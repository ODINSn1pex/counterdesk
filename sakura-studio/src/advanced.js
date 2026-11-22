// Erweiterte Funktionen: Ausbessern, inhaltsbasiert verschieben/skalieren, generativ erweitern,
// Himmel austauschen, Hochskalieren, Ebenen ausrichten/überblenden, Panorama, HDR, Exporte
import {
  S, doc, emit, view, commit, toast, askForm, canEditPixels, IMAGE, SEL, Layer, inpaintCanvas, exportSet,
  newDocFromCanvas, flattenToCanvas,
} from './state.js';
import { makeCanvas, ctx2d, cloneCanvas, alphaBounds, canvasToBytes } from './engine/util.js';
import { runFilter } from './engine/filterRunner.js';
import { renderLayerAlone } from './engine/doc.js';

// Die letzten n Protokollschritte zu einem zusammenfassen (z. B. Arbeitsfläche + Füllen)
function squash(n, name) {
  const d = doc(); if (!d || n < 2) return;
  const keep = d.history[d.histIdx];
  d.history.splice(d.histIdx - n + 1, n, { ...keep, name: name || keep.name });
  d.histIdx -= n - 1; emit();
}
const busy = (m) => { S.ui.busy = m; emit(); };
const idle = () => { S.ui.busy = null; emit(); view.request(); };
const lumA = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

// ---------- Nahtloses Einfügen (Push-Pull-Membran: Farbunterschied am Rand glatt nach innen) ----------
function pushPull(val, wgt, w, h) {
  if (w <= 1 && h <= 1) return;
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2);
  const v2 = new Float32Array(w2 * h2 * 3), g2 = new Float32Array(w2 * h2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, g = wgt[i]; if (!g) continue;
    const j = (y >> 1) * w2 + (x >> 1);
    g2[j] += g; v2[j * 3] += val[i * 3] * g; v2[j * 3 + 1] += val[i * 3 + 1] * g; v2[j * 3 + 2] += val[i * 3 + 2] * g;
  }
  for (let j = 0; j < w2 * h2; j++) if (g2[j] > 0) { v2[j * 3] /= g2[j]; v2[j * 3 + 1] /= g2[j]; v2[j * 3 + 2] /= g2[j]; g2[j] = Math.min(1, g2[j]); }
  pushPull(v2, g2, w2, h2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, g = wgt[i]; if (g >= 1) continue;
    // bilinear aus der gröberen Stufe
    const fx = Math.min(w2 - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(h2 - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w2 - 1, x0 + 1), y1 = Math.min(h2 - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < 3; c++) {
      const v = (v2[(y0 * w2 + x0) * 3 + c] * (1 - ax) + v2[(y0 * w2 + x1) * 3 + c] * ax) * (1 - ay) + (v2[(y1 * w2 + x0) * 3 + c] * (1 - ax) + v2[(y1 * w2 + x1) * 3 + c] * ax) * ay;
      val[i * 3 + c] = val[i * 3 + c] * g + v * (1 - g);
    }
    wgt[i] = 1;
  }
}
// src (gleich groß wie das Ziel, bereits ausgerichtet) innerhalb mask nahtlos in dstCanvas einsetzen
export function seamlessInto(dstCanvas, src, mask, colorMatch = true) {
  const W = dstCanvas.width, H = dstCanvas.height;
  const b = alphaBounds(mask, 8); if (!b) return;
  const pad = 3;
  const bx = Math.max(0, b.x - pad), by = Math.max(0, b.y - pad), bw = Math.min(W, b.x + b.w + pad) - bx, bh = Math.min(H, b.y + b.h + pad) - by;
  if (bw < 2 || bh < 2) return;
  const dx = ctx2d(dstCanvas), T = dx.getImageData(bx, by, bw, bh), td = T.data;
  const sd = ctx2d(src).getImageData(bx, by, bw, bh).data, md = ctx2d(mask).getImageData(bx, by, bw, bh).data;
  const n = bw * bh, val = new Float32Array(n * 3), wgt = new Float32Array(n);
  if (colorMatch) {
    for (let i = 0; i < n; i++) {
      if (md[i * 4 + 3] >= 128 || sd[i * 4 + 3] < 8 || td[i * 4 + 3] < 8) continue;
      wgt[i] = 1; for (let c = 0; c < 3; c++) val[i * 3 + c] = td[i * 4 + c] - sd[i * 4 + c];
    }
    pushPull(val, wgt, bw, bh);
  }
  for (let i = 0; i < n; i++) {
    const a = md[i * 4 + 3] / 255; if (a <= 0) continue;
    for (let c = 0; c < 3; c++) { const v = sd[i * 4 + c] + val[i * 3 + c]; td[i * 4 + c] = td[i * 4 + c] * (1 - a) + (v < 0 ? 0 : v > 255 ? 255 : v) * a; }
    td[i * 4 + 3] = td[i * 4 + 3] * (1 - a) + sd[i * 4 + 3] * a;
  }
  dx.putImageData(T, bx, by);
}
const shifted = (c, dx, dy) => { const n = makeCanvas(c.width, c.height); ctx2d(n).drawImage(c, dx, dy); return n; };

// Ausbessern: Auswahl wurde auf eine Quelle gezogen → Quellstruktur mit angepasster Farbe einsetzen
export function patchFrom(dx, dy, mode = 'normal') {
  const d = doc(); if (!d || !d.selection) return;
  const l = d.layer; if (!canEditPixels(l)) return;
  const src = shifted(cloneCanvas(l.canvas), -dx, -dy);
  seamlessInto(l.canvas, src, SEL.feather(d.selection, mode === 'soft' ? 3 : 1));
  l.touch(); view.request(); commit('Ausbessern');
}

// Inhaltsbasiert verschieben: Objekt versetzen, alte Stelle füllen, Kanten angleichen
export async function contentAwareMove(dx, dy, extend = false) {
  const d = doc(); if (!d || !d.selection) return;
  const l = d.layer; if (!canEditPixels(l)) return;
  const before = cloneCanvas(l.canvas), M = d.selection;
  busy(extend ? 'Inhaltsbasiert erweitern' : 'Inhaltsbasiert verschieben');
  try {
    if (!extend) {
      const filled = await inpaintCanvas(before, SEL.expand(M, 4));
      const x = l.ctx; x.clearRect(0, 0, d.w, d.h); x.drawImage(filled, 0, 0);
    }
    const Ms = shifted(SEL.feather(M, 2), dx, dy);
    seamlessInto(l.canvas, shifted(before, dx, dy), Ms);
    d.setSelection(shifted(M, dx, dy));
    l.touch(); commit(extend ? 'Inhaltsbasiert erweitern' : 'Inhaltsbasiert verschieben');
  } finally { idle(); }
}

