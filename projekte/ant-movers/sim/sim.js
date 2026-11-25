// Physik von Ant Movers in reinem JavaScript.
//
// Dies ist die zweite Fassung derselben Physik wie in ant_movers/sim/*.py und
// ant_movers/obs.py. Jede Rechenoperation steht in derselben Reihenfolge und Klammerung
// wie dort und wird mit Math.fround auf float32 gerundet. scripts/parity_test.py
// vergleicht beide Fassungen. Wer hier etwas ändert, ändert es auch in Python.
//
// Aufteilung wie in Python (ADR 0004): makeConfig hält, was für ein Programm gleich ist,
// scenarioRow die Größen eines Szenarios (Spiegel von world.scenario_row). Der Browser
// rechnet eine Szene, eine Bank braucht er nicht. Alle Raten stehen je Sekunde in der
// Konfiguration, die Werte je Schritt leitet Sim aus dt ab (ADR 0005).

const f = Math.fround;
const TWO_PI = f(2 * Math.PI);

export const OBS_VERSION = 1; // Layout der Beobachtung, Spiegel von obs.py
export const OBS_DIM = 25;
export const ACT_DIM = 9; // Schub, Lenkung, Greifen, 2 x Pheromon, 4 x Gedächtnis
export const MEM_DIM = 4;
export const PHERO_CH = 2;

// Dezimalliterale wie in obs.py
const ANT_COS = f(0.8775825619), ANT_SIN = f(0.4794255386), ANT_LEN = f(1.0);
const WALL_COS = f(0.7648421873), WALL_SIN = f(0.6442176872), WALL_LEN = f(2.0);
const DENS_COS = f(0.6967067093), DENS_SIN = f(0.7173560909), DENS_LEN = f(1.5);
const WALL_RANGE = f(4.0), LOAD_RANGE = f(6.0);

// Pythons round(): bei genau .5 zur geraden Zahl
function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Spiegel von config.m0_slots: Griffplätze nach der Behelfsregel aus M0. */
export function m0Slots(nAnts) {
  return Math.min(96, Math.max(12, pyRound(nAnts / 8)));
}

/** Spiegel von ant_movers.sim.config.make_config: Programmkonstanten. */
export function makeConfig(nAnts, overrides = {}) {
  const cfg = {
    n_ants: nAnts,
    n_slots_max: m0Slots(nAnts),
    n_rim_max: 32,
    n_seg_max: 8,
    width: 128.0, height: 96.0, sdf_cell: 0.5, wall_thick: 2.0,
    dt: 0.1,
    v_max: 3.0, omega_max: 3.0, r_ant: 0.5, r_grip: 1.0, c_rep: 1.0, rep_vmax: 1.5,
    t_inf: 10.0, start_density: 0.11,
    f0: 1.0, n_sub: 3, max_rim_step: 0.25,
    rim_spacing: 0.4, wall_skin: 0.15, wall_stiff: 0.5, proj_clear: 0.1, n_proj: 2,
    phero_decay: 0.1, phero_diff: 1.0, phero_quant: 256.0,
    // Belohnung (nur Training, im Browser ungenutzt, hier für die Driftprüfung)
    reward_success: 1.0, reward_time: 0.5, reward_force: 0.1, reward_phero: 0.1,
    ...overrides,
  };
  if (overrides.n_rim_max === undefined) {
    cfg.n_rim_max = Math.max(32, Math.ceil(cfg.n_slots_max / cfg.rim_spacing - 1e-9) + cfg.n_seg_max);
  }
  return cfg;
}

/** Spiegel von world.m0_spec: eine Wand mit Lücke, Last links, Nest rechts. */
export function m0Spec(cfg, nAnts, kw = {}) {
  const o = { ...kw };
  const take = (key, dflt) => {
    const v = o[key] ?? dflt;
    delete o[key];
    return v;
  };
  const nSlots = take("n_slots", m0Slots(nAnts));
  const radius = nSlots / (2.0 * Math.PI);
  const wallX = take("wall_x", 64.0);
  const gapY = take("gap_y", 48.0);
  const gapW = take("gap_w", Math.min(cfg.height - 12.0, 2.0 * radius + 10.0));
  const t = cfg.wall_thick;
  const lo = gapY - 0.5 * gapW;
  const hi = gapY + 0.5 * gapW;
  return {
    n_ants: nAnts, n_slots: nSlots,
    walls: [
      [wallX, 0.5 * lo, 0.5 * t, 0.5 * lo],
      [wallX, 0.5 * (hi + cfg.height), 0.5 * t, 0.5 * (cfg.height - hi)],
    ],
    nest: [116.0, 48.0], load_pos: [32.0, 48.0],
    load_ang: 0.0, nest_r: 4.0, t_max_s: 300.0, shape: "disc",
    stick_scale: 1.0, seed: -1, stage: -1, solvable: -1, plan_len: -1.0, attempt: 0,
    ...o,
  };
}

// --- Form der Last (Spiegel von ant_movers/sim/shape.py) ---------------------------------

export const SHAPES = ["disc", "bar", "T"];
const BAR_ASPECT = 4.0;
const UNIT = {
  bar: [[-1.0, -0.5], [1.0, -0.5], [1.0, 0.5], [-1.0, 0.5]].map(([x, y]) => [x * (BAR_ASPECT / 2.0), y]),
  T: [[-0.5, -2.0], [0.5, -2.0], [0.5, 0.0], [1.5, 0.0], [1.5, 1.0], [-1.5, 1.0], [-1.5, 0.0], [-0.5, 0.0]],
};

/** Rechteck "rect:<a>" (M5, Teil 3a), Spiegel von shape.rect_aspect. Sonst null. */
export const RECT_ASPECT_MAX = 8.0;
export function rectAspect(shape) {
  if (!shape.startsWith("rect:")) return null;
  const a = Number(shape.slice(5));
  if (!(a >= 1.0 && a <= RECT_ASPECT_MAX)) throw new Error(`Seitenverhältnis ${a} außerhalb 1 bis ${RECT_ASPECT_MAX}`);
  return a;
}
const isShape = (shape) => SHAPES.includes(shape) || rectAspect(shape) !== null;
function unitOutline(shape) {
  const a = rectAspect(shape);
  if (a === null) return UNIT[shape];
  return [[-1.0, -0.5], [1.0, -0.5], [1.0, 0.5], [-1.0, 0.5]].map(([x, y]) => [x * (a / 2.0), y]);
}

