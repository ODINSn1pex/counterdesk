// Werkzeuge: Zeigerereignisse in Dokumentkoordinaten
import {
  S, doc, emit, view, commit, toast, canEditPixels, rasterize, setFg, setBg, gradientStops, patternCanvas,
  startTransform, renderTransform, applyTransform, applyCrop, finishTextEdit, drawStarPath, drawHeartPath, drawBlossom,
  VIEW, Layer, renderTextLayer, composite, SEL, L, maskColorIsReveal,
} from './state.js';
import { makeCanvas, ctx2d, cloneCanvas, clamp, dist, hexToRgb, rgbToHex, alphaBounds, rgbToHsl, hslToRgb } from './engine/util.js';
import { gcoFor, textBounds } from './engine/doc.js';

let T = null; // aktueller Zeiger-Vorgang
const SPACE = { held: false };
export { SPACE };

// ---------- Hilfen ----------
function mergedCanvas(d) {
  const c = makeCanvas(d.w, d.h);
  composite({ ...d, channelView: null }, c, { noChannels: true });
  return c;
}

export function sampleColor(d, p, all = true, size = 1) {
  const src = all ? mergedCanvas(d) : d.layer.canvas;
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
  if (shape === 'square') { x.fillStyle = color; x.fillRect(-r, -r, size, size); }
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
    st.src = S.stampOpts.sampleAll ? mergedCanvas(d) : cloneCanvas(d.layer.canvas);
  }
  if (kind === 'heal') st.src = cloneCanvas(d.layer.canvas);
  if (kind === 'history') {
    const h = d.history[d.historySource ?? 0];
    const entry = h && h.state.layers.find((x) => x.id === d.layer.id);
    if (!entry) { toast('Keine Protokollquelle für diese Ebene'); return null; }
    st.src = entry.canvas;
  }
  if (kind === 'pattern') st.pat = patternCanvas(S.stampOpts.pattern);
  if (tgt.kind === 'mask') {
    st.reveal = kind === 'eraser' ? !maskColorIsReveal() : maskColorIsReveal();
    st.color = '#ffffff';
  } else st.color = kind === 'eraser' && tgt.layer.isBackground ? S.bg : S.fg;
  return st;
}

function stampDab(st, x, y, pressure = 1) {
  const o = st.o;
  let size = o.size * pressure;
  if (o.jitter) size *= 1 - Math.random() * o.jitter;
  if (o.scatter) { x += (Math.random() - 0.5) * o.scatter * o.size * 2; y += (Math.random() - 0.5) * o.scatter * o.size * 2; }
  const sx = st.stroke; const x2 = ctx2d(sx);
  const kind = st.kind;
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
    x2.globalAlpha = o.flow;
    x2.drawImage(tmp, ox, oy);
    x2.globalAlpha = 1;
    return;
  }
  const dab = dabCanvas(size, hard, st.color, shape, o.angle, o.roundness);
  x2.globalAlpha = o.flow;
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
  const spacing = Math.max(0.5, o.size * (o.spacing || 0.12));
  if (!st.last) { stampDab(st, p.x, p.y, pressure); st.last = { ...p }; refreshStroke(st); return; }
  const dx = p.x - st.last.x, dy = p.y - st.last.y, len = Math.hypot(dx, dy);
  let t = spacing - st.residue;
  while (t <= len) {
    stampDab(st, st.last.x + dx * t / len, st.last.y + dy * t / len, pressure);
    t += spacing;
  }
  st.residue = len - (t - spacing);
  st.last = { ...p };
  refreshStroke(st);
}

