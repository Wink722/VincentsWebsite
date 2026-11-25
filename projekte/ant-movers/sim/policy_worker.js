// Netz der Policy in einem Web Worker (M5, Teil 4b). Derselbe Code wie auf dem Hauptfaden
// (Policy.act aus policy.js), je Ameise dieselbe Rechenreihenfolge: Die Vorwärtsrechnung ist
// je Ameise unabhängig, ein Worker rechnet einen Ausschnitt der Ameisen. Gezogen wird mit
// einer eigenen Rauschquelle je Worker (dieselbe Verteilung, ADR 0003).

import { Policy, makeNoise, policyParams } from "./policy.js";
import { ACT_DIM } from "./sim.js";

let policy = null, noise = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    policy = new Policy(policyParams(m.json));
    noise = makeNoise(m.seed >>> 0);
    self.postMessage({ type: "ready" });
    return;
  }
  if (m.type === "seed") {
    noise = makeNoise(m.seed >>> 0);
    return;
  }
  // m.type === "act": obs (n * OBS_DIM) -> act (n * ACT_DIM), Puffer werden übertragen
  const act = m.act && m.act.length >= m.n * ACT_DIM ? m.act : new Float32Array(m.n * ACT_DIM);
  policy.act(m.obs, m.n, act, m.det ? null : noise);
  self.postMessage({ type: "act", id: m.id, obs: m.obs, act }, [m.obs.buffer, act.buffer]);
};
