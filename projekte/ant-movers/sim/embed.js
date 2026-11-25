// Schlanke Live-Demo zum Einbetten (M5, Teil 7: Projektseite auf vincent-petsch.de). Dieselbe
// Rechnung wie web/main.js (gelernte Policy Seed 0, gezogen wie im Training, ab 1000 Ameisen
// das Netz in Web Workern, Zeitfaktor sichtbar), ohne Messung und Eingriffe. Texte zweisprachig
// als <span lang="de"> und <span lang="en"> wie auf der Website.
//
//   import { startLive } from "./embed.js";
//   startLive(element, { policy: "policies/m4a_s0.json", scenes: ["scenes/stage3_demo.json", ...] });

import { Frame, lerpFrame, snapshot } from "./frame.js";
import { Policy, makeNoise, makeRng, policyParams } from "./policy.js";
import { PolicyPool } from "./policypool.js";
import { Renderer } from "./render.js";
import { ACT_DIM, OBS_DIM, Sim, buildScene } from "./sim.js";

const MAX_STEPS_PER_FRAME = 8;
const POOL_MIN = 1000;
const t2 = (de, en) => `<span lang="de">${de}</span><span lang="en">${en}</span>`;
const num = (x, d, lang) => x.toLocaleString(lang === "en" ? "en-US" : "de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

export async function startLive(root, opts) {
  const o = { factor: 4, n: 200, seed: 3000, counts: [100, 200, 500, 1000, 2000], ...opts };
  const [json, ...lists] = await Promise.all([fetch(o.policy).then((r) => r.json()),
    ...o.scenes.map((u) => fetch(u).then((r) => r.json()))]);
  const scenes = lists.flatMap((l) => l.scenes);
  const policy = new Policy(policyParams(json));
  const lang = () => document.documentElement.dataset.lang || document.documentElement.lang || "de";

  root.classList.add("ant-live");
  root.innerHTML = `
    <canvas class="ant-view" aria-label="Live-Simulation"></canvas>
    <div class="ant-hud ant-links"></div>
    <div class="ant-hud ant-rechts"></div>
    <div class="ant-leiste">
      <span class="ant-gruppe" data-k="n"></span>
      <span class="ant-gruppe" data-k="seed"></span>
      <button type="button" data-a="neu">${t2("Neustart", "Restart")}</button>
      <button type="button" data-a="pause">${t2("Pause", "Pause")}</button>
      <button type="button" data-a="zoom">${t2("Zoomfahrt", "Zoom out")}</button>
    </div>`;
  const canvas = root.querySelector("canvas");
  const renderer = new Renderer(canvas);
  renderer.layers.phero = false;
  const rng = makeRng(20261125);
  let sim, obs, act, prev, view, noise, outcome, acc = 0, lastNow = null, paused = false, episode = 0;
  let pool = null, busy = false, factor = o.factor, flight = null, visible = false;
  const timeLog = [];

  const groups = { n: root.querySelector('[data-k="n"]'), seed: root.querySelector('[data-k="seed"]') };
  const mark = () => {
    for (const b of groups.n.children) b.classList.toggle("an", Number(b.dataset.v) === sim.n);
    for (const b of groups.seed.children) b.classList.toggle("an", Number(b.dataset.v) === sim.row.seed);
  };
  const avail = (k) => [...new Set(scenes.map((s) => (k === "n" ? s.n_ants : s.seed)))].filter((v) => k !== "n" || o.counts.includes(v));
  for (const k of ["n", "seed"]) {
    for (const v of avail(k)) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.v = v;
      b.innerHTML = k === "n" ? t2(`${v} Ameisen`, `${v} ants`) : t2(`Szenario ${v}`, `scenario ${v}`);
      b.onclick = () => (k === "n" ? setup(v, sim.row.seed) : setup(sim.n, v));
      groups[k].appendChild(b);
    }
  }

  function setup(n, seed) {
    const sc = scenes.find((s) => s.n_ants === n && s.seed === seed) ?? scenes[0];
    sim = new Sim(sc.cfg, buildScene(sc.cfg, sc.spec));
    obs = new Float32Array(sim.n * OBS_DIM);
    act = new Float32Array(sim.n * ACT_DIM);
    renderer.setScene(sim, true);
    factor = sim.n > 1000 ? 2 : o.factor; // über 1000 Ameisen Zeitfaktor 2 (Teil 4b)
    flight = null;
    restart();
    mark();
    if (sim.n >= POOL_MIN && !pool) {
      const k = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
      PolicyPool.create(json, k, 20261125).then((p) => { pool = p; });
    }
  }

  function restart() {
    sim.reset(rng);
    episode++;
    noise = makeNoise((20261125 + 7919 * episode) >>> 0);
    if (pool) pool.reseed((20261125 + 7919 * episode) >>> 0);
    prev = snapshot(sim, new Frame(sim.n));
    view = Object.assign(new Frame(sim.n), { cfg: sim.cfg, row: sim.row, W: sim.W, H: sim.H, Ws: sim.Ws,
      Hs: sim.Hs, phero: sim.phero, density: sim.density });
    acc = 0;
    outcome = null;
    timeLog.length = 0;
    paused = false;
  }

  const finish = (s) => {
    if (outcome) return;
    if (s.atNest()) outcome = { kind: "nest", t: s.t * s.cfg.dt };
    else if (s.t >= s.row.t_max) outcome = { kind: "timeout", t: s.t * s.cfg.dt };
  };

  function stepSync() {
    sim.observe(obs);
    policy.act(obs, sim.n, act, noise);
    sim.step(act);
    finish(sim);
  }

  async function stepsAsync() {
    busy = true;
    const dt = sim.cfg.dt;
    let steps = 0;
    while (acc >= dt && steps < MAX_STEPS_PER_FRAME && !paused && !outcome) {
      const s = sim;
      snapshot(s, prev);
      s.observe(obs);
      await pool.act(obs, s.n, act);
      if (s !== sim) break;
      s.step(act);
      finish(s);
      acc -= dt;
      steps++;
      stepsAsync.done += 1;
    }
    busy = false;
  }
  stepsAsync.done = 0;
  let lastDone = 0;

  function eff() {
    let fx = 0, fy = 0, fa = 0, g = 0;
    for (let i = 0; i < sim.n; i++) {
      const f = sim.thrust[i];
      fx += f * Math.cos(sim.theta[i]);
      fy += f * Math.sin(sim.theta[i]);
      fa += Math.abs(f);
      g += sim.grip[i];
    }
    return { g, e: fa > 1e-6 ? Math.hypot(fx, fy) / fa : null };
  }

  let lastHud = 0;
  function hud(now) {
    if (now - lastHud < 250) return;
    lastHud = now;
    const L = lang(), real = timeLog.reduce((a, x) => a + x.real, 0), simT = timeLog.reduce((a, x) => a + x.sim, 0);
    const actual = real > 0.5 ? simT / real : factor, slow = !paused && !outcome && actual < 0.9 * factor;
    const t = sim.t * sim.cfg.dt;
    root.querySelector(".ant-links").innerHTML =
      `<b>${t2("Zeitfaktor", "Time factor")} ${factor}×</b>` +
      (slow ? `<small class="ant-warn">${t2("läuft langsamer", "running slower")}: ${num(actual, 1, L)}×</small>` : "") +
      `<small>${t2("Ameisenzeit", "Ant time")} ${num(t, 0, L)} s</small>` +
      (outcome ? `<small class="ant-warn">${outcome.kind === "nest" ? t2(`am Nest nach ${num(outcome.t, 0, L)} s`, `at the nest after ${num(outcome.t, 0, L)} s`) : t2("Zeit abgelaufen, nicht gelöst", "time is up, not solved")}</small>` : "");
    const { g, e } = eff();
    root.querySelector(".ant-rechts").innerHTML =
      `<small>${t2(`${g} von ${sim.row.n_slots} Plätzen greifen`, `${g} of ${sim.row.n_slots} slots gripped`)}</small>` +
      (e === null ? "" : `<small>${t2("Kraftausbeute", "Force efficiency")} ${num(e, 2, L)}</small>`) +
      `<small>${t2("gelernte Policy, Seed 0", "learned policy, seed 0")}</small>`;
  }

  function flyCamera(now) {
    if (flight.t0 === null) flight.t0 = now;
    const u = Math.min(1, (now - flight.t0) / 7000), e = u * u * (3 - 2 * u);
    const cam = renderer.camera, ax = view.pos[2 * flight.i], ay = view.pos[2 * flight.i + 1];
    cam.halfH = 1.6 * Math.pow(flight.end.halfH / 1.6, e);
    const m = Math.min(1, Math.max(0, (e - 0.15) / 0.85));
    cam.cx = ax + m * (flight.end.cx - ax);
    cam.cy = ay + m * (flight.end.cy - ay);
    if (u >= 1) flight = null;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { lastNow = null; return; }
    const real = lastNow === null ? 0 : Math.min((now - lastNow) / 1000, 0.25);
    lastNow = now;
    const dt = sim.cfg.dt;
    if (!paused && !outcome) {
      acc = Math.min(acc + real * factor, MAX_STEPS_PER_FRAME * dt);
      let steps = 0;
      if (sim.n >= POOL_MIN && pool) {
        if (!busy) stepsAsync();
        steps = stepsAsync.done - lastDone;
        lastDone = stepsAsync.done;
      } else if (sim.n < POOL_MIN) {
        while (acc >= dt && steps < MAX_STEPS_PER_FRAME && !outcome) {
          snapshot(sim, prev);
          stepSync();
          acc -= dt;
          steps++;
        }
      }
      timeLog.push({ real, sim: steps * dt });
      while (timeLog.length > 120) timeLog.shift();
    }
    if (flight) flyCamera(now);
    lerpFrame(prev, sim, outcome ? 1 : Math.min(1, acc / dt), view);
    renderer.draw(view);
    hud(now);
  }

  root.querySelector('[data-a="neu"]').onclick = () => restart();
  root.querySelector('[data-a="pause"]').onclick = () => { paused = !paused; };
  root.querySelector('[data-a="zoom"]').onclick = () => {
    let i = sim.grip.findIndex((g, k) => g && sim.active[k]);
    if (i < 0) i = 0;
    renderer.fit();
    flight = { i, t0: null, end: { ...renderer.camera } };
  };
  canvas.addEventListener("dblclick", () => { flight = null; renderer.fit(); });
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(root);
  setup(o.n, o.seed);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) paused = true;
  requestAnimationFrame(frame);
  return { get sim() { return sim; }, setup, restart };
}
