// Photoshop-Vorgaben importieren: Muster (.pat), Stile (.asl), Verläufe (.grd), Farbfelder (.aco)
import { readVersionAndDescriptor, parseEffects } from 'ag-psd/dist/descriptor.js';
import { createReader } from 'ag-psd/dist/psdReader.js';
import { makeCanvas, ctx2d, rgbToHex } from '../engine/util.js';

class R {
  constructor(u8, off = 0) { this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.o = off; }
  u8_() { return this.dv.getUint8(this.o++); }
  u16() { const v = this.dv.getUint16(this.o); this.o += 2; return v; }
  i16() { const v = this.dv.getInt16(this.o); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o); this.o += 4; return v; }
  sig() { const s = String.fromCharCode(...this.u8.subarray(this.o, this.o + 4)); this.o += 4; return s; }
  bytes(n) { const b = this.u8.subarray(this.o, this.o + n); this.o += n; return b; }
  ustr() { const n = this.u32(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16()); return s.replace(/\0+$/, ''); }
  pstr() { const n = this.u8_(); return String.fromCharCode(...this.bytes(n)); }
}

function unpackBits(src, out) {
  let i = 0, o = 0;
  while (i < src.length && o < out.length) {
    const n = src[i++] << 24 >> 24;
    if (n >= 0) { for (let k = 0; k <= n && o < out.length; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < out.length; k++) out[o++] = v; }
  }
  return out;
}

// Ein Muster ab der aktuellen Position (Version-Feld) lesen
function readPatternBody(r) {
  const version = r.u32();
  if (version !== 1) throw new Error('Unbekannte Musterversion ' + version);
  const mode = r.u32();
  r.u16(); r.u16(); // Höhe/Breite (Punkt)
  const name = r.ustr();
  r.pstr(); // ID
  let palette = null;
  if (mode === 2) { palette = r.bytes(768); r.bytes(4); }
  const vv = r.u32(); if (vv !== 3) throw new Error('Unbekanntes VMAL ' + vv);
  const vlen = r.u32(); const vstart = r.o;
  const top = r.u32(), left = r.u32(), bottom = r.u32(), right = r.u32();
  const nch = r.u32();
  const W = right - left, H = bottom - top;
  if (W <= 0 || H <= 0 || W > 8192 || H > 8192) throw new Error('Ungültige Mustergröße');
  const chans = [];
  for (let i = 0; i < nch + 2; i++) {
    if (r.o >= vstart + vlen) break;
    const written = r.u32(); if (!written) continue;
    const len = r.u32(); if (!len) continue;
    const end = r.o + len;
    const depth = r.u32();
    const ct = r.u32(), cl = r.u32(), cb = r.u32(), cr = r.u32();
    r.u16(); const comp = r.u8_();
    const w = cr - cl, h = cb - ct;
    const plane = new Uint8Array(W * H);
    if (depth === 8 && w > 0 && h > 0) {
      let px;
      if (comp === 0) px = r.bytes(w * h);
      else { const counts = []; for (let y = 0; y < h; y++) counts.push(r.u16()); px = new Uint8Array(w * h); let p = 0; for (let y = 0; y < h; y++) { unpackBits(r.bytes(counts[y]), px.subarray(p, p + w)); p += w; } }
      for (let y = 0; y < h; y++) plane.set(px.subarray(y * w, y * w + w), (y + ct - top) * W + (cl - left));
    }
    chans.push(plane);
    r.o = end;
  }
  r.o = vstart + vlen;
  const c = makeCanvas(W, H), x = ctx2d(c), id = x.createImageData(W, H), d = id.data;
  const nc = mode === 3 ? 3 : 1;
  for (let i = 0; i < W * H; i++) {
    if (mode === 2 && palette) { const v = chans[0] ? chans[0][i] : 0; d[i * 4] = palette[v * 3]; d[i * 4 + 1] = palette[v * 3 + 1]; d[i * 4 + 2] = palette[v * 3 + 2]; }
    else if (nc === 3) { d[i * 4] = chans[0]?.[i] ?? 0; d[i * 4 + 1] = chans[1]?.[i] ?? 0; d[i * 4 + 2] = chans[2]?.[i] ?? 0; }
    else { const v = chans[0]?.[i] ?? 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; }
    d[i * 4 + 3] = chans.length > nc ? chans[nc][i] : 255;
  }
  x.putImageData(id, 0, 0);
  return { name: name || 'Muster', canvas: c };
}

