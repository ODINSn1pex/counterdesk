// Lokale KI (ONNX, läuft offline): Motiv-Erkennung / Hintergrund entfernen
// Modell: „silueta“ (U²-Net-Familie, Apache-2.0), Eingabe 320×320
import * as ort from 'onnxruntime-web/wasm';
import { makeCanvas, ctx2d } from './util.js';

// Modelle: silueta (Fotos, im Programm enthalten), isnet-anime (Illustrationen/Anime), isnet-general-use (Fotos, hohe Qualität)
export const AI_MODELS = {
  silueta: { file: 'silueta.onnx', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], label: 'Standard (Fotos, schnell)', mb: 44, url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx' },
  'isnet-anime': { file: 'isnet-anime.onnx', size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], label: 'Anime & Illustration (hohe Qualität)', mb: 176, url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx' },
  'isnet-general-use': { file: 'isnet-general-use.onnx', size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], label: 'Fotos (hohe Qualität, Download)', mb: 179, url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx' },
};
const sessions = {};

function base() { return new URL('./', document.baseURI).href; }

export function aiAvailable() { return typeof WebAssembly !== 'undefined'; }

async function loadModelBytes(name) {
  const m = AI_MODELS[name];
  // Zusatzmodelle liegen im Benutzerordner (Desktop-App), das Standardmodell im Programm
  if (window.native && window.native.aiModelRead) {
    const bytes = await window.native.aiModelRead(m.file);
    if (bytes) return bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  }
  const res = await fetch(base() + 'models/' + m.file).catch(() => null);
  if (res && res.ok) return res.arrayBuffer();
  // Kompakt-Version: Modell beim ersten Gebrauch einmalig herunterladen
  if (window.native && window.native.aiModelDownload && m.url) {
    const st = await import('../state.js');
    st.S.ui.busy = `KI-Modell „${m.label}“ wird einmalig geladen (${m.mb} MB)`; st.emit();
    try { await window.native.aiModelDownload(m.file, m.url); } finally { st.S.ui.busy = null; st.emit(); }
    const bytes = await window.native.aiModelRead(m.file);
    if (bytes) return bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  }
  throw new Error('KI-Modell „' + m.label + '“ ist nicht installiert');
}

async function getSession(name) {
  if (sessions[name]) return sessions[name];
  sessions[name] = (async () => {
    ort.env.wasm.wasmPaths = base() + 'ort/';
    const cores = (navigator.hardwareConcurrency || 2);
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, cores - 1)) : 1;
    ort.env.logLevel = 'error';
    const buf = await loadModelBytes(name);
    return ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  })();
  sessions[name].catch(() => { delete sessions[name]; });
  return sessions[name];
}

// Liefert eine Maske (weiß, Alpha = Motiv) in Größe der Quelle
export async function aiSubjectMask(src, modelName = 'silueta') {
  const cfg = AI_MODELS[modelName] || AI_MODELS.silueta;
  const SIZE = cfg.size;
  const session = await getSession(modelName);
  const sm = makeCanvas(SIZE, SIZE); const sx = ctx2d(sm);
  sx.imageSmoothingQuality = 'high';
  sx.fillStyle = '#fff'; sx.fillRect(0, 0, SIZE, SIZE);
  sx.drawImage(src, 0, 0, SIZE, SIZE);
  const px = sx.getImageData(0, 0, SIZE, SIZE).data;
  let max = 1; for (let i = 0; i < px.length; i += 4) { if (px[i] > max) max = px[i]; if (px[i + 1] > max) max = px[i + 1]; if (px[i + 2] > max) max = px[i + 2]; }
  const mean = cfg.mean, std = cfg.std;
  const n = SIZE * SIZE; const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = (px[i * 4 + c] / max - mean[c]) / std[c];
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) };
  const out = await session.run(feeds);
  const pred = out[session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { if (pred[i] < lo) lo = pred[i]; if (pred[i] > hi) hi = pred[i]; }
  const span = hi - lo || 1;
  const m = makeCanvas(SIZE, SIZE); const mx = ctx2d(m); const id = mx.createImageData(SIZE, SIZE);
  for (let i = 0; i < n; i++) { const v = (pred[i] - lo) / span; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (v - 0.08) / 0.84)) * 255); }
  mx.putImageData(id, 0, 0);
  const full = makeCanvas(src.width, src.height); const fx = ctx2d(full);
  fx.imageSmoothingQuality = 'high'; fx.drawImage(m, 0, 0, src.width, src.height);
  return full;
}

