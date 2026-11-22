// GPU-Rendering (WebGL2) mit 32-Bit-Gleitkomma-Puffern:
// Mischen, alle Füllmethoden, Masken, Schnittmasken, Gruppen und Einstellungsebenen laufen in Gleitkomma.
// Ausgabe mit Dithering → keine Tonwertabrisse/Streifen, auch bei vielen gestapelten Korrekturen.
import { GPU, layerSource, childrenOf } from './doc.js';
import { ADJUSTMENTS } from './filters.js';

const MODES = ['normal', 'dissolve', 'darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color', 'lighten', 'screen', 'color-dodge', 'lighter', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'];
const MODE_ID = Object.fromEntries(MODES.map((m, i) => [m, i]));
// Einstellungen, die nicht pixelweise sind (Nachbarschaft/Bildstatistik) → CPU-Weg
const SPATIAL = new Set(['shadowsHighlights', 'hdrToning', 'equalize', 'matchColor', 'autoTone', 'autoContrast', 'autoColor']);
const LUT_N = 65;

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const BLEND_GLSL = `
float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c){ float l = lum(c), n = min(min(c.r,c.g),c.b), x = max(max(c.r,c.g),c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6); if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6); return c; }
vec3 setLum(vec3 c, float l){ return clipColor(c + (l - lum(c))); }
float sat(vec3 c){ return max(max(c.r,c.g),c.b) - min(min(c.r,c.g),c.b); }
vec3 setSat(vec3 c, float s){ float mx = max(max(c.r,c.g),c.b), mn = min(min(c.r,c.g),c.b); vec3 r = vec3(0.0);
  if (mx > mn) r = (c - mn) * s / (mx - mn); return r; }
float softLight(float b, float s){ if (s <= 0.5) return b - (1.0 - 2.0*s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0*b - 12.0)*b + 4.0)*b : sqrt(b); return b + (2.0*s - 1.0) * (d - b); }
float ch(int m, float b, float s){
  if (m == 2) return min(b, s);
  if (m == 3) return b * s;
  if (m == 4) return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s));
  if (m == 5) return max(0.0, b + s - 1.0);
  if (m == 7) return max(b, s);
  if (m == 8) return b + s - b * s;
  if (m == 9) return b <= 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s)));
  if (m == 10) return min(1.0, b + s);
  if (m == 12) return b <= 0.5 ? 2.0*b*s : 1.0 - 2.0*(1.0-b)*(1.0-s);
  if (m == 13) return softLight(b, s);
  if (m == 14) return s <= 0.5 ? 2.0*b*s : 1.0 - 2.0*(1.0-b)*(1.0-s);
  if (m == 15) return s < 0.5 ? (s <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - b) / (2.0*s))) : (s >= 1.0 ? 1.0 : min(1.0, b / (2.0*(1.0 - s))));
  if (m == 16) return clamp(b + 2.0*s - 1.0, 0.0, 1.0);
  if (m == 17) return s < 0.5 ? min(b, 2.0*s) : max(b, 2.0*s - 1.0);
  if (m == 18) return b + s >= 1.0 ? 1.0 : 0.0;
  if (m == 19) return abs(b - s);
  if (m == 20) return b + s - 2.0*b*s;
  if (m == 21) return max(0.0, b - s);
  if (m == 22) return s <= 0.0 ? 1.0 : min(1.0, b / s);
  return s;
}
vec3 blendMode(int m, vec3 b, vec3 s){
  if (m == 6) return dot(s, vec3(0.299, 0.587, 0.114)) < dot(b, vec3(0.299, 0.587, 0.114)) ? s : b;
  if (m == 11) return dot(s, vec3(0.299, 0.587, 0.114)) > dot(b, vec3(0.299, 0.587, 0.114)) ? s : b;
  if (m == 23) return setLum(setSat(s, sat(b)), lum(b));
  if (m == 24) return setLum(setSat(b, sat(s)), lum(b));
  if (m == 25) return setLum(s, lum(b));
  if (m == 26) return setLum(b, lum(s));
  return vec3(ch(m,b.r,s.r), ch(m,b.g,s.g), ch(m,b.b,s.b));
}`;

// Ebene auf den Hintergrund mischen (alles vormultipliziert in Gleitkomma)
const FS_LAYER = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uSrc, uDst, uMask, uBase;
uniform int uMode, uHasMask, uHasBase, uSrcPremul, uHasIf;
uniform float uOpacity; uniform vec4 uIf; uniform float uIfSoft;
out vec4 o;
${BLEND_GLSL}
float band(float v, float lo, float hi, float sft){ if (v < lo) return sft > 0.0 ? max(0.0, 1.0 - (lo - v)/sft) : 0.0; if (v > hi) return sft > 0.0 ? max(0.0, 1.0 - (v - hi)/sft) : 0.0; return 1.0; }
void main(){
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uSrc, q, 0), d = texelFetch(uDst, q, 0);
  vec3 cs = uSrcPremul == 1 ? (s.a > 0.0 ? s.rgb / s.a : vec3(0.0)) : s.rgb;
  float as = s.a * uOpacity;
  if (uHasMask == 1) as *= texelFetch(uMask, q, 0).a;
  if (uHasBase == 1) as *= texelFetch(uBase, q, 0).a;
  float ab = d.a; vec3 cb = ab > 0.0 ? d.rgb / ab : vec3(0.0);
  if (uHasIf == 1) as *= band(lum(cs)*255.0, uIf.x, uIf.y, uIfSoft) * (ab > 0.0 ? band(lum(cb)*255.0, uIf.z, uIf.w, uIfSoft) : 1.0);
  vec3 B = blendMode(uMode, cb, cs);
  vec3 csp = (1.0 - ab) * cs + ab * B;
  float ao = as + ab * (1.0 - as);
  o = vec4(as * csp + (1.0 - as) * d.rgb, ao);
}`;

// Einstellungsebene: Farbe über 3D-Tabelle (trilinear in Gleitkomma) oder über vorberechnetes Bild
const FS_ADJ = `#version 300 es
precision highp float; precision highp sampler2D; precision highp sampler3D;
uniform sampler2D uDst, uMask, uImg; uniform sampler3D uLut;
uniform int uHasMask, uUseImg, uMode; uniform float uAmount, uLutN;
out vec4 o;
${BLEND_GLSL}
void main(){
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 d = texelFetch(uDst, q, 0);
  if (d.a <= 0.0) { o = d; return; }
  vec3 c = d.rgb / d.a, a;
  if (uUseImg == 1) a = texelFetch(uImg, q, 0).rgb;
  else { vec3 t = clamp(c, 0.0, 1.0) * ((uLutN - 1.0) / uLutN) + 0.5 / uLutN; a = texture(uLut, t).rgb; }
  if (uMode != 0) a = blendMode(uMode, c, a);
  float k = uAmount; if (uHasMask == 1) k *= texelFetch(uMask, q, 0).a;
  o = vec4(mix(c, a, k) * d.a, d.a);
}`;

// Ausgabe: vormultipliziert → 8 Bit mit Dreiecks-Dithering; Zeilen für die Anzeige umgedreht
const FS_OUT = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uDst; uniform int uDither, uH;
out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  ivec2 q = ivec2(int(gl_FragCoord.x), uH - 1 - int(gl_FragCoord.y));
  vec4 d = texelFetch(uDst, q, 0);
  vec3 c = d.a > 0.0 ? d.rgb / d.a : vec3(0.0);
  if (uDither == 1) { vec2 p = gl_FragCoord.xy; c += (h(p) + h(p + 17.31) - 1.0) / 255.0; }
  float a = clamp(d.a, 0.0, 1.0);
  o = vec4(clamp(c, 0.0, 1.0) * a, a);
}`;