export function parsePat(u8) {
  const r = new R(u8);
  if (r.sig() !== '8BPT') throw new Error('Keine .pat-Datei');
  r.u16(); const n = r.u32();
  const out = [];
  for (let i = 0; i < n && r.o < u8.length; i++) {
    try { out.push(readPatternBody(r)); } catch (e) { if (!out.length) throw e; break; }
  }
  return out;
}

// --- Stile (.asl) → Lumora-Ebenenstile
const hex = (c) => (c && c.r != null ? rgbToHex(Math.round(c.r), Math.round(c.g), Math.round(c.b)) : '#000000');
const px = (u) => (u == null ? undefined : typeof u === 'number' ? u : u.value);
export function effectsToFx(e) {
  const fx = {};
  const multi = (key, arr, conv) => (arr || []).forEach((it, i) => { fx[i ? key + (i + 1) : key] = conv(it); });
  multi('shadow', e.dropShadow, (s) => ({ enabled: s.enabled !== false, color: hex(s.color), opacity: s.opacity ?? 0.75, useGlobal: !!s.useGlobalLight, angle: s.angle ?? 120, distance: px(s.distance) ?? 5, size: px(s.size) ?? 5 }));
  multi('inner', e.innerShadow, (s) => ({ enabled: s.enabled !== false, color: hex(s.color), opacity: s.opacity ?? 0.75, size: px(s.size) ?? 5 }));
  multi('stroke', e.stroke, (s) => ({ enabled: s.enabled !== false, color: hex(s.color || { r: 0, g: 0, b: 0 }), opacity: s.opacity ?? 1, size: px(s.size) ?? 3 }));
  multi('overlay', e.solidFill, (s) => ({ enabled: s.enabled !== false, color: hex(s.color), opacity: s.opacity ?? 1 }));
  multi('gradient', e.gradientOverlay, (s) => {
    const st = s.gradient && s.gradient.colorStops || [];
    return { enabled: s.enabled !== false, color1: hex(st[0]?.color), color2: hex(st[st.length - 1]?.color || { r: 255, g: 255, b: 255 }), opacity: s.opacity ?? 1, angle: s.angle ?? 90, style: s.type === 'radial' ? 'radial' : 'linear', reverse: !!s.reverse };
  });
  if (e.outerGlow) { const s = e.outerGlow; fx.glow = { enabled: s.enabled !== false, color: hex(s.color), opacity: s.opacity ?? 0.75, size: px(s.size) ?? 10 }; }
  if (e.innerGlow) { const s = e.innerGlow; fx.innerGlow = { enabled: s.enabled !== false, color: hex(s.color), opacity: s.opacity ?? 0.75, size: px(s.size) ?? 10 }; }
  if (e.satin) { const s = e.satin; fx.satin = { enabled: s.enabled !== false, color: hex(s.color), opacity: s.opacity ?? 0.5, angle: s.angle ?? 19, distance: px(s.distance) ?? 11, size: px(s.size) ?? 14 }; }
  if (e.bevel) {
    const s = e.bevel, st = { 'inner bevel': 'inner', 'outer bevel': 'outer', emboss: 'emboss', 'pillow emboss': 'pillow' }[s.style] || 'inner';
    fx.bevel = { enabled: s.enabled !== false, style: st, depth: s.strength ?? 100, size: px(s.size) ?? 5, highlight: hex(s.highlightColor || { r: 255, g: 255, b: 255 }), shadow: hex(s.shadowColor), opacity: ((s.highlightOpacity ?? 0.75) + (s.shadowOpacity ?? 0.75)) / 2, useGlobal: !!s.useGlobalLight, angle: s.angle ?? 120, altitude: s.altitude ?? 30 };
  }
  if (e.patternOverlay) { const s = e.patternOverlay; fx.pattern = { enabled: s.enabled !== false, name: s.pattern?.name || 'sakura', scale: (s.scale ?? 100) / 100 > 0 ? (s.scale ?? 1) : 1, opacity: s.opacity ?? 1 }; }
  return fx;
}