// ---------- Inhaltsbasiert skalieren (Seam Carving im Worker) ----------
export async function contentAwareScale() {
  const d = doc(); if (!d) return;
  const l = d.layer; if (!canEditPixels(l)) return;
  const alone = l.isBackground || d.layers.length === 1;
  const v = await askForm('Inhaltsbasiert skalieren', [
    { key: 'w', type: 'num', label: 'Breite', min: 8, max: d.w * 2, unit: ' Px', value: Math.round(d.w * 0.8), width: 70 },
    { key: 'h', type: 'num', label: 'Höhe', min: 8, max: d.h * 2, unit: ' Px', value: d.h, width: 70 },
    { key: 'protect', type: 'check', label: 'Auswahl schützen (z. B. Personen)', value: !!d.selection },
    { key: 'canvas', type: 'check', label: 'Arbeitsfläche an neue Größe anpassen', value: alone },
  ], { hint: 'Entfernt bzw. verdoppelt Pixelbahnen mit wenig Bildinhalt – wichtige Motive behalten ihre Form. Vergrößern ist bis zum Doppelten möglich.' });
  if (!v) return;
  const W = d.w, H = d.h;
  let protect = null;
  if (v.protect && d.selection) { const md = ctx2d(d.selection).getImageData(0, 0, W, H).data; protect = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) protect[i] = md[i * 4 + 3]; }
  busy('Inhaltsbasiert skalieren');
  try {
    const res = await runFilter('heavy', 'seamCarve', { w: Math.round(v.w), h: Math.round(v.h), protect }, l.canvas);
    if (v.canvas) {
      IMAGE.canvasSize(res.width, res.height, 0, 0);
      const ll = doc().layer; ll.ctx.clearRect(0, 0, res.width, res.height); ll.ctx.drawImage(res, 0, 0); ll.touch();
    } else {
      l.ctx.clearRect(0, 0, W, H); l.ctx.drawImage(res, Math.round((W - res.width) / 2), Math.round((H - res.height) / 2)); l.touch();
    }
    d.deselect(); commit('Inhaltsbasiert skalieren'); if (v.canvas) squash(2);
  } catch (e) { toast('Skalieren fehlgeschlagen: ' + e.message); } finally { idle(); }
}

// ---------- Generativ erweitern (Arbeitsfläche vergrößern + KI füllt die neuen Ränder) ----------
export async function generativeExpand() {
  const d = doc(); if (!d) return;
  const v = await askForm('Generativ erweitern', [
    { key: 'l', type: 'num', label: 'Links', max: 4000, unit: ' Px', value: 0 }, { key: 'r', type: 'num', label: 'Rechts', max: 4000, unit: ' Px', value: Math.round(d.w * 0.25) },
    { key: 't', type: 'num', label: 'Oben', max: 4000, unit: ' Px', value: 0 }, { key: 'b', type: 'num', label: 'Unten', max: 4000, unit: ' Px', value: 0 },
  ], { hint: 'Die neuen Ränder werden mit dem lokalen KI-Modell (LaMa) passend zum Bild ergänzt. Gut für Himmel, Landschaft, Wände und Texturen – neue Objekte werden nicht erfunden.' });
  if (!v || !(v.l + v.r + v.t + v.b)) return;
  const W0 = d.w, H0 = d.h;
  const nw = W0 + v.l + v.r, nh = H0 + v.t + v.b;
  IMAGE.canvasSize(nw, nh, (v.l + v.r) ? v.l / (v.l + v.r) : 0.5, (v.t + v.b) ? v.t / (v.t + v.b) : 0.5);
  const D = doc(), l = D.layers.find((x) => x.isBackground) || D.layer;
  if (!canEditPixels(l, true)) { toast('Ebene kann nicht gefüllt werden'); return; }
  busy('Generativ erweitern');
  try {
    let cur = cloneCanvas(l.canvas);
    const ox = v.l, oy = v.t;
    // erst oben/unten (über der Originalbreite), dann links/rechts über die volle Höhe (inkl. Ecken)
    if (v.t) cur = await fillSide(cur, { x: ox, y: 0, w: W0, h: v.t }, 't');
    if (v.b) cur = await fillSide(cur, { x: ox, y: oy + H0, w: W0, h: v.b }, 'b');
    if (v.l) cur = await fillSide(cur, { x: 0, y: 0, w: v.l, h: nh }, 'l');
    if (v.r) cur = await fillSide(cur, { x: ox + W0, y: 0, w: v.r, h: nh }, 'r');
    l.ctx.clearRect(0, 0, nw, nh); l.ctx.drawImage(cur, 0, 0); l.touch();
    commit('Generativ erweitern'); squash(2);
  } catch (e) { toast('Erweitern fehlgeschlagen: ' + e.message); } finally { idle(); }
}
// Einen Rand füllen: Kante wird jenseits der Lücke gespiegelt, damit die KI von beiden Seiten Kontext hat
async function fillSide(cur, R, dir) {
  const W = cur.width, H = cur.height, horiz = dir === 'l' || dir === 'r';
  const t = horiz ? R.w : R.h;
  const P = makeCanvas(W + (horiz ? t : 0), H + (horiz ? 0 : t)), px = ctx2d(P);
  const shift = dir === 'l' ? { x: t, y: 0 } : dir === 't' ? { x: 0, y: t } : { x: 0, y: 0 };
  px.drawImage(cur, shift.x, shift.y);
  const hole = { x: R.x + shift.x, y: R.y + shift.y, w: R.w, h: R.h };
  // gespiegelter Kontext hinter der Lücke
  px.save();
  if (dir === 'r') { const m = Math.max(1, Math.min(t, hole.x)); px.translate(hole.x + t + m, 0); px.scale(-1, 1); px.drawImage(P, hole.x - m, hole.y, m, hole.h, m - m, hole.y, m, hole.h); }
  if (dir === 'l') { const m = Math.max(1, Math.min(t, W - hole.x - t)); px.translate(hole.x, 0); px.scale(-1, 1); px.drawImage(P, hole.x + t, hole.y, m, hole.h, 0, hole.y, m, hole.h); }
  if (dir === 'b') { const m = Math.max(1, Math.min(t, hole.y)); px.translate(0, hole.y + t + m); px.scale(1, -1); px.drawImage(P, hole.x, hole.y - m, hole.w, m, hole.x, 0, hole.w, m); }
  if (dir === 't') { const m = Math.max(1, Math.min(t, H - hole.y - t)); px.translate(0, hole.y); px.scale(1, -1); px.drawImage(P, hole.x, hole.y + t, hole.w, m, hole.x, 0, hole.w, m); }
  px.restore();
  // Lücke mit gestreckten, weichgezeichneten Kantenpixeln vorbelegen – so sieht die KI nirgends leere/weiße Flächen
  {
    const pre = makeCanvas(P.width, P.height), qx = ctx2d(pre);
    if (dir === 'r') qx.drawImage(P, hole.x - 1, hole.y, 1, hole.h, hole.x, hole.y, hole.w, hole.h);
    if (dir === 'l') qx.drawImage(P, hole.x + hole.w, hole.y, 1, hole.h, hole.x, hole.y, hole.w, hole.h);
    if (dir === 'b') qx.drawImage(P, hole.x, hole.y - 1, hole.w, 1, hole.x, hole.y, hole.w, hole.h);
    if (dir === 't') qx.drawImage(P, hole.x, hole.y + hole.h, hole.w, 1, hole.x, hole.y, hole.w, hole.h);
    px.save(); px.beginPath(); px.rect(hole.x, hole.y, hole.w, hole.h); px.clip(); px.drawImage(pre, 0, 0); px.filter = `blur(${Math.max(4, t / 6)}px)`; px.drawImage(pre, 0, 0); px.filter = 'none'; px.restore();
  }
  // in Abschnitten entlang der Kante füllen (genug Auflösung für das Modell)
  const len = horiz ? hole.h : hole.w, chunk = Math.max(384, Math.round(t * 2.5));
  let work = P;
  for (let o = 0; o < len; o += chunk) {
    const m = makeCanvas(P.width, P.height), mx = ctx2d(m); mx.fillStyle = '#fff';
    if (horiz) mx.fillRect(hole.x - 2, hole.y + o, hole.w + 4, Math.min(chunk, len - o));
    else mx.fillRect(hole.x + o, hole.y - 2, Math.min(chunk, len - o), hole.h + 4);
    work = await inpaintCanvas(work, m);
  }
  const out = cloneCanvas(cur);
  ctx2d(out).drawImage(work, hole.x, hole.y, hole.w, hole.h, R.x, R.y, R.w, R.h);
  return out;
}