let R = null;
function compile(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function program(gl, fs) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

function init() {
  if (R) return R;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 nicht verfügbar');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Gleitkomma-Puffer nicht verfügbar');
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  R = { canvas, gl, layer: program(gl, FS_LAYER), adj: program(gl, FS_ADJ), out: program(gl, FS_OUT), tex: new Map(), luts: new Map(), pool: [], w: 0, h: 0, fmt: null, frame: 0 };
  const empty = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, empty); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  R.empty = empty;
  const e3 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, e3); gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); R.empty3 = e3;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R = null; });
  return R;
}

function texParams(gl, t, filter = gl.NEAREST) { gl.texParameteri(t, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(t, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(t, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(t, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); if (t === gl.TEXTURE_3D) gl.texParameteri(t, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE); }

// Canvas → Textur (zwischengespeichert über eine Signatur)
function texFor(key, sig, canvas) {
  const gl = R.gl;
  let e = R.tex.get(key);
  if (e && e.sig === sig && e.w === canvas.width && e.h === canvas.height) { e.frame = R.frame; return e.t; }
  if (!e) { e = { t: gl.createTexture() }; R.tex.set(key, e); }
  gl.bindTexture(gl.TEXTURE_2D, e.t); texParams(gl, gl.TEXTURE_2D);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  Object.assign(e, { sig, w: canvas.width, h: canvas.height, frame: R.frame });
  return e.t;
}

// Gleitkomma-Puffer (Framebuffer + Textur)
function getTarget() {
  const gl = R.gl;
  let t = R.pool.find((x) => !x.used && x.w === R.w && x.h === R.h && x.fmt === R.fmt);
  if (!t) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); texParams(gl, gl.TEXTURE_2D);
    gl.texStorage2D(gl.TEXTURE_2D, 1, R.fmt, R.w, R.h);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Gleitkomma-Puffer nicht unterstützt');
    t = { tex, fb, w: R.w, h: R.h, fmt: R.fmt, used: false };
    R.pool.push(t);
  }
  t.used = true;
  const gl2 = R.gl; gl2.bindFramebuffer(gl2.FRAMEBUFFER, t.fb); gl2.viewport(0, 0, R.w, R.h); gl2.clearColor(0, 0, 0, 0); gl2.clear(gl2.COLOR_BUFFER_BIT);
  return t;
}
const release = (t) => { if (t) t.used = false; };

// Ein „Stapel“ (Ping-Pong-Paar) für eine Ebene der Gruppenhierarchie
function newStack() { return { cur: getTarget(), alt: null }; }
function swapDraw(st, prog, bindFn) {
  const gl = R.gl;
  if (!st.alt) st.alt = getTarget();
  gl.bindFramebuffer(gl.FRAMEBUFFER, st.alt.fb); gl.viewport(0, 0, R.w, R.h);
  gl.useProgram(prog.p);
  bindFn();
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const t = st.cur; st.cur = st.alt; st.alt = t;
}
function bind(unit, target, tex, loc) { const gl = R.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); gl.uniform1i(loc, unit); }

