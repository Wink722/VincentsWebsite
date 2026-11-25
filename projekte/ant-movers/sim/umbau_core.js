// Umbau mit Ameisen (Nachtrag zu M5): Ablauf eines Transports ohne DOM, für den Browser
// (web/umbau.js) und die Vorabmessung in Node (scripts/carry_bench.mjs, Bedingungen umbau_*).
//
// Ein Transport hat vier Abschnitte, nur der zweite ist das gelernte Tragen:
//   anmarsch   Die Ameisen kommen vom linken und rechten Rand des sichtbaren Bereichs. Das Nest
//              liegt vorübergehend auf der Mitte des Elements: Freie Ameisen folgen dem Kompass
//              dorthin und greifen, sobald sie die Last sehen (6 Körperlängen). Gelernte Policy,
//              nur der Ort des Nests ist gesetzt. Umgeschaltet wird, sobald genug greifen.
//   tragen     Das Nest springt auf das Ziel (wie „Ziel versetzt“ in Teil 3c). Gelernte Policy.
//              Angekommen ist die Last wie im Training: Mitte näher als nest_r am Ziel.
//   einrasten  Animation, nicht gelernt: alle lassen los, das Element gleitet auf die Mitte des
//              Ziels und dreht sich gerade.
//   abzug      Geskriptet, nicht gelernt: Die Ameisen laufen zur nächsten Kante des Bereichs
//              (feste Regel als Aktion, dieselbe Physik schiebt sie aus Wänden und Last) und
//              verschwinden dort.
//
// Koordinaten wie in web/carrymode.js: Welt in Körperlängen, y oben, Außenwand T = 2 außerhalb
// des sichtbaren Bereichs: x = T + px / bl, y = T + (Hpx - py) / bl.

import { carryScene, loadFor, setNest } from "./carry.js";
import { ACT_DIM, OBS_DIM, Sim } from "./sim.js";

export const T_WALL = 2.0;
/** Freier Ring um Element und Ziel (Journal M5, Teil 3c), Körperlängen. */
export const RING = 3;

/** Vorgaben (Journal, Nachtrag M5 Teil 1). */
export const UMBAU = {
  bl: 10, perSlot: 16, maxAnts: 800, minPerSlot: 2, maxAspect: 6,
  switchFrac: 0.25, // Anteil belegter Griffplätze, ab dem das Nest aufs Ziel springt (gemessen 0,25 / 0,5 / 0,75)
  approachMaxS: 90, // spätestens dann umschalten (Ameisenzeit)
  carryMaxS: 300, // Zeit fürs Tragen, danach „Zeit abgelaufen“
  entryS: 4, // die Ameisen treten über so viele Sekunden ein
  band: 3, // Breite des Streifens am Rand, in dem sie eintreten
  sides: "both", // both: links und rechts je die Hälfte, near: nur der nähere Rand
  nestK: 0.16, // nest_r = max(2, nestK * Plätze) wie im Training (carry.nestRadius)
  nestR: 4, // fester nest_r in Körperlängen (Ankunft, danach Einrasten); null: nestK wie im Training
  retreatMaxS: 30,
};

const boxGap = (a, b) => Math.hypot(Math.max(Math.abs(a[0] - b[0]) - a[2] - b[2], 0), Math.max(Math.abs(a[1] - b[1]) - a[3] - b[3], 0));
const overlap = (a, b) => Math.abs(a[0] - b[0]) < a[2] + b[2] && Math.abs(a[1] - b[1]) < a[3] + b[3];

/** Bereich in Pixeln (wpx × hpx) in Welteinheiten. */
export function arenaOf(wpx, hpx, bl) {
  return { bl, wpx, hpx, x0: T_WALL, y0: T_WALL, x1: T_WALL + wpx / bl, y1: T_WALL + hpx / bl,
    W: Math.ceil(wpx / bl + 2 * T_WALL), H: Math.ceil(hpx / bl + 2 * T_WALL) };
}

/** Rechteck in Pixeln (x, y, w, h relativ zum Bereich, y unten) als [cx, cy, hx, hy] in der Welt. */
export function pxBox(ar, { x, y, w, h }) {
  return [T_WALL + (x + w / 2) / ar.bl, T_WALL + (ar.hpx - (y + h / 2)) / ar.bl, w / 2 / ar.bl, h / 2 / ar.bl];
}

/** Welt nach Pixel (relativ zum Bereich). */
export function toPx(ar, x, y) {
  return [(x - T_WALL) * ar.bl, ar.hpx - (y - T_WALL) * ar.bl];
}

