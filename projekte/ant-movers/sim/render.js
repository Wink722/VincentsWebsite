// WebGL2-Renderer mit Instanzen (PLAN.md §9), Stil A „heller Labortisch".
//
// Drei Durchgänge: Grund mit Wänden und Feldern (ein Vollbild-Dreieck), die Last (ein
// Quad), alle Ameisen (ein instanzierter Aufruf). Die Beine der Ameisen sind gezeichnet,
// nicht simuliert.
//
// Kamera: Mittelpunkt und halbe sichtbare Höhe in Welteinheiten (`camera`), verschieben und
// zoomen über web/camera.js. Einblendbare Felder (`layers`): Pheromon, Dichte, Abstandsfeld,
// Wegdistanzfeld (nur wenn die Szene eines mitbringt, also in Aufzeichnungen aus JAX).
//
// Gezeichnet wird eine „Ansicht" (`draw(view)`): cfg, row, n, W, H, Ws, Hs, pos, theta, grip,
// active, loadPos, loadAng und die Felder, entweder als Zahlen (`phero`, `density` wie in
// Sim) oder schon kodiert (`pheroU8`, `densityU8` wie in einer Aufzeichnung). Eine Sim ist
// eine Ansicht, ein interpoliertes Bild aus web/frame.js mit Feldern auch.

import { PHERO_CH } from "./sim.js";

// Nur Darstellung: bei dieser Pheromonmenge ist die Lasur halb gesättigt.
const PHERO_SOFT = 16;
// Nur Darstellung: Strecke eines Doppelschritts der gezeichneten Beine, in Körperlängen.
const STRIDE = 0.55;

const VS_FULL = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_GROUND = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uSdf;    // R16F: Abstand an den Knoten (Abstand sdf_cell)
uniform sampler2D uPhero;  // RG8: p / (16 + p) je Kanal
uniform sampler2D uDens;   // R8: Ameisen je Zelle (NEAREST, die Zellen sind die Wahrheit)
uniform sampler2D uPath;   // R16F: Wegdistanz zum Nest je Zelle
uniform vec2 uWorld;       // Breite, Höhe der Arena
uniform vec2 uSdfN;        // Knoten des Abstandsfelds (Ws, Hs)
uniform float uSdfCell;
uniform vec4 uCam;         // Mittelpunkt x, y, halbe sichtbare Breite, Höhe
uniform vec4 uLayers;      // Pheromon, Dichte, Abstandsfeld, Wegdistanz (0 oder 1)
uniform float uPathStep;   // Abstand der Höhenlinien der Wegdistanz
uniform vec3 uNest;        // x, y, Radius
uniform float uPx;         // Welteinheiten je Pixel
uniform float uClear;      // 1: durchsichtig über einer Seite (Tragemodus), nur das Ziel

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Höhenlinie von v im Abstand s, rund ein Pixel breit
float iso(float v, float s) {
  float e = abs(fract(v / s + 0.5) - 0.5) * s;
  return 1.0 - smoothstep(0.0, 1.2 * fwidth(v), e);
}