function drawLayerPass(st, srcTex, opts) {
  const gl = R.gl, P = R.layer, u = P.u;
  swapDraw(st, P, () => {
    bind(0, gl.TEXTURE_2D, srcTex, u.uSrc); bind(1, gl.TEXTURE_2D, st.cur.tex, u.uDst);
    bind(2, gl.TEXTURE_2D, opts.mask || R.empty, u.uMask); bind(3, gl.TEXTURE_2D, opts.base || R.empty, u.uBase);
    gl.uniform1i(u.uMode, MODE_ID[opts.mode] ?? 0); gl.uniform1i(u.uHasMask, opts.mask ? 1 : 0); gl.uniform1i(u.uHasBase, opts.base ? 1 : 0);
    gl.uniform1i(u.uSrcPremul, opts.premul ? 1 : 0); gl.uniform1f(u.uOpacity, opts.opacity);
    const bi = opts.blendIf; gl.uniform1i(u.uHasIf, bi ? 1 : 0);
    if (bi) { gl.uniform4f(u.uIf, bi.thisLo ?? 0, bi.thisHi ?? 255, bi.underLo ?? 0, bi.underHi ?? 255); gl.uniform1f(u.uIfSoft, bi.soft ?? 0); }
  });
}

// 3D-Farbtabelle einer pixelweisen Korrektur (aus der vorhandenen CPU-Funktion abgetastet)
function lutFor(adj) {
  const key = adj.id + JSON.stringify(adj.params || {});
  let e = R.luts.get(key); if (e) return e;
  const N = LUT_N, c = document.createElement('canvas'); c.width = N * N; c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true }), id = x.createImageData(N * N, N);
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const o = (g * N * N + b * N + r) * 4; id.data[o] = r * 255 / (N - 1); id.data[o + 1] = g * 255 / (N - 1); id.data[o + 2] = b * 255 / (N - 1); id.data[o + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  const out = ADJUSTMENTS[adj.id].apply(c, adj.params || {});
  const od = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, N * N, N).data;
  const data = new Uint8Array(N * N * N * 4);
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const s = (g * N * N + b * N + r) * 4, d = ((b * N + g) * N + r) * 4;
    data[d] = od[s]; data[d + 1] = od[s + 1]; data[d + 2] = od[s + 2]; data[d + 3] = 255;
  }
  const gl = R.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t); texParams(gl, gl.TEXTURE_3D, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  if (R.luts.size > 40) { const [k0, v0] = R.luts.entries().next().value; gl.deleteTexture(v0); R.luts.delete(k0); }
  R.luts.set(key, t);
  return t;
}
const isSpatial = (adj) => SPATIAL.has(adj.id) || (adj.id === 'cameraRaw' && adj.params && (adj.params.clarity || adj.params.dehaze));

