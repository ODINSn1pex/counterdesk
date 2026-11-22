// Werkzeuge: Zeigerereignisse in Dokumentkoordinaten
import {
  S, doc, emit, view, commit, toast, canEditPixels, rasterize, setFg, setBg, gradientStops, patternCanvas,
  startTransform, renderTransform, applyTransform, applyCrop, finishTextEdit, drawStarPath, drawBlossom,
  VIEW, Layer, renderTextLayer, composite, SEL, L, maskColorIsReveal, renderSmartLayer,
} from './state.js';
import { makeCanvas, ctx2d, cloneCanvas, clamp, dist, hexToRgb, rgbToHex, alphaBounds, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb } from './engine/util.js';
import { gcoFor, textBounds, getMerged, descendants } from './engine/doc.js';
import { shapePath, drawLine, renderShapeLayer } from './engine/shapes.js';
import { bilinearMap, meshMapFor } from './engine/mesh.js';
export { shapePath };

let T = null; // aktueller Zeiger-Vorgang
const SPACE = { held: false };
export { SPACE };

// ---------- Hilfen ----------
function mergedCanvas(d) { return getMerged(d); }

export function sampleColor(d, p, all = true, size = 1) {
  const src = all ? mergedCanvas(d) : d.layers[d.active].canvas;
  const r = Math.floor(size / 2);
  const x0 = clamp(Math.floor(p.x) - r, 0, d.w - 1), y0 = clamp(Math.floor(p.y) - r, 0, d.h - 1);
  const w = Math.min(size, d.w - x0), h = Math.min(size, d.h - y0);
  const data = ctx2d(src).getImageData(x0, y0, w, h).data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { if (data[i + 3] === 0) continue; R += data[i]; G += data[i + 1]; B += data[i + 2]; n++; }
  if (!n) return null;
  return rgbToHex(R / n, G / n, B / n);
}

function selectionMode(e) {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return S.sel.mode;
}

// ---------- Eigene Pinselspitzen (Alpha-Masken) ----------
const tipCanvases = new Map();
export function customTip(id) { return tipCanvases.get(id) || null; }
export async function loadCustomTips() {
  for (const b of S.customBrushes || []) {
    if (tipCanvases.has(b.id)) continue;
    const img = new Image(); img.src = b.data;
    try { await img.decode(); const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); tipCanvases.set(b.id, c); } catch (e) { /* defekt */ }
  }
}
// Graustufenbild → Pinselspitze (dunkel = deckend)
export function makeTipFromCanvas(src, name) {
  const b = alphaBounds(src) || { x: 0, y: 0, w: src.width, h: src.height };
  const max = 500, k = Math.min(1, max / Math.max(b.w, b.h));
  const c = makeCanvas(Math.max(1, b.w * k), Math.max(1, b.h * k)); const x = ctx2d(c);
  x.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  const id = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) {
    const l = (id.data[i] * 0.299 + id.data[i + 1] * 0.587 + id.data[i + 2] * 0.114) / 255;
    const a = (1 - l) * id.data[i + 3];
    id.data[i] = id.data[i + 1] = id.data[i + 2] = 0; id.data[i + 3] = a;
  }
  x.putImageData(id, 0, 0);
  const tid = 'b' + Date.now().toString(36);
  tipCanvases.set(tid, c);
  S.customBrushes = [...(S.customBrushes || []), { id: tid, name: name || 'Eigener Pinsel', data: c.toDataURL('image/png') }];
  try { localStorage.setItem('sakura.customBrushes', JSON.stringify(S.customBrushes)); } catch (e) { toast('Pinselspeicher voll'); }
  Object.assign(S.brush, { shape: 'custom:' + tid, spacing: 0.25, size: Math.min(300, Math.max(c.width, c.height)) });
  emit();
  return tid;
}
// Pinselspitze aus Alpha-Maske übernehmen (z. B. aus .abr-Dateien)
export function addTipFromAlpha(c, name, spacing = 0.25) {
  const tid = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const max = 500, k = Math.min(1, max / Math.max(c.width, c.height));
  let t = c;
  if (k < 1) { t = makeCanvas(c.width * k, c.height * k); const tx = ctx2d(t); tx.imageSmoothingQuality = 'high'; tx.drawImage(c, 0, 0, t.width, t.height); }
  tipCanvases.set(tid, t);
  S.customBrushes = [...(S.customBrushes || []), { id: tid, name, data: t.toDataURL('image/png'), spacing }];
  try { localStorage.setItem('sakura.customBrushes', JSON.stringify(S.customBrushes)); } catch (e) { /* voll */ }
  return tid;
}

export function definePresetFromSelection() {
  const d = doc(); if (!d) return;
  const src = cloneCanvas(getMerged(d));
  if (d.selection) { const sx = ctx2d(src); sx.globalCompositeOperation = 'destination-in'; sx.drawImage(d.selection, 0, 0); }
  // Transparenz → weiß (= nicht malen)
  const flat = makeCanvas(d.w, d.h); const fx = ctx2d(flat); fx.fillStyle = '#fff'; fx.fillRect(0, 0, d.w, d.h); fx.drawImage(src, 0, 0);
  if (d.selection) { fx.globalCompositeOperation = 'destination-in'; fx.drawImage(d.selection, 0, 0); }
  makeTipFromCanvas(flat, 'Pinsel ' + ((S.customBrushes || []).length + 1));
  toast('Pinselvorgabe gespeichert und ausgewählt');
}

// ---------- Pinsel-Spitze ----------
const dabCache = new Map();
function dabCanvas(size, hardness, color, shape = 'round', angle = 0, roundness = 1) {
  const key = [Math.round(size * 2) / 2, hardness, color, shape, angle, roundness].join('|');
  if (dabCache.has(key)) return dabCache.get(key);
  if (dabCache.size > 60) dabCache.clear();
  const s = Math.max(1, Math.ceil(size));
  const c = makeCanvas(s + 2, s + 2);
  const x = ctx2d(c);
  const r = size / 2, cx = (s + 2) / 2;
  x.translate(cx, cx); x.rotate(angle * Math.PI / 180); x.scale(1, roundness);
  if (shape.startsWith && shape.startsWith('custom:')) {
    const tip = customTip(shape.slice(7));
    if (tip) { const k = size / Math.max(tip.width, tip.height); const tw = tip.width * k, th = tip.height * k; x.drawImage(tip, -tw / 2, -th / 2, tw, th); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(-r, -r, size, size); }
  } else if (shape === 'square') { x.fillStyle = color; x.fillRect(-r, -r, size, size); }
  else if (shape === 'blossom') { drawBlossom(x, 0, 0, r, color); }
  else if (shape === 'star') { x.fillStyle = color; drawStarPath(x, 0, 0, 5, r, r * 0.45); x.fill(); }
  else {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
    const { r: R, g: G, b: B } = hexToRgb(color);
    g.addColorStop(0, `rgba(${R},${G},${B},1)`);
    g.addColorStop(clamp(hardness, 0, 0.999), `rgba(${R},${G},${B},1)`);
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
  }
  dabCache.set(key, c);
  return c;
}

// ---------- Mal-Strich (Pinsel, Buntstift, Radierer, Stempel, Protokollpinsel) ----------
function paintTarget(d) {
  const l = d.layer;
  if (S.ui.quickMask) return { canvas: d.ensureSelectionCanvas(), kind: 'mask', layer: null };
  if (l.editMask && l.mask) return { canvas: l.mask, kind: 'mask', layer: l };
  if (!canEditPixels(l)) return null;
  return { canvas: l.canvas, kind: 'pixels', layer: l };
}

function beginStroke(d, e, kind) {
  const tgt = paintTarget(d);
  if (!tgt) return null;
  const st = {
    d, kind, tgt, before: cloneCanvas(tgt.canvas),
    stroke: makeCanvas(d.w, d.h), last: null, residue: 0, p0: e.p, smooth: { ...e.p },
  };
  const tool = S.tool;
  if (kind === 'pencil') st.o = { size: S.pencil.size, hardness: 1, opacity: S.pencil.opacity, flow: 1, spacing: 0.25, mode: 'normal', shape: 'square' };
  else if (kind === 'eraser') st.o = { ...S.eraser, spacing: 0.12, mode: 'normal', shape: 'round' };
  else if (tool === 'stamp' || tool === 'history' || tool === 'heal') st.o = { ...S.brush, size: tool === 'heal' ? S.heal.size : S.brush.size, mode: 'normal' };
  else st.o = { ...S.brush };
  if (kind === 'clone') {
    if (!S.cloneSource) { toast('Alt + Klick, um eine Quelle festzulegen'); return null; }
    if (!S.stampOpts.aligned || S.cloneOffset == null) S.cloneOffset = { x: S.cloneSource.x - e.p.x, y: S.cloneSource.y - e.p.y };
    st.src = cloneCanvas(S.stampOpts.sampleAll ? mergedCanvas(d) : d.layer.canvas);
  }
  if (kind === 'heal') st.src = cloneCanvas(d.layer.canvas);
  if (kind === 'history') {
    const h = d.history[d.historySource ?? 0];
    const entry = h && h.state.layers.find((x) => x.id === d.layer.id);
    if (!entry) { toast('Keine Protokollquelle für diese Ebene'); return null; }
    st.src = entry.canvas;
  }
  if (kind === 'pattern') st.pat = patternCanvas(S.stampOpts.pattern);
  if ((kind === 'brush' || kind === 'mixer') && st.o.dual) st.dualStroke = makeCanvas(d.w, d.h);
  if ((kind === 'brush' || kind === 'mixer') && st.o.texture) st.tex = textureAlpha(st.o.texture, st.o.textureScale || 1, st.o.textureInvert);
  if (kind === 'mixer') { const c = hexToRgb(S.fg); st.res = [c.r, c.g, c.b]; st.sampleCtx = ctx2d(st.before); }
  if (tgt.kind === 'mask') {
    st.reveal = kind === 'eraser' ? !maskColorIsReveal() : maskColorIsReveal();
    st.color = '#ffffff';
  } else st.color = kind === 'eraser' && tgt.layer.isBackground ? S.bg : S.fg;
  return st;
}

function addDirty(st, x, y, r) {
  const x0 = Math.floor(x - r - 2), y0 = Math.floor(y - r - 2), x1 = Math.ceil(x + r + 2), y1 = Math.ceil(y + r + 2);
  const dd = st.dirty;
  if (!dd) st.dirty = { x0, y0, x1, y1 };
  else { if (x0 < dd.x0) dd.x0 = x0; if (y0 < dd.y0) dd.y0 = y0; if (x1 > dd.x1) dd.x1 = x1; if (y1 > dd.y1) dd.y1 = y1; }
}