export function fxToEffects(fx) {
  const col = (h) => { const n = parseInt((h || '#000000').slice(1), 16); return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 }; };
  const u = (v) => ({ units: 'Pixels', value: v });
  const list = (k) => Object.keys(fx).filter((n) => n.replace(/\d+$/, '') === k && fx[n]).map((n) => fx[n]);
  const e = {};
  const sh = list('shadow'); if (sh.length) e.dropShadow = sh.map((f) => ({ enabled: !!f.enabled, present: true, showInDialog: true, color: col(f.color), opacity: f.opacity, angle: f.angle ?? 120, useGlobalLight: f.useGlobal !== false, distance: u(f.distance ?? 5), size: u(f.size ?? 5), blendMode: 'multiply' }));
  const ish = list('inner'); if (ish.length) e.innerShadow = ish.map((f) => ({ enabled: !!f.enabled, present: true, showInDialog: true, color: col(f.color), opacity: f.opacity, angle: 120, distance: u(3), size: u(f.size ?? 5), blendMode: 'multiply' }));
  const st = list('stroke'); if (st.length) e.stroke = st.map((f) => ({ enabled: !!f.enabled, present: true, showInDialog: true, color: col(f.color), opacity: f.opacity, size: u(f.size ?? 3), position: 'outside', fillType: 'color', blendMode: 'normal' }));
  const so = list('overlay'); if (so.length) e.solidFill = so.map((f) => ({ enabled: !!f.enabled, present: true, showInDialog: true, color: col(f.color), opacity: f.opacity, blendMode: 'normal' }));
  const go = list('gradient'); if (go.length) e.gradientOverlay = go.map((f) => ({ enabled: !!f.enabled, present: true, showInDialog: true, opacity: f.opacity, angle: f.angle ?? 90, type: f.style === 'radial' ? 'radial' : 'linear', reverse: !!f.reverse, blendMode: 'normal', align: true, scale: 1,
    gradient: { name: 'Lumora', type: 'solid', smoothness: 1, colorStops: [{ color: col(f.color1), location: 0, midpoint: 0.5 }, { color: col(f.color2), location: 1, midpoint: 0.5 }], opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }, { opacity: 1, location: 1, midpoint: 0.5 }] } }));
  if (fx.glow) e.outerGlow = { enabled: !!fx.glow.enabled, present: true, showInDialog: true, color: col(fx.glow.color), opacity: fx.glow.opacity, size: u(fx.glow.size ?? 10), blendMode: 'screen' };
  if (fx.innerGlow) e.innerGlow = { enabled: !!fx.innerGlow.enabled, present: true, showInDialog: true, color: col(fx.innerGlow.color), opacity: fx.innerGlow.opacity, size: u(fx.innerGlow.size ?? 10), blendMode: 'screen', source: 'edge' };
  if (fx.satin) e.satin = { enabled: !!fx.satin.enabled, present: true, showInDialog: true, color: col(fx.satin.color), opacity: fx.satin.opacity, angle: fx.satin.angle, distance: u(fx.satin.distance), size: u(fx.satin.size), blendMode: 'multiply', invert: true };
  if (fx.bevel) {
    const f = fx.bevel;
    e.bevel = { enabled: !!f.enabled, present: true, showInDialog: true, style: { inner: 'inner bevel', outer: 'outer bevel', emboss: 'emboss', pillow: 'pillow emboss' }[f.style] || 'inner bevel', technique: 'smooth', direction: 'up', strength: f.depth ?? 100, size: u(f.size ?? 5), soften: u(0),
      angle: f.angle ?? 120, altitude: f.altitude ?? 30, useGlobalLight: f.useGlobal !== false, highlightColor: col(f.highlight), shadowColor: col(f.shadow), highlightOpacity: f.opacity, shadowOpacity: f.opacity, highlightBlendMode: 'screen', shadowBlendMode: 'multiply' };
  }
  return Object.keys(e).length ? e : null;
}

export function parseAsl(u8) {
  const r = new R(u8);
  r.u16(); if (r.sig() !== '8BSL') throw new Error('Keine .asl-Datei');
  r.u16();
  const patLen = r.u32(); const patEnd = r.o + patLen;
  const patterns = [];
  while (r.o + 4 < patEnd) {
    const len = r.u32(); const end = r.o + len;
    try { patterns.push(readPatternBody(r)); } catch { /* Muster überspringen */ }
    r.o = end; while (r.o % 4) r.o++;
  }
  r.o = patEnd;
  const n = r.u32();
  const styles = [];
  for (let i = 0; i < n && r.o < u8.length; i++) {
    const len = r.u32(); const end = r.o + len;
    try {
      const rd = createReader(u8.buffer, u8.byteOffset + r.o, len);
      rd.log = () => {};
      const head = readVersionAndDescriptor(rd);
      const body = readVersionAndDescriptor(rd);
      const lefx = body.Lefx || body.lefx;
      if (lefx) styles.push({ name: head['Nm  '] || `Stil ${i + 1}`, fx: effectsToFx(parseEffects(lefx, () => {})) });
    } catch { /* Stil überspringen */ }
    r.o = end; while (r.o % 4) r.o++;
  }
  return { patterns, styles };
}

