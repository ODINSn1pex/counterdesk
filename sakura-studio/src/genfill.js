// Generative Füllung: markierten Bereich per Bild-KI (OpenAI, eigener Schlüssel) neu erzeugen
import { doc, commit, view, emit, Layer, S } from './state.js';
import { makeCanvas, ctx2d, canvasToBytes, loadImage } from './engine/util.js';
import { getMerged } from './engine/doc.js';
import { selectionBounds, feather } from './engine/selection.js';

export async function generativeFill(prompt) {
  const d = doc(); if (!d || !d.selection) throw new Error('Bitte zuerst einen Bereich auswählen');
  const b = selectionBounds(d.selection); if (!b) throw new Error('Auswahl ist leer');
  // quadratischer Ausschnitt mit Kontext um die Auswahl
  let side = Math.max(b.w, b.h) * 1.6; side = Math.min(Math.max(side, 256), Math.max(d.w, d.h));
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const rx = Math.round(Math.max(0, Math.min(d.w - Math.min(side, d.w), cx - side / 2)));
  const ry = Math.round(Math.max(0, Math.min(d.h - Math.min(side, d.h), cy - side / 2)));
  const rw = Math.round(Math.min(side, d.w)), rh = Math.round(Math.min(side, d.h));
  const N = 1024;
  const img = makeCanvas(N, N); const ix = ctx2d(img); ix.imageSmoothingQuality = 'high'; ix.drawImage(getMerged(d), rx, ry, rw, rh, 0, 0, N, N);
  // Maske: transparent = neu erzeugen
  const m = makeCanvas(N, N); const mx = ctx2d(m); mx.fillStyle = '#000'; mx.fillRect(0, 0, N, N);
  mx.globalCompositeOperation = 'destination-out'; mx.drawImage(d.selection, rx, ry, rw, rh, 0, 0, N, N);
  S.ui.busy = 'Generative Füllung'; emit();
  try {
    const out = await window.native.genfill({
      prompt: prompt || 'Fill the transparent area seamlessly so it matches the surrounding image, same style and lighting.',
      image: await canvasToBytes(img, 'image/png'), mask: await canvasToBytes(m, 'image/png'), size: '1024x1024',
    });
    const res = await loadImage(URL.createObjectURL(new Blob([out], { type: 'image/png' })));
    const l = new Layer(d.w, d.h, 'Generative Füllung' + (prompt ? ': ' + prompt.slice(0, 30) : ''));
    l.ctx.imageSmoothingQuality = 'high';
    l.ctx.drawImage(res, 0, 0, res.width, res.height, rx, ry, rw, rh);
    l.mask = feather(d.selection, 2);
    d.addLayer(l);
    commit('Generative Füllung');
  } finally { S.ui.busy = null; emit(); view.request(); }
}