/** Streifen zwischen sichtbarem Bereich und ganzzahliger Arena als Wände (wie CarryMode). */
export function edgeWalls(ar) {
  const out = [];
  if (ar.W - ar.x1 > 1e-6) out.push([(ar.x1 + ar.W) / 2, ar.H / 2, (ar.W - ar.x1) / 2, ar.H / 2]);
  if (ar.H - ar.y1 > 1e-6) out.push([ar.W / 2, (ar.y1 + ar.H) / 2, ar.W / 2, (ar.H - ar.y1) / 2]);
  return out;
}

/**
 * Last für ein Element (Box [cx, cy, hx, hy]): Form, Ameisenzahl. Rückgabe null mit Grund,
 * wenn es nicht angeboten wird.
 */
export function assessLoad(box, o = UMBAU, round = false) {
  const load = loadFor(2 * box[2], 2 * box[3], { round, maxAspect: o.maxAspect });
  if (!load) return { ok: false, why: "aspect" };
  const nAnts = Math.min(o.maxAnts, Math.round(o.perSlot * load.nSlots));
  if (nAnts < o.minPerSlot * load.nSlots) return { ok: false, why: "size" };
  return { ok: true, load, nAnts };
}

/** Passt ein Element mit halben Seiten (hx, hy) samt Ring bei (x, y) in den Bereich, ohne Wand? */
export function fitsAt(ar, walls, hx, hy, x, y, ring = RING) {
  const b = [x, y, hx + ring, hy + ring];
  if (x - b[2] < ar.x0 || x + b[2] > ar.x1 || y - b[3] < ar.y0 || y + b[3] > ar.y1) return false;
  return !walls.some((w) => overlap(b, w));
}

/**
 * Freie Bahn: Das Element (ohne Ring, um tol verkleinert) lässt sich auf der Geraden von
 * start nach target schieben, ohne eine Wand zu schneiden. Die Policy plant keinen Umweg
 * (Kompass), Ziele hinter einem Hindernis scheiterten in der Vorabmessung meist.
 */
export function pathFree(walls, hx, hy, start, target, tol = 0.25) {
  const d = Math.hypot(target[0] - start[0], target[1] - start[1]);
  const n = Math.max(1, Math.ceil(d / 0.5));
  for (let k = 1; k <= n; k++) {
    const u = k / n, b = [start[0] + (target[0] - start[0]) * u, start[1] + (target[1] - start[1]) * u, hx - tol, hy - tol];
    if (walls.some((w) => overlap(b, w))) return false;
  }
  return true;
}

/**
 * Nächste erlaubte Zielmitte zu (x, y) auf einem Raster von step Körperlängen, höchstens
 * maxDist entfernt. Rückgabe [x, y] oder null.
 */
export function snapTarget(ar, walls, hx, hy, x, y, { ring = RING, step = 0.5, maxDist = Infinity, from = null, minDist = 0 } = {}) {
  const ok = (xx, yy) => fitsAt(ar, walls, hx, hy, xx, yy, ring) &&
    (!from || (Math.hypot(xx - from[0], yy - from[1]) >= minDist && pathFree(walls, hx, hy, from, [xx, yy])));
  if (ok(x, y)) return [x, y];
  let best = null, bd = maxDist;
  for (let yy = ar.y0 + hy + ring; yy <= ar.y1 - hy - ring; yy += step) {
    for (let xx = ar.x0 + hx + ring; xx <= ar.x1 - hx - ring; xx += step) {
      const d = Math.hypot(xx - x, yy - y);
      if (d < bd && ok(xx, yy)) { bd = d; best = [xx, yy]; }
    }
  }
  return best;
}

/** Alle erlaubten Zielmitten (Raster), etwa für „gibt es überhaupt ein Ziel“ und die Messung. Mit from: nur mit
 * freier Bahn von from und mindestens minDist entfernt. */
