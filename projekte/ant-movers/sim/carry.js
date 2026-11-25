// Szenen für den Tragemodus (M5, Teil 3): eine Webseite als Arena. Die Last ist ein
// angeklicktes Element (Rechteck mit seinem Seitenverhältnis oder Scheibe), das Ziel ein
// angeklickter Punkt (das Nest), die übrigen Elemente sind Wände (achsparallele Rechtecke wie
// in der Physik). Gebaut wird nur eine Spezifikation, Zeile und Abstandsfeld baut sim.js wie
// immer (buildScene). Dieselbe Physik und dieselbe Policy, aber Szenen, die es im Training
// nie gab: eine Spielwiese außerhalb der Auswertung.

import { RECT_ASPECT_MAX, buildScene, makeConfig } from "./sim.js";

const f = Math.fround;

/**
 * Form, Lage und Griffplätze für ein Element w × h (in Körperlängen). Rechtecke liegen mit der
 * langen Seite waagrecht (Winkel 0) oder senkrecht (π/2). round: Element ist rund (Scheibe).
 * Rückgabe null, wenn das Seitenverhältnis außerhalb von 1 bis maxAspect liegt.
 */
export function loadFor(w, h, { round = false, maxAspect = RECT_ASPECT_MAX } = {}) {
  if (round) return { shape: "disc", ang: 0, nSlots: Math.max(4, Math.round(Math.PI * 0.5 * (w + h))) };
  const a = Math.max(w, h) / Math.min(w, h);
  if (a > maxAspect) return null;
  const aspect = Math.round(a * 100) / 100;
  return { shape: `rect:${aspect}`, ang: w >= h ? 0 : Math.PI / 2, nSlots: Math.max(4, Math.round(2 * (w + h))) };
}

/** Nestradius wie im Erzeuger grob mit der Lastgröße wachsend, mindestens 2. */
export const nestRadius = (nSlots) => Math.max(2, 0.16 * nSlots);

/**
 * Szene des Tragemodus. Längen in Körperlängen, Arena width × height (ganzzahlig gerundet),
 * walls als [cx, cy, halbe Breite, halbe Höhe].
 */
export function carryScene({ nAnts, load, pos, walls, nest, width, height, tMaxS = 300, nestR }) {
  const W = Math.max(16, Math.round(width)), H = Math.max(16, Math.round(height));
  const cfg = makeConfig(nAnts, { n_slots_max: Math.max(12, load.nSlots), width: W, height: H });
  const spec = {
    n_ants: nAnts, n_slots: load.nSlots, walls, nest: [nest[0], nest[1]], load_pos: [pos[0], pos[1]],
    load_ang: load.ang, nest_r: nestR ?? nestRadius(load.nSlots), t_max_s: tMaxS, shape: load.shape,
    stick_scale: 1.0, seed: -1, stage: -1, solvable: -1, plan_len: -1.0, attempt: 0,
  };
  return { cfg, spec, scene: buildScene(cfg, spec) };
}

/** Ziel versetzen (Kompass und Erfolg): Zeile und abgeleitete Konstanten zugleich. */
export function setNest(sim, x, y) {
  sim.row.nest_x = f(x);
  sim.row.nest_y = f(y);
  sim.k.nestX = f(x);
  sim.k.nestY = f(y);
}
