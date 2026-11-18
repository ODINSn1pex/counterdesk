// Auswahl-Operationen (Auswahl = Canvas, Alpha = ausgewählt)
import { makeCanvas, ctx2d, cloneCanvas, clamp, hexToRgb } from './util.js';
import { cssFilter } from './filters.js';

export function combine(doc, shapeCanvas, mode = 'new') {
  const w = doc.w, h = doc.h;
  if (mode === 'new' || !doc.selection) {
    if (mode === 'subtract' || mode === 'intersect') { if (!doc.selection) return; }
    doc.setSelection(shapeCanvas);
    return;
  }
  const out = cloneCanvas(doc.selection);
  const x = ctx2d(out);
  if (mode === 'add') x.globalCompositeOperation = 'source-over';
  else if (mode === 'subtract') x.globalCompositeOperation = 'destination-out';
  else if (mode === 'intersect') x.globalCompositeOperation = 'destination-in';
  x.drawImage(shapeCanvas, 0, 0, w, h);
  doc.setSelection(out);
}

export function shapeCanvas(doc, drawFn, feather = 0, aa = true) {
  const c = makeCanvas(doc.w, doc.h);
  const x = ctx2d(c);
  x.fillStyle = '#fff';
  x.imageSmoothingEnabled = aa;
  drawFn(x);
  if (feather > 0) return cssFilter(c, `blur(${feather}px)`);
  return c;
}

export function isEmpty(sel) {
  if (!sel) return true;
  const d = ctx2d(sel).getImageData(0, 0, sel.width, sel.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 0) return false;
  return true;
}

// Zauberstab / Füllbereich
export function floodMask(srcCanvas, sx, sy, tolerance, contiguous = true) {
  const w = srcCanvas.width, h = srcCanvas.height;
  sx = Math.floor(sx); sy = Math.floor(sy);
  const out = makeCanvas(w, h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const d = ctx2d(srcCanvas).getImageData(0, 0, w, h).data;
  const o = ctx2d(out).createImageData(w, h);
  const od = o.data;
  const p0 = (sy * w + sx) * 4;
  const r0 = d[p0], g0 = d[p0 + 1], b0 = d[p0 + 2], a0 = d[p0 + 3];
  const tol = tolerance;
  const match = (p) => Math.abs(d[p] - r0) <= tol && Math.abs(d[p + 1] - g0) <= tol && Math.abs(d[p + 2] - b0) <= tol && Math.abs(d[p + 3] - a0) <= tol;
  if (!contiguous) {
    for (let p = 0; p < d.length; p += 4) if (match(p)) { od[p] = od[p + 1] = od[p + 2] = od[p + 3] = 255; }
  } else {
    const seen = new Uint8Array(w * h);
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop(); let x = stack.pop();
      let i = y * w + x;
      while (x >= 0 && !seen[i] && match(i * 4)) { x--; i--; }
      x++; i++;
      let up = false, down = false;
      while (x < w && !seen[i] && match(i * 4)) {
        seen[i] = 1; const p = i * 4; od[p] = od[p + 1] = od[p + 2] = od[p + 3] = 255;
        if (y > 0) { const j = i - w; if (!seen[j] && match(j * 4)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false; }
        if (y < h - 1) { const j = i + w; if (!seen[j] && match(j * 4)) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false; }
        x++; i++;
      }
    }
  }
  ctx2d(out).putImageData(o, 0, 0);
  return out;
}

export function colorRange(srcCanvas, hex, fuzz) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const { r, g, b } = hexToRgb(hex);
  const d = ctx2d(srcCanvas).getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h); const x = ctx2d(out);
  const o = x.createImageData(w, h);
  for (let p = 0; p < d.length; p += 4) {
    const dd = Math.hypot(d[p] - r, d[p + 1] - g, d[p + 2] - b);
    const a = clamp(255 * (1 - dd / (fuzz * 1.5 + 1)), 0, 255);
    o.data[p] = o.data[p + 1] = o.data[p + 2] = 255; o.data[p + 3] = a * (d[p + 3] / 255);
  }
  x.putImageData(o, 0, 0);
  return out;
}

