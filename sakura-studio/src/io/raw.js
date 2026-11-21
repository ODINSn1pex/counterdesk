// Echte RAW-Entwicklung mit LibRaw (WebAssembly, läuft in einem Worker)
import LibRaw from 'libraw-wasm';
import { makeCanvas, ctxRead, clamp } from '../engine/util.js';

export const RAW_DEFAULTS = { wb: 'camera', ev: 0, highlight: 2, bright: 1, noise: 0, quality: 3, autoBright: true, temp: 0, tint: 0, contrast: 0, vibrance: 0, shadows: 0 };

function settingsFor(o, half) {
  const s = {
    useCameraWb: o.wb === 'camera', useAutoWb: o.wb === 'auto', outputBps: 8, outputColor: 1,
    highlight: o.highlight, bright: o.bright, threshold: o.noise, userQual: o.quality, noAutoBright: !o.autoBright,
    halfSize: !!half, userFlip: -1,
  };
  if (o.ev) { s.expCorrec = true; s.expShift = Math.pow(2, o.ev); s.expPreser = 0.8; }
  return s;
}

// Feinabstimmung nach der Entwicklung (Temperatur, Tönung, Kontrast, Dynamik, Tiefen)
function finish(img, o) {
  const { width: w, height: h, data } = img;
  const c = makeCanvas(w, h); const x = ctxRead(c);
  const id = x.createImageData(w, h), p = id.data;
  const tr = 1 + o.temp / 200, tb = 1 - o.temp / 200, tg = 1 - o.tint / 300;
  const cf = (259 * (o.contrast * 1.2 + 255)) / (255 * (259 - o.contrast * 1.2));
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    let r = data[j] * tr, g = data[j + 1] * tg, b = data[j + 2] * tb;
    if (o.shadows) { const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255; const k = 1 + (o.shadows / 100) * Math.pow(1 - l, 3) * 1.5; r *= k; g *= k; b *= k; }
    if (o.contrast) { r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128; }
    if (o.vibrance) {
      const mx = Math.max(r, g, b), avg = (r + g + b) / 3, sat = (mx - Math.min(r, g, b)) / 255;
      const a = (o.vibrance / 100) * (1 - sat); r += (r - avg) * a; g += (g - avg) * a; b += (b - avg) * a;
    }
    const q = i * 4; p[q] = clamp(r, 0, 255); p[q + 1] = clamp(g, 0, 255); p[q + 2] = clamp(b, 0, 255); p[q + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}

let worker = null;
export async function developRaw(bytes, opts, half) {
  if (!worker) worker = new LibRaw();
  const copy = new Uint8Array(bytes); // wird an den Worker übertragen
  await worker.open(copy, settingsFor(opts, half));
  const img = await worker.imageData();
  if (!img || !img.data) throw new Error('RAW konnte nicht entwickelt werden');
  if (img.colors !== 3) throw new Error('Nicht unterstütztes RAW-Farbformat');
  return finish(img, opts);
}

export async function rawMetadata(bytes) {
  if (!worker) worker = new LibRaw();
  await worker.open(new Uint8Array(bytes), { halfSize: true });
  return worker.metadata();
}