function refreshStroke(st) {
  const d = st.d, t = st.tgt;
  const x = ctx2d(t.canvas);
  let stroke = st.stroke;
  const sel = d.selection && !S.ui.quickMask ? d.selection : null;
  if (sel || (t.layer && t.layer.lockAlpha && t.kind === 'pixels')) {
    stroke = cloneCanvas(st.stroke);
    const sx = ctx2d(stroke);
    sx.globalCompositeOperation = 'destination-in';
    if (sel) sx.drawImage(sel, 0, 0);
    if (t.layer && t.layer.lockAlpha && t.kind === 'pixels') sx.drawImage(st.before, 0, 0);
  }
  x.save();
  x.clearRect(0, 0, t.canvas.width, t.canvas.height);
  x.drawImage(st.before, 0, 0);
  x.globalAlpha = st.o.opacity;
  if (t.kind === 'mask') x.globalCompositeOperation = st.reveal ? 'source-over' : 'destination-out';
  else if (st.kind === 'eraser' && !t.layer.isBackground) x.globalCompositeOperation = 'destination-out';
  else if (st.kind === 'replace') x.globalCompositeOperation = 'color';
  else x.globalCompositeOperation = t.layer.lockAlpha ? 'source-atop' : gcoFor(st.o.mode || 'normal');
  if (st.kind === 'replace') {
    // Farbe ersetzen: nur deckende Pixel einfärben
    const s2 = cloneCanvas(stroke); const s2x = ctx2d(s2); s2x.globalCompositeOperation = 'destination-in'; s2x.drawImage(st.before, 0, 0); stroke = s2;
  }
  x.drawImage(stroke, 0, 0);
  x.restore();
  if (t.layer) t.layer.touch();
  if (t.kind === 'mask' && !t.layer) d.selRev++;
  view.request();
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
  const c = sampleColor({ ...d, layers: [layer] }, p, false, 1) || '#000000';
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
export function shapePath(x, kind, r, o) {
  const { x: X, y: Y, w: W, h: H } = r;
  x.beginPath();
  if (kind === 'rect') x.rect(X, Y, W, H);
  else if (kind === 'rounded') x.roundRect(X, Y, W, H, Math.min(o.radius, Math.abs(W) / 2, Math.abs(H) / 2));
  else if (kind === 'ellipse') x.ellipse(X + W / 2, Y + H / 2, Math.abs(W / 2), Math.abs(H / 2), 0, 0, Math.PI * 2);
  else if (kind === 'triangle') { x.moveTo(X + W / 2, Y); x.lineTo(X + W, Y + H); x.lineTo(X, Y + H); x.closePath(); }
  else if (kind === 'polygon') {
    for (let i = 0; i < o.sides; i++) { const a = (i / o.sides) * Math.PI * 2 - Math.PI / 2; x.lineTo(X + W / 2 + Math.cos(a) * W / 2, Y + H / 2 + Math.sin(a) * H / 2); }
    x.closePath();
  } else if (kind === 'star') {
    for (let i = 0; i < o.sides * 2; i++) { const a = (i / (o.sides * 2)) * Math.PI * 2 - Math.PI / 2, k = i % 2 ? o.starInner : 1; x.lineTo(X + W / 2 + Math.cos(a) * W / 2 * k, Y + H / 2 + Math.sin(a) * H / 2 * k); }
    x.closePath();
  } else if (kind === 'heart') { drawHeartPath(x, X, Y, W, H); }
  else if (kind === 'blossom') {
    const cx = X + W / 2, cy = Y + H / 2, rr = Math.min(Math.abs(W), Math.abs(H)) / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      x.moveTo(cx, cy);
      x.ellipse(cx + Math.cos(a) * rr * 0.5, cy + Math.sin(a) * rr * 0.5, rr * 0.5, rr * 0.32, a, 0, Math.PI * 2);
    }
  } else if (kind === 'arrow') {
    const hw = H * 0.5;
    x.moveTo(X, Y + H * 0.3); x.lineTo(X + W * 0.6, Y + H * 0.3); x.lineTo(X + W * 0.6, Y); x.lineTo(X + W, Y + hw); x.lineTo(X + W * 0.6, Y + H); x.lineTo(X + W * 0.6, Y + H * 0.7); x.lineTo(X, Y + H * 0.7); x.closePath();
  } else if (kind === 'speech') {
    x.roundRect(X, Y, W, H * 0.78, Math.min(Math.abs(W), Math.abs(H)) * 0.15);
    x.moveTo(X + W * 0.2, Y + H * 0.75); x.lineTo(X + W * 0.15, Y + H); x.lineTo(X + W * 0.4, Y + H * 0.75);
  }
}