void main() {
  vec2 w = uCam.xy + (vUv * 2.0 - 1.0) * uCam.zw;
  vec2 uvF = w / uWorld;                                       // zellzentrierte Felder
  vec2 uvS = (w / uSdfCell + 0.5) / uSdfN;                     // Knoten des Abstandsfelds
  bool outside = any(lessThan(w, vec2(0.0))) || any(greaterThan(w, uWorld));
  vec3 col = vec3(0.925, 0.895, 0.835);                       // Sand
  col *= 0.985 + 0.03 * hash(floor(w * 6.0));                 // Papierkorn
  if (uLayers.x > 0.5) {
    vec2 ph = texture(uPhero, uvF).rg;
    col = mix(col, col * vec3(0.33, 0.66, 0.62), smoothstep(0.02, 1.0, ph.r) * 0.6);  // Lasur 1
    col = mix(col, col * vec3(0.62, 0.45, 0.74), smoothstep(0.02, 1.0, ph.g) * 0.6);  // Lasur 2
  }
  if (uLayers.w > 0.5) {
    float pd = texture(uPath, uvF).r;
    float t = clamp(pd / (12.0 * uPathStep), 0.0, 1.0);
    col = mix(col, col * mix(vec3(0.80, 0.93, 0.80), vec3(0.97, 0.90, 0.78), t), 0.8);
    col = mix(col, vec3(0.20, 0.42, 0.24), iso(pd, uPathStep) * 0.55);
  }
  if (uLayers.y > 0.5) {
    float c = texture(uDens, uvF).r * 255.0;
    col = mix(col, vec3(0.18, 0.30, 0.62), (1.0 - exp(-c / 2.5)) * 0.7);
  }
  float d = texture(uSdf, uvS).r;
  if (outside) d = -1.0;
  if (uLayers.z > 0.5 && d > 0.0) {
    col = mix(col, vec3(0.18, 0.36, 0.70), iso(d, 1.0) * 0.5 * (1.0 - smoothstep(4.0, 8.0, d)));
    float e = abs(d - 0.5);                                    // r_ant: hier schiebt die Wand
    col = mix(col, vec3(0.75, 0.18, 0.12), (1.0 - smoothstep(0.0, 1.2 * fwidth(d), e)) * 0.8);
  }
  float ring = abs(length(w - uNest.xy) - uNest.z);
  if (uClear > 0.5) {                                          // Tragemodus: nur das Ziel
    float a = (1.0 - smoothstep(0.0, 0.2 + uPx, ring)) * 0.85
            + (1.0 - smoothstep(0.0, uPx, length(w - uNest.xy) - 0.35)) * 0.85;
    frag = vec4(vec3(0.62, 0.29, 0.13) * min(a, 1.0), min(a, 1.0));
    return;
  }
  col = mix(col, vec3(0.45, 0.36, 0.26), (1.0 - smoothstep(0.0, 0.25 + uPx, ring)) * 0.7);
  col *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 1.6, d));        // weicher Schatten an der Wand
  col = mix(vec3(0.235, 0.21, 0.185), col, smoothstep(-uPx, uPx, d));
  if (outside) col = vec3(0.30, 0.28, 0.25);
  frag = vec4(col, 1.0);
}`;

const VS_LOAD = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec4 uLoad;   // x, y, Winkel, Umkreis
uniform vec4 uCam;
out vec2 vLocal;
void main() {
  vLocal = aCorner * (uLoad.w + 0.5);
  vec2 w = uLoad.xy + vLocal;
  gl_Position = vec4((w - uCam.xy) / uCam.zw, 0.0, 1.0);
}`;

// Die Last aus denselben Randstücken wie in der Physik (ADR 0007): Kreis oder bis zu acht
// Kanten. Abstand zum Rand, innen per Strahltest, Kerben zwischen den Griffplätzen über die
// Bogenlänge.
const FS_LOAD = `#version 300 es
precision highp float;
in vec2 vLocal;
out vec4 frag;
uniform vec4 uLoad;
uniform vec4 uSeg[8];     // Anfang (xy), Ende (zw) im System der Last
uniform vec2 uArc[8];     // Bogenlänge am Anfang, Länge
uniform int uNSeg;
uniform float uDisc;
uniform float uRadius;
uniform float uSlotLen;
uniform float uPx;
void main() {
  float c = cos(uLoad.z), s = sin(uLoad.z);
  vec2 p = vec2(c * vLocal.x + s * vLocal.y, c * vLocal.y - s * vLocal.x);
  float best = 1e30, arc = 0.0;
  bool inside = false;
  float r = length(p);
  float ang = atan(p.y, p.x);
  if (uDisc > 0.5) {
    best = abs(r - uRadius);
    arc = (ang < 0.0 ? ang + 6.2831853 : ang) * uRadius;
    inside = r < uRadius;
  }
  for (int e = 0; e < 8; e++) {
    if (e >= uNSeg) break;
    vec2 a = uSeg[e].xy, b = uSeg[e].zw, d = b - a;
    float t = clamp(dot(p - a, d) / dot(d, d), 0.0, 1.0);
    float dist = length(p - a - t * d);
    if (dist < best) { best = dist; arc = uArc[e].x + t * uArc[e].y; }
    if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * d.x / d.y) inside = !inside;
  }
  float sd = inside ? -best : best;
  float alpha = 1.0 - smoothstep(-uPx, uPx, sd);
  vec3 col = vec3(0.86, 0.47, 0.24);                           // Terrakotta
  col *= 0.9 + 0.1 * smoothstep(0.0, -2.0, sd);
  float rim = smoothstep(-0.45, -0.25, sd);
  col = mix(col, vec3(0.62, 0.29, 0.13), rim * 0.8);
  // Kerben zwischen den Griffplätzen
  float t = fract(arc / uSlotLen);
  float notch = (1.0 - smoothstep(0.0, 0.08, min(t, 1.0 - t))) * rim;
  col = mix(col, vec3(0.36, 0.16, 0.07), notch);
  // Marke für den Drehwinkel (nur bei der Scheibe, Polygone zeigen ihn selbst)
  float mark = (1.0 - smoothstep(0.0, 0.12 + uPx, abs(sin(ang)) * r)) * step(0.0, cos(ang))
             * step(r, uRadius - 0.6) * uDisc;
  col = mix(col, vec3(0.36, 0.16, 0.07), mark * 0.6);
  frag = vec4(col * alpha, alpha);
}`;

