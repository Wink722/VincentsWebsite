// Tragemodus (M5, Teile 3b und 3d): Die Ameisen tragen ein Element einer Webseite.
//
// Ein Element im Bereich anklicken, es wird zur Last (Rechteck mit seinem Seitenverhältnis
// über loadFor, runde Elemente Scheibe), eine freie Stelle anklicken, sie wird das Nest. Die
// Bounding-Boxen der übrigen Elemente und der Rand des Bereichs sind Wände (achsparallele
// Rechtecke wie in der Physik, web/carry.js). Das DOM-Element folgt per transform (translate,
// rotate) der Lage der Last und bleibt lesbar und klickbar, die Ameisen laufen auf einer
// durchsichtigen Leinwand darüber, die Klicks durchlässt. Zurücksetzen stellt alles an seinen
// Platz.
//
// Dieselbe Physik (web/sim.js) und dieselbe Policy (Seed 0, gezogen wie im Training) wie in
// der Live-Demo, aber Szenen, die es im Training nie gab: eine Spielwiese außerhalb der
// Auswertung. Vorabmessung in Node: Journal M5, Teil 3c (scripts/carry_bench.mjs).
//
// Koordinaten: Welt in Körperlängen, y nach oben wie in der Physik. Der Bereich liegt innen in
// der Arena, die Außenwand (wall_thick) liegt außerhalb des sichtbaren Bereichs:
//   x = T + px / bl,  y = T + (Hpx - py) / bl.
// Winkel: Die Welt dreht gegen den Uhrzeigersinn (y oben), CSS rotate im Uhrzeigersinn
// (y unten), das Element dreht deshalb um −(Winkel − Startwinkel).

import { carryScene, loadFor, nestRadius, setNest } from "./carry.js";
import { Frame, lerpFrame, snapshot } from "./frame.js";
import { Policy, makeNoise, makeRng, policyParams } from "./policy.js";
import { Renderer } from "./render.js";
import { ACT_DIM, OBS_DIM, Sim } from "./sim.js";

const MAX_STEPS_PER_FRAME = 8;
/** Freier Ring um das Element (Journal M5, Teil 3c), in Körperlängen. */
export const FREE_RING = 3;

/** Abstand eines Punkts zu einem Rechteck [cx, cy, hx, hy]. */
function boxDist(x, y, [cx, cy, hx, hy]) {
  return Math.hypot(Math.max(Math.abs(x - cx) - hx, 0), Math.max(Math.abs(y - cy) - hy, 0));
}

/** Abstand zweier Rechtecke [cx, cy, hx, hy]. */
function boxGap(a, b) {
  return Math.hypot(Math.max(Math.abs(a[0] - b[0]) - a[2] - b[2], 0), Math.max(Math.abs(a[1] - b[1]) - a[3] - b[3], 0));
}

/** Policy aus einer JSON-Datei (web/policies). */
export async function loadPolicy(url) {
  const json = await fetch(url).then((r) => r.json());
  return { policy: new Policy(policyParams(json)), json };
}