// Farbeinstellungen pro Pinselabdruck (Farbton-, Sättigungs-, Helligkeits-, VG/HG-Jitter)
function dynColor(o, base) {
  if (!o.hueJitter && !o.satJitter && !o.briJitter && !o.fgbgJitter) return base;
  let c = hexToRgb(base);
  if (o.fgbgJitter) { const b = hexToRgb(S.bg), t = Math.random() * o.fgbgJitter; c = { r: c.r + (b.r - c.r) * t, g: c.g + (b.g - c.g) * t, b: c.b + (b.b - c.b) * t }; }
  const h = rgbToHsv(c.r, c.g, c.b);
  const hh = (h.h + (Math.random() - 0.5) * 360 * (o.hueJitter || 0) + 360) % 360;
  const ss = clamp(h.s + (Math.random() - 0.5) * 2 * (o.satJitter || 0), 0, 1), vv = clamp(h.v + (Math.random() - 0.5) * 2 * (o.briJitter || 0), 0, 1);
  const q = hsvToRgb(Math.round(hh / 3) * 3, Math.round(ss * 40) / 40, Math.round(vv * 40) / 40);
  return rgbToHex(Math.round(q.r), Math.round(q.g), Math.round(q.b));
}
// Misch-Pinsel: Farbe im Pinsel vermischt sich mit der Leinwand (Nässe, Aufnahme, Mischung)
function mixerColor(st, x, y) {
  const o = st.o, W = st.before.width, H = st.before.height;
  const xi = clamp(Math.round(x) - 1, 0, W - 3), yi = clamp(Math.round(y) - 1, 0, H - 3);
  const px = st.sampleCtx.getImageData(xi, yi, 3, 3).data;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < px.length; i += 4) { const w = px[i + 3] / 255; r += px[i] * w; g += px[i + 1] * w; b += px[i + 2] * w; a += w; }
  const wet = o.wet ?? 0.5, mix = o.mix ?? 0.5, load = o.load ?? 0.5;
  if (a > 0.01) { r /= a; g /= a; b /= a; const k = wet * mix; st.res = st.res.map((v, i) => v + ([r, g, b][i] - v) * k); }
  // Farbe nachladen (Aufnahme)
  if (o.reload !== false) { const f = hexToRgb(S.fg); st.res = st.res.map((v, i) => v + ([f.r, f.g, f.b][i] - v) * (1 - load) * 0.05); }
  return rgbToHex(Math.round(st.res[0]), Math.round(st.res[1]), Math.round(st.res[2]));
}
// Struktur: Musterhelligkeit als Deckkraft-Maske
const texCache = new Map();
function textureAlpha(name, scale, invert) {
  const k = name + '|' + scale + '|' + invert;
  if (texCache.has(k)) return texCache.get(k);
  const p = patternCanvas(name), w = Math.max(1, Math.round(p.width * scale)), h = Math.max(1, Math.round(p.height * scale));
  const c = makeCanvas(w, h), x = ctx2d(c); x.drawImage(p, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h), D = id.data;
  for (let i = 0; i < D.length; i += 4) { let l = (D[i] * 0.299 + D[i + 1] * 0.587 + D[i + 2] * 0.114) / 255; if (invert) l = 1 - l; D[i] = D[i + 1] = D[i + 2] = 0; D[i + 3] = l * 255; }
  x.putImageData(id, 0, 0);
  texCache.set(k, c); return c;
}
// Symmetrie: Abdruck an allen Spiegelachsen wiederholen
function symPoints(st, x, y) {
  const m = st.o.symmetry; if (!m || m === 'none') return [[x, y]];
  const cx = S.symCenter ? S.symCenter.x : st.d.w / 2, cy = S.symCenter ? S.symCenter.y : st.d.h / 2;
  if (m === 'vertical') return [[x, y], [2 * cx - x, y]];
  if (m === 'horizontal') return [[x, y], [x, 2 * cy - y]];
  if (m === 'both') return [[x, y], [2 * cx - x, y], [x, 2 * cy - y], [2 * cx - x, 2 * cy - y]];
  const n = Math.max(2, st.o.symSegments || 6), out = [], dx = x - cx, dy = y - cy;
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n, c = Math.cos(a), s = Math.sin(a);
    out.push([cx + dx * c - dy * s, cy + dx * s + dy * c]);
    if (m === 'mandala') out.push([cx + dx * c + dy * s, cy + dx * s - dy * c]);
  }
  return out;
}
function stampSym(st, x, y, pressure) {
  for (const [a, b] of symPoints(st, x, y)) stampDab(st, a, b, pressure);
}

function stampDab(st, x, y, pressure = 1) {
  const o = st.o;
  const pSize = S.prefs.pressureSize !== false ? pressure : 1;
  let size = Math.max(1, o.size * pSize);
  st.curAlpha = S.prefs.pressureOpacity ? pressure : 1;
  if (o.jitter) size *= 1 - Math.random() * o.jitter;
  if (o.scatter) { x += (Math.random() - 0.5) * o.scatter * o.size * 2; y += (Math.random() - 0.5) * o.scatter * o.size * 2; }
  const sx = st.stroke; const x2 = ctx2d(sx);
  const kind = st.kind;
  addDirty(st, x, y, size * 0.75 + 2);
  const hard = kind === 'pencil' ? 1 : o.hardness;
  const shape = kind === 'pencil' ? 'square' : o.shape || 'round';
  if (kind === 'clone' || kind === 'history' || kind === 'pattern' || kind === 'heal') {
    const s = Math.ceil(size) + 2;
    const tmp = makeCanvas(s, s); const tx = ctx2d(tmp);
    tx.drawImage(dabCanvas(size, hard, '#000', shape, o.angle, o.roundness), 0, 0);
    tx.globalCompositeOperation = 'source-in';
    const ox = x - s / 2, oy = y - s / 2;
    if (kind === 'clone') tx.drawImage(st.src, -(ox + S.cloneOffset.x), -(oy + S.cloneOffset.y));
    else if (kind === 'history') tx.drawImage(st.src, -ox, -oy);
    else if (kind === 'pattern') { tx.fillStyle = tx.createPattern(st.pat, 'repeat'); tx.translate(-ox, -oy); tx.fillRect(ox, oy, s, s); }
    else if (kind === 'heal') healPatch(st, tx, ox, oy, s);
    x2.globalAlpha = o.flow * st.curAlpha;
    x2.drawImage(tmp, ox, oy);
    x2.globalAlpha = 1;
    return;
  }
  let color = st.color, angle = o.angle || 0, flow = o.flow;
  if (kind === 'brush' || kind === 'mixer') {
    if (st.tgt.kind === 'pixels') color = kind === 'mixer' ? mixerColor(st, x, y) : dynColor(o, st.color);
    if (o.angleJitter) angle += (Math.random() - 0.5) * 360 * o.angleJitter;
    if (o.angleFollow && st.dir != null) angle += st.dir * 180 / Math.PI;
    if (o.penAngle && st.penTwist != null) angle += st.penTwist;
    if (o.flowJitter) flow *= 1 - Math.random() * o.flowJitter;
    if (o.opacityJitter) flow *= 1 - Math.random() * o.opacityJitter;
    if (st.dualStroke) {
      const ds = Math.max(1, o.dualSize || 20), dd = dabCanvas(ds, 0.9, '#000', o.dual, 0, 1);
      const sc = (o.dualScatter || 0) * size;
      ctx2d(st.dualStroke).drawImage(dd, x + (Math.random() - 0.5) * sc - dd.width / 2, y + (Math.random() - 0.5) * sc - dd.height / 2);
    }
  }
  const dab = dabCanvas(size, hard, color, shape, Math.round(angle), o.roundness);
  x2.globalAlpha = flow * st.curAlpha;
  if (kind === 'pencil') { x2.imageSmoothingEnabled = false; x2.drawImage(dab, Math.round(x - dab.width / 2), Math.round(y - dab.height / 2)); }
  else x2.drawImage(dab, x - dab.width / 2, y - dab.height / 2);
  x2.globalAlpha = 1;
}

