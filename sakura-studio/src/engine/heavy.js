// Rechenintensive Bildoperationen (laufen im Filter-Worker)
const mk = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true });

// ---------- Inhaltsbasiert skalieren (Seam Carving) ----------
function transpose(px, W, H) {
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (y * W + x) * 4, d = (x * H + y) * 4; out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]; }
  return out;
}
function transposeMask(m, W, H) { if (!m) return null; const o = new Uint8Array(m.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[x * H + y] = m[y * W + x]; return o; }

// Spaltenweise: liefert neues RGBA-Array mit Breite newW
function carveWidth(px, W, H, newW, protect) {
  // Arbeitsdaten: Luminanz, Index-Zuordnung auf Originalspalten
  let cur = W;
  const lum = new Float32Array(W * H), idx = new Int32Array(W * H), prot = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { lum[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114 + (255 - px[i * 4 + 3]) * 0.3; idx[i] = i % W; prot[i] = protect ? protect[i] / 255 * 1e5 : 0; }
  const energy = new Float32Array(W * H), M = new Float32Array(W * H), seam = new Int32Array(H);
  const en = (x, y) => {
    const r = y * W;
    const l = lum[r + (x > 0 ? x - 1 : x)], rr = lum[r + (x < cur - 1 ? x + 1 : x)];
    const u = lum[(y > 0 ? y - 1 : y) * W + x], d = lum[(y < H - 1 ? y + 1 : y) * W + x];
    return Math.abs(l - rr) + Math.abs(u - d) + prot[r + x];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) energy[y * W + x] = en(x, y);
  const target = Math.max(1, Math.min(newW, W));
  const removed = []; // für Vergrößerung: Originalspalten der Nähte
  const steps = newW < W ? W - newW : Math.min(newW - W, W - 1);
  for (let k = 0; k < steps; k++) {
    // dynamische Programmierung
    for (let x = 0; x < cur; x++) M[x] = energy[x];
    for (let y = 1; y < H; y++) {
      const r = y * W, p = r - W;
      for (let x = 0; x < cur; x++) {
        let m = M[p + x];
        if (x > 0 && M[p + x - 1] < m) m = M[p + x - 1];
        if (x < cur - 1 && M[p + x + 1] < m) m = M[p + x + 1];
        M[r + x] = energy[r + x] + m;
      }
    }
    let bx = 0, r = (H - 1) * W;
    for (let x = 1; x < cur; x++) if (M[r + x] < M[r + bx]) bx = x;
    seam[H - 1] = bx;
    for (let y = H - 2; y >= 0; y--) {
      const rr = y * W; let nx = bx;
      if (bx > 0 && M[rr + bx - 1] < M[rr + nx]) nx = bx - 1;
      if (bx < cur - 1 && M[rr + bx + 1] < M[rr + nx]) nx = bx + 1;
      bx = nx; seam[y] = bx;
    }
    const rec = new Int32Array(H);
    for (let y = 0; y < H; y++) {
      const rr = y * W, sx = seam[y];
      rec[y] = idx[rr + sx];
      lum.copyWithin(rr + sx, rr + sx + 1, rr + cur); idx.copyWithin(rr + sx, rr + sx + 1, rr + cur);
      energy.copyWithin(rr + sx, rr + sx + 1, rr + cur); prot.copyWithin(rr + sx, rr + sx + 1, rr + cur);
    }
    removed.push(rec);
    cur--;
    for (let y = 0; y < H; y++) { const sx = seam[y]; for (let x = Math.max(0, sx - 1); x <= Math.min(cur - 1, sx); x++) energy[y * W + x] = en(x, y); }
  }
  if (newW < W) {
    const out = new Uint8ClampedArray(target * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < target; x++) { const s = (y * W + idx[y * W + x]) * 4, d = (y * target + x) * 4; out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]; }
    return { px: out, W: target };
  }
  // Vergrößern: die günstigsten Nähte (in Originalkoordinaten) verdoppeln
  const add = newW - W, NW = W + Math.min(add, steps);
  const out = new Uint8ClampedArray(NW * H * 4);
  for (let y = 0; y < H; y++) {
    const dup = new Uint8Array(W);
    for (const rec of removed) dup[rec[y]]++;
    let o = 0;
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      for (let k = 0; k <= dup[x] && o < NW; k++) {
        const d = (y * NW + o) * 4;
        if (k > 0) { const s2 = (y * W + Math.min(W - 1, x + 1)) * 4; for (let c = 0; c < 4; c++) out[d + c] = (px[s + c] + px[s2 + c]) >> 1; }
        else for (let c = 0; c < 4; c++) out[d + c] = px[s + c];
        o++;
      }
    }
  }
  return { px: out, W: NW };
}

export function seamCarve(src, { w, h, protect }) {
  const W = src.width, H = src.height;
  let px = ctxOf(src).getImageData(0, 0, W, H).data, cw = W, ch = H, prot = protect || null;
  let guard = 0;
  while (cw !== w && guard++ < 8) { const r = carveWidth(px, cw, ch, w, prot); prot = null; px = r.px; cw = r.W; }
  if (ch !== h) {
    px = transpose(px, cw, ch);
    let tw = ch, th = cw; guard = 0;
    let tp = protect && cw === W ? transposeMask(protect, cw, ch) : null;
    while (tw !== h && guard++ < 8) { const r = carveWidth(px, tw, th, h, tp); tp = null; px = r.px; tw = r.W; }
    px = transpose(px, tw, th); ch = tw;
  }
  const out = mk(cw, ch); ctxOf(out).putImageData(new ImageData(px, cw, ch), 0, 0);
  return out;
}

// ---------- Hochwertiges Vergrößern (Interpolation in Stufen + Nachschärfen, kein KI-Modell) ----------
export function upscale(src, { scale = 2, sharpen = 0.6 }) {
  let c = src, cw = src.width, ch = src.height;
  const tw = Math.round(src.width * scale), th = Math.round(src.height * scale);
  while (cw < tw || ch < th) {
    const nw = Math.min(tw, cw * 2), nh = Math.min(th, ch * 2);
    const n = mk(nw, nh), x = n.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, nw, nh);
    c = n; cw = nw; ch = nh;
  }
  if (sharpen > 0) {
    // Unscharf maskieren mit kleinem Radius
    const x = ctxOf(c), id = x.getImageData(0, 0, cw, ch), d = id.data;
    const b = mk(cw, ch), bx = b.getContext('2d'); bx.filter = `blur(${Math.max(0.6, scale * 0.45)}px)`; bx.drawImage(c, 0, 0);
    const bd = ctxOf(b).getImageData(0, 0, cw, ch).data;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) { const v = d[i + k] + (d[i + k] - bd[i + k]) * sharpen; d[i + k] = v < 0 ? 0 : v > 255 ? 255 : v; }
    x.putImageData(id, 0, 0);
  }
  return c;
}

export const HEAVY = {
  seamCarve: { apply: seamCarve },
  upscale: { apply: upscale },
};
