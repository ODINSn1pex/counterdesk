// Filter/Korrekturen auf aktive Ebene (oder Maske) anwenden – mit Vorschau
import { S, doc, commit, view, emit, toast, canEditPixels } from '../../state.js';
import { cloneCanvas, ctx2d } from '../../engine/util.js';
import { applyMasked } from '../../engine/selection.js';

function target(d) {
  const l = d.layer;
  if (l.editMask && l.mask) return { canvas: l.mask, layer: l, mask: true };
  if (!canEditPixels(l)) return null;
  return { canvas: l.canvas, layer: l, mask: false };
}

// Maskenkanal: Alpha → Graustufen-Bild und zurück
function maskToGray(m) {
  const c = cloneCanvas(m); const x = ctx2d(c); const id = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) { const a = id.data[i + 3]; id.data[i] = id.data[i + 1] = id.data[i + 2] = a; id.data[i + 3] = 255; }
  x.putImageData(id, 0, 0); return c;
}
function grayToMask(g) {
  const c = cloneCanvas(g); const x = ctx2d(c); const id = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) { const v = id.data[i]; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = v; }
  x.putImageData(id, 0, 0); return c;
}

export function beginPreview() {
  const d = doc(); if (!d) return null;
  const t = target(d); if (!t) return null;
  return { d, t, before: cloneCanvas(t.canvas) };
}

export function previewWith(pv, fn) {
  if (!pv) return;
  const src = pv.t.mask ? maskToGray(pv.before) : pv.before;
  let out = fn(src);
  if (pv.t.mask) out = grayToMask(out);
  const x = ctx2d(pv.t.canvas);
  x.save(); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, pv.t.canvas.width, pv.t.canvas.height); x.drawImage(pv.before, 0, 0); x.restore();
  // Transparenz der Ebene erhalten (Filter wie Wolken füllen sonst alles)
  applyMasked(pv.t.canvas, pv.d.selection, out);
  pv.t.layer.touch();
  view.request();
}

export function endPreview(pv, apply, name) {
  if (!pv) return;
  if (!apply) {
    const x = ctx2d(pv.t.canvas); x.clearRect(0, 0, pv.t.canvas.width, pv.t.canvas.height); x.drawImage(pv.before, 0, 0);
    pv.t.layer.touch(); view.request(); emit();
    return;
  }
  commit(name);
}

export function applyFilterToLayer(fn, name) {
  const pv = beginPreview();
  if (!pv) { if (!doc()) return; toast('Filter kann hier nicht angewendet werden'); return; }
  document.body.classList.add('busy');
  setTimeout(() => {
    try { previewWith(pv, fn); endPreview(pv, true, name); }
    catch (e) { console.error(e); endPreview(pv, false); toast('Fehler: ' + e.message); }
    document.body.classList.remove('busy');
  }, 10);
}