// ---------- Himmel austauschen ----------
export function skyMask(src) {
  const W = src.width, H = src.height, k = Math.min(1, 420 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const sm = makeCanvas(w, h), sx = ctx2d(sm); sx.drawImage(src, 0, 0, w, h);
  const px = sx.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h), G = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lumA(px, i * 4);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; G[i] = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]); }
  const cand = (i) => { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; return G[i] < 24 && L[i] > 12 && (b >= r - 8 || L[i] > 170); };
  const sky = new Uint8Array(w * h), q = [];
  for (let x = 0; x < w; x++) if (cand(x)) { sky[x] = 1; q.push(x); }
  while (q.length) {
    const i = q.pop(), x = i % w;
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= w * h || sky[j] || (j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
      const dc = Math.abs(px[i * 4] - px[j * 4]) + Math.abs(px[i * 4 + 1] - px[j * 4 + 1]) + Math.abs(px[i * 4 + 2] - px[j * 4 + 2]);
      if (cand(j) && dc < 36) { sky[j] = 1; q.push(j); }
    }
  }
  const m = makeCanvas(w, h), mx = ctx2d(m), id = mx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = sky[i] ? 255 : 0; }
  mx.putImageData(id, 0, 0);
  const out = makeCanvas(W, H), ox = ctx2d(out); ox.imageSmoothingQuality = 'high'; ox.filter = `blur(${Math.max(1, 1.2 / k)}px)`; ox.drawImage(m, 0, 0, W, H);
  return out;
}
export const SKY_PRESETS = [['blue', 'Blauer Himmel'], ['clouds', 'Schönwetterwolken'], ['sunset', 'Sonnenuntergang'], ['dusk', 'Dämmerung'], ['night', 'Sternennacht'], ['pastel', 'Pastell (Anime)']];
export function makeSky(kind, W, H) {
  const c = makeCanvas(W, H), x = ctx2d(c);
  const stops = { blue: ['#2f6fd0', '#7fb6f0', '#d6ecff'], clouds: ['#3d7fd6', '#8cc0f2', '#e2f1ff'], sunset: ['#2b1055', '#7b3f8f', '#d16ba5', '#f9a26c', '#ffd89b'], dusk: ['#0f2027', '#2c5364', '#e0a96d'], night: ['#020111', '#0b1a4a', '#26346e'], pastel: ['#a18cd1', '#c9a7e8', '#fbc2eb', '#ffe1f0'] }[kind] || ['#2f6fd0', '#d6ecff'];
  const g = x.createLinearGradient(0, 0, 0, H); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); x.fillStyle = g; x.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 'night') { x.fillStyle = '#fff'; for (let i = 0; i < W * H / 900; i++) { x.globalAlpha = 0.3 + rnd() * 0.7; const r = rnd() * 1.4 + 0.3; x.beginPath(); x.arc(rnd() * W, rnd() * H * 0.9, r, 0, 7); x.fill(); } x.globalAlpha = 1; }
  if (kind === 'clouds' || kind === 'pastel' || kind === 'sunset') {
    const col = kind === 'sunset' ? 'rgba(255,200,170,' : 'rgba(255,255,255,';
    x.filter = `blur(${Math.max(4, W / 160)}px)`;
    for (let n = 0; n < 9; n++) {
      const cx = rnd() * W, cy = H * (0.1 + rnd() * 0.55), s = W * (0.05 + rnd() * 0.08);
      for (let k = 0; k < 14; k++) { x.fillStyle = col + (0.35 + rnd() * 0.4) + ')'; x.beginPath(); x.ellipse(cx + (rnd() - 0.5) * s * 3, cy + (rnd() - 0.5) * s * 0.7, s * (0.5 + rnd()), s * (0.35 + rnd() * 0.4), 0, 0, 7); x.fill(); }
    }
    x.filter = 'none';
  }
  return c;
}
export async function replaceSky() {
  const d = doc(); if (!d) return;
  const v = await askForm('Himmel austauschen', [
    { key: 'kind', type: 'select', label: 'Himmel', options: [...SKY_PRESETS, ['file', 'Eigenes Bild…']], value: 'clouds' },
    { key: 'shift', type: 'num', label: 'Kante verschieben', min: -40, max: 40, unit: ' Px', value: 0 },
    { key: 'feather', type: 'num', label: 'Weiche Kante', min: 0, max: 60, unit: ' Px', value: 4 },
    { key: 'light', type: 'num', label: 'Vordergrund-Beleuchtung', min: 0, max: 100, unit: '%', value: 30 },
  ], { hint: 'Erkennt den Himmel automatisch (Helligkeit, Farbe, wenig Struktur, Verbindung zum oberen Rand). Die Maske lässt sich danach mit dem Pinsel nachbessern.' });
  if (!v) return;
  let skyImg = null;
  if (v.kind === 'file') {
    const files = await pickFiles('Himmelbild wählen', false); if (!files || !files[0]) return;
    skyImg = await decodeImage(files[0].name, files[0].data);
  }
  busy('Himmel wird erkannt');
  try {
    let mask = skyMask(flattenToCanvas(d));
    if (v.shift > 0) mask = SEL.expand(mask, v.shift); else if (v.shift < 0) mask = SEL.contract ? SEL.contract(mask, -v.shift) : mask;
    if (v.feather) mask = SEL.feather(mask, v.feather);
    const ab = alphaBounds(mask, 20);
    if (!ab) { toast('Kein Himmel erkannt – wähle ihn mit der Auswahl aus und nutze Bearbeiten › Fläche füllen'); return; }
    const sky = new Layer(d.w, d.h, 'Himmel');
    if (skyImg) { const k = Math.max(d.w / skyImg.width, (ab.y + ab.h) / skyImg.height); sky.ctx.drawImage(skyImg, (d.w - skyImg.width * k) / 2, 0, skyImg.width * k, skyImg.height * k); }
    else sky.ctx.drawImage(makeSky(v.kind, d.w, Math.max(32, ab.y + ab.h)), 0, 0);
    sky.mask = mask; sky.maskEnabled = true;
    d.addLayer(sky);
    if (v.light > 0) {
      // Farbstimmung des neuen Himmels weich auf den Vordergrund übertragen
      const t = makeCanvas(1, 1), tx = ctx2d(t); tx.drawImage(sky.canvas, 0, 0, 1, 1); const p = tx.getImageData(0, 0, 1, 1).data;
      const fl = new Layer(d.w, d.h, 'Vordergrund-Beleuchtung'); fl.ctx.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`; fl.ctx.fillRect(0, 0, d.w, d.h);
      fl.blend = 'soft-light'; fl.opacity = v.light / 100;
      fl.mask = makeCanvas(d.w, d.h); const fm = ctx2d(fl.mask); fm.fillStyle = '#fff'; fm.fillRect(0, 0, d.w, d.h); fm.globalCompositeOperation = 'destination-out'; fm.drawImage(mask, 0, 0); fl.maskEnabled = true;
      d.addLayer(fl);
    }
    commit('Himmel austauschen');
  } finally { idle(); }
}

// ---------- Hochskalieren ----------
export async function upscaleImage() {
  const d = doc(); if (!d) return;
  const v = await askForm('Hochskalieren (Details erhalten)', [
    { key: 'scale', type: 'select', label: 'Faktor', options: [['1.5', '150 %'], ['2', '200 %'], ['3', '300 %'], ['4', '400 %']], value: '2' },
    { key: 'sharpen', type: 'num', label: 'Nachschärfen', max: 150, unit: '%', value: 60 },
  ], { hint: 'Mehrstufige hochwertige Interpolation mit anschließendem Nachschärfen. Hinweis: Das ist kein KI-Hochskalieren – es werden keine neuen Details erfunden.' });
  if (!v) return;
  const k = Number(v.scale), nw = Math.round(d.w * k), nh = Math.round(d.h * k);
  if (nw * nh > 12e7) { toast('Ergebnis wäre zu groß'); return; }
  busy('Hochskalieren');
  try {
    const raster = d.layers.filter((l) => l.type === 'raster');
    const ups = [];
    for (const l of raster) ups.push(await runFilter('heavy', 'upscale', { scale: k, sharpen: v.sharpen / 100 }, l.canvas));
    IMAGE.resize(nw, nh);
    raster.forEach((l, i) => { const c = makeCanvas(nw, nh); ctx2d(c).drawImage(ups[i], 0, 0, nw, nh); l.canvas = c; l.touch(); });
    commit('Hochskalieren'); squash(2);
  } catch (e) { toast('Hochskalieren fehlgeschlagen: ' + e.message); } finally { idle(); }
}

// ---------- Ebenen automatisch ausrichten (Verschiebung per Bildvergleich) ----------
function grayOf(c, k) {
  const w = Math.max(8, Math.round(c.width * k)), h = Math.max(8, Math.round(c.height * k));
  const t = makeCanvas(w, h), x = ctx2d(t); x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { g[i] = lumA(d, i * 4); a[i] = d[i * 4 + 3] > 200 ? 1 : 0; }
  // Gradientenbild: robust gegen Belichtungsunterschiede
  const e = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x2 = 1; x2 < w - 1; x2++) { const i = y * w + x2; e[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]); }
  return { g: e, a, w, h };
}
function matchCost(A, B, dx, dy, minOverlap) {
  let s = 0, n = 0;
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(A.w, B.w + dx), y1 = Math.min(A.h, B.h + dy);
  if ((x1 - x0) * (y1 - y0) < minOverlap) return Infinity;
  const step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 6000)));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const i = y * A.w + x, j = (y - dy) * B.w + (x - dx);
    if (!A.a[i] || !B.a[j]) continue;
    s += Math.abs(A.g[i] - B.g[j]); n++;
  }
  return n > 20 ? s / n : Infinity;
}
// Grob-zu-fein-Suche der besten Verschiebung von b relativ zu a (in Pixeln von a/b, gleiche Skala)
export function findOffset(a, b, range = { x0: -0.25, x1: 0.25, y0: -0.25, y1: 0.25 }, minOverlap = 0.15) {
  const levels = [1 / 16, 1 / 8, 1 / 4, 1 / 2];
  const base = Math.max(a.width, a.height);
  let best = null;
  for (const lv of levels) {
    const k = Math.min(1, lv * 1600 / base) || lv;
    const A = grayOf(a, k), B = grayOf(b, k), mo = A.w * A.h * minOverlap;
    let cand = [];
    if (!best) {
      for (let dy = Math.floor(range.y0 * A.h); dy <= Math.ceil(range.y1 * A.h); dy++) for (let dx = Math.floor(range.x0 * A.w); dx <= Math.ceil(range.x1 * A.w); dx++) cand.push([dx, dy]);
    } else {
      const cx = Math.round(best.x * k), cy = Math.round(best.y * k);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) cand.push([cx + dx, cy + dy]);
    }
    let bc = Infinity, bxy = [0, 0];
    for (const [dx, dy] of cand) { const c = matchCost(A, B, dx, dy, mo); if (c < bc) { bc = c; bxy = [dx, dy]; } }
    best = { x: bxy[0] / k, y: bxy[1] / k, cost: bc };
  }
  return { x: Math.round(best.x), y: Math.round(best.y), cost: best.cost };
}
export async function autoAlignLayers() {
  const d = doc(); if (!d) return;
  const ls = d.layers.filter((l) => l.type === 'raster' && l.visible && !l.parent);
  if (ls.length < 2) { toast('Mindestens zwei sichtbare Pixelebenen nötig'); return; }
  busy('Ebenen werden ausgerichtet');
  await new Promise((r) => setTimeout(r, 30));
  try {
    const ref = ls[0]; let moved = 0;
    for (const l of ls.slice(1)) {
      const o = findOffset(ref.canvas, l.canvas);
      if (o.x || o.y) { const c = cloneCanvas(l.canvas); l.ctx.clearRect(0, 0, d.w, d.h); l.ctx.drawImage(c, o.x, o.y); if (l.mask) { const m = cloneCanvas(l.mask); const mx = ctx2d(l.mask); mx.clearRect(0, 0, d.w, d.h); mx.drawImage(m, o.x, o.y); } l.touch(); moved++; }
    }
    commit('Ebenen automatisch ausrichten');
    toast(`${moved} Ebene(n) verschoben (Ausrichtung per Verschiebung – Drehung/Perspektive werden nicht korrigiert)`);
  } finally { idle(); }
}

// ---------- Belichtungs-/Schärfe-Fusion mit Laplace-Pyramiden ----------
function toF(c) { const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, f = new Float32Array(n * 3), a = new Float32Array(n); for (let i = 0; i < n; i++) { f[i * 3] = d[i * 4] / 255; f[i * 3 + 1] = d[i * 4 + 1] / 255; f[i * 3 + 2] = d[i * 4 + 2] / 255; a[i] = d[i * 4 + 3] / 255; } return { f, a, w: c.width, h: c.height }; }
function down(f, w, h, ch) { const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2), o = new Float32Array(w2 * h2 * ch); for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < ch; c++) { let s = 0, n = 0; for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) { const sx = Math.min(w - 1, Math.max(0, x * 2 + dx)), sy = Math.min(h - 1, Math.max(0, y * 2 + dy)); const wt = (dx === 0 || dx === 1 ? 3 : 1) * (dy === 0 || dy === 1 ? 3 : 1); s += f[(sy * w + sx) * ch + c] * wt; n += wt; } o[(y * w2 + x) * ch + c] = s / n; } return { f: o, w: w2, h: h2 }; }
function up(f, w2, h2, w, h, ch) { const o = new Float32Array(w * h * ch); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const fx = Math.min(w2 - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(h2 - 1, Math.max(0, (y + 0.5) / 2 - 0.5)); const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w2 - 1, x0 + 1), y1 = Math.min(h2 - 1, y0 + 1), ax = fx - x0, ay = fy - y0; for (let c = 0; c < ch; c++) o[(y * w + x) * ch + c] = (f[(y0 * w2 + x0) * ch + c] * (1 - ax) + f[(y0 * w2 + x1) * ch + c] * ax) * (1 - ay) + (f[(y1 * w2 + x0) * ch + c] * (1 - ax) + f[(y1 * w2 + x1) * ch + c] * ax) * ay; } return o; }
function fuse(images, weights, w, h) {
  const levels = Math.max(1, Math.min(7, Math.floor(Math.log2(Math.min(w, h))) - 3));
  const n = images.length;
  // Gewichte normieren
  for (let i = 0; i < w * h; i++) { let s = 1e-12; for (let k = 0; k < n; k++) s += weights[k][i]; for (let k = 0; k < n; k++) weights[k][i] /= s; }
  let result = null; const sizes = [];
  { let cw = w, chh = h; for (let l = 0; l <= levels; l++) { sizes.push([cw, chh]); cw = Math.ceil(cw / 2); chh = Math.ceil(chh / 2); } }
  const acc = sizes.map(([cw, chh]) => new Float32Array(cw * chh * 3));
  for (let k = 0; k < n; k++) {
    // Gauß-Pyramide der Gewichte, Laplace-Pyramide des Bildes
    let g = { f: images[k], w, h }, wt = { f: weights[k], w, h };
    for (let l = 0; l <= levels; l++) {
      const [cw, chh] = sizes[l];
      let lap;
      if (l < levels) { const dn = down(g.f, cw, chh, 3); const upd = up(dn.f, dn.w, dn.h, cw, chh, 3); lap = new Float32Array(cw * chh * 3); for (let i = 0; i < lap.length; i++) lap[i] = g.f[i] - upd[i]; g = dn; }
      else lap = g.f;
      const A = acc[l];
      for (let i = 0; i < cw * chh; i++) { const ww = wt.f[i]; A[i * 3] += lap[i * 3] * ww; A[i * 3 + 1] += lap[i * 3 + 1] * ww; A[i * 3 + 2] += lap[i * 3 + 2] * ww; }
      if (l < levels) wt = down(wt.f, cw, chh, 1);
    }
  }
  result = acc[levels];
  for (let l = levels - 1; l >= 0; l--) { const [cw, chh] = sizes[l], [pw, ph] = sizes[l + 1]; const u = up(result, pw, ph, cw, chh, 3); for (let i = 0; i < u.length; i++) u[i] += acc[l][i]; result = u; }
  return result;
}
function fromF(f, w, h, alpha) { const c = makeCanvas(w, h), x = ctx2d(c), id = x.createImageData(w, h); for (let i = 0; i < w * h; i++) { for (let k = 0; k < 3; k++) { const v = f[i * 3 + k] * 255; id.data[i * 4 + k] = v < 0 ? 0 : v > 255 ? 255 : v; } id.data[i * 4 + 3] = alpha ? alpha[i] * 255 : 255; } x.putImageData(id, 0, 0); return c; }
function localContrast(F, w, h, blurR) {
  const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = F.f[i * 3] * 0.299 + F.f[i * 3 + 1] * 0.587 + F.f[i * 3 + 2] * 0.114;
  const C = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; C[i] = Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]); }
  if (blurR > 0) { const c = makeCanvas(w, h), cx = ctx2d(c), id = cx.createImageData(w, h); let mx = 1e-6; for (let i = 0; i < w * h; i++) mx = Math.max(mx, C[i]); for (let i = 0; i < w * h; i++) { id.data[i * 4] = Math.min(255, C[i] / mx * 255 * 4); id.data[i * 4 + 3] = 255; } cx.putImageData(id, 0, 0); const b = makeCanvas(w, h), bx = ctx2d(b); bx.filter = `blur(${blurR}px)`; bx.drawImage(c, 0, 0); const bd = bx.getImageData(0, 0, w, h).data; for (let i = 0; i < w * h; i++) C[i] = bd[i * 4] / 255 + 1e-4; }
  return { L, C };
}
// Fokus stapeln / Ebenen automatisch überblenden
export async function autoBlendLayers() {
  const d = doc(); if (!d) return;
  const ls = d.layers.filter((l) => l.type === 'raster' && l.visible && !l.parent);
  if (ls.length < 2) { toast('Mindestens zwei sichtbare Pixelebenen nötig (z. B. Fotos mit unterschiedlichem Fokus)'); return; }
  const v = await askForm('Ebenen automatisch überblenden', [
    { key: 'mode', type: 'select', label: 'Methode', options: [['stack', 'Bilder stapeln (Fokus-Stacking)'], ['exposure', 'Belichtungen verschmelzen']], value: 'stack' },
    { key: 'align', type: 'check', label: 'Vorher automatisch ausrichten', value: true },
  ]);
  if (!v) return;
  if (v.align) await autoAlignLayers();
  busy('Ebenen werden überblendet');
  await new Promise((r) => setTimeout(r, 30));
  try {
    const out = fusionOf(ls.map((l) => l.canvas), v.mode);
    const nl = new Layer(d.w, d.h, v.mode === 'stack' ? 'Fokus gestapelt' : 'Belichtung verschmolzen'); nl.ctx.drawImage(out, 0, 0);
    d.addLayer(nl); commit('Ebenen automatisch überblenden');
  } finally { idle(); }
}
function fusionOf(canvases, mode) {
  const w = canvases[0].width, h = canvases[0].height;
  const Fs = canvases.map(toF);
  const weights = Fs.map((F) => {
    const { L, C } = localContrast(F, w, h, mode === 'stack' ? Math.max(2, Math.min(w, h) / 300) : 0);
    const W = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (mode === 'stack') W[i] = Math.pow(C[i], 4) * F.a[i];
      else {
        const r = F.f[i * 3], g = F.f[i * 3 + 1], b = F.f[i * 3 + 2], m = (r + g + b) / 3;
        const sat = Math.sqrt(((r - m) ** 2 + (g - m) ** 2 + (b - m) ** 2) / 3);
        const we = Math.exp(-((r - 0.5) ** 2) / 0.08) * Math.exp(-((g - 0.5) ** 2) / 0.08) * Math.exp(-((b - 0.5) ** 2) / 0.08);
        W[i] = (C[i] * 4 + 0.02) * (sat + 0.05) * (we + 1e-3) * F.a[i];
      }
    }
    return W;
  });
  const res = fuse(Fs.map((F) => F.f), weights, w, h);
  const alpha = new Float32Array(w * h); for (let i = 0; i < w * h; i++) alpha[i] = Math.max(...Fs.map((F) => F.a[i]));
  return fromF(res, w, h, alpha);
}

// ---------- Dateien wählen & dekodieren ----------
export async function pickFiles(title, multi = true) {
  if (window.native) return window.native.openDialog({ title, filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'] }], multi });
  return new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,.tif,.tiff'; i.multiple = multi; i.onchange = async () => res(await Promise.all([...i.files].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))); i.click(); });
}
export async function decodeImage(name, data) {
  if (/\.tiff?$/i.test(name)) { const { readTiff } = await import('./io/tiff.js'); return readTiff(new Uint8Array(data)); }
  const bmp = await createImageBitmap(new Blob([data]));
  const c = makeCanvas(bmp.width, bmp.height); ctx2d(c).drawImage(bmp, 0, 0); bmp.close(); return c;
}

// ---------- Zu HDR zusammenfügen (Belichtungsfusion) ----------
export async function mergeHdr() {
  const files = await pickFiles('Belichtungsreihe wählen (2–9 Bilder)');
  if (!files || files.length < 2) { if (files && files.length) toast('Mindestens zwei Belichtungen wählen'); return; }
  busy('HDR wird zusammengefügt');
  try {
    let imgs = [];
    for (const f of files.slice(0, 9)) imgs.push(await decodeImage(f.name, f.data));
    const W = imgs[0].width, H = imgs[0].height;
    imgs = imgs.map((c) => { if (c.width === W && c.height === H) return c; const n = makeCanvas(W, H); ctx2d(n).drawImage(c, 0, 0, W, H); return n; });
    // Ausrichten (Freihand-Reihen)
    const aligned = [imgs[0]];
    for (const c of imgs.slice(1)) { const o = findOffset(imgs[0], c, { x0: -0.08, x1: 0.08, y0: -0.08, y1: 0.08 }, 0.5); const n = makeCanvas(W, H); ctx2d(n).drawImage(c, o.x, o.y); aligned.push(n); }
    let work = aligned, scale = 1;
    if (W * H > 9e6) { scale = Math.sqrt(9e6 / (W * H)); work = aligned.map((c) => { const n = makeCanvas(Math.round(W * scale), Math.round(H * scale)); ctx2d(n).drawImage(c, 0, 0, n.width, n.height); return n; }); }
    const out = fusionOf(work, 'exposure');
    newDocFromCanvas(out, 'HDR-Zusammenfügung');
    toast(`${aligned.length} Belichtungen zu HDR verschmolzen (Exposure Fusion)` + (scale < 1 ? ' – aus Speichergründen auf ~9 MP verkleinert' : ''));
  } catch (e) { toast('HDR fehlgeschlagen: ' + e.message); } finally { idle(); }
}

// ---------- Photomerge (Panorama) ----------
export async function photomerge() {
  const files = await pickFiles('Panorama-Bilder wählen (in Reihenfolge, mit Überlappung)');
  if (!files || files.length < 2) { if (files && files.length) toast('Mindestens zwei Bilder wählen'); return; }
  const v = await askForm('Photomerge', [
    { key: 'dir', type: 'select', label: 'Richtung', options: [['auto', 'Automatisch'], ['h', 'Horizontal'], ['v', 'Vertikal']], value: 'auto' },
    { key: 'blend', type: 'check', label: 'Bilder zusammen überblenden', value: true },
    { key: 'layers', type: 'check', label: 'Als einzelne Ebenen behalten', value: true },
  ], { hint: 'Ausrichtung per Verschiebung (ideal: Kamera auf Stativ geschwenkt, 25–50 % Überlappung). Starke Perspektivverzerrung wird nicht korrigiert.' });
  if (!v) return;
  busy('Panorama wird erstellt');
  try {
    const imgs = [];
    for (const f of files) imgs.push(await decodeImage(f.name, f.data));
    // gleiche Höhe (horizontal) angleichen
    const pos = [{ x: 0, y: 0 }];
    for (let i = 1; i < imgs.length; i++) {
      const a = imgs[i - 1], b = imgs[i];
      const tryDir = (dir) => findOffset(a, b, dir === 'h' ? { x0: 0.25, x1: 0.95, y0: -0.15, y1: 0.15 } : { x0: -0.15, x1: 0.15, y0: 0.25, y1: 0.95 }, 0.05);
      let o;
      if (v.dir === 'auto') { const h = tryDir('h'), vv = tryDir('v'); o = h.cost <= vv.cost ? h : vv; } else o = tryDir(v.dir);
      pos.push({ x: pos[i - 1].x + o.x, y: pos[i - 1].y + o.y });
    }
    const minX = Math.min(...pos.map((p) => p.x)), minY = Math.min(...pos.map((p) => p.y));
    const maxX = Math.max(...pos.map((p, i) => p.x + imgs[i].width)), maxY = Math.max(...pos.map((p, i) => p.y + imgs[i].height));
    const W = maxX - minX, H = maxY - minY;
    if (W * H > 2e8) { toast('Panorama wäre zu groß'); return; }
    const d = newDocFromCanvas(makeCanvas(W, H), 'Panorama', true);
    const layers = [];
    imgs.forEach((img, i) => {
      const l = new Layer(W, H, files[i].name.replace(/\.[^.]+$/, ''));
      l.ctx.drawImage(img, pos[i].x - minX, pos[i].y - minY);
      if (v.blend && i > 0) {
        // Weicher Übergang im Überlappungsbereich mit dem vorherigen Bild
        const prev = { x: pos[i - 1].x - minX, y: pos[i - 1].y - minY, w: imgs[i - 1].width, h: imgs[i - 1].height }, cur = { x: pos[i].x - minX, y: pos[i].y - minY, w: img.width, h: img.height };
        const m = makeCanvas(W, H), mx = ctx2d(m);
        const horiz = Math.abs(cur.x - prev.x) >= Math.abs(cur.y - prev.y);
        let g;
        if (horiz) { const s = cur.x, e = Math.min(prev.x + prev.w, cur.x + cur.w); g = mx.createLinearGradient(s, 0, Math.max(s + 1, e), 0); }
        else { const s = cur.y, e = Math.min(prev.y + prev.h, cur.y + cur.h); g = mx.createLinearGradient(0, s, 0, Math.max(s + 1, e)); }
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)');
        mx.fillStyle = g; mx.fillRect(0, 0, W, H);
        l.mask = m; l.maskEnabled = true;
      }
      layers.push(l);
    });
    // Belichtung angleichen: mittlere Helligkeit im Überlappungsbereich
    d.layers = layers; d.active = layers.length - 1;
    if (!v.layers) { const flat = flattenToCanvas(d); const l = new Layer(W, H, 'Panorama'); l.ctx.drawImage(flat, 0, 0); d.layers = [l]; d.active = 0; }
    d.needsFit = true; d.history = []; d.histIdx = -1; d.commit('Photomerge'); d.dirty = true;
    toast(`Panorama aus ${imgs.length} Bildern erstellt – leere Ränder mit Freistellen oder „Generativ erweitern“ füllen`);
  } catch (e) { toast('Photomerge fehlgeschlagen: ' + e.message); } finally { idle(); }
}

// ---------- Exporte ----------
export async function exportMultiSize() {
  const d = doc(); if (!d) return;
  const v = await askForm('Exportieren als (mehrere Größen)', [
    { key: 's05', type: 'check', label: '0,5x', value: false }, { key: 's1', type: 'check', label: '1x', value: true }, { key: 's15', type: 'check', label: '1,5x', value: false },
    { key: 's2', type: 'check', label: '2x (@2x)', value: true }, { key: 's3', type: 'check', label: '3x (@3x)', value: true }, { key: 's4', type: 'check', label: '4x (@4x)', value: false },
    { key: 'fmt', type: 'select', label: 'Format', options: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']], value: 'png' },
    { key: 'what', type: 'select', label: 'Inhalt', options: [['doc', 'Ganzes Dokument'], ['layer', 'Aktive Ebene (zugeschnitten)'], ['artboards', 'Alle Zeichenflächen'], ['slices', 'Alle Slices']], value: 'doc' },
  ]);
  if (!v) return;
  const scales = [['s05', 0.5, '@0.5x'], ['s1', 1, ''], ['s15', 1.5, '@1.5x'], ['s2', 2, '@2x'], ['s3', 3, '@3x'], ['s4', 4, '@4x']].filter(([k]) => v[k]);
  if (!scales.length) return;
  const full = flattenToCanvas(d), base = d.name.replace(/\.[^.]+$/, '');
  let parts = [{ name: base, c: full }];
  if (v.what === 'layer') { const b = alphaBounds(d.layer.canvas); if (!b) { toast('Aktive Ebene ist leer'); return; } const c = makeCanvas(b.w, b.h); ctx2d(c).drawImage(d.layer.canvas, -b.x, -b.y); parts = [{ name: d.layer.name, c }]; }
  if (v.what === 'artboards') parts = (d.artboards || []).map((a) => { const c = makeCanvas(a.w, a.h); ctx2d(c).drawImage(full, -a.x, -a.y); return { name: a.name, c }; });
  if (v.what === 'slices') parts = sliceCanvases(d, full);
  if (!parts.length) { toast('Nichts zu exportieren'); return; }
  const items = [];
  for (const p of parts) for (const [, k, suf] of scales) {
    const c = makeCanvas(Math.max(1, Math.round(p.c.width * k)), Math.max(1, Math.round(p.c.height * k))), x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(p.c, 0, 0, c.width, c.height);
    items.push({ name: p.name + suf, canvas: c });
  }
  await exportSet(items, v.fmt, 'Dateien');
}

function sliceCanvases(d, full) {
  return (d.slices || []).map((s, i) => { const c = makeCanvas(s.w, s.h); ctx2d(c).drawImage(full, -s.x, -s.y); return { name: s.name || `slice_${i + 1}`, c }; });
}
export async function exportSlices() {
  const d = doc(); if (!d) return;
  if (!d.slices.length) { toast('Keine Slices – mit dem Slice-Werkzeug (C) aufziehen oder „Slices aus Hilfslinien“ wählen'); return; }
  const v = await askForm('Slices exportieren', [{ key: 'fmt', type: 'select', label: 'Format', options: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']], value: 'png' }]);
  if (!v) return;
  await exportSet(sliceCanvases(d, flattenToCanvas(d)).map((p) => ({ name: p.name, canvas: p.c })), v.fmt, 'Slices');
}
export function slicesFromGuides() {
  const d = doc(); if (!d) return;
  const xs = [0, ...d.guides.filter((g) => g.dir === 'v').map((g) => Math.round(g.pos)), d.w].filter((v, i, a) => v >= 0 && v <= d.w && a.indexOf(v) === i).sort((a, b) => a - b);
  const ys = [0, ...d.guides.filter((g) => g.dir === 'h').map((g) => Math.round(g.pos)), d.h].filter((v, i, a) => v >= 0 && v <= d.h && a.indexOf(v) === i).sort((a, b) => a - b);
  if (xs.length < 3 && ys.length < 3) { toast('Zuerst Hilfslinien anlegen (aus den Linealen ziehen)'); return; }
  const base = d.name.replace(/\.[^.]+$/, '');
  d.slices = [];
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) { if (xs[i + 1] - xs[i] < 1 || ys[j + 1] - ys[j] < 1) continue; d.slices.push({ x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j], name: `${base}_${String(d.slices.length + 1).padStart(2, '0')}` }); }
  S.ui.showSlices = true; view.overlay(); commit('Slices aus Hilfslinien'); toast(`${d.slices.length} Slices erstellt`);
}
export function clearSlices() { const d = doc(); if (!d) return; d.slices = []; view.overlay(); commit('Slices löschen'); }

// SVG: Formen und Text als echte Vektoren, übrige Ebenen als eingebettete Bilder
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BLEND_CSS = { normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function shapeSvg(s) {
  const st = `fill="${s.fillOn !== false ? esc(s.fillColor) : 'none'}"` + (s.strokeOn ? ` stroke="${esc(s.strokeColor)}" stroke-width="${s.strokeWidth || 1}" stroke-linejoin="round"` : '');
  const x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h), w = Math.abs(s.w), h = Math.abs(s.h);
  const tr = s.rot ? ` transform="rotate(${s.rot * 180 / Math.PI} ${x + w / 2} ${y + h / 2})"` : '';
  if (s.parts && s.parts.length) return null;
  if (s.kind === 'rect') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${st}${tr}/>`;
  if (s.kind === 'rounded' && !s.radii) { const r = Math.min(s.radius || 0, w / 2, h / 2); return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${st}${tr}/>`; }
  if (s.kind === 'ellipse') return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${st}${tr}/>`;
  if (s.kind === 'triangle') return `<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" ${st}${tr}/>`;
  if (s.kind === 'polygon' || s.kind === 'star') {
    const n = s.sides || 5, pts = [];
    const cnt = s.kind === 'star' ? n * 2 : n;
    for (let i = 0; i < cnt; i++) { const a = i / cnt * Math.PI * 2 - Math.PI / 2, k = s.kind === 'star' && i % 2 ? (s.starInner || 0.45) : 1; pts.push(`${x + w / 2 + Math.cos(a) * w / 2 * k},${y + h / 2 + Math.sin(a) * h / 2 * k}`); }
    return `<polygon points="${pts.join(' ')}" ${st}${tr}/>`;
  }
  if (s.kind === 'line') return `<line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" stroke="${esc(s.fillColor)}" stroke-width="${s.lineWidth || 6}" stroke-linecap="round"/>`;
  return null;
}
export async function exportSvg() {
  const d = doc(); if (!d) return;
  const v = await askForm('Als SVG exportieren', [
    { key: 'mode', type: 'select', label: 'Inhalt', options: [['layers', 'Ebenen (Formen und Text als Vektoren)'], ['flat', 'Ein zusammengefügtes Bild']], value: 'layers' },
  ], { hint: 'Ebenen mit Ebenenstilen, Masken, Einstellungsebenen oder besonderen Füllmethoden werden als Bild eingebettet, damit sie genau so aussehen wie in Lumora.' });
  if (!v) return;
  busy('SVG wird erstellt');
  try {
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}">`, `<title>${esc(d.name)}</title>`];
    const img = async (c, bx = 0, by = 0) => `<image x="${bx}" y="${by}" width="${c.width}" height="${c.height}" xlink:href="data:image/png;base64,${bytesToB64(new Uint8Array(await canvasToBytes(c, 'image/png')))}"/>`;
    const hasSpecial = d.layers.some((l) => l.visible && (l.type === 'adjust' || l.type === 'group' || l.parent || l.clip));
    if (v.mode === 'flat' || hasSpecial) {
      if (v.mode !== 'flat') toast('Gruppen/Einstellungsebenen/Schnittmasken enthalten – SVG wird als ein Bild gespeichert');
      out.push(await img(flattenToCanvas(d)));
    } else {
      for (const l of d.layers) {
        if (!l.visible) continue;
        const plain = !(l.mask && l.maskEnabled) && !l.vmask && !Object.values(l.fx || {}).some((f) => f && f.enabled) && l.fill >= 1 && BLEND_CSS[l.blend];
        const style = `opacity="${l.opacity}"` + (l.blend !== 'normal' && BLEND_CSS[l.blend] ? ` style="mix-blend-mode:${BLEND_CSS[l.blend]}"` : '');
        let body = null;
        if (plain && l.type === 'shape' && l.shape) body = shapeSvg(l.shape);
        if (plain && l.type === 'text' && l.text && !l.text.path && !l.text.box && !(l.text.warp && l.text.warp.bend)) {
          const t = l.text, lh = t.size * (t.leading || 1.2), anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
          const deco = [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ');
          body = `<text x="${t.x}" y="${t.y}" font-family="${esc(t.font)}" font-size="${t.size}" fill="${esc(t.color)}" text-anchor="${anchor}" dominant-baseline="text-before-edge"${t.bold ? ' font-weight="700"' : ''}${t.italic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''}${t.tracking ? ` letter-spacing="${t.tracking}"` : ''} xml:space="preserve">` +
            (t.content || '').split('\n').map((ln, i) => `<tspan x="${t.x}" y="${t.y + i * lh}">${esc(t.caps ? ln.toUpperCase() : ln)}</tspan>`).join('') + '</text>';
        }
        if (!body) {
          const c = renderLayerAlone(l, d.w, d.h);
          const b = alphaBounds(c); if (!b) continue;
          const cut = makeCanvas(b.w, b.h); ctx2d(cut).drawImage(c, -b.x, -b.y);
          body = await img(cut, b.x, b.y);
          out.push(`<g id="${esc(l.name)}"${l.blend !== 'normal' && BLEND_CSS[l.blend] ? ` style="mix-blend-mode:${BLEND_CSS[l.blend]}"` : ''}>${body}</g>`);
          continue;
        }
        out.push(`<g id="${esc(l.name)}" ${style}>${body}</g>`);
      }
    }
    out.push('</svg>');
    const bytes = new TextEncoder().encode(out.join('\n'));
    const { saveBytesPublic } = await import('./state.js');
    await saveBytesPublic(d.name.replace(/\.[^.]+$/, '') + '.svg', bytes, [{ name: 'SVG', extensions: ['svg'] }]);
  } finally { idle(); }
}

// PDF: Seiten als JPEG (DCT) eingebettet; Zeichenflächen ergeben mehrere Seiten
export async function exportPdf() {
  const d = doc(); if (!d) return;
  const hasAb = (d.artboards || []).length > 0;
  const v = await askForm('Als PDF speichern', [
    { key: 'q', type: 'num', label: 'Bildqualität', min: 10, max: 100, unit: '%', value: 92 },
    { key: 'pages', type: 'select', label: 'Seiten', options: hasAb ? [['artboards', 'Jede Zeichenfläche eine Seite'], ['doc', 'Ganzes Dokument']] : [['doc', 'Ganzes Dokument']], value: hasAb ? 'artboards' : 'doc' },
  ], { hint: `Seitengröße aus Pixelmaß und Auflösung (${d.ppi || 72} ppi).` });
  if (!v) return;
  busy('PDF wird erstellt');
  try {
    const full = flattenToCanvas(d, '#ffffff');
    const pages = v.pages === 'artboards' ? d.artboards.map((a) => { const c = makeCanvas(a.w, a.h); ctx2d(c).drawImage(full, -a.x, -a.y); return c; }) : [full];
    const jpgs = [];
    for (const c of pages) jpgs.push({ w: c.width, h: c.height, data: new Uint8Array(await canvasToBytes(c, 'image/jpeg', v.q / 100)) });
    const bytes = buildPdf(jpgs, d.ppi || 72, d.name);
    const { saveBytesPublic } = await import('./state.js');
    await saveBytesPublic(d.name.replace(/\.[^.]+$/, '') + '.pdf', bytes, [{ name: 'PDF', extensions: ['pdf'] }]);
  } finally { idle(); }
}
export function buildPdf(images, ppi, title) {
  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = images.length;
  // Objekte: 1 Katalog, 2 Seitenbaum, 3 Info, dann je Seite: Seite, Inhalt, Bild
  const pageIds = images.map((_, i) => 4 + i * 3);
  const obj = (id, body) => { offsets[id] = len; push(`${id} 0 obj\n`); if (Array.isArray(body)) body.forEach(push); else push(body); push('\nendobj\n'); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${n} >>`);
  obj(3, `<< /Title (${String(title || 'Lumora').replace(/[()\\]/g, '_').replace(/[^\x20-\x7e]/g, '_')}) /Producer (Lumora) >>`);
  images.forEach((im, i) => {
    const pid = pageIds[i], cid = pid + 1, iid = pid + 2;
    const pw = im.w * 72 / ppi, ph = im.h * 72 / ppi;
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im${i} ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
    const content = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im${i} Do Q`;
    obj(cid, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(iid, [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`, im.data, '\nendstream']);
  });
  const total = 4 + n * 3;
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Bild in den gewählten Rahmen (Rahmenwerkzeug) setzen
export async function placeIntoFrame() {
  const files = await pickFiles('Bild für den Rahmen wählen', false); if (!files || !files[0]) return;
  const img = await decodeImage(files[0].name, files[0].data);
  const { placeInFrame } = await import('./tools.js');
  placeInFrame(img);
}