export function allTargets(ar, walls, hx, hy, { ring = RING, step = 1, from = null, minDist = 0, limit = Infinity } = {}) {
  const out = [];
  for (let yy = ar.y0 + hy + ring; yy <= ar.y1 - hy - ring; yy += step) {
    for (let xx = ar.x0 + hx + ring; xx <= ar.x1 - hx - ring; xx += step) {
      if (!fitsAt(ar, walls, hx, hy, xx, yy, ring)) continue;
      if (from && (Math.hypot(xx - from[0], yy - from[1]) < minDist || !pathFree(walls, hx, hy, from, [xx, yy]))) continue;
      out.push([xx, yy]);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * Ein Transport: Szene bauen, Ameisen vom Rand, Anmarsch, Tragen, Einrasten, Abzug.
 * walls ohne das Element selbst, box = Element [cx, cy, hx, hy], start = aktuelle Mitte und
 * Drehung { x, y, rot }, target [x, y], policy und rng/noise wie in CarryMode.
 */
export class Transport {
  constructor({ ar, walls, box, round = false, assessment, start, target, policy, rng, noise, opts = {} }) {
    const o = (this.o = { ...UMBAU, ...opts });
    this.ar = ar;
    this.policy = policy;
    this.rng = rng;
    this.noise = noise;
    this.target = target;
    const a = assessment ?? assessLoad(box, o, round);
    this.assessment = a;
    const load = { ...a.load, ang: a.load.ang + (start.rot ?? 0) };
    this.ang0 = a.load.ang; // gerade Lage des Elements
    const nestR = (this.nestR = o.nestR ?? Math.max(2, o.nestK * load.nSlots));
    const { cfg, spec, scene } = carryScene({ nAnts: a.nAnts, load, pos: [start.x, start.y], walls: [...walls, ...edgeWalls(ar)],
      nest: [start.x, start.y], width: ar.W, height: ar.H, tMaxS: o.carryMaxS, nestR });
    this.cfg = cfg;
    this.spec = spec;
    const sim = (this.sim = new Sim(cfg, scene));
    sim.reset(rng);
    this.n = sim.n;
    this.obs = new Float32Array(sim.n * OBS_DIM);
    this.act = new Float32Array(sim.n * ACT_DIM);
    this._spawn();
    this.phase = "anmarsch";
    this.tPhase = 0; // Schritte im Abschnitt
    this.start = [start.x, start.y];
    this.log = { slip: 0, slipRot: 0, tSwitch: null, tCarry: null, occ25: null, occ50: null, occ75: null, near: 0,
      snapDist: null, snapRot: null };
  }

  /** Eintrittspunkte am linken und rechten Rand, Eintritt gestaffelt über entryS. */
  _spawn() {
    const { sim, ar, o, rng } = this, { cfg } = sim, c = cfg.sdf_cell;
    const dist = (x, y) => {
      const i = Math.min(sim.Ws - 1, Math.max(0, Math.round(x / c)));
      const j = Math.min(sim.Hs - 1, Math.max(0, Math.round(y / c)));
      return sim.sdf[3 * (j * sim.Ws + i)];
    };
    const lx = sim.loadPos[0];
    const leftNear = lx - ar.x0 <= ar.x1 - lx;
    this.entry = new Int32Array(sim.n);
    const steps = Math.max(1, Math.round(o.entryS / cfg.dt));
    for (let i = 0; i < sim.n; i++) {
      const left = o.sides === "near" ? leftNear : i % 2 === 0;
      let x = 0, y = 0;
      for (let k = 0; k < 60; k++) {
        const u = ar.x0 + cfg.r_ant + rng() * (o.band - cfg.r_ant);
        x = left ? u : ar.x1 - (u - ar.x0);
        y = ar.y0 + 1 + rng() * (ar.y1 - ar.y0 - 2);
        if (dist(x, y) > cfg.r_ant + 0.25) break;
      }
      sim.pos[2 * i] = x;
      sim.pos[2 * i + 1] = y;
      sim.theta[i] = (left ? 0 : Math.PI) + (rng() - 0.5) * 1.2;
      this.entry[i] = Math.floor((i / sim.n) * steps);
      sim.active[i] = this.entry[i] === 0 ? 1 : 0;
    }
    sim._depositDensity();
  }

  get done() {
    return this.phase === "fertig";
  }

  /** Belegte Griffplätze. */
  occupied() {
    let g = 0;
    for (let s = 0; s < this.sim.S; s++) g += this.sim.slotOcc[s];
    return g;
  }

  /** Ziel versetzen (nur während anmarsch und tragen). */
  setTarget(x, y) {
    this.target = [x, y];
    if (this.phase === "tragen") setNest(this.sim, x, y);
  }

  /** Ein Schritt (dt Ameisenzeit) in anmarsch, tragen und abzug. Einrasten: snapStep. */
  tick() {
    const { sim, o } = this, dt = sim.cfg.dt;
    if (this.phase === "anmarsch" || this.phase === "tragen") {
      if (this.phase === "anmarsch") {
        for (let i = 0; i < sim.n; i++) if (this.entry[i] === this.tPhase) sim.active[i] = 1;
        setNest(sim, sim.loadPos[0], sim.loadPos[1]);
      }
      sim.observe(this.obs);
      this.policy.act(this.obs, sim.n, this.act, this.noise);
      sim.step(this.act);
      this.tPhase++;
      if (this.phase === "anmarsch") {
        const slip = Math.hypot(sim.loadPos[0] - this.start[0], sim.loadPos[1] - this.start[1]);
        this.log.slip = Math.max(this.log.slip, slip);
        const frac = this.occupied() / this.spec.n_slots, t = this.tPhase * dt;
        if (frac >= 0.25 && this.log.occ25 === null) this.log.occ25 = t;
        if (frac >= 0.5 && this.log.occ50 === null) this.log.occ50 = t;
        if (frac >= 0.75 && this.log.occ75 === null) this.log.occ75 = t;
        if (frac >= o.switchFrac || t >= o.approachMaxS) {
          this.log.tSwitch = t;
          this.log.slipRot = Math.abs(wrap(sim.loadAng - this.ang0));
          this.log.near = this._nearFrac();
          this.phase = "tragen";
          this.tPhase = 0;
          setNest(sim, this.target[0], this.target[1]);
        }
      } else if (sim.atNest()) {
        this.log.tCarry = this.tPhase * dt;
        this._arrive();
      } else if (this.tPhase * dt >= o.carryMaxS) {
        this.log.tCarry = null;
        this.phase = "zeit";
      }
      return;
    }
    if (this.phase === "abzug" || this.phase === "einrasten") this._retreatStep();
  }

  /** Anteil der aktiven Ameisen, die die Last sehen oder greifen (aus der letzten Beobachtung). */
  _nearFrac() {
    const { sim, obs } = this;
    let a = 0, k = 0;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.active[i]) continue;
      a++;
      const p = i * OBS_DIM;
      if (sim.grip[i] || obs[p + 12] > 0 || obs[p + 10] !== 0 || obs[p + 11] !== 0) k++;
    }
    return a ? k / a : 0;
  }

  _arrive() {
    const { sim } = this;
    this.log.snapDist = Math.hypot(sim.loadPos[0] - this.target[0], sim.loadPos[1] - this.target[1]);
    this.log.snapRot = wrap(sim.loadAng - this.ang0);
    this.snapFrom = { x: sim.loadPos[0], y: sim.loadPos[1], ang: sim.loadAng };
    // alle lassen los (Animation ab hier)
    sim.grip.fill(0);
    sim.slotOcc.fill(0);
    sim.tDock.fill(0);
    sim.loadVel.fill(0);
    sim.loadOmega = 0;
    this.phase = "einrasten";
    this.tPhase = 0;
    this.snapU = 0;
  }

  /** Aufgeben (Zeit abgelaufen, Abbruch): alle lassen los und ziehen ab, das Element bleibt, wo es ist. */
  giveUp() {
    const { sim } = this;
    sim.grip.fill(0);
    sim.slotOcc.fill(0);
    sim.tDock.fill(0);
    sim.loadVel.fill(0);
    sim.loadOmega = 0;
    this.phase = "abzug";
    this.tPhase = 0;
  }

  /** Einrasten: u von 0 bis 1 (Anteil der Animation). Setzt Lage und Winkel der Last. */
  snapTo(u) {
    const { sim } = this, s = this.snapFrom;
    const e = u >= 1 ? 1 : 1 - Math.pow(1 - u, 3);
    sim.loadPos[0] = s.x + (this.target[0] - s.x) * e;
    sim.loadPos[1] = s.y + (this.target[1] - s.y) * e;
    sim.loadAng = s.ang + wrap(this.ang0 - s.ang) * e;
    this.snapU = u;
    if (u >= 1 && this.phase === "einrasten") this.phase = "abzug";
  }

  /** Abzug: feste Regel, Ameise lenkt zur nächsten Kante und läuft, am Rand verschwindet sie. */
  _retreatStep() {
    const { sim, ar, act } = this, { cfg } = sim, turn = cfg.omega_max * cfg.dt;
    act.fill(0);
    let left = 0;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.active[i]) continue;
      const x = sim.pos[2 * i], y = sim.pos[2 * i + 1];
      const d = [x - ar.x0, ar.x1 - x, y - ar.y0, ar.y1 - y];
      let k = 0;
      for (let j = 1; j < 4; j++) if (d[j] < d[k]) k = j;
      if (d[k] < 0.6) { sim.active[i] = 0; continue; }
      left++;
      const want = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][k] + (this.rng() - 0.5) * 0.8;
      const err = wrap(want - sim.theta[i]);
      act[i * ACT_DIM] = 1;
      act[i * ACT_DIM + 1] = Math.max(-1, Math.min(1, err / turn));
      act[i * ACT_DIM + 2] = -1;
    }
    sim.step(act);
    sim.grip.fill(0);
    sim.slotOcc.fill(0);
    if (this.phase === "einrasten") return;
    this.tPhase++;
    if (left === 0 || this.tPhase * cfg.dt >= this.o.retreatMaxS) {
      sim.active.fill(0);
      this.phase = "fertig";
    }
  }
}
