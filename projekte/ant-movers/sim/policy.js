// Vorwärtsrechnung des MLP je Ameise von Hand (PLAN.md §4): zwei tanh-Schichten zu 64,
// linearer Kopf. Spiegel von ant_movers/algo/networks.py.

import { ACT_DIM, MEM_DIM, OBS_DIM } from "./sim.js";

const f = Math.fround;

export class Policy {
  /**
   * params: { w0, b0, w1, b1, w2, b2 }, w_i als flache Liste im Layout (ein, aus)
   * zeilenweise, wie JAX sie ablegt. Intern wird transponiert, damit die innere
   * Schleife über zusammenhängenden Speicher läuft.
   */
  constructor(params) {
    this.layers = [];
    for (let l = 0; params[`w${l}`] !== undefined; l++) {
      const b = Float32Array.from(params[`b${l}`]);
      const nOut = b.length;
      const w = params[`w${l}`];
      const nIn = w.length / nOut;
      const wT = new Float32Array(w.length);
      for (let i = 0; i < nIn; i++) for (let j = 0; j < nOut; j++) wT[j * nIn + i] = w[i * nOut + j];
      this.layers.push({ wT, b, nIn, nOut });
    }
    const widest = Math.max(...this.layers.map((l) => l.nOut));
    this._h = [new Float32Array(widest), new Float32Array(widest)];
    // Streuung der gelernten Verteilung (ADR 0018), nur wenn log_std mitkommt
    this.sigma = params.log_std ? sigmaFromLogStd(params.log_std) : null;
    this.checksum = params.params_checksum ?? null;
    this._raw = null;
    this._normal = null;
    this._uniform = null;
  }

  /**
   * Beobachtung -> Aktion. Mit noise (eine Noise-Quelle aus makeNoise) zieht die Policy wie
   * im Training und in der Auswertung (ppo.sample), ohne ist sie deterministisch (toAction).
   */
  act(obs, n, act, noise = null) {
    if (!this._raw || this._raw.length < n * ACT_DIM) {
      this._raw = new Float32Array(n * ACT_DIM);
      this._normal = new Float32Array(n * N_CONT);
      this._uniform = new Float32Array(n);
    }
    this.forward(obs, n, this._raw);
    if (!noise) {
      toAction(this._raw, n, act, null);
      return;
    }
    if (!this.sigma) throw new Error("Ziehen braucht log_std in den Gewichten");
    noise.fill(this._normal, this._uniform, n);
    sampleAction(this._raw, n, act, this.sigma, this._normal, this._uniform);
  }

  /** obs: (N * OBS_DIM) -> out: (N * ACT_DIM), Rohausgabe vor der Quetschung. */
  forward(obs, n, out) {
    const layers = this.layers, last = layers.length - 1;
    for (let a = 0; a < n; a++) {
      let src = obs, srcOff = a * OBS_DIM;
      for (let l = 0; l <= last; l++) {
        const { wT, b, nIn, nOut } = layers[l];
        const dst = l === last ? out : this._h[l & 1];
        const dstOff = l === last ? a * ACT_DIM : 0;
        const n4 = nIn & ~3;
        for (let j = 0; j < nOut; j++) {
          const row = j * nIn;
          // vier Akkumulatoren in double: bricht die Abhängigkeitskette und liegt
          // näher an der exakten Summe als eine float32-Kette
          let s0 = 0, s1 = 0, s2 = 0, s3 = 0, i = 0;
          for (; i < n4; i += 4) {
            s0 += src[srcOff + i] * wT[row + i];
            s1 += src[srcOff + i + 1] * wT[row + i + 1];
            s2 += src[srcOff + i + 2] * wT[row + i + 2];
            s3 += src[srcOff + i + 3] * wT[row + i + 3];
          }
          for (; i < nIn; i++) s0 += src[srcOff + i] * wT[row + i];
          const z = f(f(s0 + s1 + (s2 + s3)) + b[j]);
          dst[dstOff + j] = l === last ? z : Math.tanh(z);
        }
        src = dst;
        srcOff = 0;
      }
    }
  }
}

/**
 * Rohausgabe -> Aktion im Layout von Sim.step. Deterministisch, wenn noise null ist.
 * noise: Funktion ohne Argument, liefert einen Wert mit Mittel 0, oder null.
 */
export function toAction(raw, n, act, noise = null) {
  for (let a = 0; a < n; a++) {
    const o = a * ACT_DIM;
    for (let j = 0; j < ACT_DIM; j++) {
      const z = noise ? f(raw[o + j] + noise()) : raw[o + j];
      const t = f(Math.tanh(z));
      if (j === 2) act[o + j] = z > 0 ? 1 : 0;
      else if (j === 3 || j === 4) act[o + j] = f(0.5 + f(0.5 * t));
      else act[o + j] = t;
    }
  }
}