// Reparatur: Textur von Quelle, Farbe an Umgebung angepasst
function healPatch(st, tx, ox, oy, s) {
  const d = st.d;
  let off = S.sub.heal === 'spot' ? null : S.cloneOffset;
  if (!off) {
    // automatisch: ähnlichsten Nachbarbereich wählen
    const cands = [[s * 1.1, 0], [-s * 1.1, 0], [0, s * 1.1], [0, -s * 1.1]];
    off = { x: cands[0][0], y: cands[0][1] };
    for (const [cx, cy] of cands) { if (ox + cx >= 0 && oy + cy >= 0 && ox + cx + s <= d.w && oy + cy + s <= d.h) { off = { x: cx, y: cy }; break; } }
  }
  const mean = (canvas, x, y, w, h, ring) => {
    x = clamp(Math.round(x), 0, d.w - 1); y = clamp(Math.round(y), 0, d.h - 1);
    w = Math.max(1, Math.min(w, d.w - x)); h = Math.max(1, Math.min(h, d.h - y));
    const dd = ctx2d(canvas).getImageData(x, y, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (ring) { const rr = Math.hypot(i - w / 2, j - h / 2) / (w / 2); if (rr < 0.75 || rr > 1) continue; }
      const q = (j * w + i) * 4; r += dd[q]; g += dd[q + 1]; b += dd[q + 2]; n++;
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  const pad = s * 0.35;
  const tgtMean = mean(st.src, ox - pad, oy - pad, s + pad * 2, s + pad * 2, true);
  const srcMean = mean(st.src, ox + off.x - pad, oy + off.y - pad, s + pad * 2, s + pad * 2, true);
  tx.drawImage(st.src, -(ox + off.x), -(oy + off.y));
  const id = tx.getImageData(0, 0, s, s);
  for (let i = 0; i < id.data.length; i += 4) {
    id.data[i] += tgtMean[0] - srcMean[0]; id.data[i + 1] += tgtMean[1] - srcMean[1]; id.data[i + 2] += tgtMean[2] - srcMean[2];
  }
  tx.putImageData(id, 0, 0);
}

function strokeTo(st, p, pressure) {
  const o = st.o;
  st.lastPressure = pressure;
  const spacing = Math.max(0.5, o.size * (o.spacing || 0.12));
  if (!st.last) { stampSym(st, p.x, p.y, pressure); st.last = { ...p }; refreshStroke(st); return; }
  const dx = p.x - st.last.x, dy = p.y - st.last.y, len = Math.hypot(dx, dy);
  if (len > 0.5) st.dir = Math.atan2(dy, dx);
  let t = spacing - st.residue;
  while (t <= len) {
    stampSym(st, st.last.x + dx * t / len, st.last.y + dy * t / len, pressure);
    t += spacing;
  }
  st.residue = len - (t - spacing);
  st.last = { ...p };
  refreshStroke(st);
}

const scratch = { c: null };
function scratchCanvas(w, h) {
  let c = scratch.c;
  if (!c) c = scratch.c = makeCanvas(w, h);
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  const x = ctx2d(c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
  return c;
}

// Nur den veränderten Bereich neu zeichnen → flüssiges Malen auch bei großen Bildern
function refreshStroke(st) {
  const d = st.d, t = st.tgt;
  const W = t.canvas.width, H = t.canvas.height;
  const dd = st.dirty || { x0: 0, y0: 0, x1: W, y1: H };
  st.dirty = null;
  const rx = Math.max(0, dd.x0), ry = Math.max(0, dd.y0);
  const rw = Math.min(W, dd.x1) - rx, rh = Math.min(H, dd.y1) - ry;
  if (rw <= 0 || rh <= 0) return;
  const x = ctx2d(t.canvas);
  const sel = d.selection && !S.ui.quickMask ? d.selection : null;
  const lockA = t.layer && t.layer.lockAlpha && t.kind === 'pixels';
  // Strich-Ausschnitt vorbereiten (Auswahl / Transparenz fixieren / Farbe ersetzen)
  const sc = scratchCanvas(rw, rh); const sx = ctx2d(sc);
  sx.drawImage(st.stroke, rx, ry, rw, rh, 0, 0, rw, rh);
  if (st.dualStroke) { sx.globalCompositeOperation = 'destination-in'; sx.drawImage(st.dualStroke, rx, ry, rw, rh, 0, 0, rw, rh); sx.globalCompositeOperation = 'source-over'; }
  if (st.tex) {
    sx.save(); sx.globalCompositeOperation = 'destination-out'; sx.globalAlpha = clamp(st.o.textureDepth ?? 0.5, 0, 1);
    sx.translate(-rx, -ry); sx.fillStyle = sx.createPattern(st.tex, 'repeat'); sx.fillRect(rx, ry, rw, rh); sx.restore();
  }
  if (sel || lockA || st.kind === 'replace') {
    sx.globalCompositeOperation = 'destination-in';
    if (sel) sx.drawImage(sel, rx, ry, rw, rh, 0, 0, rw, rh);
    if (lockA || st.kind === 'replace') sx.drawImage(st.before, rx, ry, rw, rh, 0, 0, rw, rh);
    sx.globalCompositeOperation = 'source-over';
  }
  x.save();
  x.clearRect(rx, ry, rw, rh);
  x.drawImage(st.before, rx, ry, rw, rh, rx, ry, rw, rh);
  x.globalAlpha = st.o.opacity;
  if (t.kind === 'mask') x.globalCompositeOperation = st.reveal ? 'source-over' : 'destination-out';
  else if (st.kind === 'eraser' && !t.layer.isBackground) x.globalCompositeOperation = 'destination-out';
  else if (st.kind === 'replace') x.globalCompositeOperation = 'color';
  else x.globalCompositeOperation = lockA ? 'source-atop' : gcoFor(st.o.mode || 'normal');
  x.drawImage(sc, 0, 0, rw, rh, rx, ry, rw, rh);
  x.restore();
  if (t.layer) t.layer.touch();
  if (t.kind === 'mask' && !t.layer) { d.selRev++; view.request(); }
  else view.requestRect({ x: rx, y: ry, w: rw, h: rh });
}

// ---------- Lokale Pixel-Werkzeuge (Weichzeichnen, Abwedeln …) ----------
function localOp(d, layer, p, size, fn) {
  const r = size / 2;
  const x0 = Math.floor(clamp(p.x - r, 0, d.w)), y0 = Math.floor(clamp(p.y - r, 0, d.h));
  const x1 = Math.ceil(clamp(p.x + r, 0, d.w)), y1 = Math.ceil(clamp(p.y + r, 0, d.h));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const cx = ctx2d(layer.canvas);
  const id = cx.getImageData(x0, y0, w, h);
  const selD = d.selection ? ctx2d(d.selection).getImageData(x0, y0, w, h).data : null;
  const weight = (i, j) => {
    const dd = Math.hypot(x0 + i - p.x, y0 + j - p.y) / r;
    if (dd >= 1) return 0;
    let wgt = dd < 0.5 ? 1 : 1 - (dd - 0.5) * 2;
    if (selD) wgt *= selD[(j * w + i) * 4 + 3] / 255;
    return wgt;
  };
  fn(id, w, h, weight, x0, y0);
  cx.putImageData(id, x0, y0);
  layer.touch();
  view.requestRect({ x: x0, y: y0, w, h });
}

function blurDab(d, layer, p, strength, sharpen) {
  const size = S.retouch.size;
  const r = size / 2;
  const x0 = Math.floor(clamp(p.x - r - 4, 0, d.w)), y0 = Math.floor(clamp(p.y - r - 4, 0, d.h));
  const w = Math.ceil(Math.min(d.w - x0, size + 8)), h = Math.ceil(Math.min(d.h - y0, size + 8));
  if (w <= 0 || h <= 0) return;
  const reg = makeCanvas(w, h); const rx = ctx2d(reg); rx.drawImage(layer.canvas, -x0, -y0);
  const bl = makeCanvas(w, h); const bx = ctx2d(bl); bx.filter = 'blur(2px)'; bx.drawImage(reg, 0, 0);
  const bd = bx.getImageData(0, 0, w, h).data;
  localOp(d, layer, p, size, (id, ww, hh, weight, lx, ly) => {
    for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) {
      const wgt = weight(i, j) * strength; if (!wgt) continue;
      const q = (j * ww + i) * 4, bq = ((ly - y0 + j) * w + (lx - x0 + i)) * 4;
      for (let k = 0; k < 4; k++) {
        const v = id.data[q + k], b = bd[bq + k];
        id.data[q + k] = sharpen ? v + (v - b) * wgt * 1.2 : v + (b - v) * wgt;
      }
    }
  });
}

function toneDab(d, layer, p, mode) {
  const ex = S.retouch.exposure * 0.25, range = S.retouch.range;
  localOp(d, layer, p, S.retouch.size, (id, w, h, weight) => {
    const px = id.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const wgt = weight(i, j); if (!wgt) continue;
      const q = (j * w + i) * 4;
      const l = (px[q] * 0.299 + px[q + 1] * 0.587 + px[q + 2] * 0.114) / 255;
      const rw = range === 'shadows' ? clamp(1 - l * 2.2, 0, 1) : range === 'highlights' ? clamp(l * 2.2 - 1.2, 0, 1) : 1 - Math.abs(l - 0.5) * 1.6;
      const k = wgt * ex * clamp(rw, 0.05, 1);
      if (mode === 'sponge') {
        const [hh, s, ll] = rgbToHsl(px[q], px[q + 1], px[q + 2]);
        const ns = S.retouch.sponge === 'saturate' ? clamp(s + k * 2, 0, 1) : clamp(s - k * 2, 0, 1);
        const [r, g, b] = hslToRgb(hh, ns, ll); px[q] = r; px[q + 1] = g; px[q + 2] = b;
      } else for (let c = 0; c < 3; c++) {
        const v = px[q + c];
        px[q + c] = mode === 'dodge' ? v + (255 - v) * k : v - v * k;
      }
    }
  });
}

function smudgeDab(st, p) {
  const d = st.d, layer = st.layer, size = S.retouch.size;
  const s = Math.ceil(size);
  const x0 = Math.round(p.x - s / 2), y0 = Math.round(p.y - s / 2);
  const cur = makeCanvas(s, s); ctx2d(cur).drawImage(layer.canvas, -x0, -y0);
  if (!st.carry) { st.carry = cur; return; }
  const strength = S.retouch.strength;
  const cd = ctx2d(st.carry).getImageData(0, 0, s, s).data;
  localOp(d, layer, { x: x0 + s / 2, y: y0 + s / 2 }, size, (id, w, h, weight, lx, ly) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const wgt = weight(i, j) * strength; if (!wgt) continue;
      const q = (j * w + i) * 4, cq = ((ly - y0 + j) * s + (lx - x0 + i)) * 4;
      if (cq < 0 || cq >= cd.length) continue;
      for (let k = 0; k < 4; k++) id.data[q + k] += (cd[cq + k] - id.data[q + k]) * wgt;
    }
  });
  const nc = makeCanvas(s, s); ctx2d(nc).drawImage(layer.canvas, -x0, -y0);
  st.carry = nc;
}

function bgEraserDab(st, p) {
  const d = st.d, layer = st.layer;
  const px = ctx2d(layer.canvas).getImageData(clamp(Math.floor(p.x), 0, d.w - 1), clamp(Math.floor(p.y), 0, d.h - 1), 1, 1).data;
  const c = px[3] ? rgbToHex(px[0], px[1], px[2]) : (st.lastColor || '#000000');
  st.lastColor = c;
  const { r, g, b } = hexToRgb(st.sampleOnce ? st.sampleOnce : c);
  if (!st.sampleOnce) st.sampleOnce = S.eraser.sampling === 'once' ? c : null;
  const tol = S.eraser.tolerance * 2.55;
  localOp(d, layer, p, S.eraser.size, (id, w, h, weight) => {
    const px = id.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const wgt = weight(i, j); if (!wgt) continue;
      const q = (j * w + i) * 4;
      const dd = Math.max(Math.abs(px[q] - r), Math.abs(px[q + 1] - g), Math.abs(px[q + 2] - b));
      if (dd <= tol) px[q + 3] *= 1 - wgt;
    }
  });
}

// ---------- Verlauf ----------
export function drawGradient(x, w, h, a, b, opts) {
  const stops = gradientStops(S.gradients[opts.index]);
  const st = opts.reverse ? stops.map((s) => ({ p: 1 - s.p, c: s.c })).reverse() : stops;
  const len = Math.max(1, dist(a, b));
  let g;
  if (opts.type === 'radial') g = x.createRadialGradient(a.x, a.y, 0, a.x, a.y, len);
  else if (opts.type === 'angle') { g = x.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y); }
  else if (opts.type === 'reflected') {
    g = x.createLinearGradient(a.x - (b.x - a.x), a.y - (b.y - a.y), b.x, b.y);
    st.forEach((s) => { g.addColorStop(0.5 - s.p / 2, s.c); g.addColorStop(0.5 + s.p / 2, s.c); });
    x.fillStyle = g; x.fillRect(0, 0, w, h); return;
  } else if (opts.type === 'diamond') {
    const tmp = makeCanvas(256, 1); const tx = ctx2d(tmp);
    const lg = tx.createLinearGradient(0, 0, 256, 0); st.forEach((s) => lg.addColorStop(s.p, s.c));
    tx.fillStyle = lg; tx.fillRect(0, 0, 256, 1);
    const lut = tx.getImageData(0, 0, 256, 1).data;
    const id = x.createImageData(w, h);
    const ang = Math.atan2(b.y - a.y, b.x - a.x), ca = Math.cos(-ang), sa = Math.sin(-ang);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const dx = xx - a.x, dy = yy - a.y;
      const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
      const t = clamp((Math.abs(u) + Math.abs(v)) / len, 0, 1);
      const li = Math.min(255, (t * 255) | 0) * 4, o = (yy * w + xx) * 4;
      id.data[o] = lut[li]; id.data[o + 1] = lut[li + 1]; id.data[o + 2] = lut[li + 2]; id.data[o + 3] = lut[li + 3];
    }
    const tc = makeCanvas(w, h); ctx2d(tc).putImageData(id, 0, 0); x.drawImage(tc, 0, 0); return;
  } else g = x.createLinearGradient(a.x, a.y, b.x, b.y);
  st.forEach((s) => g.addColorStop(clamp(s.p, 0, 1), s.c));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
}

// ---------- Formen ----------


function rectFrom(a, b, e, ratio) {
  let w = b.x - a.x, h = b.y - a.y;
  if (e.shift || ratio) {
    const k = ratio || 1;
    const m = Math.max(Math.abs(w), Math.abs(h) * k);
    w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m / k;
  }
  if (e.alt) return { x: a.x - w, y: a.y - h, w: w * 2, h: h * 2 };
  return { x: a.x, y: a.y, w, h };
}
function norm(r) { return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) }; }

// ---------- Pfade ----------
export function tracePath(x, path) {
  const pts = path.points; if (!pts.length) return;
  x.beginPath();
  x.moveTo(pts[0].x, pts[0].y);
  const seg = (a, b) => x.bezierCurveTo(a.ox ?? a.x, a.oy ?? a.y, b.ix ?? b.x, b.iy ?? b.y, b.x, b.y);
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  if (path.closed && pts.length > 2) { seg(pts[pts.length - 1], pts[0]); x.closePath(); }
}

