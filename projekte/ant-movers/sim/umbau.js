// Umbau mit Ameisen (Nachtrag zu M5): Die Ameisen tragen Teile einer Webseite an eine andere
// Stelle. Ablauf und Messung in web/umbau_core.js (Anmarsch und Tragen gelernt, Einrasten
// Animation, Abzug geskriptet), hier nur die Seite: Elemente wählen, Ziel prüfen, Leinwand,
// transform, Zurücksetzen.
//
// Im Umbaumodus wählt ein Klick auf ein angebotenes Element dieses aus, ein Klick auf eine freie
// Stelle setzt das Ziel (die nächste Stelle mit Platz samt Ring und freier gerader Bahn).
// Getroffen ist ein Text nur auf seiner Ausdehnung (inkRect, 6 Pixel Rand), nicht auf der ganzen
// Box: Neben einem kurzen Absatz liegt eine freie Stelle. Ist ein Element gewählt oder läuft ein
// Transport, ist jeder Klick ein Ziel (auch auf Knöpfe und nicht angebotene Elemente, nichts
// löst aus), außer auf ein anderes angebotenes Element (neue Wahl). Ohne Wahl sagt ein Klick auf
// ein nicht angebotenes Element, warum es nicht geht, und löst ebenfalls nicht aus. Durch gehen
// nur Klicks auf ignore (Kasten, Kopfzeile), auf freie Stellen ohne Wahl und Klicks per Tastatur.
// Außerhalb des Modus und nach dem Tragen ist alles normal klickbar: Das DOM-Element selbst
// wird per transform verschoben.
//
// Nach Vincents Rückmeldung („noch sehr buggy“, Website nach M6): Vorher reagierten Absätze auf
// ihre ganze Box (die Kennzeile des Hero 1100 statt 427 Pixel), ein Klick daneben meldete „zu
// schmal“ statt ein Ziel zu setzen, und mit gewähltem Element löste ein Klick auf einen Knopf
// dessen Link aus.
//
// Arena ist der sichtbare Bereich unter einer festen Kopfzeile, wenn ein Transport beginnt; die
// Leinwand liegt dort im Dokument (position: absolute), Scrollen nimmt sie mit wie die
// Elemente. Außer Sicht hält der Transport an.

import { Frame, lerpFrame, snapshot } from "./frame.js";
import { Policy, makeNoise, makeRng, policyParams } from "./policy.js";
import { Renderer } from "./render.js";
import { RING, Transport, UMBAU, allTargets, arenaOf, assessLoad, snapTarget } from "./umbau_core.js";

const MAX_STEPS_PER_FRAME = 8;
const SNAP_S = 0.7; // Einrasten in Sekunden echter Zeit
const MIN_DIST = 10; // kleinster Abstand von Start und Ziel, Körperlängen
const HIT_PAD = 6; // Rand um die Ausdehnung eines Texts, in dem ein Klick ihn trifft (Pixel)

/** Policy aus einer JSON-Datei (web/policies). */
export async function loadPolicy(url) {
  const json = await fetch(url).then((r) => r.json());
  return { policy: new Policy(policyParams(json)), json };
}

const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed";

/**
 * Sichtbare Ausdehnung eines Elements im Viewport: bei Texten die Vereinigung der Textzeilen
 * (geschnitten mit der Box des Elements, ausgeblendete Sprachen zählen nicht), sonst die Box.
 */
export function inkRect(e, text) {
  const b = e.getBoundingClientRect();
  if (!text) return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  let n, u = null;
  const r = document.createRange();
  while ((n = w.nextNode())) {
    if (!n.textContent.trim()) continue;
    const l = n.parentElement.closest("[lang]");
    if (l && l !== document.documentElement && !vis(l)) continue;
    r.selectNodeContents(n);
    for (const c of r.getClientRects()) {
      if (!c.width) continue;
      u = u ? { left: Math.min(u.left, c.left), top: Math.min(u.top, c.top), right: Math.max(u.right, c.right), bottom: Math.max(u.bottom, c.bottom) }
        : { left: c.left, top: c.top, right: c.right, bottom: c.bottom };
    }
  }
  if (!u) return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  return { left: Math.max(u.left, b.left), top: Math.max(u.top, b.top), right: Math.min(u.right, b.right), bottom: Math.min(u.bottom, b.bottom) };
}