function edgeLengths(v) {
  const n = v.length, out = [];
  for (let i = 0; i < n; i++) {
    const dx = v[(i + 1) % n][0] - v[i][0], dy = v[(i + 1) % n][1] - v[i][1];
    out.push(Math.sqrt(dx * dx + dy * dy));
  }
  return out;
}

function seqSum(xs) {
  let acc = 0.0;
  for (const x of xs) acc += x;
  return acc;
}

function polygonProps(v) {
  const n = v.length;
  let a2 = 0.0, sx = 0.0, sy = 0.0, j0 = 0.0;
  for (let i = 0; i < n; i++) {
    const [x, y] = v[i], [xn, yn] = v[(i + 1) % n];
    const cross = x * yn - xn * y;
    a2 += cross;
    sx += (x + xn) * cross;
    sy += (y + yn) * cross;
    j0 += cross * (x * x + x * xn + xn * xn + y * y + y * yn + yn * yn);
  }
  const area = 0.5 * a2;
  const cx = sx / (6.0 * area), cy = sy / (6.0 * area);
  return { area, cx, cy, j: j0 / 12.0 - area * (cx * cx + cy * cy) };
}

/** Spiegel von shape.outline: Ecken im Schwerpunktsystem mit Umfang nSlots. */
export function outline(shape, nSlots) {
  let v = unitOutline(shape).map((p) => [p[0], p[1]]);
  const k = nSlots / seqSum(edgeLengths(v));
  v = v.map(([x, y]) => [x * k, y * k]);
  const { cx, cy } = polygonProps(v);
  return v.map(([x, y]) => [x - cx, y - cy]);
}