// --- Verläufe (.grd, Version 5)
const descColor = (c) => {
  if (!c) return '#000000';
  if ('Rd  ' in c) return rgbToHex(Math.round(c['Rd  ']), Math.round(c['Grn ']), Math.round(c['Bl  ']));
  if ('Gry ' in c) { const v = Math.round(255 - c['Gry '] * 2.55); return rgbToHex(v, v, v); }
  if ('H   ' in c) {
    const h = (typeof c['H   '] === 'object' ? c['H   '].value : c['H   ']) / 60, s = c.Strt / 100, v = c.Brgh / 100;
    const f = (n) => { const k = (n + h) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return rgbToHex(Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255));
  }
  if ('Cyn ' in c) { const C = c['Cyn '] / 100, M = c.Mgnt / 100, Y = c['Ylw '] / 100, K = c.Blck / 100; return rgbToHex(Math.round(255 * (1 - C) * (1 - K)), Math.round(255 * (1 - M) * (1 - K)), Math.round(255 * (1 - Y) * (1 - K))); }
  return '#000000';
};
export function parseGrd(u8) {
  const r = new R(u8);
  if (r.sig() !== '8BGR') throw new Error('Keine .grd-Datei');
  const ver = r.u16();
  if (ver !== 5) throw new Error('Nur .grd-Dateien ab Photoshop 6 (Version 5) werden unterstützt');
  const rd = createReader(u8.buffer, u8.byteOffset + r.o, u8.length - r.o); rd.log = () => {};
  const desc = readVersionAndDescriptor(rd);
  const out = [];
  for (const it of desc.GrdL || []) {
    const g = it.Grad || it;
    if (!g || !g.Clrs) continue;
    const stops = g.Clrs.map((s) => {
      let c = descColor(s['Clr ']);
      const t = s.Type && (s.Type.split ? s.Type.split('.').pop() : s.Type);
      if (t === 'FrgC' || t === 'foregroundColor') c = 'fg'; else if (t === 'BckC' || t === 'backgroundColor') c = 'bg';
      return { p: (s.Lctn ?? 0) / 4096, c };
    });
    const ops = (g.Trns || []).map((t) => ({ p: (t.Lctn ?? 0) / 4096, a: (typeof t.Opct === 'object' ? t.Opct.value : t.Opct ?? 100) / 100 }));
    out.push({ name: g['Nm  '] || 'Verlauf', stops, ops });
  }
  return out;
}

// --- Farbfelder (.aco)
export function parseAco(u8) {
  const r = new R(u8);
  const read = (withNames) => {
    const n = r.u16(); const out = [];
    for (let i = 0; i < n; i++) {
      const sp = r.u16(), w = r.u16(), x = r.u16(), y = r.u16(), z = r.u16();
      let name = '';
      if (withNames) name = r.ustr();
      let hx = null;
      if (sp === 0) hx = rgbToHex(w >> 8, x >> 8, y >> 8);
      else if (sp === 1) { const h = w / 65535 * 6, s = x / 65535, v = y / 65535; const f = (k) => { const q = (k + h) % 6; return v - v * s * Math.max(0, Math.min(q, 4 - q, 1)); }; hx = rgbToHex(Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)); }
      else if (sp === 2) { const C = 1 - w / 65535, M = 1 - x / 65535, Y = 1 - y / 65535, K = 1 - z / 65535; hx = rgbToHex(Math.round(255 * (1 - C) * (1 - K)), Math.round(255 * (1 - M) * (1 - K)), Math.round(255 * (1 - Y) * (1 - K))); }
      else if (sp === 8) { const v = Math.round(255 - w / 10000 * 255); hx = rgbToHex(v, v, v); }
      else if (sp === 7) {
        const L = w / 100, a = (x << 16 >> 16) / 100, b = (y << 16 >> 16) / 100;
        const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
        const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
        const X = 0.95047 * inv(fx), Yy = inv(fy), Z = 1.08883 * inv(fz);
        const g = (c) => Math.round(255 * Math.max(0, Math.min(1, c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c)));
        hx = rgbToHex(g(3.2406 * X - 1.5372 * Yy - 0.4986 * Z), g(-0.9689 * X + 1.8758 * Yy + 0.0415 * Z), g(0.0557 * X - 0.204 * Yy + 1.057 * Z));
      }
      if (hx) out.push({ c: hx, name });
    }
    return out;
  };
  const v = r.u16();
  let list = read(false);
  if (v === 1 && r.o + 4 <= u8.length) { try { if (r.u16() === 2) list = read(true); } catch { /* nur v1 */ } }
  else if (v === 2) { r.o = 2; list = read(true); }
  return list;
}