export class Umbau {
  /**
   * policy aus loadPolicy. Optionen: candidates [{ sel, text }] (wählbare Blöcke, die übrigen
   * sind Wände), walls Selektoren weiterer Wände, ignore Selektor, dessen Klicks immer
   * durchgehen (Kasten, Kopfzeile), header Selektor der festen Kopfzeile (Arena darunter),
   * factor, seed, onStatus(status), dazu die Werte aus UMBAU (bl, perSlot, maxAnts, ...).
   */
  constructor(policy, opts = {}) {
    this.policy = policy;
    this.o = { ...UMBAU, factor: 4, candidates: [], walls: [], ignore: null, header: null, seed: 20261125,
      canvasClass: "", onStatus: () => {}, ...opts };
    this.rng = makeRng(this.o.seed >>> 0);
    this.episode = 0;
    this.active = false;
    this.sel = null; // gewähltes Element
    this.tr = null; // laufender Transport
    this.moved = new Map(); // Element -> { dx, dy, rot, transform, origin }
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0",
      pointerEvents: "none", zIndex: "40", display: "none" });
    this.canvas.setAttribute("aria-hidden", "true");
    if (this.o.canvasClass) this.canvas.className = this.o.canvasClass;
    document.body.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas, { clear: true, drawLoad: false });
    this.renderer.layers.phero = false;
    this.feld = document.createElement("div"); // Zielfeld
    this.feld.className = "umbau-zielfeld";
    Object.assign(this.feld.style, { position: "absolute", pointerEvents: "none", zIndex: "39", display: "none" });
    this.feld.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.feld);
    this._click = (e) => this._onClick(e);
    this._key = (e) => { if (e.key === "Escape" && this.sel) { this._select(null); this._status(); } };
    this._vis = () => { this.lastNow = null; };
    document.addEventListener("visibilitychange", this._vis);
    this.sicht = new IntersectionObserver(([e]) => this.setPaused(!e.isIntersecting), { threshold: 0 });
    this.sicht.observe(this.canvas);
    this.raf = null;
    this.paused = false;
    this.msg = null;
    let warte = null;
    this._scroll = () => {
      if (!this.active) return;
      this._unmarkOutside(); // sofort: was nicht mehr ganz im Bild ist, ist nicht mehr wählbar
      clearTimeout(warte);
      warte = setTimeout(() => this._mark(), 1000); // nach dem Einblenden beim Scrollen (0,8 s)
    };
    addEventListener("scroll", this._scroll, { passive: true });
  }

  // --- Elemente und Geometrie ---

  _cands() {
    const out = [];
    for (const { sel, text } of this.o.candidates) for (const e of document.querySelectorAll(sel)) if (vis(e)) out.push({ e, text: !!text });
    return out;
  }

  /** Arena: sichtbarer Bereich unter der Kopfzeile (Viewport-Pixel) und in Welteinheiten. */
  _arena() {
    const top = this.o.header ? Math.max(0, document.querySelector(this.o.header)?.getBoundingClientRect().bottom ?? 0) : 0;
    const w = document.documentElement.clientWidth, h = innerHeight - top;
    return { vp: { left: 0, top, w, h }, ar: arenaOf(w, h, this.o.bl) };
  }

  _box(A, r) {
    const { bl } = A.ar;
    return [2 + (r.left - A.vp.left + (r.right - r.left) / 2) / bl, 2 + (A.vp.h - (r.top - A.vp.top + (r.bottom - r.top) / 2)) / bl,
      (r.right - r.left) / 2 / bl, (r.bottom - r.top) / 2 / bl];
  }

  _walls(A, except) {
    const out = [];
    for (const { e, text } of this._cands()) if (e !== except) out.push(this._box(A, inkRect(e, text)));
    for (const s of this.o.walls) for (const e of document.querySelectorAll(s)) if (vis(e)) out.push(this._box(A, inkRect(e, false)));
    // nur Wände, die die Arena berühren (die übrigen schaden nicht, kosten aber Zeit im Abstandsfeld)
    const { ar } = A;
    return out.filter((b) => b[0] + b[2] > 0 && b[0] - b[2] < ar.W && b[1] + b[3] > 0 && b[1] - b[3] < ar.H);
  }

  /** Kandidat prüfen: { ok, why: aspect | size | outside | noroom, assessment, box, walls, A }. */
  assess(e) {
    const c = this._cands().find((x) => x.e === e);
    if (!c) return { ok: false, why: "none" };
    const A = this._arena();
    const st = this.moved.get(e);
    const r = inkRect(e, c.text);
    // Lage: Mitte aus der sichtbaren Box, Größe aus der ungedrehten Box (gedreht ist die Box größer)
    let box = this._box(A, r);
    if (st && st.rot) box = [box[0], box[1], st.hx, st.hy];
    const a = assessLoad(box, this.o);
    if (!a.ok) return { ok: false, why: a.why };
    const { ar } = A;
    if (box[0] - box[2] < ar.x0 || box[0] + box[2] > ar.x1 || box[1] - box[3] < ar.y0 || box[1] + box[3] > ar.y1) return { ok: false, why: "outside" };
    const walls = this._walls(A, e);
    // mindestens ein Ziel mit Platz, freier Bahn und Abstand (Vorabmessung: sonst scheitert es meist)
    if (!allTargets(ar, walls, box[2], box[3], { step: 2, from: [box[0], box[1]], minDist: MIN_DIST, limit: 1 }).length) return { ok: false, why: "noroom" };
    return { ok: true, assessment: a, box, walls, A, text: c.text };
  }

  // --- Bedienung ---

  /** Umbaumodus an: angebotene Elemente markieren, Klicks abfangen. */
  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener("click", this._click, true);
    document.addEventListener("keydown", this._key);
    this._mark();
    this._status();
  }

  /** Umbaumodus aus: laufenden Transport abbrechen, verschobene Elemente bleiben. */
  stop() {
    this._abort();
    this._select(null);
    this.active = false;
    document.removeEventListener("click", this._click, true);
    document.removeEventListener("keydown", this._key);
    this._mark();
    this._status();
  }

  _mark() {
    let lost = null;
    for (const { e } of this._cands()) {
      e.classList.remove("umbau-wahl", "umbau-nicht");
      if (!this.active) continue;
      const a = this.assess(e);
      e.classList.add(a.ok ? "umbau-wahl" : "umbau-nicht");
      if (e === this.sel && !a.ok) lost = a.why;
    }
    document.documentElement.classList.toggle("umbau-an", this.active);
    // gewähltes Element nicht mehr tragbar (etwa aus dem Bild gescrollt): Wahl aufheben und sagen, warum
    if (lost) { this._select(null); this._status(`no:${lost}`); }
  }

  /** Beim Scrollen sofort: Umrandung weg bei allem, was nicht mehr ganz im Bild ist. */
  _unmarkOutside() {
    const top = this._arena().vp.top, h = innerHeight;
    for (const e of document.querySelectorAll(".umbau-wahl")) {
      const r = e.getBoundingClientRect();
      if (r.top < top || r.bottom > h) { e.classList.remove("umbau-wahl"); e.classList.add("umbau-nicht"); }
    }
  }

  /** Getroffener Kandidat: Texte nur auf ihrer Ausdehnung (plus HIT_PAD), sonst die Box. */
  _hit(ev) {
    const x = ev.clientX, y = ev.clientY;
    for (const c of this._cands()) {
      if (!c.e.contains(ev.target)) continue;
      if (!c.text) return c;
      const r = inkRect(c.e, true);
      if (x >= r.left - HIT_PAD && x <= r.right + HIT_PAD && y >= r.top - HIT_PAD && y <= r.bottom + HIT_PAD) return c;
    }
    return null;
  }

  _onClick(ev) {
    if (!this.active) return;
    if (this.o.ignore && ev.target.closest(this.o.ignore)) return;
    if (ev.detail === 0) return; // Tastatur (Enter auf einem Link): keine Lage, normal auslösen
    const running = !!this.tr && (this.tr.phase === "anmarsch" || this.tr.phase === "tragen");
    const c = this._hit(ev);
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (running) {
      stop();
      // anderes Element während des Tragens: erst absetzen lassen; sonst Ziel versetzen
      if (c && c.e !== this.el && this.assess(c.e).ok) { this._status("busy"); return; }
      this._target(ev.clientX, ev.clientY);
      return;
    }
    if (this.sel) {
      stop();
      // ein anderes angebotenes Element: neue Wahl; alles andere (auch das gewählte selbst,
      // Knöpfe, nicht angebotene Elemente) ist ein Ziel
      if (c && c.e !== this.sel && this.assess(c.e).ok) { this._select(c.e); this._status(); return; }
      this._target(ev.clientX, ev.clientY);
      return;
    }
    if (!c) return; // freie Stelle ohne Wahl: Klick geht durch
    stop();
    const a = this.assess(c.e);
    if (!a.ok) { this._status(`no:${a.why}`); return; } // der Kasten sagt, warum
    this._select(c.e);
    this._status();
  }

  _select(e) {
    this.msg = null;
    if (this.sel) this.sel.classList.remove("umbau-gewaehlt");
    this.sel = e;
    if (e) e.classList.add("umbau-gewaehlt");
  }

  _target(cx, cy) {
    const tr = this.tr;
    if (tr && (tr.phase === "anmarsch" || tr.phase === "tragen")) {
      // Ziel versetzen: in der Arena des laufenden Transports
      const r = this.canvas.getBoundingClientRect(), ar = tr.ar;
      const x = 2 + (cx - r.left) / ar.bl, y = 2 + (ar.hpx - (cy - r.top)) / ar.bl;
      const sim = tr.sim;
      const t = snapTarget(ar, this.walls, this.hx, this.hy, x, y, { maxDist: 12, from: [sim.loadPos[0], sim.loadPos[1]] });
      if (!t) { this._status("no:target"); return; }
      tr.setTarget(t[0], t[1]);
      this._showField(t);
      this._status();
      return;
    }
    const e = this.sel, a = this.assess(e);
    if (!a.ok) { this._select(null); this._status(`no:${a.why}`); this._mark(); return; }
    const { A } = a;
    const x = 2 + (cx - A.vp.left) / A.ar.bl, y = 2 + (A.vp.h - (cy - A.vp.top)) / A.ar.bl;
    // Platz samt Ring, freie Bahn, mindestens MIN_DIST weit (sonst trüge das Einrasten statt der Ameisen)
    const t = snapTarget(A.ar, a.walls, a.box[2], a.box[3], x, y, { maxDist: 12, from: [a.box[0], a.box[1]], minDist: MIN_DIST });
    if (!t) { this._status("no:target"); return; }
    this._begin(e, a, t);
  }

  _begin(e, a, target) {
    this._abort();
    const { A, box, walls } = a;
    const st = this.moved.get(e) ?? { dx: 0, dy: 0, rot: 0, transform: e.style.transform, transformOrigin: e.style.transformOrigin, origin: null };
    if (!st.origin) {
      // Drehpunkt: Mitte der sichtbaren Ausdehnung, relativ zur (unverschobenen) Box des Elements
      const b = e.getBoundingClientRect(), r = inkRect(e, a.text);
      st.origin = [(r.left + r.right) / 2 - b.left, (r.top + r.bottom) / 2 - b.top];
      st.hx = box[2];
      st.hy = box[3];
      e.style.transformOrigin = `${st.origin[0].toFixed(2)}px ${st.origin[1].toFixed(2)}px`;
    }
    this.moved.set(e, st);
    this.el = e;
    this.walls = walls;
    this.hx = box[2];
    this.hy = box[3];
    this.episode++;
    this.outcome = null;
    const tr = (this.tr = new Transport({ ar: A.ar, walls, box, assessment: a.assessment, start: { x: box[0], y: box[1], rot: st.rot },
      target, policy: this.policy, rng: this.rng, noise: makeNoise((this.o.seed + 7919 * this.episode) >>> 0), opts: this.o }));
    // natürliche Mitte (ohne transform) in dieser Arena
    this.base = { st, x0: box[0] - st.dx / A.ar.bl, y0: box[1] + st.dy / A.ar.bl, ang0: tr.ang0 };
    // Leinwand über die Arena, im Dokument verankert
    Object.assign(this.canvas.style, { display: "block", left: `${A.vp.left + scrollX}px`, top: `${A.vp.top + scrollY}px`,
      width: `${A.vp.w}px`, height: `${A.vp.h}px` });
    this.docOrigin = [A.vp.left + scrollX, A.vp.top + scrollY];
    const sim = tr.sim;
    this.prev = snapshot(sim, new Frame(sim.n));
    this.view = Object.assign(new Frame(sim.n), { cfg: sim.cfg, row: { nest_x: -1e4, nest_y: -1e4, nest_r: 0 }, W: sim.W, H: sim.H,
      Ws: sim.Ws, Hs: sim.Hs, phero: sim.phero, density: sim.density });
    this.renderer.setScene(sim, false);
    const cam = this.renderer.camera;
    cam.cx = 2 + A.ar.wpx / A.ar.bl / 2;
    cam.cy = 2 + A.ar.hpx / A.ar.bl / 2;
    cam.halfH = A.ar.hpx / A.ar.bl / 2;
    // eigene Übergänge (etwa Einblenden beim Scrollen) würden jedem Schritt hinterherlaufen
    if (st.transition === undefined) st.transition = e.style.transition;
    e.style.transition = "none";
    e.style.willChange = "transform";
    this._showField(target);
    this._select(null);
    this.acc = 0;
    this.lastNow = null;
    this.timeLog = [];
    this.snapT = 0;
    this._loop();
    this._status();
  }

  /** Zielfeld: gestrichelter Rahmen in der Größe des Elements an der Zielmitte. */
  _showField(t) {
    const ar = this.tr.ar, [px, py] = [(t[0] - 2) * ar.bl, ar.hpx - (t[1] - 2) * ar.bl];
    Object.assign(this.feld.style, { display: "block", left: `${this.docOrigin[0] + px - this.hx * ar.bl}px`,
      top: `${this.docOrigin[1] + py - this.hy * ar.bl}px`, width: `${2 * this.hx * ar.bl}px`, height: `${2 * this.hy * ar.bl}px` });
  }

  _hideField() {
    this.feld.style.display = "none";
  }

  /** Laufenden Transport beenden: Ameisen weg, das Element bleibt, wo es gerade ist. */
  _abort() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.tr && this.tr.phase === "einrasten") { this.tr.snapTo(1); this._apply(this.tr.sim.loadPos, this.tr.sim.loadAng); }
    this.tr = null;
    this._clear();
    this._hideField();
    this._release();
  }

  /** Element nach dem Tragen: Übergänge wieder wie vorher (Zurücksetzen gleitet dann zurück). */
  _release() {
    const e = this.el;
    if (!e) return;
    e.style.willChange = "";
    const st = this.moved.get(e);
    if (st && st.transition !== undefined) e.style.transition = st.transition;
  }

  _clear() {
    const gl = this.renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.canvas.style.display = "none";
  }

  /** Anhalten (außer Sicht) und weiterlaufen lassen, ohne Zeitsprung. */
  setPaused(p) {
    this.paused = !!p;
    if (this.paused) {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
    } else if (this.tr) {
      this.lastNow = null;
      this._loop();
    }
  }

  _loop() {
    if (this.raf !== null || this.paused || !this.tr) return;
    const frame = (now) => {
      this.raf = null;
      if (!this.tr || this.paused) return;
      this.raf = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Ein Bild zur Zeit now (ms): rechnen, zeichnen, Element setzen. Auch von Hand (Konsole, Messung). */
  frame(now) {
    const tr = this.tr;
    if (!tr) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const real = this.lastNow === null ? 0 : Math.min((now - this.lastNow) / 1000, 0.25);
    this.lastNow = now;
    const dt = tr.cfg.dt;
    this.acc += real * this.o.factor;
    let steps = 0;
    const c0 = performance.now();
    const before = tr.phase;
    while (this.acc >= dt && steps < MAX_STEPS_PER_FRAME && tr.phase !== "fertig") {
      snapshot(tr.sim, this.prev);
      tr.tick();
      this.acc -= dt;
      steps++;
      if (tr.phase !== before && (tr.phase === "einrasten" || tr.phase === "zeit")) break;
    }
    this.cpuMs = performance.now() - c0;
    if (this.acc >= dt) this.acc = 0.999 * dt;
    this.timeLog.push({ real, sim: steps * dt });
    while (this.timeLog.length > 120) this.timeLog.shift();
    if (tr.phase === "zeit") { this.outcome = { kind: "timeout" }; tr.giveUp(); this._hideField(); }
    if (tr.phase === "einrasten") {
      if (before !== "einrasten") { this.outcome = { kind: "nest", t: (tr.log.tSwitch ?? 0) + tr.log.tCarry }; this.snapT = 0; }
      this.snapT += reduce ? SNAP_S : real;
      tr.snapTo(Math.min(1, this.snapT / SNAP_S));
      if (tr.phase === "abzug") this._hideField();
    }
    const alpha = Math.min(1, this.acc / dt);
    lerpFrame(this.prev, tr.sim, tr.phase === "anmarsch" || tr.phase === "tragen" ? alpha : 1, this.view);
    this.renderer.draw(this.view);
    if (tr.phase === "einrasten" || tr.phase === "abzug" || tr.phase === "fertig") this._apply(tr.sim.loadPos, tr.sim.loadAng);
    else this._apply(this.view.loadPos, this.view.loadAng);
    if (tr.phase === "fertig") {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.tr = null;
      this._release();
      this._clear();
      this._mark();
    }
    this._status();
  }

  /** Lage der Last aufs Element übertragen (transform). */
  _apply(pos, ang) {
    const { base } = this, st = base.st, bl = this.o.bl;
    st.dx = (pos[0] - base.x0) * bl;
    st.dy = -(pos[1] - base.y0) * bl;
    st.rot = ang - base.ang0;
    this.el.style.transform = `translate(${st.dx.toFixed(2)}px, ${st.dy.toFixed(2)}px) rotate(${(-st.rot).toFixed(4)}rad)`;
  }

  /** Alles an seinen Platz. */
  reset() {
    this._abort();
    this._select(null);
    for (const [el, st] of this.moved) {
      el.style.transform = st.transform ?? "";
      el.style.transformOrigin = st.transformOrigin ?? "";
    }
    this.moved.clear();
    this.outcome = null;
    this._mark();
    this._status();
  }

  /** Nach Änderungen am Layout (Sprache): laufenden Transport abbrechen, Angebot neu prüfen. */
  relayout() {
    this._abort();
    this._select(null);
    this._mark();
    this._status();
  }

  setFactor(fct) {
    this.o.factor = fct;
    if (this.timeLog) this.timeLog.length = 0;
    this._status();
  }

  /** Zustand für die Anzeige. msg: busy | no:<grund> (aspect, size, outside, noroom, target). */
  status(msg = null) {
    if (msg === null && this.msg && performance.now() - this.msgT < 2500) msg = this.msg;
    const tr = this.tr;
    const s = { active: this.active, selected: !!this.sel, phase: tr ? tr.phase : "idle", factor: this.o.factor, msg,
      moved: this.moved.size, outcome: this.outcome ?? null };
    if (tr) {
      const real = this.timeLog.reduce((a, x) => a + x.real, 0), simT = this.timeLog.reduce((a, x) => a + x.sim, 0);
      let grip = 0;
      for (let i = 0; i < tr.sim.n; i++) grip += tr.sim.grip[i];
      Object.assign(s, { nAnts: tr.n, grip, slots: tr.spec.n_slots, t: tr.sim.t * tr.cfg.dt,
        actual: real > 0.5 ? simT / real : this.o.factor, cpuMs: this.cpuMs });
    }
    return s;
  }

  _status(msg = null) {
    if (msg !== null) { this.msg = msg; this.msgT = performance.now(); }
    this.o.onStatus(this.status(msg));
  }

  destroy() {
    this.reset();
    this.stop();
    document.removeEventListener("visibilitychange", this._vis);
    removeEventListener("scroll", this._scroll);
    this.sicht.disconnect();
    this.canvas.remove();
    this.feld.remove();
  }
}

export { RING };