export class CarryMode {
  /**
   * area: Bereich (position relative oder absolute). policy: Policy aus loadPolicy.
   * Optionen: bl Pixel je Körperlänge, perSlot Ameisen je Griffplatz, maxAnts, minPerSlot
   * (darunter wird ein Element nicht angeboten), maxAspect, factor Zeitfaktor, tMaxS,
   * carry/walls Selektoren, textWalls Selektor für Elemente, deren Wand nur die Ausdehnung ihres
   * Texts ist (Range, etwa Überschriften mit display: block), canvasClass Klasse der Leinwand,
   * onStatus(status) für die Anzeige.
   */
  constructor(area, policy, opts = {}) {
    this.area = area;
    this.policy = policy;
    this.o = { bl: 12, perSlot: 6, maxAnts: 500, minPerSlot: 2, maxAspect: 6, factor: 4, tMaxS: 300,
      carry: "[data-carry]", walls: "[data-wall]", textWalls: null, canvasClass: "", seed: 20261125, onStatus: () => {}, ...opts };
    this.rng = makeRng(this.o.seed);
    this.episode = 0;
    this.phase = "idle"; // idle | pick | target | run | done
    this.el = null; // getragenes Element
    this.moved = new Map(); // Element -> { dx, dy, rot, transform } (Pixel, Welt-Bogenmaß)
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "5" });
    this.canvas.setAttribute("aria-hidden", "true");
    if (this.o.canvasClass) this.canvas.className = this.o.canvasClass;
    area.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas, { clear: true, drawLoad: false });
    this.renderer.layers.phero = false;
    this._click = (e) => this._onClick(e);
    area.addEventListener("click", this._click, true);
    this._vis = () => { this.lastNow = null; };
    document.addEventListener("visibilitychange", this._vis);
    this._resize = () => { if (this.phase !== "idle") this.reset(); };
    window.addEventListener("resize", this._resize);
    this.raf = null;
    this.paused = false;
  }

  /** Kandidaten: wählbare Elemente im Bereich. */
  candidates() {
    return [...this.area.querySelectorAll(this.o.carry)];
  }

  // --- Geometrie ---

  _frame() {
    const r = this.area.getBoundingClientRect();
    const T = 2.0; // wall_thick aus makeConfig
    const bl = this.o.bl;
    return { r, T, bl, Wpx: r.width, Hpx: r.height, W: Math.ceil(r.width / bl + 2 * T), H: Math.ceil(r.height / bl + 2 * T) };
  }

  _toWorld(fr, clientX, clientY) {
    return [fr.T + (clientX - fr.r.left) / fr.bl, fr.T + (fr.Hpx - (clientY - fr.r.top)) / fr.bl];
  }

  /** Bounding-Box eines Elements als Wand [cx, cy, hx, hy] in Welteinheiten. */
  _box(fr, el) {
    let b = el.getBoundingClientRect();
    if (this.o.textWalls && el.matches(this.o.textWalls)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      b = range.getBoundingClientRect();
    }
    const [cx, cy] = this._toWorld(fr, b.left + b.width / 2, b.top + b.height / 2);
    return [cx, cy, b.width / 2 / fr.bl, b.height / 2 / fr.bl];
  }

  _walls(fr, except) {
    const els = new Set([...this.candidates(), ...this.area.querySelectorAll(this.o.walls),
      ...(this.o.textWalls ? this.area.querySelectorAll(this.o.textWalls) : [])]);
    els.delete(except);
    const walls = [...els].filter((e) => e.offsetParent !== null).map((e) => this._box(fr, e));
    // Streifen zwischen Bereich und gerundeter Arena (weniger als eine Körperlänge)
    const x0 = fr.T + fr.Wpx / fr.bl, y0 = fr.T + fr.Hpx / fr.bl;
    if (fr.W - x0 > 1e-6) walls.push([(x0 + fr.W) / 2, fr.H / 2, (fr.W - x0) / 2, fr.H / 2]);
    if (fr.H - y0 > 1e-6) walls.push([fr.W / 2, (y0 + fr.H) / 2, fr.W / 2, (fr.H - y0) / 2]);
    return walls;
  }

  /**
   * Prüft ein Element: Form, Ameisenzahl, freier Ring. Rückgabe { ok, load, nAnts, warn, why }.
   */
  assess(el) {
    const fr = this._frame();
    const w = el.offsetWidth / fr.bl, h = el.offsetHeight / fr.bl;
    const cs = getComputedStyle(el);
    const round = el.dataset.carryShape === "disc" ||
      (Math.abs(el.offsetWidth - el.offsetHeight) < 2 && parseFloat(cs.borderTopLeftRadius) >= el.offsetWidth / 2 - 1);
    const load = loadFor(w, h, { round, maxAspect: this.o.maxAspect });
    if (!load) return { ok: false, why: `Seitenverhältnis über ${this.o.maxAspect} : 1` };
    const nAnts = Math.min(this.o.maxAnts, Math.round(this.o.perSlot * load.nSlots));
    if (nAnts < this.o.minPerSlot * load.nSlots) return { ok: false, why: "zu groß für die Ameisen" };
    const box = this._box(fr, el);
    const gap = Math.min(...this._walls(fr, el).map((b) => boxGap(box, b)),
      box[0] - box[2] - fr.T, fr.T + fr.Wpx / fr.bl - box[0] - box[2],
      box[1] - box[3] - fr.T, fr.T + fr.Hpx / fr.bl - box[1] - box[3]);
    return { ok: true, load, nAnts, warn: gap < FREE_RING ? "klappt nicht immer (wenig Platz ringsum)" : null };
  }

  // --- Bedienung ---

  /** Element wählen: der nächste Klick auf ein wählbares Element macht es zur Last. */
  pick() {
    if (this.phase === "run" || this.phase === "done") this._stopSim();
    this.phase = "pick";
    this.area.classList.add("carry-picking");
    this._status();
  }

  _onClick(e) {
    if (this.phase === "pick") {
      const el = e.target.closest(this.o.carry);
      if (!el || !this.area.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const a = this.assess(el);
      if (!a.ok) { this._status(`nicht wählbar: ${a.why}`); return; }
      this._select(el, a);
      return;
    }
    if (this.phase === "target" || this.phase === "run" || this.phase === "done") {
      if (e.target.closest(this.o.carry) || e.target.closest(this.o.walls) ||
        (this.o.textWalls && e.target.closest(this.o.textWalls))) return; // Elemente bleiben klickbar
      e.preventDefault();
      this._target(e.clientX, e.clientY);
    }
  }

  /** Element ohne Klick zur Last machen (etwa ein eingefügtes Abzeichen). Rückgabe wie assess. */
  select(el) {
    if (this.phase === "run" || this.phase === "done") this._stopSim();
    const a = this.assess(el);
    if (a.ok) this._select(el, a);
    return a;
  }

  /** Anhalten (etwa außer Sicht) und weiterlaufen lassen, ohne Zeitsprung. */
  setPaused(p) {
    this.paused = !!p;
    if (this.paused) {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
    } else if (this.phase === "run") {
      this.lastNow = null;
      this._loop();
    }
  }

  _select(el, assessment) {
    for (const c of this.candidates()) c.classList.remove("carry-load");
    this.el = el;
    this.assessment = assessment;
    el.classList.add("carry-load");
    this.area.classList.remove("carry-picking");
    this.phase = "target";
    this._status();
  }

  _target(clientX, clientY) {
    const fr = this._frame();
    const [x, y] = this._toWorld(fr, clientX, clientY);
    const walls = this._walls(fr, this.el);
    const inner = Math.min(x - fr.T, fr.T + fr.Wpx / fr.bl - x, y - fr.T, fr.T + fr.Hpx / fr.bl - y);
    if (inner < FREE_RING || walls.some((b) => boxDist(x, y, b) < FREE_RING)) {
      this._status("Ziel zu nah an einem Element oder am Rand");
      return;
    }
    if (this.phase === "target") this._startSim(fr, walls, [x, y]);
    else {
      setNest(this.sim, x, y);
      if (this.phase === "done") { this.phase = "run"; this.outcome = null; this.t0 = this.sim.t; this._loop(); }
    }
    this._status();
  }

  _startSim(fr, walls, nest) {
    const el = this.el, a = this.assessment;
    const st = this.moved.get(el) ?? { dx: 0, dy: 0, rot: 0, transform: el.style.transform };
    this.moved.set(el, st);
    // natürliche Mitte (ohne transform), Startlage = jetzige Mitte
    const b = el.getBoundingClientRect();
    const [lx, ly] = this._toWorld(fr, b.left + b.width / 2, b.top + b.height / 2);
    this.base = { st, x0: lx - st.dx / fr.bl, y0: ly + st.dy / fr.bl, ang0: a.load.ang };
    const load = { ...a.load, ang: a.load.ang + st.rot };
    const { cfg, scene } = carryScene({ nAnts: a.nAnts, load, pos: [lx, ly], walls, nest, width: fr.W, height: fr.H,
      tMaxS: this.o.tMaxS });
    const sim = (this.sim = new Sim(cfg, scene));
    sim.reset(this.rng);
    this._respawn(sim);
    this.episode++;
    this.noise = makeNoise((this.o.seed + 7919 * this.episode) >>> 0);
    this.obs = new Float32Array(sim.n * OBS_DIM);
    this.act = new Float32Array(sim.n * ACT_DIM);
    this.prev = snapshot(sim, new Frame(sim.n));
    this.view = Object.assign(new Frame(sim.n), { cfg, row: sim.row, W: sim.W, H: sim.H, Ws: sim.Ws, Hs: sim.Hs,
      phero: sim.phero, density: sim.density });
    this.renderer.setScene(sim, false);
    const cam = this.renderer.camera;
    cam.cx = fr.T + fr.Wpx / fr.bl / 2;
    cam.cy = fr.T + fr.Hpx / fr.bl / 2;
    cam.halfH = fr.Hpx / fr.bl / 2;
    this.fr = fr;
    el.style.willChange = "transform";
    this.acc = 0;
    this.lastNow = null;
    this.t0 = 0;
    this.outcome = null;
    this.phase = "run";
    this.timeLog = [];
    this._loop();
  }

  /**
   * Startzone wie im Training (Ring um die Last, feste Dichte, sim.reset). Wer dabei in einem
   * anderen Element landet, wird im Ring neu gezogen (Training: Wände sind dort Szenarien
   * mit freiem Ring, Journal M5 Teil 3c).
   */
  _respawn(sim) {
    const { cfg, row } = sim, c = cfg.sdf_cell, m = cfg.wall_thick + 1.0;
    const dist = (x, y) => {
      const i = Math.min(sim.Ws - 1, Math.max(0, Math.round(x / c)));
      const j = Math.min(sim.Hs - 1, Math.max(0, Math.round(y / c)));
      return sim.sdf[3 * (j * sim.Ws + i)];
    };
    const lx = sim.loadPos[0], ly = sim.loadPos[1], r0 = row.spawn_r0, r1 = row.spawn_r1;
    for (let i = 0; i < sim.n; i++) {
      for (let k = 0; k < 40 && dist(sim.pos[2 * i], sim.pos[2 * i + 1]) < cfg.r_ant + 0.25; k++) {
        const r = Math.sqrt(r0 * r0 + this.rng() * (r1 * r1 - r0 * r0)), a = (this.rng() * 2 - 1) * Math.PI;
        sim.pos[2 * i] = Math.min(Math.max(lx + r * Math.cos(a), m), cfg.width - m);
        sim.pos[2 * i + 1] = Math.min(Math.max(ly + r * Math.sin(a), m), cfg.height - m);
      }
    }
    sim._depositDensity();
  }

  _tick() {
    const sim = this.sim;
    sim.observe(this.obs);
    this.policy.act(this.obs, sim.n, this.act, this.noise);
    sim.step(this.act);
    if (!this.outcome) {
      if (sim.atNest()) this.outcome = { kind: "nest", t: (sim.t - this.t0) * sim.cfg.dt };
      else if (sim.t - this.t0 >= sim.row.t_max) this.outcome = { kind: "timeout", t: (sim.t - this.t0) * sim.cfg.dt };
    }
  }

  _loop() {
    if (this.raf !== null || this.paused) return;
    const frame = (now) => {
      this.raf = null;
      if (this.phase !== "run" || this.paused) return;
      this.raf = requestAnimationFrame(frame);
      const real = this.lastNow === null ? 0 : Math.min((now - this.lastNow) / 1000, 0.25);
      this.lastNow = now;
      const dt = this.sim.cfg.dt;
      this.acc += real * this.o.factor;
      let steps = 0;
      const c0 = performance.now();
      while (this.acc >= dt && steps < MAX_STEPS_PER_FRAME && !this.outcome) {
        snapshot(this.sim, this.prev);
        this._tick();
        this.acc -= dt;
        steps++;
      }
      this.cpuMs = performance.now() - c0;
      if (this.acc >= dt) this.acc = 0.999 * dt;
      this.timeLog.push({ real, sim: steps * dt });
      while (this.timeLog.length > 120) this.timeLog.shift();
      this._draw(this.outcome ? 1 : Math.min(1, this.acc / dt));
      if (this.outcome) { this.phase = "done"; this.raf && cancelAnimationFrame(this.raf); this.raf = null; this._draw(1); }
      this._status();
    };
    this.raf = requestAnimationFrame(frame);
  }

  _draw(alpha) {
    const { sim, view, fr, base } = this;
    lerpFrame(this.prev, sim, alpha, view);
    this.renderer.draw(view);
    const st = base.st;
    st.dx = (view.loadPos[0] - base.x0) * fr.bl;
    st.dy = -(view.loadPos[1] - base.y0) * fr.bl;
    st.rot = view.loadAng - base.ang0;
    this.el.style.transform = `translate(${st.dx.toFixed(2)}px, ${st.dy.toFixed(2)}px) rotate(${(-st.rot).toFixed(4)}rad)`;
  }

  _stopSim() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.sim = null;
    const gl = this.renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.el) this.el.style.willChange = "";
  }

  /** Alles an seinen Platz. */
  reset() {
    this._stopSim();
    for (const [el, st] of this.moved) el.style.transform = st.transform ?? "";
    this.moved.clear();
    for (const c of this.candidates()) c.classList.remove("carry-load");
    this.area.classList.remove("carry-picking");
    this.el = null;
    this.phase = "idle";
    this._status();
  }

  setFactor(fct) {
    this.o.factor = fct;
    if (this.timeLog) this.timeLog.length = 0;
    this._status();
  }

  /** Zustand für die Anzeige. */
  status(msg = null) {
    const s = { phase: this.phase, factor: this.o.factor, msg, warn: this.assessment?.warn ?? null };
    if (this.el && this.assessment) Object.assign(s, { nAnts: this.assessment.nAnts, nSlots: this.assessment.load.nSlots,
      shape: this.assessment.load.shape });
    const sim = this.sim;
    if (sim) {
      let grip = 0;
      for (let i = 0; i < sim.n; i++) grip += sim.grip[i];
      const real = this.timeLog.reduce((a, x) => a + x.real, 0), simT = this.timeLog.reduce((a, x) => a + x.sim, 0);
      Object.assign(s, { grip, t: (sim.t - this.t0) * sim.cfg.dt, tMax: sim.row.t_max * sim.cfg.dt,
        actual: real > 0.5 ? simT / real : this.o.factor, outcome: this.outcome, cpuMs: this.cpuMs });
    }
    return s;
  }

  _status(msg = null) {
    this.o.onStatus(this.status(msg));
  }

  destroy() {
    this.reset();
    this.area.removeEventListener("click", this._click, true);
    document.removeEventListener("visibilitychange", this._vis);
    window.removeEventListener("resize", this._resize);
    this.canvas.remove();
  }
}

export { nestRadius };