// Pfad in Polylinie umwandeln (für Text auf Pfad)
export function pathPolyline(path, steps = 24) {
  const pts = path.points; if (!pts.length) return [];
  const out = [{ x: pts[0].x, y: pts[0].y }];
  const seg = (a, b) => {
    const c1 = { x: a.ox ?? a.x, y: a.oy ?? a.y }, c2 = { x: b.ix ?? b.x, y: b.iy ?? b.y };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      out.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y });
    }
  };
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  if (path.closed && pts.length > 2) seg(pts[pts.length - 1], pts[0]);
  return out;
}

export function textOnPath() {
  const d = doc(); if (!d) return;
  const path = d.paths[d.activePath] || d.paths[d.paths.length - 1];
  if (!path || path.points.length < 2) { toast('Zeichne zuerst mit dem Zeichenstift (P) einen Pfad'); return; }
  const poly = pathPolyline(path);
  const l = new Layer(d.w, d.h, 'Text auf Pfad');
  l.type = 'text';
  l.text = { content: 'Text auf Pfad', x: poly[0].x, y: poly[0].y - S.text.size, font: S.text.font, size: S.text.size, color: S.text.color || S.fg, bold: S.text.bold, italic: S.text.italic, caps: S.text.caps, align: 'left', leading: 1.2, tracking: S.text.tracking || 0, path: poly, pathOffset: 0 };
  renderTextLayer(l, d.w, d.h);
  d.addLayer(l);
  S.tool = 'type';
  S.ui.textEdit = { layerId: l.id, isNew: true };
  emit(); view.request();
}

export const PATHS = {
  toSelection: () => {
    const d = doc(); const p = d && d.paths[d.activePath]; if (!p) { toast('Kein Pfad aktiv'); return; }
    const c = SEL.shapeCanvas(d, (x) => { tracePath(x, { ...p, closed: true }); x.fill(); }, S.sel.feather);
    SEL.combine(d, c, S.sel.mode); commit('Pfad als Auswahl');
  },
  fill: () => {
    const d = doc(); const p = d && d.paths[d.activePath]; if (!p) { toast('Kein Pfad aktiv'); return; }
    const l = d.layer; if (!canEditPixels(l)) return;
    const x = l.ctx; x.save(); x.fillStyle = S.fg; tracePath(x, { ...p, closed: true }); x.fill(); x.restore(); l.touch(); commit('Pfad füllen');
  },
  stroke: () => {
    const d = doc(); const p = d && d.paths[d.activePath]; if (!p) { toast('Kein Pfad aktiv'); return; }
    const l = d.layer; if (!canEditPixels(l)) return;
    const x = l.ctx; x.save(); x.strokeStyle = S.fg; x.lineWidth = Math.max(1, S.brush.size / 4); x.lineCap = 'round'; x.lineJoin = 'round';
    tracePath(x, p); x.stroke(); x.restore(); l.touch(); commit('Pfadkontur füllen');
  },
  remove: (i) => { const d = doc(); if (!d) return; d.paths.splice(i, 1); d.activePath = -1; commit('Pfad löschen'); },
  fromSelection: () => {
    const d = doc(); if (!d || !d.selection) { toast('Keine Auswahl'); return; }
    const b = SEL.selectionBounds(d.selection); if (!b) return;
    // Kontur grob abtasten (Strahlen vom Mittelpunkt)
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, sd = ctx2d(d.selection).getImageData(0, 0, d.w, d.h).data;
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2; let r = Math.hypot(b.w, b.h);
      for (; r > 0; r -= 1) { const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r); if (x >= 0 && y >= 0 && x < d.w && y < d.h && sd[(y * d.w + x) * 4 + 3] > 127) break; }
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    d.paths.push({ name: `Pfad ${d.paths.length + 1}`, points: pts, closed: true }); d.activePath = d.paths.length - 1;
    commit('Arbeitspfad erstellen');
  },
};

// =====================================================================
// Zeiger-Handler
// =====================================================================
export function pointerDown(e) {
  const d = doc(); if (!d) return;
  if (S.ui.textEdit && S.tool !== 'type') finishTextEdit();
  const tool = SPACE.held ? 'view' : S.tool;
  const sub = SPACE.held ? 'hand' : S.sub[tool];
  const p = e.p;

  // Alt in Malwerkzeugen = Pipette
  if (e.alt && e.shift && tool === 'brush' && S.brush.symmetry && S.brush.symmetry !== 'none') { S.symCenter = { x: p.x, y: p.y }; view.overlay(); toast('Symmetrie-Mittelpunkt festgelegt'); return; }
  if (e.alt && (tool === 'brush' || tool === 'gradient' || (tool === 'shape'))) {
    const c = sampleColor(d, p, true, 1); if (c) setFg(c); return;
  }

  switch (tool) {
    case 'view':
      if (sub === 'zoom' && !SPACE.held) { VIEW.zoomBy(e.alt ? 1 / 1.5 : 1.5, e.cx, e.cy); return; }
      if (sub === 'rotate' && !SPACE.held) { T = { kind: 'rotview', a0: Math.atan2(e.rsy - e.vh / 2, e.rsx - e.vw / 2), r0: d.viewRot || 0 }; return; }
      T = { kind: 'pan', sx: e.sx, sy: e.sy, px: d.panX, py: d.panY };
      return;
    case 'move':
      if (sub === 'artboard') { T = { kind: 'marquee', a: p, b: p, mode: 'new', artboard: true }; return; }
      return moveDown(d, e);
    case 'marquee': {
      if (sub === 'row' || sub === 'col') {
        const c = SEL.shapeCanvas(d, (x) => sub === 'row' ? x.fillRect(0, Math.floor(p.y), d.w, 1) : x.fillRect(Math.floor(p.x), 0, 1, d.h));
        SEL.combine(d, c, selectionMode(e)); commit('Auswahl'); return;
      }
      T = { kind: 'marquee', a: p, b: p, mode: selectionMode(e) };
      return;
    }
    case 'lasso':
      if (sub === 'polygon') {
        if (!T || T.kind !== 'poly') T = { kind: 'poly', pts: [p], mode: selectionMode(e), hover: p };
        else {
          if (T.pts.length > 2 && dist(p, T.pts[0]) * e.zoom < 10) { finishLasso(d); return; }
          T.pts.push(p);
        }
        view.overlay(); return;
      }
      T = { kind: 'lasso', pts: [p], mode: selectionMode(e) };
      return;
    case 'wand': {
      if (sub === 'object') {
        T = { kind: 'marquee', a: p, b: p, mode: selectionMode(e), object: true }; return;
      }
      const src = S.sel.sampleAll ? mergedCanvas(d) : d.layer.canvas;
      if (sub === 'wand') {
        let m = SEL.floodMask(src, p.x, p.y, S.sel.tolerance, S.sel.contiguous);
        if (S.sel.feather) m = SEL.feather(m, S.sel.feather);
        SEL.combine(d, m, selectionMode(e)); commit('Zauberstab');
        return;
      }
      T = { kind: 'quick', src, mode: selectionMode(e) === 'subtract' ? 'subtract' : 'add', last: null };
      if (!d.selection || selectionMode(e) === 'new') { if (selectionMode(e) === 'new' && !e.shift && !e.alt && d.selection && !S.quickAdd) { /* bestehende erweitern */ } }
      quickSelectAt(d, p);
      return;
    }
    case 'crop': {
      if (sub === 'slice' || sub === 'frame') { T = { kind: 'rectTool', sub, a: p, b: p }; return; }
      return cropDown(d, e);
    }
    case 'eyedropper': {
      if (sub === 'sampler' || sub === 'count' || sub === 'note') {
        const list = sub === 'sampler' ? d.samplers : sub === 'count' ? d.counts : d.notes;
        const near = list.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 8 / d.zoom);
        if (e.alt) { if (near >= 0) { list.splice(near, 1); commit('Markierung löschen'); view.overlay(); } return; }
        if (near >= 0) { T = { kind: 'dragMark', list, i: near }; return; }
        if (sub === 'sampler' && list.length >= 10) { toast('Höchstens 10 Farbaufnahmepunkte'); return; }
        list.push(sub === 'note' ? { x: p.x, y: p.y, text: '' } : { x: p.x, y: p.y });
        if (sub === 'note') { S.ui.noteSel = list.length - 1; S.ui.panelTabs.props = 'notes'; S.ui.hiddenPanels.props = false; }
        if (sub === 'sampler') { S.ui.flyout = 'info'; }
        commit({ sampler: 'Farbaufnahme', count: 'Zählung', note: 'Anmerkung' }[sub]); view.overlay(); emit(); return;
      }
      if (sub === 'ruler') { T = { kind: 'measure', a: p }; S.measure = { a: p, b: p }; view.overlay(); emit(); return; }
      const c = sampleColor(d, p, S.eyedrop.allLayers, S.eyedrop.sample);
      if (c) { if (e.alt) setBg(c); else setFg(c); }
      T = { kind: 'eyedrop', bg: e.alt };
      return;
    }
    case 'heal': {
      if (sub === 'redeye') { redEye(d, p); return; }
      if (sub === 'patch' || sub === 'camove') {
        // In der Auswahl ziehen = verschieben; außerhalb = neue Lasso-Auswahl
        const inside = d.selection && ctx2d(d.selection).getImageData(Math.floor(clamp(p.x, 0, d.w - 1)), Math.floor(clamp(p.y, 0, d.h - 1)), 1, 1).data[3] > 100;
        if (inside) { T = { kind: 'patchDrag', sub, a: p, b: p }; return; }
        T = { kind: 'lasso', pts: [p], mode: selectionMode(e) }; return;
      }
      if (sub === 'remove') {
        if (!canEditPixels(d.layer)) return;
        const m = makeCanvas(d.w, d.h);
        T = { kind: 'removeStroke', mask: m, last: p };
        const x = ctx2d(m); x.fillStyle = '#ff2d55'; x.beginPath(); x.arc(p.x, p.y, S.heal.size / 2, 0, 7); x.fill();
        S.removeMask = m; view.request(); return;
      }
      if (sub === 'healing' && e.alt) { S.cloneSource = { ...p }; S.cloneOffset = null; toast('Quelle festgelegt'); return; }
      if (sub === 'healing' && !S.cloneSource) { toast('Alt + Klick, um eine Quelle festzulegen'); return; }
      if (sub === 'healing' && (!S.stampOpts.aligned || S.cloneOffset == null)) S.cloneOffset = { x: S.cloneSource.x - p.x, y: S.cloneSource.y - p.y };
      const st = beginStroke(d, e, 'heal'); if (!st) return;
      T = { kind: 'stroke', st }; strokeTo(st, p, 1); return;
    }
    case 'brush': {
      const kind = sub === 'pencil' ? 'pencil' : sub === 'replace' ? 'replace' : sub === 'mixer' ? 'mixer' : 'brush';
      const st = beginStroke(d, e, kind); if (!st) return;
      T = { kind: 'stroke', st };
      // Airbrush: Farbe baut sich auf, solange die Maus gedrückt bleibt
      if (S.brush.airbrush && kind === 'brush') st.air = setInterval(() => { if (!T || T.st !== st || !st.last) { clearInterval(st.air); return; } stampSym(st, st.last.x, st.last.y, st.lastPressure || 1); refreshStroke(st); }, 70);
      if (e.shift && S.lastPaintPoint) { st.last = { ...S.lastPaintPoint }; }
      strokeTo(st, p, e.pressure);
      return;
    }
    case 'stamp': {
      if (sub === 'clone' && e.alt) { S.cloneSource = { ...p }; S.cloneOffset = null; toast('Klonquelle festgelegt'); return; }
      const st = beginStroke(d, e, sub === 'pattern' ? 'pattern' : 'clone'); if (!st) return;
      T = { kind: 'stroke', st }; strokeTo(st, p, 1); return;
    }
    case 'history': {
      const st = beginStroke(d, e, 'history'); if (!st) return;
      T = { kind: 'stroke', st }; strokeTo(st, p, 1); return;
    }
    case 'eraser': {
      if (sub === 'magic') {
        const l = d.layer; if (!canEditPixels(l)) return;
        let m = SEL.floodMask(S.sel.sampleAll ? mergedCanvas(d) : l.canvas, p.x, p.y, S.eraser.tolerance, S.sel.contiguous);
        if (d.selection) { const mx = ctx2d(m); mx.globalCompositeOperation = 'destination-in'; mx.drawImage(d.selection, 0, 0); }
        const x = l.ctx; x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(m, 0, 0); x.restore();
        if (l.isBackground) { l.isBackground = false; l.lockPosition = false; l.name = 'Ebene 0'; }
        l.touch(); commit('Magischer Radiergummi'); return;
      }
      if (sub === 'background') {
        const l = d.layer; if (!canEditPixels(l)) return;
        if (l.isBackground) { l.isBackground = false; l.lockPosition = false; l.name = 'Ebene 0'; }
        T = { kind: 'bgerase', st: { d, layer: l, last: p } }; bgEraserDab(T.st, p); view.request(); return;
      }
      const st = beginStroke(d, e, 'eraser'); if (!st) return;
      T = { kind: 'stroke', st }; strokeTo(st, p, e.pressure); return;
    }
    case 'gradient': {
      if (sub === 'bucket') return bucketFill(d, p);
      const tgt = paintTarget(d); if (!tgt) return;
      T = { kind: 'gradient', a: p, b: p, tgt, before: cloneCanvas(tgt.canvas) };
      return;
    }
    case 'blur': {
      const l = d.layer; if (!canEditPixels(l)) return;
      T = { kind: 'retouch', mode: sub, st: { d, layer: l, last: p } };
      retouchAt(T, p); return;
    }
    case 'dodge': {
      const l = d.layer; if (!canEditPixels(l)) return;
      T = { kind: 'retouch', mode: sub, st: { d, layer: l, last: p } };
      retouchAt(T, p); return;
    }
    case 'pen': return penDown(d, e);
    case 'select': return pathSelectDown(d, e);
    case 'type': return typeDown(d, e);
    case 'shape': {
      const l = d.layer; void l;
      T = { kind: 'shape', a: p, b: p };
      return;
    }
    default:
  }
}