function drawLine(x, a, b, o, color) {
  x.save(); x.strokeStyle = color; x.fillStyle = color; x.lineWidth = o.lineWidth; x.lineCap = 'round';
  x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
  if (o.arrow) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), s = o.lineWidth * 4;
    x.beginPath(); x.moveTo(b.x, b.y); x.lineTo(b.x - Math.cos(ang - 0.45) * s, b.y - Math.sin(ang - 0.45) * s);
    x.lineTo(b.x - Math.cos(ang + 0.45) * s, b.y - Math.sin(ang + 0.45) * s); x.closePath(); x.fill();
  }
  x.restore();
}

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
  if (e.alt && (tool === 'brush' || tool === 'gradient' || (tool === 'shape'))) {
    const c = sampleColor(d, p, true, 1); if (c) setFg(c); return;
  }

  switch (tool) {
    case 'view':
      if (sub === 'zoom' && !SPACE.held) { VIEW.zoomBy(e.alt ? 1 / 1.5 : 1.5, e.cx, e.cy); return; }
      T = { kind: 'pan', sx: e.sx, sy: e.sy, px: d.panX, py: d.panY };
      return;
    case 'move': return moveDown(d, e);
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
    case 'crop': return cropDown(d, e);
    case 'eyedropper': {
      if (sub === 'ruler') { T = { kind: 'measure', a: p }; S.measure = { a: p, b: p }; view.overlay(); emit(); return; }
      const c = sampleColor(d, p, S.eyedrop.allLayers, S.eyedrop.sample);
      if (c) { if (e.alt) setBg(c); else setFg(c); }
      T = { kind: 'eyedrop', bg: e.alt };
      return;
    }
    case 'heal': {
      if (sub === 'redeye') { redEye(d, p); return; }
      if (sub === 'healing' && e.alt) { S.cloneSource = { ...p }; S.cloneOffset = null; toast('Quelle festgelegt'); return; }
      if (sub === 'healing' && !S.cloneSource) { toast('Alt + Klick, um eine Quelle festzulegen'); return; }
      if (sub === 'healing' && (!S.stampOpts.aligned || S.cloneOffset == null)) S.cloneOffset = { x: S.cloneSource.x - p.x, y: S.cloneSource.y - p.y };
      const st = beginStroke(d, e, 'heal'); if (!st) return;
      T = { kind: 'stroke', st }; strokeTo(st, p, 1); return;
    }
    case 'brush': {
      const kind = sub === 'pencil' ? 'pencil' : sub === 'replace' ? 'replace' : 'brush';
      const st = beginStroke(d, e, kind); if (!st) return;
      T = { kind: 'stroke', st };
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
    case 'move': moveDrag(d, e); break;
    case 'transform': transformDrag(e); break;
    case 'marquee': T.b = p; T.e = e; view.overlay(); break;
    case 'lasso': T.pts.push(p); view.overlay(); break;
    case 'quick': quickSelectAt(d, p); break;
    case 'crop': cropDrag(d, e); break;
    case 'measure': S.measure = { a: T.a, b: e.shift ? snapAngle(T.a, p) : p }; view.overlay(); emit(); break;
    case 'eyedrop': { const c = sampleColor(d, p, S.eyedrop.allLayers, S.eyedrop.sample); if (c) { if (T.bg) S.bg = c; else S.fg = c; emit(); } break; }
    case 'stroke': {
      const st = T.st;
      let q = p;
      if (e.shift && st.p0) { q = Math.abs(p.x - st.p0.x) > Math.abs(p.y - st.p0.y) ? { x: p.x, y: st.p0.y } : { x: st.p0.x, y: p.y }; }
      const sm = S.brush.smoothing || 0;
      if (sm > 0 && st.kind !== 'pencil') { st.smooth.x += (q.x - st.smooth.x) * (1 - sm * 0.85); st.smooth.y += (q.y - st.smooth.y) * (1 - sm * 0.85); q = { ...st.smooth }; }
      strokeTo(st, q, e.pressure);
      break;
    }
    case 'bgerase': interp(T.st, p, S.eraser.size * 0.25, (q) => bgEraserDab(T.st, q)); view.request(); break;
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
    case 'pen': penDrag(d, e); break;
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
    case 'pan': emit(); break;
    case 'move': moveUp(d, t); break;
    case 'transform': emit(); break;
    case 'marquee': {
      const r = norm(rectFrom(t.a, t.b, t.e || e, S.sel.ratio === 'free' ? null : Number(S.sel.ratio)));
      if (r.w < 1 || r.h < 1) {
        if (t.mode === 'new' && d.selection) { d.deselect(); commit('Auswahl aufheben'); }
        break;
      }
      if (t.object) {
        // Objektauswahl: Motiv innerhalb des Rechtecks
        const src = mergedCanvas(d); const part = makeCanvas(r.w, r.h); ctx2d(part).drawImage(src, -r.x, -r.y);
        const m = SEL.selectSubject(part); const c = makeCanvas(d.w, d.h); ctx2d(c).drawImage(m, r.x, r.y);
        SEL.combine(d, c, t.mode); commit('Objektauswahl'); break;
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
    case 'eyedrop': setFg(S.fg); break;
    case 'stroke': {
      S.lastPaintPoint = { ...p };
      const names = { brush: 'Pinsel', pencil: 'Buntstift', eraser: 'Radiergummi', clone: 'Kopierstempel', pattern: 'Musterstempel', history: 'Protokollpinsel', heal: 'Reparatur-Pinsel', replace: 'Farbe ersetzen' };
      if (S.ui.quickMask) { d.selRev++; view.request(); emit(); break; }
      commit(names[t.st.kind] || 'Malen');
      break;
    }
    case 'bgerase': commit('Hintergrund-Radiergummi'); break;
    case 'retouch': commit({ blur: 'Weichzeichner', sharpen: 'Scharfzeichner', smudge: 'Wischfinger', dodge: 'Abwedler', burn: 'Nachbelichter', sponge: 'Schwamm' }[t.mode]); break;
    case 'gradient': if (dist(t.a, t.b) > 1) commit('Verlauf'); break;
    case 'shape': finishShape(d, t, e); break;
    case 'pen': emit(); break;
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
  view.request();
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
      const L2 = d.layers[i]; if (!L2.visible) continue;
      const px = ctx2d(L2.canvas).getImageData(clamp(Math.floor(e.p.x), 0, d.w - 1), clamp(Math.floor(e.p.y), 0, d.h - 1), 1, 1).data;
      if (px[3] > 10) { d.active = i; l = L2; emit(); break; }
    }
  }
  if (l.lockAll || l.lockPosition) { toast('Position ist fixiert 🔒'); return; }
  if (l.type === 'text' && !d.selection) {
    T = { kind: 'text-move', layer: l, a: e.p, tx: l.text.x, ty: l.text.y };
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
  if (S.ui.snap && !T.float) {
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
  moveDrag(d, { p: { x: dx, y: dy } });
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

function transformDown(e) {
  const t = S.transform; const p = e.p;
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
    if (e.shift && hx && hy) { const k = Math.max(Math.abs(sx / s.sx), Math.abs(sy / s.sy)); sx = Math.sign(sx) * Math.abs(s.sx) * k; sy = Math.sign(sy) * Math.abs(s.sy) * k; }
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
    path.closed = true; commit('Pfad schließen'); return;
  }
  const pt = { x: p.x, y: p.y };
  path.points.push(pt);
  T = { kind: 'pen', pt, a: p };
  view.overlay(); emit();
}

function penDrag(d, e) {
  const p = e.p;
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
  const l = new Layer(d.w, d.h, 'Text');
  l.type = 'text';
  l.text = { content: '', x: p.x, y: p.y - S.text.size * 0.8, font: S.text.font, size: S.text.size, color: S.text.color || S.fg, bold: S.text.bold, italic: S.text.italic, underline: S.text.underline, strike: S.text.strike, caps: S.text.caps, align: S.text.align, leading: S.text.leading, tracking: S.text.tracking, vertical: S.sub.type === 'v' };
  if (S.sub.type === 'v') l.text.leading = 1;
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