const VS_ANT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aAnt;   // x, y, Blickrichtung, 10 · Greif-Flag + Schrittphase (0 bis 1)
uniform vec4 uCam;
out vec2 vLocal;
out float vGrip;
out float vPhase;
void main() {
  vLocal = aCorner * vec2(0.78, 0.55);
  float c = cos(aAnt.z), s = sin(aAnt.z);
  vec2 w = aAnt.xy + vec2(c * vLocal.x - s * vLocal.y, s * vLocal.x + c * vLocal.y);
  vGrip = step(5.0, aAnt.w);
  vPhase = aAnt.w - 10.0 * vGrip;
  gl_Position = vec4((w - uCam.xy) / uCam.zw, 0.0, 1.0);
}`;

// Ameise aus drei Ellipsen, sechs Beinen und zwei Fühlern. Die Beine sind Animation, nicht
// simuliert (PLAN.md §9.2): Dreifußgang, die Schrittphase wächst mit der zurückgelegten
// Strecke (Renderer.draw), links vorn, rechts Mitte und links hinten schwingen zusammen.
const FS_ANT = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vGrip;
in float vPhase;
out vec4 frag;
uniform float uPx;
float ell(vec2 p, vec2 c, vec2 r) {            // genäherter Abstand zu einer Ellipse
  vec2 q = (p - c) / r;
  return (length(q) - 1.0) * min(r.x, r.y);
}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// Bein mit Knie: Hüfte h, Knie k, Fuß f; Fuß und Knie schwingen längs um sw
float leg(vec2 p, vec2 h, vec2 k, vec2 f, float sw) {
  vec2 k2 = k + vec2(0.5 * sw, 0.0), f2 = f + vec2(sw, 0.0);
  return min(seg(p, h, k2), seg(p, k2, f2));
}
void main() {
  float side = vLocal.y >= 0.0 ? 0.0 : 1.0;
  vec2 p = vec2(vLocal.x, abs(vLocal.y));      // Körper spiegelsymmetrisch
  float body = min(ell(p, vec2(-0.27, 0.0), vec2(0.24, 0.15)),      // Hinterleib
               min(ell(p, vec2(0.03, 0.0), vec2(0.15, 0.085)),      // Brust
                   ell(p, vec2(0.30, 0.0), vec2(0.12, 0.105))));    // Kopf
  float ph = 6.2831853 * vPhase;
  float a = 0.09;                               // Schwingweite in Körperlängen
  float s0 = a * sin(ph + 3.14159265 * side);          // vorn
  float s1 = a * sin(ph + 3.14159265 * (1.0 - side));  // Mitte, gegenphasig
  float s2 = s0;                                       // hinten wie vorn
  float legs = min(leg(p, vec2(0.08, 0.05), vec2(0.20, 0.24), vec2(0.36, 0.44), s0),
               min(leg(p, vec2(0.03, 0.06), vec2(0.04, 0.27), vec2(-0.02, 0.50), s1),
                   leg(p, vec2(-0.04, 0.05), vec2(-0.16, 0.24), vec2(-0.40, 0.44), s2)));
  legs = min(legs, min(seg(p, vec2(0.38, 0.05), vec2(0.50, 0.16)),
                       seg(p, vec2(0.50, 0.16), vec2(0.68, 0.18))));   // Fühler mit Knick
  legs -= 0.018;
  float aBody = 1.0 - smoothstep(-uPx, uPx, body);
  float aLegs = (1.0 - smoothstep(-uPx, uPx, legs)) * clamp(0.035 / uPx, 0.0, 1.0);
  float alpha = max(aBody, aLegs * 0.85);
  vec3 ink = vec3(0.12, 0.105, 0.09) + 0.08 * smoothstep(0.1, -0.1, p.x + 0.1) * (1.0 - aLegs);
  vec3 col = mix(ink, vec3(0.62, 0.17, 0.06), vGrip);   // Tusche, Greiferinnen Rotbraun
  frag = vec4(col * alpha, alpha);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error("Shader: " + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Programm: " + gl.getProgramInfoLog(p));
  }
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(p, i).name;
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { p, u: uniforms };
}

export class Renderer {
  /**
   * clear: durchsichtiger Hintergrund über einer Webseite (Tragemodus), gezeichnet werden nur
   * Ziel und Ameisen. drawLoad: die Last zeichnen (im Tragemodus ist das DOM-Element die Last).
   */
  constructor(canvas, { clear = false, drawLoad = true } = {}) {
    this.clear = clear;
    this.drawLoad = drawLoad;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: clear, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 steht nicht zur Verfügung.");
    this.gl = gl;
    this.canvas = canvas;
    this.ground = program(gl, VS_FULL, FS_GROUND);
    this.load = program(gl, VS_LOAD, FS_LOAD);
    this.ant = program(gl, VS_ANT, FS_ANT);

    const corners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);

    this.emptyVao = gl.createVertexArray();
    this.loadVao = gl.createVertexArray();
    gl.bindVertexArray(this.loadVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.antVao = gl.createVertexArray();
    gl.bindVertexArray(this.antVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.sdfTex = this._texture();
    this.pheroTex = this._texture();
    this.densTex = this._texture(gl.NEAREST);
    this.pathTex = this._texture();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    /** Kamera: Mittelpunkt (cx, cy) und halbe sichtbare Höhe in Welteinheiten. */
    this.camera = { cx: 64, cy: 48, halfH: 50 };
    /** Einblendbare Felder. */
    this.layers = { phero: true, density: false, sdf: false, path: false };
    this.hasPath = false;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // vormultipliziertes Alpha
  }

  _texture(filter = this.gl.LINEAR) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /**
   * Nach jedem Wechsel der Szene oder der Agentenzahl. scene: cfg, n, W, H, Ws, Hs, sdf
   * (Abstand je Knoten, Kanalabstand `sdfStride`, Vorgabe 3 wie in Sim) und optional `path`
   * (Wegdistanz je Zelle, H × W). Mit `fit` (Vorgabe) zeigt die Kamera die ganze Arena.
   */
  setScene(scene, fit = true) {
    const gl = this.gl;
    this.inst = new Float32Array(scene.n * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    const { Ws, Hs, W, H, sdf } = scene;
    const stride = scene.sdfStride ?? 3;
    const dist = new Float32Array(Ws * Hs);
    for (let i = 0; i < Ws * Hs; i++) dist[i] = sdf[stride * i];
    gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, Ws, Hs, 0, gl.RED, gl.FLOAT, dist);
    this.pheroBytes = new Uint8Array(W * H * PHERO_CH);
    gl.bindTexture(gl.TEXTURE_2D, this.pheroTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, W, H, 0, gl.RG, gl.UNSIGNED_BYTE, this.pheroBytes);
    this.densBytes = new Uint8Array(W * H);
    gl.bindTexture(gl.TEXTURE_2D, this.densTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, this.densBytes);
    this.hasPath = !!scene.path;
    gl.bindTexture(gl.TEXTURE_2D, this.pathTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, W, H, 0, gl.RED, gl.FLOAT,
      scene.path ? Float32Array.from(scene.path) : new Float32Array(W * H));
    this.world = [scene.cfg.width, scene.cfg.height];
    // Begehbarer Bereich (Abstand > 0): Szenen kleiner als das Programmgitter sind von
    // Wänden umschlossen (scenarios/generate.py), die Kamera zeigt nur die Arena.
    let x0 = Ws, x1 = -1, y0 = Hs, y1 = -1;
    for (let j = 0; j < Hs; j++) {
      for (let i = 0; i < Ws; i++) {
        if (dist[j * Ws + i] > 0) {
          if (i < x0) x0 = i; if (i > x1) x1 = i;
          if (j < y0) y0 = j; if (j > y1) y1 = j;
        }
      }
    }
    const c = scene.cfg.sdf_cell, m = 2 * scene.cfg.wall_thick;
    this.arena = x1 < 0 ? [0, 0, ...this.world]
      : [Math.max(0, x0 * c - m), Math.max(0, y0 * c - m),
        Math.min(this.world[0], x1 * c + m), Math.min(this.world[1], y1 * c + m)];
    if (fit) this.fit();
  }

  /** Seitenverhältnis des Canvas (Breite durch Höhe). */
  get aspect() {
    const c = this.canvas;
    return (c.clientWidth || c.width) / Math.max(1, c.clientHeight || c.height);
  }

  /** Kamera auf die ganze Arena (den begehbaren Bereich samt Außenwand). */
  fit() {
    const [x0, y0, x1, y1] = this.arena ?? [0, 0, ...(this.world ?? [128, 96])];
    this.camera.cx = 0.5 * (x0 + x1);
    this.camera.cy = 0.5 * (y0 + y1);
    this.camera.halfH = 0.5 * Math.max(y1 - y0, (x1 - x0) / this.aspect);
  }

  /** Bildschirmpunkt (clientX, clientY) in Weltkoordinaten. */
  screenToWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const { cx, cy, halfH } = this.camera;
    const halfW = halfH * (r.width / r.height);
    const u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
    return [cx + (2 * u - 1) * halfW, cy + (1 - 2 * v) * halfH];
  }

  /** Welteinheiten je Bildschirmpixel (CSS). */
  get unitsPerPixel() {
    return (2 * this.camera.halfH) / Math.max(1, this.canvas.clientHeight || this.canvas.height);
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  draw(view) {
    const gl = this.gl, cfg = view.cfg;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.clear) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    const cam = this.camera;
    const halfW = cam.halfH * (this.canvas.width / this.canvas.height);
    const px = (2 * cam.halfH) / this.canvas.height; // Welteinheiten je Pixel
    const L = this.layers;

    // Felder hochladen (nur eingeblendete)
    if (L.phero) {
      let pb = view.pheroU8;
      if (!pb) {
        pb = this.pheroBytes;
        const p = view.phero;
        for (let i = 0; i < pb.length; i++) pb[i] = (255 * p[i]) / (PHERO_SOFT + p[i]) + 0.5; // gerundet wie record.py
      }
      gl.bindTexture(gl.TEXTURE_2D, this.pheroTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, view.W, view.H, gl.RG, gl.UNSIGNED_BYTE, pb);
    }
    if (L.density) {
      let db = view.densityU8;
      if (!db) {
        db = this.densBytes;
        const d = view.density;
        for (let i = 0; i < db.length; i++) db[i] = Math.min(255, d[i]);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.densTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, view.W, view.H, gl.RED, gl.UNSIGNED_BYTE, db);
    }
    const units = [this.sdfTex, this.pheroTex, this.densTex, this.pathTex];
    for (let u = units.length - 1; u >= 0; u--) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, units[u]);
    }

    // 1. Grund
    const gu = this.ground.u;
    gl.useProgram(this.ground.p);
    gl.uniform1i(gu.uSdf, 0);
    gl.uniform1i(gu.uPhero, 1);
    gl.uniform1i(gu.uDens, 2);
    gl.uniform1i(gu.uPath, 3);
    gl.uniform2f(gu.uWorld, cfg.width, cfg.height);
    gl.uniform2f(gu.uSdfN, view.Ws, view.Hs);
    gl.uniform1f(gu.uSdfCell, cfg.sdf_cell);
    gl.uniform4f(gu.uCam, cam.cx, cam.cy, halfW, cam.halfH);
    gl.uniform4f(gu.uLayers, L.phero ? 1 : 0, L.density ? 1 : 0, L.sdf ? 1 : 0,
      L.path && this.hasPath ? 1 : 0);
    const span = this.arena ? this.arena[2] - this.arena[0] : cfg.width;
    gl.uniform1f(gu.uPathStep, Math.max(1, Math.round(span / 25))); // rund 25 Linien quer
    gl.uniform3f(gu.uNest, view.row.nest_x, view.row.nest_y, view.row.nest_r);
    gl.uniform1f(gu.uPx, px);
    gl.uniform1f(gu.uClear, this.clear ? 1 : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Last
    if (this.drawLoad) this._drawLoad(view, cam, halfW, px);
    this._drawAnts(view, cam, halfW, px);
  }

  _drawLoad(view, cam, halfW, px) {
    const gl = this.gl;
    gl.useProgram(this.load.p);
    const row = view.row, lu = this.load.u;
    gl.uniform4f(lu.uLoad, view.loadPos[0], view.loadPos[1], view.loadAng, row.r_out);
    gl.uniform4f(lu.uCam, cam.cx, cam.cy, halfW, cam.halfH);
    if (!this._segs || this._segsFor !== row) {
      const segs = new Float32Array(32), arcs = new Float32Array(16);
      for (let e = 0; e < Math.min(8, row.n_seg); e++) {
        segs.set([row.seg_a[2 * e], row.seg_a[2 * e + 1], row.seg_b[2 * e], row.seg_b[2 * e + 1]], 4 * e);
        arcs.set([row.seg_s0[e], row.seg_len[e]], 2 * e);
      }
      this._segs = segs; this._arcs = arcs; this._segsFor = row;
    }
    gl.uniform4fv(lu["uSeg[0]"], this._segs);
    gl.uniform2fv(lu["uArc[0]"], this._arcs);
    gl.uniform1i(lu.uNSeg, row.n_seg);
    gl.uniform1f(lu.uDisc, row.disc ? 1 : 0);
    gl.uniform1f(lu.uRadius, row.load_radius);
    gl.uniform1f(lu.uSlotLen, row.slot_len);
    gl.uniform1f(lu.uPx, px);
    gl.bindVertexArray(this.loadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _drawAnts(view, cam, halfW, px) {
    const gl = this.gl;
    // 3. Ameisen, ein instanzierter Aufruf. Inaktive Ameisen existieren nicht (ADR 0004)
    // und werden nicht gezeichnet.
    const inst = this.inst;
    if (!this._phase || this._phase.length !== view.n) {
      this._phase = new Float32Array(view.n);
      this._last = Float32Array.from(view.pos);
    }
    const ph = this._phase, last = this._last;
    let n = 0;
    for (let i = 0; i < view.n; i++) {
      const x = view.pos[2 * i], y = view.pos[2 * i + 1];
      const d = Math.hypot(x - last[2 * i], y - last[2 * i + 1]);
      last[2 * i] = x;
      last[2 * i + 1] = y;
      if (d < 2) ph[i] = (ph[i] + d / STRIDE) % 1; // Sprünge (Neustart, Versetzen) zählen nicht
      if (!view.active[i]) continue;
      inst[4 * n] = x;
      inst[4 * n + 1] = y;
      inst[4 * n + 2] = view.theta[i];
      inst[4 * n + 3] = 10 * view.grip[i] + ph[i];
      n++;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, 4 * n);
    gl.useProgram(this.ant.p);
    gl.uniform4f(this.ant.u.uCam, cam.cx, cam.cy, halfW, cam.halfH);
    gl.uniform1f(this.ant.u.uPx, px);
    gl.bindVertexArray(this.antVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.bindVertexArray(null);
  }

  /** Wartet, bis die GPU fertig ist. Nur für Messungen. */
  sync() {
    const gl = this.gl;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._px ?? (this._px = new Uint8Array(4)));
  }
}