/** Spiegel von shape.shape_tables (float64, ungerundet). */
export function shapeTables(cfg, shape, nSlots) {
  if (!isShape(shape)) throw new Error(`unbekannte Form ${shape}`);
  const E = cfg.n_seg_max, Smax = cfg.n_slots_max, Pmax = cfg.n_rim_max;
  if (nSlots > Smax) throw new Error(`${nSlots} Griffplätze, Programm hat ${Smax}`);
  const out = {
    seg_a: new Float64Array(2 * E), seg_b: new Float64Array(2 * E), seg_d: new Float64Array(2 * E),
    seg_n: new Float64Array(2 * E), seg_il2: new Float64Array(E), seg_slope: new Float64Array(E),
    seg_s0: new Float64Array(E), seg_len: new Float64Array(E), seg_mask: new Uint8Array(E),
    slot_att: new Float64Array(2 * Smax), rim: new Float64Array(2 * Pmax),
    rim_mask: new Uint8Array(Pmax),
  };
  let nRim, perim;
  if (shape === "disc") {
    const radius = nSlots / (2.0 * Math.PI);
    perim = 2.0 * Math.PI * radius;
    nRim = Math.max(32, Math.ceil(perim / cfg.rim_spacing - 1e-9));
    if (nRim > Pmax) throw new Error(`${nRim} Randpunkte, Programm hat ${Pmax}`);
    for (let k = 0; k < nSlots; k++) {
      const a = (k + 0.5) * ((2.0 * Math.PI) / nSlots);
      out.slot_att[2 * k] = (radius + cfg.r_ant) * Math.cos(a);
      out.slot_att[2 * k + 1] = (radius + cfg.r_ant) * Math.sin(a);
    }
    for (let j = 0; j < nRim; j++) {
      const b = j * ((2.0 * Math.PI) / nRim);
      out.rim[2 * j] = radius * Math.cos(b);
      out.rim[2 * j + 1] = radius * Math.sin(b);
    }
    Object.assign(out, { disc: true, load_radius: radius, r_out: radius, perimeter: perim,
      n_seg: 0, area: Math.PI * radius * radius, rho2: 0.5 * radius * radius });
  } else {
    const v = outline(shape, nSlots);
    const n = v.length;
    if (n > E) throw new Error(`${shape} hat ${n} Randstücke, Programm hat ${E}`);
    const len = edgeLengths(v);
    const s0 = [];
    for (let i = 0; i < n; i++) s0.push(seqSum(len.slice(0, i)));
    perim = seqSum(len);
    const d = [];
    for (let i = 0; i < n; i++) {
      const a = v[i], b = v[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      d.push([dx, dy]);
      out.seg_a[2 * i] = a[0]; out.seg_a[2 * i + 1] = a[1];
      out.seg_b[2 * i] = b[0]; out.seg_b[2 * i + 1] = b[1];
      out.seg_d[2 * i] = dx; out.seg_d[2 * i + 1] = dy;
      out.seg_n[2 * i] = dy / len[i]; out.seg_n[2 * i + 1] = -dx / len[i];
      out.seg_il2[i] = 1.0 / (len[i] * len[i]);
      out.seg_slope[i] = dy !== 0.0 ? dx / dy : 0.0;
      out.seg_s0[i] = s0[i];
      out.seg_len[i] = len[i];
      out.seg_mask[i] = 1;
    }
    // Griffpunkte: Platzmitte in Bogenlänge, auf ihrer Kante r_ant nach außen
    for (let k = 0; k < nSlots; k++) {
      const sMid = (k + 0.5) * (perim / nSlots);
      let e = 0;
      for (let i = 0; i < n; i++) if (s0[i] <= sMid) e = i;
      const t = (sMid - s0[e]) / len[e];
      const nx = d[e][1] / len[e], ny = -d[e][0] / len[e];
      out.slot_att[2 * k] = v[e][0] + t * d[e][0] + cfg.r_ant * nx;
      out.slot_att[2 * k + 1] = v[e][1] + t * d[e][1] + cfg.r_ant * ny;
    }
    // Randpunkte: jede Ecke, dazwischen höchstens rim_spacing auseinander
    nRim = 0;
    for (let i = 0; i < n; i++) {
      const m = Math.ceil(len[i] / cfg.rim_spacing - 1e-9);
      for (let j = 0; j < m; j++) {
        if (nRim >= Pmax) throw new Error(`zu viele Randpunkte, Programm hat ${Pmax}`);
        out.rim[2 * nRim] = v[i][0] + (j / m) * d[i][0];
        out.rim[2 * nRim + 1] = v[i][1] + (j / m) * d[i][1];
        nRim++;
      }
    }
    const { area, j } = polygonProps(v);
    let rOut = 0;
    for (const [x, y] of v) rOut = Math.max(rOut, Math.sqrt(x * x + y * y));
    Object.assign(out, { disc: false, load_radius: 0.0, r_out: rOut, perimeter: perim, n_seg: n,
      area, rho2: j / area });
  }
  for (let j = 0; j < nRim; j++) out.rim_mask[j] = 1;
  out.n_rim = nRim;
  out.slot_len = out.perimeter / nSlots;
  return out;
}

/** Spiegel von world.lever_sum: Σ |r_k| der ersten nSlots Griffpunkte, der Reihe nach. */
function leverSum(att, nSlots) {
  let acc = 0.0;
  for (let k = 0; k < nSlots; k++) {
    const x = att[2 * k], y = att[2 * k + 1];
    acc += Math.sqrt(x * x + y * y);
  }
  return acc;
}

/** Spiegel von world.scenario_row: eine Zeile der Szenarien-Tabelle (ohne Bankindex). */
export function scenarioRow(cfg, spec) {
  if (spec.n_ants > cfg.n_ants) throw new Error(`${spec.n_ants} Ameisen, Programm hat ${cfg.n_ants}`);
  const s = spec.n_slots, f0 = cfg.f0;
  const geo = shapeTables(cfg, spec.shape, s);
  // Schwellen der leeren Last, im Schritt mal (1 - n_greif / S) (Heben, ADR 0015). Alle
  // Plätze ziehen bei voller Belegung die Last mit halber Ameisengeschwindigkeit.
  const fStick = (f0 * s) / 3.0;
  const gammaT = (f0 * s) / (0.5 * cfg.v_max);
  // Drehung nach derselben Regel wie die Translation (ADR 0010, 0015)
  const tauFull = f0 * leverSum(geo.slot_att, s);
  const tauStick = tauFull / 3.0;
  const gammaR = (tauFull * geo.r_out) / (0.5 * cfg.v_max);
  // Startzone: Ring vom Umkreis plus r_ant, Fläche n_ants / start_density (feste Dichte)
  const r0 = geo.r_out + cfg.r_ant;
  const r1 = Math.sqrt(r0 * r0 + spec.n_ants / (Math.PI * cfg.start_density));
  const row = {
    n_ants: spec.n_ants, n_slots: s, n_rim: geo.n_rim, n_seg: geo.n_seg,
    t_max: Math.ceil(spec.t_max_s / cfg.dt - 1e-9), solvable: spec.solvable ?? -1,
    plan_len: (spec.plan_len ?? -1) >= 0 ? f(spec.plan_len) : null,
    seed: spec.seed, stage: spec.stage, disc: geo.disc ? 1 : 0,
    f_stick: f(fStick * spec.stick_scale), gamma_t: f(gammaT),
    tau_stick: f(tauStick * spec.stick_scale),
    gamma_r: f(gammaR),
    load_x: f(spec.load_pos[0]), load_y: f(spec.load_pos[1]), load_ang: f(spec.load_ang),
    spawn_r0: f(r0), spawn_r1: f(r1),
    nest_x: f(spec.nest[0]), nest_y: f(spec.nest[1]), nest_r: f(spec.nest_r),
  };
  for (const k of ["load_radius", "r_out", "perimeter", "slot_len", "area", "rho2"]) row[k] = f(geo[k]);
  for (const k of ["seg_a", "seg_b", "seg_d", "seg_n", "seg_il2", "seg_slope", "seg_s0", "seg_len",
    "slot_att", "rim"]) row[k] = Float32Array.from(geo[k]);
  row.seg_mask = geo.seg_mask;
  row.rim_mask = geo.rim_mask;
  return row;
}

function sdBox(px, py, cx, cy, hx, hy) {
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const ox = Math.max(qx, 0.0), oy = Math.max(qy, 0.0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0.0);
}

/**
 * Abstandsfeld (Hs, Ws, 3) als Float32Array: Abstand, d/dx, d/dy. Spiegel von
 * walls.build_sdf. walls: Innenwände als [cx, cy, hx, hy].
 */
export function buildSdf(cfg, walls) {
  const ws = Math.round(cfg.width / cfg.sdf_cell) + 1;
  const hs = Math.round(cfg.height / cfg.sdf_cell) + 1;
  const d = new Float64Array(ws * hs);
  const t = cfg.wall_thick;
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < ws; i++) {
      const px = i * cfg.sdf_cell, py = j * cfg.sdf_cell;
      let v = -sdBox(px, py, 0.5 * cfg.width, 0.5 * cfg.height,
        0.5 * cfg.width - t, 0.5 * cfg.height - t);
      for (const r of walls) v = Math.min(v, sdBox(px, py, r[0], r[1], r[2], r[3]));
      d[j * ws + i] = v;
    }
  }
  const out = new Float32Array(ws * hs * 3);
  const h = cfg.sdf_cell;
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < ws; i++) {
      const k = j * ws + i;
      // wie numpy.gradient: innen zentrale, am Rand einseitige Differenz
      const gx = i === 0 ? (d[k + 1] - d[k]) / h
        : i === ws - 1 ? (d[k] - d[k - 1]) / h : (d[k + 1] - d[k - 1]) / (2 * h);
      const gy = j === 0 ? (d[k + ws] - d[k]) / h
        : j === hs - 1 ? (d[k] - d[k - ws]) / h : (d[k + ws] - d[k - ws]) / (2 * h);
      out[3 * k] = d[k];
      out[3 * k + 1] = gx;
      out[3 * k + 2] = gy;
    }
  }
  return out;
}

/** Szene für den Browser: Abstandsfeld, Zeile, Wände (für die Darstellung). */
export function buildScene(cfg, spec) {
  return { sdf: buildSdf(cfg, spec.walls), row: scenarioRow(cfg, spec), walls: spec.walls };
}

/**
 * Bilineares Abtasten. grid hat `stride` Kanäle je Knoten, gelesen wird Kanal `ch`.
 * Spiegel von fields.bilinear und fields.bilinear_bank, Klammerung identisch.
 */
function bilin(grid, w, h, stride, ch, x, y, inv, off) {
  const u = f(f(x * inv) - off);
  const v = f(f(y * inv) - off);
  let i0 = Math.floor(u), j0 = Math.floor(v);
  if (i0 < 0) i0 = 0; else if (i0 > w - 2) i0 = w - 2;
  if (j0 < 0) j0 = 0; else if (j0 > h - 2) j0 = h - 2;
  let fx = f(u - i0), fy = f(v - j0);
  if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
  if (fy < 0) fy = 0; else if (fy > 1) fy = 1;
  const k = (j0 * w + i0) * stride + ch;
  const a00 = grid[k], a10 = grid[k + stride];
  const a01 = grid[k + w * stride], a11 = grid[k + w * stride + stride];
  const top = f(a00 + f(fx * f(a10 - a00)));
  const bot = f(a01 + f(fx * f(a11 - a01)));
  return f(top + f(fy * f(bot - top)));
}