// ---------- Objekte entfernen: LaMa-Inpainting (Apache-2.0, über OpenCV Model Zoo) ----------
AI_MODELS.lama = { file: 'lama.onnx', size: 512, label: 'Objekte entfernen (LaMa)', mb: 92, url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/inpainting_lama/inpainting_lama_2025jan.onnx' };
export const lastInpaintInfo = {};

// src: Bildquelle, mask: Canvas (Alpha = zu entfernen); liefert neues Canvas in Größe von src
export async function aiInpaint(src, mask) {
  const W = src.width, H = src.height;
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  const md = mctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (md[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('Keine Auswahl zum Entfernen');
  // Ausschnitt mit Umgebung (Kontext für die KI), quadratisch
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  let side = Math.max(bw, bh) * 2.2; side = Math.max(side, Math.min(512, Math.max(W, H)));
  side = Math.min(side, Math.max(W, H));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = Math.round(Math.max(0, Math.min(W - Math.min(side, W), cx - side / 2)));
  const ry = Math.round(Math.max(0, Math.min(H - Math.min(side, H), cy - side / 2)));
  const rw = Math.round(Math.min(side, W)), rh = Math.round(Math.min(side, H));
  const S2 = 512;
  const session = await getSession('lama');
  const ic = makeCanvas(S2, S2); const ix = ctx2d(ic); ix.imageSmoothingQuality = 'high'; ix.drawImage(src, rx, ry, rw, rh, 0, 0, S2, S2);
  const mc = makeCanvas(S2, S2); const mx = ctx2d(mc); mx.drawImage(mask, rx, ry, rw, rh, 0, 0, S2, S2);
  const ip = ix.getImageData(0, 0, S2, S2).data, mp = mx.getImageData(0, 0, S2, S2).data;
  const n = S2 * S2, img = new Float32Array(3 * n), m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const on = mp[i * 4 + 3] > 10 ? 1 : 0; m[i] = on;
    for (let c = 0; c < 3; c++) img[c * n + i] = on ? 0 : ip[i * 4 + c] / 255;
  }
  const t0 = performance.now();
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', img, [1, 3, S2, S2]), [session.inputNames[1]]: new ort.Tensor('float32', m, [1, 1, S2, S2]) });
  const o = out[session.outputNames[0]];
  const od = o.data; let mxv = 0; for (let i = 0; i < od.length; i += 101) if (od[i] > mxv) mxv = od[i];
  const k = mxv > 2 ? 1 : 255;
  // NCHW oder NHWC erkennen
  const nhwc = o.dims.length === 4 && o.dims[3] === 3;
  const rc = makeCanvas(S2, S2); const rcx = ctx2d(rc); const rid = rcx.createImageData(S2, S2);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rid.data[i * 4 + c] = Math.max(0, Math.min(255, (nhwc ? od[i * 3 + c] : od[c * n + i]) * k));
  for (let i = 0; i < n; i++) rid.data[i * 4 + 3] = 255;
  rcx.putImageData(rid, 0, 0);
  Object.assign(lastInpaintInfo, { ms: Math.round(performance.now() - t0), inputs: session.inputNames, dims: o.dims, scale: k });
  // Ergebnis zurückskalieren und nur im (leicht weichgezeichneten) Maskenbereich einsetzen
  const res = makeCanvas(W, H); const rx2 = ctx2d(res);
  rx2.drawImage(src, 0, 0);
  const patch = makeCanvas(W, H); const px2 = ctx2d(patch);
  px2.imageSmoothingQuality = 'high'; px2.drawImage(rc, 0, 0, S2, S2, rx, ry, rw, rh);
  const soft = makeCanvas(W, H); const sx2 = ctx2d(soft); sx2.filter = 'blur(2px)'; sx2.drawImage(mask, 0, 0); sx2.filter = 'none';
  // Maske leicht erweitern, damit Ränder sauber überdeckt werden
  sx2.drawImage(mask, 0, 0);
  px2.globalCompositeOperation = 'destination-in'; px2.drawImage(soft, 0, 0);
  rx2.drawImage(patch, 0, 0);
  return res;
}