// --- Ziehen wie ppo.sample (ADR 0018, M5 Teil 1b) ----------------------------------------

/** Gauß-Dimensionen der Rohausgabe (ppo.CONT): Schub, Lenkung, Pheromon 0 und 1, Gedächtnis. */
export const CONT = [0, 1, 3, 4, 5, 6, 7, 8];
export const N_CONT = CONT.length;
export const GRIP = 2;
/** ppo.LOG_STD_BOUNDS, als float32 wie jnp.clip sie sieht. */
export const LOG_STD_BOUNDS = [f(-2.3), f(0.4)];

/** σ = exp(clip(log_std)) in float32, Reihenfolge CONT. */
export function sigmaFromLogStd(logStd) {
  const out = new Float32Array(N_CONT);
  for (let c = 0; c < N_CONT; c++) {
    const ls = Math.min(Math.max(f(logStd[c]), LOG_STD_BOUNDS[0]), LOG_STD_BOUNDS[1]);
    out[c] = f(Math.exp(ls));
  }
  return out;
}

/**
 * Rohausgabe plus vorgegebenes Rauschen -> Aktion. Spiegel von ppo.sample_from_noise und
 * danach networks.to_action: Gauß um die 8 stetigen Rohwerte (normal: N * 8, Reihenfolge
 * CONT), Greifen als Bernoulli (uniform: N, gleichverteilt in [0, 1), gegriffen wird bei
 * u < sigmoid(Rohwert 2), wie jax.random.bernoulli), dann tanh und Ablage 0,5 + 0,5 tanh.
 */
export function sampleAction(raw, n, act, sigma, normal, uniform) {
  for (let a = 0; a < n; a++) {
    const o = a * ACT_DIM, q = a * N_CONT;
    for (let c = 0; c < N_CONT; c++) {
      const j = CONT[c];
      const z = f(raw[o + j] + f(sigma[c] * normal[q + c]));
      const t = f(Math.tanh(z));
      act[o + j] = j === 3 || j === 4 ? f(0.5 + f(0.5 * t)) : t;
    }
    const p = f(1 / f(1 + f(Math.exp(-raw[o + GRIP]))));
    act[o + GRIP] = uniform[a] < p ? 1 : 0;
  }
}

/**
 * Rauschquelle für sampleAction: Normalverteilte per Box-Muller und Gleichverteilte aus
 * makeRng(seed). Eigener Zufall, nicht der aus JAX (ADR 0003: dieselbe Verteilung, nicht
 * dieselbe Bahn).
 */
export function makeNoise(seed) {
  const rng = makeRng(seed);
  let spare = null;
  const gauss = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    const u1 = 1 - rng(), u2 = rng(); // u1 in (0, 1]
    const r = Math.sqrt(-2 * Math.log(u1));
    spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  };
  return {
    fill(normal, uniform, n) {
      for (let i = 0; i < n * N_CONT; i++) normal[i] = gauss();
      for (let i = 0; i < n; i++) uniform[i] = rng();
    },
  };
}

/** Gewichte aus web/policies/<lauf>.json (export_policy.py) als Parameter für Policy. */
export function policyParams(json) {
  const p = { params_checksum: json.params_checksum, origin: json.origin };
  for (const k of ["w0", "b0", "w1", "b1", "w2", "b2", "log_std"]) p[k] = Float32Array.from(json[k]);
  return p;
}

/** Zufallspolicy ohne Netz: gleichverteilte Aktionen. */
export function randomAction(n, act, rng) {
  for (let a = 0; a < n; a++) {
    const o = a * ACT_DIM;
    for (let j = 0; j < ACT_DIM; j++) {
      const u = rng() * 2 - 1;
      if (j === 2) act[o + j] = u > 0 ? 1 : 0;
      else if (j === 3 || j === 4) act[o + j] = 0.5 + 0.5 * u;
      else act[o + j] = u;
    }
  }
}

/** Kleiner, schneller Zufallsgenerator (mulberry32). Liefert Zahlen in [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zufällige Gewichte für die Demo, gleiche Verteilung wie networks.init_mlp. */
export function randomParams(rng, hidden = [64, 64], gain = 1.5) {
  const gauss = () => {
    const u = Math.max(rng(), 1e-12), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const sizes = [OBS_DIM, ...hidden, ACT_DIM];
  const params = {};
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const w = new Float32Array(nIn * nOut);
    for (let i = 0; i < w.length; i++) w[i] = (gauss() * gain) / Math.sqrt(nIn);
    params[`w${l}`] = w;
    params[`b${l}`] = new Float32Array(nOut);
  }
  const lastB = params[`b${sizes.length - 2}`];
  lastB[0] = 1.0; // Vorwärtsschub
  lastB[2] = 0.5; // Greifen
  return params;
}

export { ACT_DIM, MEM_DIM, OBS_DIM };