const BIG = f(3.0e38);

export class Sim {
  /** scene: { sdf, row } aus buildScene oder aus einem Paritätsfall. */
  constructor(cfg, scene) {
    this.cfg = cfg;
    const n = (this.n = cfg.n_ants);
    const W = (this.W = Math.round(cfg.width));
    const H = (this.H = Math.round(cfg.height));
    this.Ws = Math.round(cfg.width / cfg.sdf_cell) + 1;
    this.Hs = Math.round(cfg.height / cfg.sdf_cell) + 1;
    const row = (this.row = scene.row);
    this.S = cfg.n_slots_max;
    this.P = cfg.n_rim_max;
    this.E = cfg.n_seg_max;
    this.sdf = scene.sdf;
    this.walls = scene.walls ?? [];
    const F = (a) => Float32Array.from(a);
    this.slotAtt = F(row.slot_att);
    this.rim = F(row.rim);
    this.rimMask = Uint8Array.from(row.rim_mask);
    this.seg = {
      a: F(row.seg_a), b: F(row.seg_b), d: F(row.seg_d), n: F(row.seg_n), il2: F(row.seg_il2),
      slope: F(row.seg_slope), s0: F(row.seg_s0), len: F(row.seg_len),
      mask: Uint8Array.from(row.seg_mask),
    };
    this.disc = row.disc ? 1 : 0;

    // Zustand
    this.pos = new Float32Array(2 * n);
    this.theta = new Float32Array(n);
    this.active = new Uint8Array(n);
    this.grip = new Uint8Array(n);
    this.slot = new Int32Array(n);
    this.tDock = new Float32Array(n);
    this.mem = new Float32Array(MEM_DIM * n);
    this.thrust = new Float32Array(n);
    this.loadPos = new Float32Array([row.load_x, row.load_y]);
    this.loadAng = f(row.load_ang);
    this.loadVel = new Float32Array(2);
    this.loadOmega = 0;
    this.slotOcc = new Uint8Array(this.S);
    this.density = new Float32Array(H * W);
    this.phero = new Float32Array(H * W * PHERO_CH);
    this.scen = 0;
    this.t = 0;

    // Arbeitsspeicher
    this._phero2 = new Float32Array(H * W * PHERO_CH);
    this._dep = new Float32Array(H * W * PHERO_CH);
    this._cos = new Float32Array(n);
    this._sin = new Float32Array(n);
    this._winner = new Int32Array(this.S);
    this._slotRel = new Float32Array(2 * this.S);
    this._slotPos = new Float32Array(2 * this.S);
    this._slotOk = new Uint8Array(this.S);
    this._nb = { sd: 0, qx: 0, qy: 0, arc: 0, ox: 0, oy: 0, inside: false };
    const P = this.P;
    this._c = { gx: new Float32Array(P), gy: new Float32Array(P), cr: new Float32Array(P),
      e: new Float32Array(P), mob: new Float32Array(P), mEff: 1 };

    // Konstanten: Ausdrücke in double wie in Python (SimConfig-Eigenschaften), dann einmal
    // auf float32 gerundet. Werte je Szenario kommen schon als float32 aus der Zeile.
    this.k = {
      invSdf: f(1.0 / cfg.sdf_cell),
      slotLen: f(row.slot_len),
      sLast: row.n_slots - 1,
      radius: f(row.load_radius),
      rGrip: f(cfg.r_grip),
      turn: f(cfg.omega_max * cfg.dt),
      stepLen: f(cfg.v_max * cfg.dt),
      invV: f(1.0 / cfg.v_max),
      negRep: f(-(cfg.c_rep * cfg.dt)),
      repClip: f(cfg.rep_vmax * cfg.dt),
      rAnt: f(cfg.r_ant),
      f0: f(cfg.f0),
      fStick: f(row.f_stick),
      gammaT: f(row.gamma_t),
      tauStick: f(row.tau_stick),
      gammaR: f(row.gamma_r),
      nSlots: row.n_slots,
      // Heben: Faktor auf die Zahl der Greifer. 1 ist exakt (x * 1 = x), parity_run.mjs
      // stört ihn (Störung "heben").
      liftGain: f(1.0),
      skin: f(cfg.wall_skin),
      projClear: f(cfg.proj_clear),
      stiff: f(cfg.wall_stiff / (cfg.dt / cfg.n_sub)),
      dt: f(cfg.dt),
      dtSub: f(cfg.dt / cfg.n_sub),
      xMax: f(cfg.width - 0.5),
      yMax: f(cfg.height - 0.5),
      keep: f(1.0 - cfg.phero_decay * cfg.dt),
      diff: f(cfg.phero_diff * cfg.dt),
      quant: f(cfg.phero_quant),
      tInf: f(cfg.t_inf),
      nestX: f(row.nest_x),
      nestY: f(row.nest_y),
      // Fühler der Beobachtung (Dezimalliterale wie in obs.py). In der Tabelle statt als
      // Modulkonstante, damit parity_run.mjs einen Winkel stören kann.
      antCos: ANT_COS, antSin: ANT_SIN,
      wallCos: WALL_COS, wallSin: WALL_SIN,
      densCos: DENS_COS, densSin: DENS_SIN,
    };
  }