// Aktuellen Puffer als 8-Bit-Canvas lesen (für Korrekturen mit Nachbarschaft)
function readToCanvas(t) {
  const gl = R.gl, w = R.w, h = R.h;
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  const f = new Float32Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, f);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const id = x.createImageData(w, h);
  for (let i = 0; i < w * h * 4; i += 4) { const a = f[i + 3]; id.data[i + 3] = a * 255; if (a > 0) { id.data[i] = f[i] / a * 255; id.data[i + 1] = f[i + 1] / a * 255; id.data[i + 2] = f[i + 2] / a * 255; } }
  x.putImageData(id, 0, 0); return c;
}

function drawAdjust(st, node, key) {
  const gl = R.gl, P = R.adj, u = P.u, adj = node.adjust;
  if (!adj || !ADJUSTMENTS[adj.id]) return;
  let img = null, lut = null;
  if (isSpatial(adj)) img = texFor('adjimg', key + Math.random(), ADJUSTMENTS[adj.id].apply(readToCanvas(st.cur), adj.params || {}));
  else lut = lutFor(adj);
  const mask = node.mask && node.maskEnabled ? texFor('m' + node.id, node.rev + ':' + node.maskEnabled, node.mask) : null;
  swapDraw(st, P, () => {
    bind(0, gl.TEXTURE_2D, st.cur.tex, u.uDst); bind(1, gl.TEXTURE_2D, mask || R.empty, u.uMask);
    bind(2, gl.TEXTURE_2D, img || R.empty, u.uImg); bind(3, gl.TEXTURE_3D, lut || R.empty3, u.uLut);
    gl.uniform1i(u.uHasMask, mask ? 1 : 0); gl.uniform1i(u.uUseImg, img ? 1 : 0); gl.uniform1f(u.uLutN, LUT_N);
    const m = node.blend === 'pass' || node.blend === 'normal' || node.blend === 'dissolve' ? 0 : (MODE_ID[node.blend] ?? 0);
    gl.uniform1i(u.uMode, m); gl.uniform1f(u.uAmount, node.opacity * node.fill);
  });
}

function cachedTex(key, sig) { const e = R.tex.get(key); if (e && e.sig === sig && e.w === R.w && e.h === R.h) { e.frame = R.frame; return e.t; } return null; }