export function pointerMove(e) {
  const d = doc(); if (!d) return;
  const p = e.p;
  if (T && T.kind === 'poly') { T.hover = p; view.overlay(); return; }
  if (!T) return;
  switch (T.kind) {
    case 'pan': d.panX = T.px + (e.sx - T.sx); d.panY = T.py + (e.sy - T.sy); view.request(); break;
    case 'rotview': {
      let r = T.r0 + (Math.atan2(e.rsy - e.vh / 2, e.rsx - e.vw / 2) - T.a0) * 180 / Math.PI;
      if (e.shift) r = Math.round(r / 15) * 15;
      d.viewRot = ((Math.round(r) % 360) + 540) % 360 - 180; emit(); break;
    }
    case 'move': moveDrag(d, e); break;
    case 'move-multi': {
      let dx = Math.round(e.p.x - T.a.x), dy = Math.round(e.p.y - T.a.y);
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      T.dx = dx; T.dy = dy;
      for (const it of T.items) {
        const x = it.layer;
        if (it.before) { const c = ctx2d(x.canvas); c.clearRect(0, 0, d.w, d.h); c.drawImage(it.before, dx, dy); }
        if (it.mask) { const m = ctx2d(x.mask); m.clearRect(0, 0, d.w, d.h); m.drawImage(it.mask, dx, dy); }
        x.touch();
      }
      view.request();
      break;
    }
    case 'transform': transformDrag(e); break;
    case 'marquee': T.b = p; T.e = e; view.overlay(); break;
    case 'lasso': T.pts.push(p); view.overlay(); break;
    case 'quick': quickSelectAt(d, p); break;
    case 'crop': cropDrag(d, e); break;
    case 'measure': S.measure = { a: T.a, b: e.shift ? snapAngle(T.a, p) : p }; view.overlay(); emit(); break;
    case 'dragMark': T.list[T.i].x = p.x; T.list[T.i].y = p.y; T.moved = true; view.overlay(); emit(); break;
    case 'rectTool': case 'typeBox': case 'patchDrag': T.b = p; view.overlay(); break;
    case 'eyedrop': { const c = sampleColor(d, p, S.eyedrop.allLayers, S.eyedrop.sample); if (c) { if (T.bg) S.bg = c; else S.fg = c; emit(); } break; }
    case 'stroke': {
      const st = T.st;
      let q = p;
      if (e.shift && st.p0) { q = Math.abs(p.x - st.p0.x) > Math.abs(p.y - st.p0.y) ? { x: p.x, y: st.p0.y } : { x: st.p0.x, y: p.y }; }
      const sm = S.brush.smoothing || 0;
      if (sm > 0 && st.kind !== 'pencil') { st.smooth.x += (q.x - st.smooth.x) * (1 - sm * 0.85); st.smooth.y += (q.y - st.smooth.y) * (1 - sm * 0.85); q = { ...st.smooth }; }
      if (e.twist != null) st.penTwist = e.twist;
      strokeTo(st, q, e.pressure);
      break;
    }
    case 'removeStroke': {
      const x = ctx2d(T.mask); x.strokeStyle = '#ff2d55'; x.lineWidth = S.heal.size; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(T.last.x, T.last.y); x.lineTo(p.x, p.y); x.stroke(); T.last = p;
      view.overlay(); break;
    }
    case 'bgerase': interp(T.st, p, S.eraser.size * 0.25, (q) => bgEraserDab(T.st, q)); break;
    case 'retouch': interp(T.st, p, S.retouch.size * 0.2, (q) => retouchAt(T, q)); break;
    case 'gradient': {
      T.b = e.shift ? snapAngle(T.a, p) : p;
      const x = ctx2d(T.tgt.canvas);
      x.save(); x.clearRect(0, 0, d.w, d.h); x.drawImage(T.before, 0, 0);
      const g = makeCanvas(d.w, d.h); const gx = ctx2d(g);
      drawGradient(gx, d.w, d.h, T.a, T.b, S.gradient);
      if (d.selection && !S.ui.quickMask) { gx.globalCompositeOperation = 'destination-in'; gx.drawImage(d.selection, 0, 0); }
      x.globalAlpha = S.gradient.opacity;
      x.globalCompositeOperation = T.tgt.kind === 'mask' ? 'source-over' : (T.tgt.layer.lockAlpha ? 'source-atop' : gcoFor(S.gradient.mode));
      if (T.tgt.kind === 'mask') {
        // Verlauf als Maskenwerte: Luminanz → Alpha
        const id = gx.getImageData(0, 0, d.w, d.h);
        for (let i = 0; i < id.data.length; i += 4) { const v = (id.data[i] * 0.299 + id.data[i + 1] * 0.587 + id.data[i + 2] * 0.114) * id.data[i + 3] / 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = v; }
        gx.putImageData(id, 0, 0); x.clearRect(0, 0, d.w, d.h);
      }
      x.drawImage(g, 0, 0); x.restore();
      if (T.tgt.layer) T.tgt.layer.touch(); else d.selRev++;
      view.request();
      break;
    }
    case 'shape': T.b = p; T.e = e; view.overlay(); break;
    case 'pen': case 'pen-curv': penDrag(d, e); break;
    case 'pathsel': pathSelectDrag(d, e); break;
    case 'text-move': {
      const l = T.layer; l.text.x = T.tx + (p.x - T.a.x); l.text.y = T.ty + (p.y - T.a.y); renderTextLayer(l, d.w, d.h); view.request(); emit(); break;
    }
    default:
  }
}

export function pointerUp(e) {
  const d = doc(); if (!d || !T) return;
  const p = e.p;
  const t = T;
  if (t.kind === 'poly') return;
  T = null;
  switch (t.kind) {
    case 'pan': case 'rotview': emit(); break;
    case 'move': moveUp(d, t); break;
    case 'move-multi': {
      if (!t.dx && !t.dy) break;
      for (const it of t.items) {
        const x = it.layer;
        if (x.type === 'smart') { x.smart = { ...x.smart, t: shiftT(x.smart.t, t.dx, t.dy) }; renderSmartLayer(x, d.w, d.h); }
        else if (x.type === 'shape') { x.shape = { ...x.shape, x: x.shape.x + t.dx, y: x.shape.y + t.dy, parts: (x.shape.parts || []).map((q) => ({ ...q, x: q.x + t.dx, y: q.y + t.dy })) }; renderShapeLayer(x, d.w, d.h); }
        else if (x.type === 'text') { x.text.x += t.dx; x.text.y += t.dy; renderTextLayer(x, d.w, d.h); }
      }
      commit('Verschieben');
      break;
    }
    case 'transform': emit(); break;
    case 'marquee': {
      const r = norm(rectFrom(t.a, t.b, t.e || e, S.sel.ratio === 'free' ? null : Number(S.sel.ratio)));
      if (r.w < 1 || r.h < 1) {
        if (t.mode === 'new' && d.selection) { d.deselect(); commit('Auswahl aufheben'); }
        break;
      }
      if (t.artboard) {
        if (r.w < 20 || r.h < 20) break;
        import('./state.js').then((m) => m.ARTBOARDS.add(null, r.w, r.h, '#ffffff', r));
        break;
      }
      if (t.object) {
        // Objektauswahl: Motiv innerhalb des Rechtecks
        const src = mergedCanvas(d); const part = makeCanvas(r.w, r.h); ctx2d(part).drawImage(src, -r.x, -r.y);
        S.ui.busy = 'KI-Objektauswahl'; emit();
        import('./engine/ai.js').then((ai) => ai.aiSubjectMask(part, S.prefs.aiModel)).catch(() => SEL.selectSubject(part)).then((m) => {
          const c = makeCanvas(d.w, d.h); ctx2d(c).drawImage(m, r.x, r.y);
          SEL.combine(d, c, t.mode); S.ui.busy = null; commit('Objektauswahl');
        });
        break;
      }
      const ell = S.sub.marquee === 'ellipse';
      const c = SEL.shapeCanvas(d, (x) => { if (ell) { x.beginPath(); x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); x.fill(); } else x.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)); }, S.sel.feather);
      SEL.combine(d, c, t.mode); commit(ell ? 'Ellipsenauswahl' : 'Rechteckauswahl');
      break;
    }
    case 'lasso': T = t; finishLasso(d); break;
    case 'quick': commit('Schnellauswahl'); break;
    case 'crop': emit(); break;
    case 'measure': emit(); break;
    case 'dragMark': if (t.moved) commit('Markierung verschieben'); break;
    case 'patchDrag': {
      const dx = Math.round(t.b.x - t.a.x), dy = Math.round(t.b.y - t.a.y);
      if (!dx && !dy) break;
      import('./advanced.js').then((m) => (t.sub === 'patch' ? m.patchFrom(dx, dy) : m.contentAwareMove(dx, dy, S.heal.caMode === 'extend')));
      break;
    }
    case 'typeBox': {
      const r = norm({ x: t.a.x, y: t.a.y, w: t.b.x - t.a.x, h: t.b.y - t.a.y });
      if (r.w > 12 && r.h > 12) createTextLayer(d, { x: r.x, y: r.y }, { w: Math.round(r.w), h: Math.round(r.h) });
      else createTextLayer(d, t.a, null);
      break;
    }
    case 'rectTool': {
      const r = norm({ x: t.a.x, y: t.a.y, w: t.b.x - t.a.x, h: t.b.y - t.a.y });
      if (r.w < 4 || r.h < 4) break;
      const R = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      if (t.sub === 'slice') { d.slices.push({ ...R, name: `${d.name.replace(/\.[^.]+$/, '')}_${String(d.slices.length + 1).padStart(2, '0')}` }); commit('Slice erstellen'); }
      else makeFrame(d, R);
      view.overlay(); emit(); break;
    }
    case 'eyedrop': setFg(S.fg); break;
    case 'stroke': {
      if (t.st.air) { clearInterval(t.st.air); t.st.air = null; }
      S.lastPaintPoint = { ...p };
      const names = { brush: 'Pinsel', pencil: 'Buntstift', eraser: 'Radiergummi', clone: 'Kopierstempel', pattern: 'Musterstempel', history: 'Protokollpinsel', heal: 'Reparatur-Pinsel', replace: 'Farbe ersetzen' };
      if (S.ui.quickMask) { d.selRev++; view.request(); emit(); break; }
      commit(names[t.st.kind] || 'Malen');
      break;
    }
    case 'bgerase': commit('Hintergrund-Radiergummi'); break;
    case 'removeStroke': { const m = t.mask; import('./state.js').then((st) => st.EDIT.remove(m)).finally(() => { S.removeMask = null; view.overlay(); }); break; }
    case 'retouch': commit({ blur: 'Weichzeichner', sharpen: 'Scharfzeichner', smudge: 'Wischfinger', dodge: 'Abwedler', burn: 'Nachbelichter', sponge: 'Schwamm' }[t.mode]); break;
    case 'gradient': if (dist(t.a, t.b) > 1) commit('Verlauf'); break;
    case 'shape': finishShape(d, t, e); break;
    case 'pen': emit(); break;
    case 'pen-curv': commit('Ankerpunkt'); emit(); break;
    case 'pathsel': commit('Pfad bearbeiten'); break;
    case 'text-move': commit('Text verschieben'); break;
    default:
  }
  view.overlay();
}

