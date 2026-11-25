// Das Netz auf mehrere Kerne verteilt (M5, Teil 4b): k Web Worker rechnen je einen
// Ausschnitt der Ameisen mit demselben JavaScript (policy_worker.js), die Physik bleibt auf dem
// Hauptfaden. Übertragbare Puffer statt SharedArrayBuffer (GitHub Pages setzt keine
// COOP/COEP-Header). Die Puffer wandern hin und zurück und werden wiederverwendet.

import { ACT_DIM, OBS_DIM } from "./sim.js";

export class PolicyPool {
  /** json: Gewichte (web/policies/*.json), k Worker, seed für die Rauschquellen. */
  static async create(json, k, seed = 1) {
    const pool = new PolicyPool();
    pool.workers = [];
    pool.bufs = [];
    const url = new URL("./policy_worker.js", import.meta.url);
    await Promise.all(Array.from({ length: k }, (_, w) => new Promise((resolve, reject) => {
      const wk = new Worker(url, { type: "module" });
      wk.onerror = reject;
      wk.onmessage = (e) => { if (e.data.type === "ready") resolve(); };
      wk.postMessage({ type: "init", json, seed: seed + 7919 * w });
      pool.workers[w] = wk;
      pool.bufs[w] = { obs: null, act: null };
    })));
    pool.id = 0;
    return pool;
  }

  get size() { return this.workers.length; }

  /** Neue Rauschquellen (Neustart). */
  reseed(seed) {
    this.workers.forEach((wk, w) => wk.postMessage({ type: "seed", seed: seed + 7919 * w }));
  }

  /** Wie Policy.act, aber asynchron: obs (n * OBS_DIM) -> act (n * ACT_DIM). */
  act(obs, n, act, det = false) {
    const k = this.workers.length, per = Math.ceil(n / k), id = ++this.id;
    const jobs = [];
    for (let w = 0; w < k; w++) {
      const a0 = w * per, a1 = Math.min(n, a0 + per);
      if (a1 <= a0) break;
      const m = a1 - a0, b = this.bufs[w];
      if (!b.obs || b.obs.length !== m * OBS_DIM) b.obs = new Float32Array(m * OBS_DIM);
      b.obs.set(obs.subarray(a0 * OBS_DIM, a1 * OBS_DIM));
      const wk = this.workers[w];
      jobs.push(new Promise((resolve) => {
        wk.onmessage = (e) => {
          if (e.data.type !== "act" || e.data.id !== id) return;
          b.obs = e.data.obs;
          b.act = e.data.act;
          act.set(b.act.subarray(0, m * ACT_DIM), a0 * ACT_DIM);
          resolve();
        };
      }));
      const msg = { type: "act", id, n: m, obs: b.obs, act: b.act, det };
      wk.postMessage(msg, b.act ? [b.obs.buffer, b.act.buffer] : [b.obs.buffer]);
      b.obs = null;
      b.act = null;
    }
    return Promise.all(jobs);
  }

  terminate() {
    for (const wk of this.workers) wk.terminate();
    this.workers = [];
  }
}