// Motiv auswählen (heuristisch: Abstand zur Randfarbe)
export function selectSubject(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const d = ctx2d(srcCanvas).getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  const add = (x, y) => { const p = (y * w + x) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; };
  for (let x = 0; x < w; x += 4) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y += 4) { add(0, y); add(w - 1, y); }
  r /= n; g /= n; b /= n;
  let vs = 0;
  for (let x = 0; x < w; x += 4) { const p = x * 4; vs += Math.hypot(d[p] - r, d[p + 1] - g, d[p + 2] - b); }
  const thr = Math.max(40, (vs / (w / 4)) * 2.2);
  const out = makeCanvas(w, h); const x = ctx2d(out); const o = x.createImageData(w, h);
  for (let p = 0; p < d.length; p += 4) {
    const dd = Math.hypot(d[p] - r, d[p + 1] - g, d[p + 2] - b);
    if (dd > thr && d[p + 3] > 10) o.data[p] = o.data[p + 1] = o.data[p + 2] = o.data[p + 3] = 255;
  }
  x.putImageData(o, 0, 0);
  // Löcher schließen & glätten
  return threshold(cssFilter(cssFilter(out, 'blur(3px)'), 'none'), 90);
}

export function invert(doc) {
  const c = makeCanvas(doc.w, doc.h); const x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h);
  if (doc.selection) { x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.selection, 0, 0); }
  doc.setSelection(c);
}

function threshold(c, t) {
  const x = ctx2d(c);
  const id = x.getImageData(0, 0, c.width, c.height);
  for (let p = 3; p < id.data.length; p += 4) { const v = id.data[p] >= t ? 255 : 0; id.data[p - 3] = id.data[p - 2] = id.data[p - 1] = 255; id.data[p] = v; }
  x.putImageData(id, 0, 0);
  return c;
}

export function feather(sel, r) { return cssFilter(sel, `blur(${r}px)`); }
export function expand(sel, r) { return threshold(cssFilter(sel, `blur(${r / 2}px)`), 8); }
export function contract(sel, r) { return threshold(cssFilter(sel, `blur(${r / 2}px)`), 247); }
export function smooth(sel, r) { return threshold(cssFilter(sel, `blur(${r}px)`), 128); }
export function border(sel, r) {
  const a = expand(sel, r), b = contract(sel, r);
  const x = ctx2d(a); x.globalCompositeOperation = 'destination-out'; x.drawImage(b, 0, 0);
  return a;
}

// Ränder für "Marschierende Ameisen"
export function edgeCanvas(sel) {
  const w = sel.width, h = sel.height;
  const d = ctx2d(sel).getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h); const x = ctx2d(out); const o = x.createImageData(w, h);
  const on = (i) => d[i * 4 + 3] >= 128;
  let any = false;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const i = y * w + xx;
    if (!on(i)) continue;
    if (xx === 0 || yy0(y) || xx === w - 1 || y === h - 1 || !on(i - 1) || !on(i + 1) || !on(i - w) || !on(i + w)) {
      o.data[i * 4 + 3] = 255; any = true;
    }
  }
  function yy0(y) { return y === 0; }
  x.putImageData(o, 0, 0);
  return any ? out : null;
}

export function selectionBounds(sel) {
  const w = sel.width, h = sel.height, d = ctx2d(sel).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 0) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Wendet fn(canvas)->canvas auf Ebene an, beschränkt auf Auswahl
export function applyMasked(target, sel, resultCanvas) {
  const x = ctx2d(target);
  if (!sel) { x.clearRect(0, 0, target.width, target.height); x.drawImage(resultCanvas, 0, 0); return; }
  const r = cloneCanvas(resultCanvas);
  const rx = ctx2d(r); rx.globalCompositeOperation = 'destination-in'; rx.drawImage(sel, 0, 0);
  x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(sel, 0, 0); x.restore();
  x.drawImage(r, 0, 0);
}