  /** Zufälliger Start für die Demo. rng() liefert Zahlen in [0, 1). */
  reset(rng) {
    const { cfg, n, pos, row } = this;
    const m = cfg.wall_thick + 1.0;
    const lx = (this.loadPos[0] = row.load_x);
    const ly = (this.loadPos[1] = row.load_y);
    // verstreut um die Last (PLAN.md §5.7): gleichverteilt auf einem Kreisring
    const r0 = row.spawn_r0, r1 = row.spawn_r1; // Startzone mit fester Dichte
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(r0 * r0 + rng() * (r1 * r1 - r0 * r0));
      const a = (rng() * 2 - 1) * Math.PI;
      pos[2 * i] = Math.min(Math.max(lx + r * Math.cos(a), m), cfg.width - m);
      pos[2 * i + 1] = Math.min(Math.max(ly + r * Math.sin(a), m), cfg.height - m);
      this.theta[i] = (rng() * 2 - 1) * Math.PI;
      this.active[i] = i < row.n_ants ? 1 : 0;
    }
    this.grip.fill(0); this.slot.fill(0); this.tDock.fill(0); this.mem.fill(0);
    this.thrust.fill(0); this.slotOcc.fill(0); this.phero.fill(0);
    this.loadAng = f(row.load_ang); this.loadVel.fill(0); this.loadOmega = 0; this.t = 0;
    this._depositDensity();
  }

  /** Zustand aus dem Paritätsfall (flache Listen im Layout der JAX-Arrays). */
  loadState(s) {
    this.pos.set(s.pos); this.theta.set(s.theta); this.active.set(s.active);
    this.grip.set(s.grip); this.slot.set(s.slot); this.tDock.set(s.t_dock); this.mem.set(s.mem);
    this.thrust.set(s.thrust); this.loadPos.set(s.load_pos);
    this.loadAng = f(s.load_ang); this.loadVel.set(s.load_vel);
    this.loadOmega = f(s.load_omega); this.slotOcc.set(s.slot_occ);
    this.density.set(s.density); this.phero.set(s.phero);
    this.scen = s.scen; this.t = s.t;
  }

  _depositDensity() {
    const { n, W, H, pos, density, active } = this;
    density.fill(0);
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      let ci = Math.floor(pos[2 * i]), cj = Math.floor(pos[2 * i + 1]);
      if (ci < 0) ci = 0; else if (ci > W - 1) ci = W - 1;
      if (cj < 0) cj = 0; else if (cj > H - 1) cj = H - 1;
      density[cj * W + ci] += 1;
    }
  }

  /**
   * Nächster Randpunkt der Last zum Punkt (px, py) im System der Last. Spiegel von
   * load.nearest_boundary. Ergebnis in this._nb (sd, qx, qy, arc, ox, oy, inside), (ox, oy)
   * ist die Richtung nach außen: Normale des Randstücks, nur an einer Ecke (p - q) / |p - q|.
   */
  _nearest(px, py) {
    const k = this.k, sg = this.seg, nb = this._nb;
    const R = k.radius;
    const rad = f(Math.sqrt(f(f(px * px) + f(py * py))));
    const inv = f(1 / Math.max(rad, f(1e-12)));
    const ux = f(px * inv), uy = f(py * inv);
    const dr = f(rad - R);
    let best = this.disc ? f(dr * dr) : BIG;
    let qx = f(R * ux), qy = f(R * uy);
    let ang = f(Math.atan2(py, px));
    ang = f(ang - f(TWO_PI * Math.floor(f(ang / TWO_PI))));
    let arc = f(R * ang);
    let nx = ux, ny = uy, corner = false;
    let inside = this.disc && rad < R;
    for (let e = 0; e < this.E; e++) {
      if (!sg.mask[e]) continue;
      const ax = sg.a[2 * e], ay = sg.a[2 * e + 1], dx = sg.d[2 * e], dy = sg.d[2 * e + 1];
      const tRaw = f(f(f(f(px - ax) * dx) + f(f(py - ay) * dy)) * sg.il2[e]);
      let t = tRaw;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const ex = f(ax + f(t * dx)), ey = f(ay + f(t * dy));
      const wx = f(px - ex), wy = f(py - ey);
      const d2 = f(f(wx * wx) + f(wy * wy));
      if (d2 < best) {
        best = d2; qx = ex; qy = ey;
        arc = f(sg.s0[e] + f(t * sg.len[e]));
        nx = sg.n[2 * e]; ny = sg.n[2 * e + 1];
        corner = tRaw <= 0 || tRaw >= 1;
      }
      const by = sg.b[2 * e + 1];
      if ((ay > py) !== (by > py) && px < f(ax + f(f(py - ay) * sg.slope[e]))) inside = !inside;
    }
    const dist = f(Math.sqrt(best));
    nb.sd = inside ? -dist : dist;
    const kk = f((inside ? -1 : 1) / Math.max(dist, f(1e-12)));
    const use = corner && dist > f(1e-6);
    nb.ox = use ? f(f(px - qx) * kk) : nx;
    nb.oy = use ? f(f(py - qy) * kk) : ny;
    nb.qx = qx; nb.qy = qy; nb.arc = arc; nb.inside = inside;
    return nb;
  }

  /** Griffplatz zur Bogenlänge. Spiegel von load.slot_of. */
  _slotOf(arc) {
    let s = Math.floor(f(arc / this.k.slotLen));
    if (s < 0) s = 0; else if (s > this.k.sLast) s = this.k.sLast;
    return s;
  }

  /** Griffpunkte aller Plätze bei Lage (lx, ly) und cos/sin (c, s), und ob die Wand sie sperrt. */
  _slots(lx, ly, c, s) {
    const { slotAtt, sdf, Ws, Hs, k } = this;
    const rel = this._slotRel, pos = this._slotPos, ok = this._slotOk;
    for (let j = 0; j < this.S; j++) {
      const a0 = slotAtt[2 * j], a1 = slotAtt[2 * j + 1];
      const rx = f(f(c * a0) - f(s * a1)), ry = f(f(s * a0) + f(c * a1));
      rel[2 * j] = rx; rel[2 * j + 1] = ry;
      const x = f(lx + rx), y = f(ly + ry);
      pos[2 * j] = x; pos[2 * j + 1] = y;
      ok[j] = bilin(sdf, Ws, Hs, 3, 0, x, y, k.invSdf, 0) >= k.rAnt ? 1 : 0;
    }
  }

  /** Randpunkte gegen die Wand (Spiegel von load._contacts). Ergebnis in this._c. */
  _contacts(lx, ly, la, target) {
    const k = this.k, cc = this._c, { rim, rimMask, sdf, Ws, Hs } = this;
    const c = f(Math.cos(la)), s = f(Math.sin(la));
    const invGt = f(1 / k.gammaT);
    let sumE = 0, maxE = 0;
    for (let j = 0; j < this.P; j++) {
      const r0 = rim[2 * j], r1 = rim[2 * j + 1];
      const rx = f(f(c * r0) - f(s * r1)), ry = f(f(s * r0) + f(c * r1));
      const px = f(lx + rx), py = f(ly + ry);
      let e = 0, gx = 0, gy = 0;
      if (rimMask[j]) {
        const d = bilin(sdf, Ws, Hs, 3, 0, px, py, k.invSdf, 0);
        gx = bilin(sdf, Ws, Hs, 3, 1, px, py, k.invSdf, 0);
        gy = bilin(sdf, Ws, Hs, 3, 2, px, py, k.invSdf, 0);
        e = Math.max(f(target - d), 0);
      }
      const cr = f(f(rx * gy) - f(ry * gx));
      cc.gx[j] = gx; cc.gy[j] = gy; cc.cr[j] = cr; cc.e[j] = e;
      cc.mob[j] = f(invGt + f(f(cr * cr) / k.gammaR));
      sumE += e;
      if (e > maxE) maxE = e;
    }
    cc.mEff = Math.max(f(f(sumE) / Math.max(maxE, f(1e-12))), 1);
    return cc;
  }

  /**
   * Ein Schritt. act: Float32Array (N * 9) mit [Schub, Lenkung, Greifen (> 0),
   * Pheromon 0, Pheromon 1, Gedächtnis 0..3] je Ameise, bereits gequetscht.
   */
  step(act) {
    const k = this.k, n = this.n, S = this.S, W = this.W, H = this.H, P = this.P;
    const { pos, theta, active, grip, slot, sdf, Ws, Hs, density } = this;
    const cosT = this._cos, sinT = this._sin;
    const oldLx = this.loadPos[0], oldLy = this.loadPos[1], oldLa = this.loadAng;

    // 1. Greifregel auf dem alten Zustand, Plätze an der Wand gesperrt
    let cl = f(Math.cos(oldLa)), sl = f(Math.sin(oldLa));
    this._slots(oldLx, oldLy, cl, sl);
    const slotRel = this._slotRel, slotOk = this._slotOk;
    const occ = this.slotOcc, winner = this._winner;
    occ.fill(0);
    winner.fill(-1);
    for (let i = 0; i < n; i++) {
      if (grip[i] && act[i * ACT_DIM + 2] > 0 && active[i]) occ[slot[i]] = 1;
    }
    for (let i = 0; i < n; i++) {
      const want = act[i * ACT_DIM + 2] > 0;
      if (grip[i]) {
        // lässt los (oder wurde inaktiv), darf in diesem Schritt nicht neu greifen
        if (!want || !active[i]) grip[i] = 2;
        continue;
      }
      if (!want || !active[i]) continue;
      const rx = f(pos[2 * i] - oldLx), ry = f(pos[2 * i + 1] - oldLy);
      const nb = this._nearest(f(f(cl * rx) + f(sl * ry)), f(f(cl * ry) - f(sl * rx)));
      if (!(nb.sd < k.rGrip)) continue;
      const s = this._slotOf(nb.arc);
      if (!occ[s] && slotOk[s] && winner[s] < 0) winner[s] = i; // kleinster Index gewinnt
    }
    for (let i = 0; i < n; i++) if (grip[i] === 2) grip[i] = 0;
    for (let s = 0; s < S; s++) {
      const w = winner[s];
      if (w >= 0) { grip[w] = 1; slot[w] = s; }
    }
    // Heben (ADR 0015): Die Schwellen sinken mit der Zahl der Greifer nach der Greifregel
    let nGrip = 0;
    for (let i = 0; i < n; i++) if (grip[i]) nGrip += 1;
    const lift = f(1 - f(f(nGrip * k.liftGain) / k.nSlots));
    const fStick = f(k.fStick * lift), tauStick = f(k.tauStick * lift);

    // 2. Drehen (nur aktive)
    for (let i = 0; i < n; i++) {
      if (active[i]) {
        let th = f(theta[i] + f(k.turn * act[i * ACT_DIM + 1]));
        th = f(th - f(TWO_PI * Math.floor(f(f(th / TWO_PI) + 0.5))));
        theta[i] = th;
      }
      cosT[i] = Math.cos(theta[i]);
      sinT[i] = Math.sin(theta[i]);
    }

    // 3. Kräfte der Greifer auf die Last, angreifend am Griffpunkt
    let sumFx = 0, sumFy = 0, sumTau = 0;
    for (let i = 0; i < n; i++) {
      if (!grip[i]) continue;
      const rx = slotRel[2 * slot[i]], ry = slotRel[2 * slot[i] + 1];
      const pull = f(k.f0 * act[i * ACT_DIM]);
      const fx = f(pull * cosT[i]), fy = f(pull * sinT[i]);
      sumFx += fx;
      sumFy += fy;
      sumTau += f(f(rx * fy) - f(ry * fx));
    }
    const fAntX = f(sumFx), fAntY = f(sumFy), tauAnt = f(sumTau);

    // 4. Last: Teilschritte mit Federkraft der Wand, dann Projektion (ADR 0007)
    let lx = oldLx, ly = oldLy, la = oldLa;
    for (let sub = 0; sub < this.cfg.n_sub; sub++) {
      const cc = this._contacts(lx, ly, la, k.skin);
      let wFx = 0, wFy = 0, wTau = 0;
      for (let j = 0; j < P; j++) {
        const lam = f(f(f(cc.e[j] / cc.mob[j]) * k.stiff) / cc.mEff);
        wFx += f(lam * cc.gx[j]);
        wFy += f(lam * cc.gy[j]);
        wTau += f(lam * cc.cr[j]);
      }
      const Fx = f(fAntX + f(wFx)), Fy = f(fAntY + f(wFy));
      const tau = f(tauAnt + f(wTau));
      const mag = f(Math.sqrt(f(f(Fx * Fx) + f(Fy * Fy))));
      const speed = f(Math.max(f(mag - fStick), 0) / k.gammaT);
      const scale = f(speed / Math.max(mag, f(1e-9)));
      lx = f(lx + f(f(Fx * scale) * k.dtSub));
      ly = f(ly + f(f(Fy * scale) * k.dtSub));
      const om = f(f(Math.sign(tau) * Math.max(f(Math.abs(tau) - tauStick), 0)) / k.gammaR);
      la = f(la + f(om * k.dtSub));
    }
    for (let it = 0; it < this.cfg.n_proj; it++) {
      const cc = this._contacts(lx, ly, la, k.projClear);
      let sx = 0, sy = 0, st = 0;
      for (let j = 0; j < P; j++) {
        const lam = f(f(cc.e[j] / cc.mob[j]) / cc.mEff);
        sx += f(lam * cc.gx[j]);
        sy += f(lam * cc.gy[j]);
        st += f(lam * cc.cr[j]);
      }
      lx = f(lx + f(f(sx) / k.gammaT));
      ly = f(ly + f(f(sy) / k.gammaT));
      la = f(la + f(f(st) / k.gammaR));
    }
    this.loadVel[0] = f(f(lx - oldLx) / k.dt);
    this.loadVel[1] = f(f(ly - oldLy) / k.dt);
    this.loadOmega = f(f(la - oldLa) / k.dt);
    la = f(la - f(TWO_PI * Math.floor(f(f(la / TWO_PI) + 0.5))));
    this.loadPos[0] = lx;
    this.loadPos[1] = ly;
    this.loadAng = la;

    // 5. Greifer, deren Griffpunkt jetzt zu nah an der Wand läge, lassen los. Dann Ameisen:
    //    am Griffpunkt hängen oder frei laufen, inaktive bleiben stehen.
    cl = f(Math.cos(la));
    sl = f(Math.sin(la));
    this._slots(lx, ly, cl, sl);
    const slotPos = this._slotPos;
    for (let i = 0; i < n; i++) if (grip[i] && !slotOk[slot[i]]) grip[i] = 3; // 3: gerade gelöst
    for (let i = 0; i < n; i++) {
      if (grip[i] === 1) {
        pos[2 * i] = slotPos[2 * slot[i]];
        pos[2 * i + 1] = slotPos[2 * slot[i] + 1];
        continue;
      }
      if (!active[i]) continue;
      let x = pos[2 * i], y = pos[2 * i + 1];
      let ci = Math.floor(x), cj = Math.floor(y);
      if (ci < 0) ci = 0; else if (ci > W - 1) ci = W - 1;
      if (cj < 0) cj = 0; else if (cj > H - 1) cj = H - 1;
      const gx = f(0.5 * f(density[cj * W + Math.min(ci + 1, W - 1)]
        - density[cj * W + Math.max(ci - 1, 0)]));
      const gy = f(0.5 * f(density[Math.min(cj + 1, H - 1) * W + ci]
        - density[Math.max(cj - 1, 0) * W + ci]));
      let repX = f(k.negRep * gx), repY = f(k.negRep * gy);
      if (repX < -k.repClip) repX = -k.repClip; else if (repX > k.repClip) repX = k.repClip;
      if (repY < -k.repClip) repY = -k.repClip; else if (repY > k.repClip) repY = k.repClip;
      const drive = f(k.stepLen * act[i * ACT_DIM]);
      x = f(f(x + f(drive * cosT[i])) + repX);
      y = f(f(y + f(drive * sinT[i])) + repY);
      // Wand
      const d = bilin(sdf, Ws, Hs, 3, 0, x, y, k.invSdf, 0);
      const push = f(k.rAnt - d);
      if (push > 0) {
        const wgx = bilin(sdf, Ws, Hs, 3, 1, x, y, k.invSdf, 0);
        const wgy = bilin(sdf, Ws, Hs, 3, 2, x, y, k.invSdf, 0);
        x = f(x + f(push * wgx));
        y = f(y + f(push * wgy));
      }
      // Last als Hindernis (Spiegel von ants.push_out_of_load)
      const rx = f(x - lx), ry = f(y - ly);
      const px = f(f(cl * rx) + f(sl * ry)), py = f(f(cl * ry) - f(sl * rx));
      const nb = this._nearest(px, py);
      if (nb.sd < k.rAnt) {
        const tx = f(nb.qx + f(k.rAnt * nb.ox)), ty = f(nb.qy + f(k.rAnt * nb.oy));
        x = f(lx + f(f(cl * tx) - f(sl * ty)));
        y = f(ly + f(f(sl * tx) + f(cl * ty)));
      }
      if (x < 0.5) x = 0.5; else if (x > k.xMax) x = k.xMax;
      if (y < 0.5) y = 0.5; else if (y > k.yMax) y = k.yMax;
      pos[2 * i] = x;
      pos[2 * i + 1] = y;
    }

    // 6. Felder: nur aktive Ameisen legen ab
    const dep = this._dep;
    density.fill(0);
    dep.fill(0);
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      let ci = Math.floor(pos[2 * i]), cj = Math.floor(pos[2 * i + 1]);
      if (ci < 0) ci = 0; else if (ci > W - 1) ci = W - 1;
      if (cj < 0) cj = 0; else if (cj > H - 1) cj = H - 1;
      const cell = cj * W + ci;
      density[cell] += 1;
      for (let c = 0; c < PHERO_CH; c++) {
        let a = act[i * ACT_DIM + 3 + c];
        if (a < 0) a = 0; else if (a > 1) a = 1;
        // Vielfache von 1/256: die Summe je Zelle ist exakt, egal in welcher Reihenfolge
        dep[cell * PHERO_CH + c] += f(Math.floor(f(a * k.quant)) / k.quant);
      }
    }
    const p = this.phero, q = this._phero2;
    for (let j = 0; j < H; j++) {
      const ju = Math.min(j + 1, H - 1), jd = Math.max(j - 1, 0);
      for (let i = 0; i < W; i++) {
        const ir = Math.min(i + 1, W - 1), il = Math.max(i - 1, 0);
        for (let c = 0; c < PHERO_CH; c++) {
          const v = p[(j * W + i) * PHERO_CH + c];
          const right = p[(j * W + ir) * PHERO_CH + c], left = p[(j * W + il) * PHERO_CH + c];
          const up = p[(ju * W + i) * PHERO_CH + c], down = p[(jd * W + i) * PHERO_CH + c];
          const lap = f(f(f(right + left) + f(up + down)) - f(4 * v));
          q[(j * W + i) * PHERO_CH + c] =
            f(f(f(k.keep * v) + f(k.diff * lap)) + dep[(j * W + i) * PHERO_CH + c]);
        }
      }
    }
    this.phero = q;
    this._phero2 = p;

    // 7. Buchführung. Die Kraft im letzten Schritt zählt auch für gerade Gelöste.
    occ.fill(0);
    for (let i = 0; i < n; i++) {
      const g = grip[i];
      this.thrust[i] = g ? act[i * ACT_DIM] : 0;
      if (g === 3) grip[i] = 0;
      if (grip[i]) occ[slot[i]] = 1;
      this.tDock[i] = grip[i] ? f(this.tDock[i] + k.dt) : 0;
      if (active[i]) for (let m = 0; m < MEM_DIM; m++) this.mem[i * MEM_DIM + m] = act[i * ACT_DIM + 5 + m];
    }
    this.t += 1;
  }

  /** Erfolg wie env.step_info: Lastmitte näher als nest_r am Nest (float32). */
  atNest() {
    const r = this.row;
    const dx = f(this.loadPos[0] - r.nest_x), dy = f(this.loadPos[1] - r.nest_y);
    return f(f(dx * dx) + f(dy * dy)) < f(r.nest_r * r.nest_r);
  }

  /** Beobachtung aller Ameisen. out: Float32Array (N * 25). Spiegel von obs.observe. */
  observe(out) {
    const k = this.k, n = this.n, W = this.W, H = this.H;
    const { pos, theta, active, grip, sdf, Ws, Hs, density, phero } = this;
    const lx = this.loadPos[0], ly = this.loadPos[1], la = this.loadAng;
    const lvx = this.loadVel[0], lvy = this.loadVel[1], lom = this.loadOmega;
    const lc = f(Math.cos(la)), ls = f(Math.sin(la));
    this._slots(lx, ly, lc, ls); // Sperre der Plätze an der Wand für „Platz frei"
    const half = f(0.5);
    const ANT_COS = k.antCos, ANT_SIN = k.antSin, WALL_COS = k.wallCos, WALL_SIN = k.wallSin;
    const DENS_COS = k.densCos, DENS_SIN = k.densSin;
    for (let i = 0; i < n; i++) {
      const o = i * OBS_DIM;
      if (!active[i]) {
        out.fill(0, o, o + OBS_DIM);
        continue;
      }
      const x = pos[2 * i], y = pos[2 * i + 1];
      const c = f(Math.cos(theta[i])), s = f(Math.sin(theta[i]));
      const g = grip[i] ? 1 : 0;

      // Fühler: Punkt im Abstand len unter dem Winkel (ca, sa) links der Blickrichtung
      let px, py, v;
      // Pheromon links, rechts
      px = f(x + f(ANT_LEN * f(f(c * ANT_COS) - f(s * ANT_SIN))));
      py = f(y + f(ANT_LEN * f(f(s * ANT_COS) + f(c * ANT_SIN))));
      v = bilin(phero, W, H, 2, 0, px, py, 1, half); out[o] = f(v / f(1 + v));
      v = bilin(phero, W, H, 2, 1, px, py, 1, half); out[o + 1] = f(v / f(1 + v));
      px = f(x + f(ANT_LEN * f(f(c * ANT_COS) - f(s * -ANT_SIN))));
      py = f(y + f(ANT_LEN * f(f(s * ANT_COS) + f(c * -ANT_SIN))));
      v = bilin(phero, W, H, 2, 0, px, py, 1, half); out[o + 2] = f(v / f(1 + v));
      v = bilin(phero, W, H, 2, 1, px, py, 1, half); out[o + 3] = f(v / f(1 + v));

      // Wandabstand links, rechts, vorn
      px = f(x + f(WALL_LEN * f(f(c * WALL_COS) - f(s * WALL_SIN))));
      py = f(y + f(WALL_LEN * f(f(s * WALL_COS) + f(c * WALL_SIN))));
      v = bilin(sdf, Ws, Hs, 3, 0, px, py, k.invSdf, 0);
      out[o + 4] = f(Math.min(Math.max(v, 0), WALL_RANGE) / WALL_RANGE);
      px = f(x + f(WALL_LEN * f(f(c * WALL_COS) - f(s * -WALL_SIN))));
      py = f(y + f(WALL_LEN * f(f(s * WALL_COS) + f(c * -WALL_SIN))));
      v = bilin(sdf, Ws, Hs, 3, 0, px, py, k.invSdf, 0);
      out[o + 5] = f(Math.min(Math.max(v, 0), WALL_RANGE) / WALL_RANGE);
      px = f(x + f(WALL_LEN * c));
      py = f(y + f(WALL_LEN * s));
      v = bilin(sdf, Ws, Hs, 3, 0, px, py, k.invSdf, 0);
      out[o + 6] = f(Math.min(Math.max(v, 0), WALL_RANGE) / WALL_RANGE);

      // Dichte links vorn, vorn, rechts vorn
      px = f(x + f(DENS_LEN * f(f(c * DENS_COS) - f(s * DENS_SIN))));
      py = f(y + f(DENS_LEN * f(f(s * DENS_COS) + f(c * DENS_SIN))));
      v = bilin(density, W, H, 1, 0, px, py, 1, half); out[o + 7] = f(v / f(1 + v));
      px = f(x + f(DENS_LEN * c));
      py = f(y + f(DENS_LEN * s));
      v = bilin(density, W, H, 1, 0, px, py, 1, half); out[o + 8] = f(v / f(1 + v));
      px = f(x + f(DENS_LEN * f(f(c * DENS_COS) - f(s * -DENS_SIN))));
      py = f(y + f(DENS_LEN * f(f(s * DENS_COS) + f(c * -DENS_SIN))));
      v = bilin(density, W, H, 1, 0, px, py, 1, half); out[o + 9] = f(v / f(1 + v));

      // Last: Richtung und Abstand zum nächsten Randpunkt, nächster Griffplatz
      const relx = f(x - lx), rely = f(y - ly);
      const qxl = f(f(lc * relx) + f(ls * rely)), qyl = f(f(lc * rely) - f(ls * relx));
      const nb = this._nearest(qxl, qyl);
      const edge = nb.sd;
      const seen = edge < LOAD_RANGE ? 1 : 0;
      const toward = nb.inside ? 1 : -1; // zum nächsten Randpunkt: außen gegen die Normale
      const vx0 = f(toward * nb.ox), vy0 = f(toward * nb.oy);
      const tx = f(f(lc * vx0) - f(ls * vy0)), ty = f(f(ls * vx0) + f(lc * vy0));
      out[o + 10] = f(f(f(c * tx) + f(s * ty)) * seen);
      out[o + 11] = f(f(f(c * ty) - f(s * tx)) * seen);
      out[o + 12] = f(f(edge / LOAD_RANGE) * seen);
      const sl = this._slotOf(nb.arc);
      out[o + 13] = seen * (!this.slotOcc[sl] && this._slotOk[sl] ? 1 : 0);

      // Mechanischer Kanal: Geschwindigkeit des Griffpunkts, v + omega x r
      const vx = f(lvx - f(lom * rely)), vy = f(lvy + f(lom * relx));
      out[o + 14] = f(f(f(f(c * vx) + f(s * vy)) * g) * k.invV);
      out[o + 15] = f(f(f(f(c * vy) - f(s * vx)) * g) * k.invV);
      out[o + 16] = this.thrust[i];

      // Nestkompass
      let nx = f(k.nestX - x), ny = f(k.nestY - y);
      const invN = f(1 / f(Math.sqrt(f(f(f(nx * nx) + f(ny * ny)) + f(1e-12)))));
      nx = f(nx * invN);
      ny = f(ny * invN);
      const mask = g ? Math.max(f(1 - f(this.tDock[i] / k.tInf)), 0) : 1;
      out[o + 17] = f(f(f(c * nx) + f(s * ny)) * mask);
      out[o + 18] = f(f(f(c * ny) - f(s * nx)) * mask);
      out[o + 19] = mask;
      out[o + 20] = g;
      for (let m = 0; m < MEM_DIM; m++) out[o + 21 + m] = this.mem[i * MEM_DIM + m];
    }
  }
}