export function cancelOp() {
  if (T && T.kind === 'poly') { T = null; view.overlay(); return true; }
  return false;
}
export function finishPoly() {
  const d = doc(); if (d && T && T.kind === 'poly') { finishLasso(d); return true; } return false;
}
export function currentOp() { return T; }

function interp(st, p, step, fn) {
  const a = st.last, len = dist(a, p);
  const n = Math.max(1, Math.floor(len / Math.max(1, step)));
  for (let i = 1; i <= n; i++) fn({ x: a.x + (p.x - a.x) * i / n, y: a.y + (p.y - a.y) * i / n });
  st.last = { ...p };
}

function snapAngle(a, p) {
  const ang = Math.atan2(p.y - a.y, p.x - a.x), r = dist(a, p);
  const s = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(s) * r, y: a.y + Math.sin(s) * r };
}

function finishLasso(d) {
  const t = T; T = null;
  if (!t || t.pts.length < 3) { view.overlay(); return; }
  const c = SEL.shapeCanvas(d, (x) => { x.beginPath(); t.pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); x.closePath(); x.fill(); }, S.sel.feather);
  SEL.combine(d, c, t.mode);
  commit(t.kind === 'poly' ? 'Polygon-Lasso' : 'Lasso');
}

function quickSelectAt(d, p) {
  const t = T;
  if (t.last && dist(t.last, p) < S.brush.size / 4) return;
  t.last = p;
  const r = S.brush.size * 2.5;
  // Flood-Fill in begrenztem Fenster
  const x0 = Math.max(0, Math.floor(p.x - r)), y0 = Math.max(0, Math.floor(p.y - r));
  const w = Math.min(d.w - x0, Math.ceil(r * 2)), h = Math.min(d.h - y0, Math.ceil(r * 2));
  if (w <= 0 || h <= 0) return;
  const part = makeCanvas(w, h); ctx2d(part).drawImage(t.src, -x0, -y0);
  const m = SEL.floodMask(part, p.x - x0, p.y - y0, Math.max(18, S.sel.tolerance), true);
  const full = makeCanvas(d.w, d.h); const fx = ctx2d(full);
  fx.drawImage(SEL.smooth(m, 1.5), x0, y0);
  if (!d.selection) d.setSelection(makeCanvas(d.w, d.h));
  SEL.combine(d, full, t.mode);
  view.overlay();
}

function redEye(d, p) {
  const l = d.layer; if (!canEditPixels(l)) return;
  localOp(d, l, p, S.brush.size * 2, (id, w, h, weight) => {
    const px = id.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const q = (j * w + i) * 4, wgt = weight(i, j); if (!wgt) continue;
      const r = px[q], g = px[q + 1], b = px[q + 2];
      if (r > 80 && r > g * 1.4 && r > b * 1.4) { const v = (g + b) / 2 * 0.8; px[q] = r + (v - r) * wgt; }
    }
  });
  commit('Rote-Augen-Werkzeug');
}

function retouchAt(t, p) {
  const { d, layer } = t.st;
  if (t.mode === 'blur') blurDab(d, layer, p, S.retouch.strength, false);
  else if (t.mode === 'sharpen') blurDab(d, layer, p, S.retouch.strength * 0.5, true);
  else if (t.mode === 'smudge') smudgeDab(t.st, p);
  else toneDab(d, layer, p, t.mode);
}

function bucketFill(d, p) {
  const l = d.layer; if (!canEditPixels(l)) return;
  const src = S.fill.sampleAll ? mergedCanvas(d) : l.canvas;
  const m = SEL.floodMask(src, p.x, p.y, S.fill.tolerance, S.fill.contiguous);
  const mx = ctx2d(m);
  if (d.selection) { mx.globalCompositeOperation = 'destination-in'; mx.drawImage(d.selection, 0, 0); }
  mx.globalCompositeOperation = 'source-in';
  mx.fillStyle = S.fill.source === 'pattern' ? mx.createPattern(patternCanvas(S.fill.pattern), 'repeat') : S.fg;
  mx.fillRect(0, 0, d.w, d.h);
  const x = l.ctx; x.save(); x.globalAlpha = S.fill.opacity; x.globalCompositeOperation = l.lockAlpha ? 'source-atop' : gcoFor(S.fill.mode);
  x.drawImage(m, 0, 0); x.restore(); l.touch();
  commit('Füllwerkzeug');
}

function finishShape(d, t, e) {
  const sub = S.sub.shape, o = S.shape;
  if (dist(t.a, t.b) < 2) return;
  const l = new Layer(d.w, d.h, ({ rect: 'Rechteck', rounded: 'Abgerundetes Rechteck', ellipse: 'Ellipse', triangle: 'Dreieck', polygon: 'Polygon', line: 'Linie', star: 'Stern', heart: 'Herz', blossom: 'Kirschblüte', arrow: 'Pfeil', speech: 'Sprechblase' })[sub] + ' ' + (d.layers.length));
  if (o.mode !== 'pixel') {
    // Vektor-Formebene (bleibt bearbeitbar)
    const b = sub === 'line' ? e.shift ? snapAngle(t.a, t.b) : t.b : null;
    const r = sub === 'line' ? { x: t.a.x, y: t.a.y, w: b.x - t.a.x, h: b.y - t.a.y } : rectFrom(t.a, t.b, t.e || e);
    l.type = 'shape';
    l.shape = { kind: sub, x: r.x, y: r.y, w: r.w, h: r.h, rot: 0, fillOn: o.fill, fillColor: S.fg, strokeOn: o.stroke, strokeColor: o.strokeColor, strokeWidth: o.strokeWidth, radius: o.radius, sides: o.sides, starInner: o.starInner, lineWidth: o.lineWidth, arrow: o.arrow };
    renderShapeLayer(l, d.w, d.h);
    d.addLayer(l);
    commit('Formebene');
    return;
  }
  const x = l.ctx;
  if (sub === 'line') drawLine(x, t.a, e.shift ? snapAngle(t.a, t.b) : t.b, o, S.fg);
  else {
    const r = rectFrom(t.a, t.b, t.e || e);
    shapePath(x, sub, r, o);
    if (o.fill) { x.fillStyle = S.fg; x.fill(); }
    if (o.stroke) { x.strokeStyle = o.strokeColor; x.lineWidth = o.strokeWidth; x.lineJoin = 'round'; x.stroke(); }
  }
  d.addLayer(l);
  commit('Form zeichnen');
}

export function shapePreview(x) {
  if (!T || T.kind !== 'shape') return;
  const sub = S.sub.shape, o = S.shape;
  if (sub === 'line') { drawLine(x, T.a, T.e && T.e.shift ? snapAngle(T.a, T.b) : T.b, o, S.fg); return; }
  const r = rectFrom(T.a, T.b, T.e || {});
  shapePath(x, sub, r, o);
  x.save();
  if (o.fill) { x.globalAlpha = 0.85; x.fillStyle = S.fg; x.fill(); }
  if (o.stroke) { x.globalAlpha = 1; x.strokeStyle = o.strokeColor; x.lineWidth = o.strokeWidth; x.stroke(); }
  x.restore();
}

// ---------- Verschieben ----------
function moveDown(d, e) {
  if (S.transform) return transformDown(e);
  let l = d.layer;
  if (S.move.autoSelect || e.ctrl) {
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const L2 = d.layers[i]; if (!L2.visible || !L2.hasPixels) continue;
      const px = ctx2d(L2.canvas).getImageData(clamp(Math.floor(e.p.x), 0, d.w - 1), clamp(Math.floor(e.p.y), 0, d.h - 1), 1, 1).data;
      if (px[3] > 10) { d.active = i; l = L2; emit(); break; }
    }
  }
  if (l.lockAll || l.lockPosition) { toast('Position ist fixiert 🔒'); return; }
  if (l.type === 'text' && !d.selection) {
    T = { kind: 'text-move', layer: l, a: e.p, tx: l.text.x, ty: l.text.y };
    return;
  }
  // Gruppen, Formen, Smart-Objekte, Einstellungsebenen: alle betroffenen Ebenen gemeinsam verschieben
  if (l.type === 'group' || l.type === 'shape' || l.type === 'smart' || l.type === 'adjust') {
    const targets = l.type === 'group' ? descendants(d.layers, l).filter((x) => x.type !== 'group') : [l];
    if (l.type === 'group' && l.mask) targets.push(l);
    const locked = targets.find((x) => x.lockAll || x.lockPosition);
    if (locked) { toast(`„${locked.name}“ ist fixiert 🔒`); return; }
    T = { kind: 'move-multi', a: e.p, dx: 0, dy: 0, items: targets.map((x) => ({ layer: x, before: x.hasPixels ? cloneCanvas(x.canvas) : null, mask: x.mask ? cloneCanvas(x.mask) : null })) };
    return;
  }
  const before = cloneCanvas(l.canvas);
  let float = null, base = before;
  if (d.selection) {
    if (e.alt) { /* Kopie verschieben */ }
    float = cloneCanvas(before); const fx = ctx2d(float); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(d.selection, 0, 0);
    if (!e.alt) { base = cloneCanvas(before); const bx = ctx2d(base); bx.globalCompositeOperation = 'destination-out'; bx.drawImage(d.selection, 0, 0); }
  }
  T = { kind: 'move', layer: l, before, base, float, a: e.p, sel: d.selection ? cloneCanvas(d.selection) : null, mask: l.mask ? cloneCanvas(l.mask) : null, dx: 0, dy: 0 };
}

