// Ein Bild zwischen zwei Zuständen (ADR 0005, Punkt 6): Die Simulationszeit ist vom
// Bildtakt gelöst, gezeichnet wird zwischen den letzten beiden Zuständen interpoliert.
//
// Interpoliert werden nur Lage und Winkel (Ameisen und Last), linear, Winkel über den
// kürzeren Weg. Greif- und Aktiv-Flag springen in der Mitte des Schritts. Das ist reine
// Darstellung: Gerechnet wird immer mit den echten Zuständen.

const TWO_PI = 2 * Math.PI;

/** Winkeldifferenz auf (-π, π]. */
export function wrapDelta(d) {
  return d - TWO_PI * Math.floor(d / TWO_PI + 0.5);
}

/** Lage und Winkel aller Ameisen und der Last. */
export class Frame {
  constructor(n) {
    this.n = n;
    this.pos = new Float32Array(2 * n);
    this.theta = new Float32Array(n);
    this.grip = new Uint8Array(n);
    this.active = new Uint8Array(n);
    this.loadPos = new Float32Array(2);
    this.loadAng = 0;
  }
}

/** Kopiert den Zustand einer Sim (oder jeder Ansicht mit denselben Feldern) in `out`. */
export function snapshot(src, out) {
  out.pos.set(src.pos);
  out.theta.set(src.theta);
  out.grip.set(src.grip);
  out.active.set(src.active);
  out.loadPos.set(src.loadPos);
  out.loadAng = src.loadAng;
  return out;
}

/**
 * out = a + alpha · (b - a). a und b haben pos, theta, grip, active, loadPos, loadAng (als
 * Arrays gleicher Länge, auch Ausschnitte mit subarray).
 */
export function lerpFrame(a, b, alpha, out) {
  const n = out.n;
  const pa = a.pos, pb = b.pos, po = out.pos;
  for (let i = 0; i < 2 * n; i++) po[i] = pa[i] + alpha * (pb[i] - pa[i]);
  const ta = a.theta, tb = b.theta, to = out.theta;
  for (let i = 0; i < n; i++) to[i] = ta[i] + alpha * wrapDelta(tb[i] - ta[i]);
  const late = alpha >= 0.5 ? b : a;
  out.grip.set(late.grip);
  out.active.set(late.active);
  out.loadPos[0] = a.loadPos[0] + alpha * (b.loadPos[0] - a.loadPos[0]);
  out.loadPos[1] = a.loadPos[1] + alpha * (b.loadPos[1] - a.loadPos[1]);
  out.loadAng = a.loadAng + alpha * wrapDelta(b.loadAng - a.loadAng);
  return out;
}
