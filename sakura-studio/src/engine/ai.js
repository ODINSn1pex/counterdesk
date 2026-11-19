// Lokale KI (ONNX, läuft offline): Motiv-Erkennung / Hintergrund entfernen
// Modell: „silueta“ (U²-Net-Familie, Apache-2.0), Eingabe 320×320
import * as ort from 'onnxruntime-web/wasm';
import { makeCanvas, ctx2d } from './util.js';

// Modelle: silueta (Fotos, im Programm enthalten), isnet-anime (Illustrationen/Anime), isnet-general-use (Fotos, hohe Qualität)
export const AI_MODELS = {
  silueta: { file: 'silueta.onnx', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], label: 'Standard (Fotos, schnell)', mb: 44 },
  'isnet-anime': { file: 'isnet-anime.onnx', size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], label: 'Anime & Illustration (hohe Qualität)', mb: 176 },
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
  const res = await fetch(base() + 'models/' + m.file);
  if (!res.ok) throw new Error('KI-Modell „' + m.label + '“ ist nicht installiert');
  return res.arrayBuffer();
}

async function getSession(name) {
  if (sessions[name]) return sessions[name];
  sessions[name] = (async () => {
    ort.env.wasm.wasmPaths = base() + 'ort/';
    const cores = (navigator.hardwareConcurrency || 2);
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, cores - 1)) : 1;
    ort.env.logLevel = 'error';
    const buf = await loadModelBytes(name);
    return ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
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