function moveDrag(d, e) {
  let dx = Math.round(e.p.x - T.a.x), dy = Math.round(e.p.y - T.a.y);
  if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  // Einrasten an Hilfslinien / Mitte
  if (S.ui.snap && !T.float && !e.noSnap) {
    const b = T.bounds || (T.bounds = alphaBounds(T.before));
    if (b) {
      const snapPos = [0, d.w / 2, d.w, ...d.guides.filter((g) => g.dir === 'v').map((g) => g.pos)];
      const snapPosY = [0, d.h / 2, d.h, ...d.guides.filter((g) => g.dir === 'h').map((g) => g.pos)];
      const thr = 6 / (d.zoom || 1);
      for (const s of snapPos) for (const edge of [b.x, b.x + b.w / 2, b.x + b.w]) if (Math.abs(edge + dx - s) < thr) dx = Math.round(s - edge);
      for (const s of snapPosY) for (const edge of [b.y, b.y + b.h / 2, b.y + b.h]) if (Math.abs(edge + dy - s) < thr) dy = Math.round(s - edge);
    }
  }
  T.dx = dx; T.dy = dy;
  const l = T.layer, x = l.ctx;
  x.clearRect(0, 0, d.w, d.h);
  if (T.float) { x.drawImage(T.base, 0, 0); x.drawImage(T.float, dx, dy); }
  else x.drawImage(T.before, dx, dy);
  if (T.mask && !T.float) { const mx = ctx2d(l.mask); mx.clearRect(0, 0, d.w, d.h); mx.drawImage(T.mask, dx, dy); }
  if (T.sel) { const s = makeCanvas(d.w, d.h); ctx2d(s).drawImage(T.sel, dx, dy); d.selection = s; d.selRev++; }
  l.touch();
  view.request();
}

function moveUp(d, t) {
  if (!t.dx && !t.dy) return;
  commit('Verschieben');
}

export function nudge(dx, dy) {
  const d = doc(); if (!d) return;
  const l = d.layer; if (l.lockAll || l.lockPosition) return;
  if (l.type === 'text') { l.text.x += dx; l.text.y += dy; renderTextLayer(l, d.w, d.h); commit('Verschieben'); return; }
  T = null;
  moveDown(d, { p: { x: 0, y: 0 } });
  if (!T) return;
  if (T.kind === 'move-multi') { pointerMove({ p: { x: dx, y: dy } }); pointerUp({ p: { x: dx, y: dy } }); return; }
  moveDrag(d, { p: { x: dx, y: dy }, noSnap: true });
  T = null;
  commit('Verschieben');
}

// Ebenen ausrichten
export function alignLayer(how) {
  const d = doc(); if (!d) return;
  const l = d.layer; if (l.lockPosition || l.lockAll) return;
  const b = alphaBounds(l.canvas); if (!b) return;
  const ref = d.selection ? SEL.selectionBounds(d.selection) : { x: 0, y: 0, w: d.w, h: d.h };
  let dx = 0, dy = 0;
  if (how === 'left') dx = ref.x - b.x; if (how === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2); if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
  if (how === 'top') dy = ref.y - b.y; if (how === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2); if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
  const c = cloneCanvas(l.canvas); l.ctx.clearRect(0, 0, d.w, d.h); l.ctx.drawImage(c, Math.round(dx), Math.round(dy));
  if (l.text) { l.text.x += Math.round(dx); l.text.y += Math.round(dy); }
  l.touch(); commit('Ausrichten');
}

// ---------- Freies Transformieren: Griffe ----------
export function transformHandles(t) {
  const pts = [];
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  const map = (lx, ly) => ({ x: t.cx + lx * cos - ly * sin, y: t.cy + lx * sin + ly * cos });
  const hw = t.w * t.sx / 2, hh = t.h * t.sy / 2;
  for (const [hx, hy] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) pts.push({ hx, hy, ...map(hx * hw, hy * hh) });
  return pts;
}

function shiftT(t, dx, dy) {
  const n = { ...t, cx: t.cx + dx, cy: t.cy + dy };
  if (t.corners) n.corners = t.corners.map((q) => ({ x: q.x + dx, y: q.y + dy }));
  if (t.grid) n.grid = t.grid.map((r) => r.map((q) => ({ x: q.x + dx, y: q.y + dy })));
  return n;
}

// Bildschirmpunkt → unverformte Position (für neue Pins): Suche im Gitter
function meshInverse(t, p) {
  const base = bilinearMap(t.corners);
  const f = meshMapFor(t);
  let best = null, bd = Infinity;
  const N = 40;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const q = f(i / N, j / N); const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dd < bd) { bd = dd; best = [i / N, j / N]; }
  }
  if (!best) return null;
  const cell = Math.hypot(t.w * t.sx, t.h * t.sy) / N;
  if (Math.sqrt(bd) > cell * 2) return null;
  return base(best[0], best[1]);
}

export function meshPoints(t) {
  if (!t || !t.mesh) return [];
  if (t.mesh === 'warp') { const out = []; t.grid.forEach((r, j) => r.forEach((q, i) => out.push({ ...q, j, i }))); return out; }
  return t.corners.map((q, i) => ({ ...q, ci: i }));
}

function transformDown(e) {
  const t = S.transform; const p = e.p;
  if (t.mesh === 'puppet') {
    const tol = 10 / e.zoom;
    const idx = (t.pins || []).findIndex((pn) => dist(pn.q, p) < tol);
    if (idx >= 0 && e.alt) { t.pins.splice(idx, 1); renderTransform(); emit(); return; }
    if (idx >= 0) { T = { kind: 'transform', mode: 'pin', idx, a: p, q0: { ...t.pins[idx].q } }; return; }
    // neuen Pin an der ursprünglichen (unverformten) Position setzen
    const inv = meshInverse(t, p);
    if (!inv) { toast('Pins nur innerhalb des Motivs setzen'); return; }
    t.pins.push({ p: inv, q: { x: p.x, y: p.y } });
    renderTransform(); emit(); return;
  }
  if (t.mesh) {
    const tol = 9 / e.zoom;
    const hit = meshPoints(t).find((q) => dist(q, p) < tol);
    T = { kind: 'transform', mode: hit ? 'meshpt' : 'meshmove', hit, a: p, start: JSON.parse(JSON.stringify({ corners: t.corners, grid: t.grid })) };
    return;
  }
  const hs = transformHandles(t);
  const tol = 8 / e.zoom;
  const h = hs.find((q) => dist(q, p) < tol);
  const cos = Math.cos(-t.rot), sin = Math.sin(-t.rot);
  const lx = (p.x - t.cx) * cos - (p.y - t.cy) * sin, ly = (p.x - t.cx) * sin + (p.y - t.cy) * cos;
  const inside = Math.abs(lx) <= Math.abs(t.w * t.sx / 2) && Math.abs(ly) <= Math.abs(t.h * t.sy / 2);
  if (h) T = { kind: 'transform', mode: 'scale', h, start: { ...t } };
  else if (inside) T = { kind: 'transform', mode: 'move', a: p, start: { ...t } };
  else T = { kind: 'transform', mode: 'rotate', a: p, start: { ...t } };
}

function transformDrag(e) {
  const t = S.transform; const s = T.start; const p = e.p;
  if (T.mode === 'pin') {
    const pin = t.pins[T.idx]; if (!pin) return;
    pin.q = { x: T.q0.x + p.x - T.a.x, y: T.q0.y + p.y - T.a.y };
    renderTransform(); emit(); return;
  }
  if (T.mode === 'meshpt' || T.mode === 'meshmove') {
    const dx = p.x - T.a.x, dy = p.y - T.a.y;
    if (T.mode === 'meshmove') {
      if (t.corners && s.corners) t.corners = s.corners.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      if (t.grid && s.grid) t.grid = s.grid.map((r) => r.map((q) => ({ x: q.x + dx, y: q.y + dy })));
    } else if (t.mesh === 'warp') {
      const { i, j } = T.hit;
      t.grid[j][i] = { x: s.grid[j][i].x + dx, y: s.grid[j][i].y + dy };
      // Eckpunkte ziehen ihre Griffe mit (wie in Photoshop)
      if ((i === 0 || i === 3) && (j === 0 || j === 3)) {
        const ni = i === 0 ? 1 : 2, nj = j === 0 ? 1 : 2;
        for (const [jj, ii] of [[j, ni], [nj, i], [nj, ni]]) t.grid[jj][ii] = { x: s.grid[jj][ii].x + dx, y: s.grid[jj][ii].y + dy };
      }
    } else {
      const ci = T.hit.ci;
      t.corners[ci] = { x: s.corners[ci].x + dx, y: s.corners[ci].y + dy };
      if (t.mesh === 'perspective' && e.shift) {
        // Umschalt: gegenüberliegende Ecke symmetrisch bewegen
        const mirror = { 0: 1, 1: 0, 2: 3, 3: 2 }[ci];
        t.corners[mirror] = { x: s.corners[mirror].x - dx, y: s.corners[mirror].y + dy };
      }
    }
    renderTransform(); emit();
    return;
  }
  if (T.mode === 'move') { t.cx = s.cx + p.x - T.a.x; t.cy = s.cy + p.y - T.a.y; }
  else if (T.mode === 'rotate') {
    let a = s.rot + Math.atan2(p.y - s.cy, p.x - s.cx) - Math.atan2(T.a.y - s.cy, T.a.x - s.cx);
    if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    t.rot = a;
  } else {
    const { hx, hy } = T.h;
    const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
    const ux = (p.x - s.cx) * cos - (p.y - s.cy) * sin, uy = (p.x - s.cx) * sin + (p.y - s.cy) * cos;
    const ax = -hx * s.w * s.sx / 2, ay = -hy * s.h * s.sy / 2;
    let sx = s.sx, sy = s.sy;
    if (e.alt) { if (hx) sx = (ux * hx * 2) / s.w; if (hy) sy = (uy * hy * 2) / s.h; }
    else { if (hx) sx = ((ux - ax) * hx) / s.w; if (hy) sy = ((uy - ay) * hy) / s.h; }
    const prop = S.prefs.proportionalTransform !== false ? !e.shift : e.shift;
    if (prop && hx && hy) { const k = Math.max(Math.abs(sx / s.sx), Math.abs(sy / s.sy)); sx = Math.sign(sx) * Math.abs(s.sx) * k; sy = Math.sign(sy) * Math.abs(s.sy) * k; }
    let ncx = 0, ncy = 0;
    if (!e.alt) { if (hx) ncx = ax + hx * s.w * sx / 2; if (hy) ncy = ay + hy * s.h * sy / 2; }
    const c2 = Math.cos(s.rot), s2 = Math.sin(s.rot);
    t.cx = s.cx + ncx * c2 - ncy * s2; t.cy = s.cy + ncx * s2 + ncy * c2;
    t.sx = sx || 0.001; t.sy = sy || 0.001;
  }
  renderTransform();
  emit();
}