function renderNodes(all, nodes, st, opts, depth) {
  let base = null, hold = null; // hold: Gruppenpuffer, der als Schnittmasken-Basis dient
  const drop = () => { if (hold) { release(hold.cur); release(hold.alt); hold = null; } };
  nodes.forEach((node, i) => {
    if (!node.visible && !opts.forceAll) { if (!node.clip) { base = null; drop(); } return; }
    if (node.type === 'adjust') { drawAdjust(st, node, 'a' + node.id); return; }
    let srcTex, premul = false, groupStack = null;
    if (node.type === 'group') {
      const kids = childrenOf(all, node.id);
      if (node.blend === 'pass' && node.opacity >= 1 && node.fill >= 1 && !(node.mask && node.maskEnabled) && !node.clip) { renderNodes(all, kids, st, opts, depth + 1); base = null; drop(); return; }
      groupStack = newStack();
      renderNodes(all, kids, groupStack, opts, depth + 1);
      srcTex = groupStack.cur.tex; premul = true;
    } else {
      const sig = node.rev + '|' + (node.maskEnabled ? 1 : 0) + '|' + node.fill + '|' + JSON.stringify(node.fx || {}) + '|' + JSON.stringify(node.vmask || 0) + '|' + node.blend + '|' + (GPU.fxSig || '');
      srcTex = cachedTex('L' + node.id, sig) || texFor('L' + node.id, sig, layerSource(node, R.w, R.h, 'G' + (i % 2) + '_' + depth));
    }
    const groupMask = node.type === 'group' && node.mask && node.maskEnabled ? texFor('m' + node.id, node.rev + ':m', node.mask) : null;
    let baseTex = null;
    if (node.clip) { if (!base) { if (groupStack) { release(groupStack.cur); release(groupStack.alt); } return; } baseTex = base; }
    drawLayerPass(st, srcTex, { mode: node.blend === 'pass' ? 'normal' : node.blend, opacity: node.opacity * (node.type === 'group' ? node.fill : 1), mask: groupMask, base: baseTex, premul, blendIf: node.blendIf && needsIf(node.blendIf) ? node.blendIf : null });
    if (!node.clip) {
      drop();
      if (groupStack) { hold = groupStack; base = groupStack.cur.tex; groupStack = null; }
      else base = cachedTex('raw' + node.id, String(node.rev)) || texFor('raw' + node.id, String(node.rev), node.canvas);
    }
    if (groupStack) { release(groupStack.cur); release(groupStack.alt); }
  });
  drop();
}
const needsIf = (b) => b.thisLo > 0 || b.thisHi < 255 || b.underLo > 0 || b.underHi < 255;

function renderToStack(doc, opts = {}) {
  init();
  const gl = R.gl, w = doc.w, h = doc.h;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (w > max || h > max) throw new Error('Bild größer als die GPU-Texturgrenze');
  const fmt = w * h <= 16e6 ? gl.RGBA32F : gl.RGBA16F;
  if (R.w !== w || R.h !== h || R.fmt !== fmt) {
    R.pool.forEach((t) => { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }); R.pool = [];
    R.w = w; R.h = h; R.fmt = fmt;
  }
  R.frame++;
  R.pool.forEach((t) => { t.used = false; });
  const st = newStack();
  renderNodes(doc.layers, doc.layers.filter((l) => !l.parent), st, opts, 0);
  // nicht mehr genutzte Texturen freigeben
  if (R.frame % 30 === 0) for (const [k, e] of R.tex) if (R.frame - e.frame > 60) { gl.deleteTexture(e.t); R.tex.delete(k); }
  return st;
}

// Zusammensetzen auf der GPU → 8-Bit-Canvas (mit Dithering)
export function gpuComposite(doc, opts = {}) {
  const st = renderToStack(doc, opts);
  const gl = R.gl, P = R.out, u = P.u;
  R.canvas.width = R.w; R.canvas.height = R.h;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, R.w, R.h);
  gl.useProgram(P.p);
  bind(0, gl.TEXTURE_2D, st.cur.tex, u.uDst);
  gl.uniform1i(u.uDither, GPU.dither ? 1 : 0); gl.uniform1i(u.uH, R.h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  release(st.cur); release(st.alt);
  return R.canvas;
}

// Gleitkomma-Ergebnis (nicht vormultipliziert, 0..1) für 16-Bit-Export
export function gpuFloatPixels(doc) {
  const st = renderToStack(doc, { forceAll: false });
  const gl = R.gl, w = R.w, h = R.h;
  gl.bindFramebuffer(gl.FRAMEBUFFER, st.cur.fb);
  const f = new Float32Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, f);
  release(st.cur); release(st.alt);
  for (let i = 0; i < f.length; i += 4) { const a = f[i + 3]; if (a > 0) { f[i] /= a; f[i + 1] /= a; f[i + 2] /= a; } }
  return { data: f, w, h };
}

export function gpuInfo() {
  try {
    init(); const gl = R.gl; const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { ok: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Aktivieren (wird von doc.js composite() genutzt)
// on: true = erzwingen, false = aus, 'auto' = nur mit echter Grafikkarte (nicht bei Software-Renderern)
export function enableGpu(on = 'auto', dither = true) {
  GPU.dither = dither;
  if (!on) { GPU.enabled = false; return false; }
  const info = gpuInfo();
  info.software = !!(info.ok && /swiftshader|llvmpipe|softpipe|basic render|software/i.test(info.renderer || ''));
  GPU.info = info; GPU.render = gpuComposite;
  GPU.enabled = info.ok && (on === true || !info.software);
  return GPU.enabled;
}
