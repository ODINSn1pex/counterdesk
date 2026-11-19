// Filter/Korrekturen auf aktive Ebene (oder Maske) anwenden – Vorschau im Hintergrund-Thread
import { S, doc, commit, view, emit, toast, canEditPixels, renderSmartLayer } from '../../state.js';
import { cloneCanvas, ctx2d, ctxRead, makeCanvas } from '../../engine/util.js';
import { applyMasked } from '../../engine/selection.js';
import { runFilter, cancelFilters } from '../../engine/filterRunner.js';

function target(d) {
  const l = d.layer;
  if (l.editMask && l.mask) return { canvas: l.mask, layer: l, mask: true };
  if (!canEditPixels(l)) return null;
  return { canvas: l.canvas, layer: l, mask: false };
}

function maskToGray(m) {
  const c = makeCanvas(m.width, m.height); const x = ctxRead(c); x.drawImage(m, 0, 0); const id = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) { const a = id.data[i + 3]; id.data[i] = id.data[i + 1] = id.data[i + 2] = a; id.data[i + 3] = 255; }
  x.putImageData(id, 0, 0); return c;
}
function grayToMask(g) {
  const c = makeCanvas(g.width, g.height); const x = ctxRead(c); x.drawImage(g, 0, 0); const id = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) { const v = id.data[i]; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = v; }
  x.putImageData(id, 0, 0); return c;
}

export function beginPreview() {
  const d = doc(); if (!d) return null;
  const sl = d.layer;
  if (sl && sl.type === 'smart' && !sl.editMask) {
    return { d, smart: true, layer: sl, orig: JSON.parse(JSON.stringify(sl.smart.filters || [])), gen: 0, t: { layer: sl } };
  }
  const t = target(d); if (!t) return null;
  const before = cloneCanvas(t.canvas);
  return { d, t, before, src: t.mask ? maskToGray(before) : before, gen: 0 };
}

function showResult(pv, out) {
  if (pv.t.mask) out = grayToMask(out);
  const x = ctx2d(pv.t.canvas);
  x.save(); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, pv.t.canvas.width, pv.t.canvas.height); x.drawImage(pv.before, 0, 0); x.restore();
  applyMasked(pv.t.canvas, pv.d.selection, out);
  if (out.close) out.close();
  pv.t.layer.touch();
  view.request();
}

function restoreBefore(pv) {
  const x = ctx2d(pv.t.canvas); x.clearRect(0, 0, pv.t.canvas.width, pv.t.canvas.height); x.drawImage(pv.before, 0, 0);
  pv.t.layer.touch(); view.request();
}

// Vorschau berechnen; ältere, noch laufende Berechnungen werden verworfen
function smartApply(pv, kind, id, params) {
  pv.layer.smart.filters = [...pv.orig, { kind, id, params, on: true }];
  renderSmartLayer(pv.layer, pv.d.w, pv.d.h);
  view.request();
}

export async function previewFilter(pv, kind, id, params, fast) {
  if (!pv) return false;
  if (pv.smart) { smartApply(pv, kind, id, params); return true; }
  const gen = ++pv.gen;
  cancelFilters();
  let src = pv.src;
  // Schnelle Vorschau: große Bilder verkleinert berechnen und hochskalieren
  let scale = 1;
  if (fast && src.width * src.height > 2_500_000) {
    scale = Math.sqrt(2_500_000 / (src.width * src.height));
    const sm = makeCanvas(src.width * scale, src.height * scale); const sx = ctx2d(sm); sx.imageSmoothingQuality = 'high'; sx.drawImage(src, 0, 0, sm.width, sm.height); src = sm;
  }
  try {
    let out = await runFilter(kind, id, params, src, 'preview');
    if (gen !== pv.gen) { if (out.close) out.close(); return false; }
    if (scale !== 1) { const up = makeCanvas(pv.src.width, pv.src.height); const ux = ctx2d(up); ux.imageSmoothingQuality = 'high'; ux.drawImage(out, 0, 0, up.width, up.height); if (out.close) out.close(); out = up; }
    showResult(pv, out);
    return true;
  } catch (e) {
    if (gen === pv.gen && e.message !== 'abgebrochen') { console.error(e); toast('Fehler im Filter: ' + e.message); }
    return false;
  }
}

export function showOriginal(pv) {
  if (!pv) return;
  if (pv.smart) { pv.layer.smart.filters = pv.orig; renderSmartLayer(pv.layer, pv.d.w, pv.d.h); view.request(); return; }
  pv.gen++; cancelFilters(); restoreBefore(pv);
}

export async function finishFilter(pv, kind, id, params, name) {
  if (!pv) return;
  if (pv.smart) { smartApply(pv, kind, id, params); commit('Smartfilter: ' + name); return; }
  pv.gen++;
  cancelFilters();
  try {
    const out = await runFilter(kind, id, params, pv.src);
    showResult(pv, out);
    commit(name);
  } catch (e) {
    console.error(e); restoreBefore(pv); emit(); toast('Fehler im Filter: ' + e.message);
  }
}

export function cancelPreview(pv) {
  if (!pv) return;
  if (pv.smart) { showOriginal(pv); emit(); return; }
  pv.gen++; cancelFilters(); restoreBefore(pv); emit();
}

// Direkt anwenden (Filter ohne Parameter)
export async function applyFilterToLayer(kind, id, params, name) {
  const pv = beginPreview();
  if (!pv) { if (doc()) toast('Filter kann hier nicht angewendet werden'); return; }
  document.body.classList.add('busy');
  S.ui.busy = name; emit();
  await finishFilter(pv, kind, id, params, name);
  document.body.classList.remove('busy');
  S.ui.busy = null; emit();
}