// ---------- Freistellen ----------
function cropDown(d, e) {
  const c = S.cropState || (S.cropState = { x: 0, y: 0, w: d.w, h: d.h });
  const p = e.p, tol = 10 / e.zoom;
  const r = norm(c);
  const hs = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]].map(([hx, hy]) => ({ hx, hy, x: r.x + (hx + 1) / 2 * r.w, y: r.y + (hy + 1) / 2 * r.h }));
  const h = hs.find((q) => dist(q, p) < tol);
  if (h) T = { kind: 'crop', mode: 'handle', h, r: { ...r } };
  else if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) T = { kind: 'crop', mode: 'move', a: p, r: { ...r } };
  else { T = { kind: 'crop', mode: 'new', a: p }; S.cropState = { x: p.x, y: p.y, w: 0, h: 0 }; }
}

function cropDrag(d, e) {
  const p = e.p; const ratio = S.crop.ratio === 'free' ? null : S.crop.ratio === 'orig' ? d.w / d.h : Number(S.crop.ratio);
  if (T.mode === 'new') { S.cropState = norm(rectFrom(T.a, p, { shift: e.shift }, ratio)); }
  else if (T.mode === 'move') { S.cropState = { ...T.r, x: T.r.x + p.x - T.a.x, y: T.r.y + p.y - T.a.y }; }
  else {
    const r = { ...T.r }; const { hx, hy } = T.h;
    let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    if (hx < 0) x0 = p.x; if (hx > 0) x1 = p.x; if (hy < 0) y0 = p.y; if (hy > 0) y1 = p.y;
    let nr = norm({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    if (ratio && hx && hy) { nr.h = nr.w / ratio; if (hy < 0) nr.y = r.y + r.h - nr.h; }
    S.cropState = nr;
  }
  view.overlay(); emit();
}

export function cropHandles() {
  const c = S.cropState; if (!c) return [];
  const r = norm(c);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]].map(([hx, hy]) => ({ x: r.x + (hx + 1) / 2 * r.w, y: r.y + (hy + 1) / 2 * r.h }));
}
export { applyCrop };

// ---------- Zeichenstift ----------
function penDown(d, e) {
  const p = e.p, tol = 8 / e.zoom;
  let path = d.paths[d.activePath];
  if (S.sub.pen === 'freeform') {
    path = { name: `Pfad ${d.paths.length + 1}`, points: [{ x: p.x, y: p.y }], closed: false };
    d.paths.push(path); d.activePath = d.paths.length - 1;
    T = { kind: 'pen', free: true, path };
    return;
  }
  if (!path || path.closed) {
    path = { name: `Pfad ${d.paths.length + 1}`, points: [], closed: false };
    d.paths.push(path); d.activePath = d.paths.length - 1;
  }
  if (path.points.length > 2 && dist(path.points[0], p) < tol) {
    path.closed = true; if (path.curvature) smoothPath(path); commit('Pfad schließen'); view.overlay(); return;
  }
  if (S.sub.pen === 'curvature') {
    // Rundungszeichenstift: Klick = Punkt, Kurven ergeben sich automatisch; Alt+Klick = Eckpunkt
    path.curvature = true;
    path.points.push({ x: p.x, y: p.y, corner: !!e.alt });
    smoothPath(path); T = { kind: 'pen-curv', path, pt: path.points[path.points.length - 1] };
    view.overlay(); emit(); return;
  }
  const pt = { x: p.x, y: p.y };
  path.points.push(pt);
  T = { kind: 'pen', pt, a: p };
  view.overlay(); emit();
}

// Glatte Bézier-Griffe (Catmull-Rom) für alle Punkte eines Rundungspfads
export function smoothPath(path) {
  const pts = path.points, n = pts.length;
  for (let i = 0; i < n; i++) {
    const pt = pts[i];
    const prev = pts[i - 1] || (path.closed ? pts[n - 1] : null), next = pts[i + 1] || (path.closed ? pts[0] : null);
    if (pt.corner || !prev || !next) { delete pt.ix; delete pt.iy; delete pt.ox; delete pt.oy; if (!pt.corner && (prev || next)) { const o = prev || next; const k = 1 / 3; if (!prev && next) { pt.ox = pt.x + (next.x - pt.x) * k; pt.oy = pt.y + (next.y - pt.y) * k; pt.ix = pt.x; pt.iy = pt.y; } else if (prev) { pt.ix = pt.x + (prev.x - pt.x) * k; pt.iy = pt.y + (prev.y - pt.y) * k; pt.ox = pt.x; pt.oy = pt.y; } void o; } continue; }
    const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
    pt.ix = pt.x - tx; pt.iy = pt.y - ty; pt.ox = pt.x + tx; pt.oy = pt.y + ty;
  }
}

function penDrag(d, e) {
  const p = e.p;
  if (T.kind === 'pen-curv') { T.pt.x = p.x; T.pt.y = p.y; smoothPath(T.path); view.overlay(); return; }
  if (T.free) {
    const pts = T.path.points; const last = pts[pts.length - 1];
    if (dist(last, p) > 4 / e.zoom) pts.push({ x: p.x, y: p.y });
    view.overlay(); return;
  }
  const pt = T.pt;
  pt.ox = p.x; pt.oy = p.y; pt.ix = 2 * pt.x - p.x; pt.iy = 2 * pt.y - p.y;
  view.overlay();
}

export function finishPath() {
  const d = doc(); if (!d) return;
  const p = d.paths[d.activePath];
  if (p && !p.closed) { commit('Pfad'); d.activePath = -1; view.overlay(); emit(); }
}

function pathSelectDown(d, e) {
  const p = e.p, tol = 8 / e.zoom;
  for (let pi = d.paths.length - 1; pi >= 0; pi--) {
    const path = d.paths[pi];
    for (const pt of path.points) {
      for (const [kx, ky] of [['x', 'y'], ['ix', 'iy'], ['ox', 'oy']]) {
        if (pt[kx] != null && dist({ x: pt[kx], y: pt[ky] }, p) < tol) { d.activePath = pi; T = { kind: 'pathsel', pt, kx, ky, a: p, sx: pt[kx], sy: pt[ky] }; emit(); return; }
      }
    }
  }
  const path = d.paths[d.activePath];
  if (path) T = { kind: 'pathsel', whole: path, a: p, orig: JSON.parse(JSON.stringify(path.points)) };
}

function pathSelectDrag(d, e) {
  const dx = e.p.x - T.a.x, dy = e.p.y - T.a.y;
  if (T.whole) {
    T.whole.points.forEach((pt, i) => { const o = T.orig[i]; for (const k of ['x', 'ix', 'ox']) if (o[k] != null) pt[k] = o[k] + dx; for (const k of ['y', 'iy', 'oy']) if (o[k] != null) pt[k] = o[k] + dy; });
  } else {
    const pt = T.pt;
    if (T.kx === 'x') {
      const ddx = T.sx + dx - pt.x, ddy = T.sy + dy - pt.y;
      pt.x += ddx; pt.y += ddy;
      if (pt.ix != null) { pt.ix += ddx; pt.iy += ddy; } if (pt.ox != null) { pt.ox += ddx; pt.oy += ddy; }
    } else { pt[T.kx] = T.sx + dx; pt[T.ky] = T.sy + dy; }
  }
  view.overlay();
}

// ---------- Text ----------
function typeDown(d, e) {
  const p = e.p;
  if (S.ui.textEdit) { finishTextEdit(); return; }
  // vorhandene Textebene anklicken
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const l = d.layers[i];
    if (l.type !== 'text' || !l.visible) continue;
    const b = textBounds(l);
    if (p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4) {
      d.active = i; S.ui.textEdit = { layerId: l.id, isNew: false };
      Object.assign(S.text, { font: l.text.font, size: l.text.size, bold: l.text.bold, italic: l.text.italic, align: l.text.align });
      S.text.color = l.text.color;
      emit(); view.request(); return;
    }
  }
  // Ziehen = Textrahmen (Absatztext), Klicken = Punkttext
  T = { kind: 'typeBox', a: p, b: p };
}

function createTextLayer(d, p, box) {
  const l = new Layer(d.w, d.h, box ? 'Absatztext' : 'Text');
  l.type = 'text';
  l.text = { content: '', x: p.x, y: box ? p.y : p.y - S.text.size * 0.8, box: box || null, font: S.text.font, size: S.text.size, color: S.text.color || S.fg, bold: S.text.bold, italic: S.text.italic, underline: S.text.underline, strike: S.text.strike, caps: S.text.caps, align: S.text.align, leading: S.text.leading, tracking: S.text.tracking, vertical: S.sub.type === 'v' };
  if (S.sub.type === 'v') l.text.leading = 1;
  if (box && l.text.align === 'center') l.text.align = 'left';
  d.addLayer(l);
  S.ui.textEdit = { layerId: l.id, isNew: true };
  emit(); view.request();
}

export function updateTextLayer(l, patch) {
  const d = doc(); if (!d) return;
  Object.assign(l.text, patch);
  if (l.text.vertical && patch.content != null) { /* Inhalt bleibt, vertikale Darstellung beim Rendern */ }
  renderTextLayerV(l, d.w, d.h);
  view.request(); emit();
}

export function renderTextLayerV(l, w, h) {
  if (l.text.vertical) {
    const orig = l.text.content;
    l.text.content = orig.split('\n').map((line) => line.split('').join('\n')).join('\n');
    renderTextLayer(l, w, h);
    l.text.content = orig;
  } else renderTextLayer(l, w, h);
}

// Für Overlay
export function opState() { return T; }
export { rectFrom, norm, L };

// Rahmenwerkzeug: Platzhalter-Ebene mit rechteckiger Maske; Bilder werden darin eingepasst
function makeFrame(d, r) {
  const l = new Layer(d.w, d.h, `Rahmen ${d.layers.filter((x) => x.frame).length + 1}`);
  l.frame = { ...r };
  const x = l.ctx; x.fillStyle = '#9aa0b4'; x.fillRect(r.x, r.y, r.w, r.h);
  x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(1, Math.min(r.w, r.h) / 200); x.beginPath(); x.moveTo(r.x, r.y); x.lineTo(r.x + r.w, r.y + r.h); x.moveTo(r.x + r.w, r.y); x.lineTo(r.x, r.y + r.h); x.stroke();
  l.mask = makeCanvas(d.w, d.h); const m = ctx2d(l.mask); m.fillStyle = '#fff'; m.fillRect(r.x, r.y, r.w, r.h); l.maskEnabled = true;
  d.addLayer(l); commit('Rahmen erstellen');
  toast('Rahmen erstellt – Bild per Ebene › Bild in Rahmen platzieren oder Drag & Drop einsetzen');
}
export function placeInFrame(img) {
  const d = doc(); const l = d && d.layer; if (!l || !l.frame) { toast('Zuerst eine Rahmen-Ebene auswählen'); return false; }
  const r = l.frame, k = Math.max(r.w / img.width, r.h / img.height), w = img.width * k, h = img.height * k;
  l.ctx.clearRect(0, 0, d.w, d.h); l.ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  l.touch(); view.request(); commit('Bild in Rahmen platzieren'); return true;
}
