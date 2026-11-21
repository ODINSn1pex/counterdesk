// Import von Photoshop-Pinseln (.abr) – Versionen 1, 2 (alt) und 6.1/6.2 (Photoshop 7 bis heute, „sampled brushes“)
import { makeCanvas, ctxRead } from '../engine/util.js';

class Reader {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.p = 0; }
  u8() { return this.b[this.p++]; }
  u16() { const x = this.v.getUint16(this.p); this.p += 2; return x; }
  i16() { const x = this.v.getInt16(this.p); this.p += 2; return x; }
  u32() { const x = this.v.getUint32(this.p); this.p += 4; return x; }
  i32() { const x = this.v.getInt32(this.p); this.p += 4; return x; }
  str4() { const s = String.fromCharCode(...this.b.subarray(this.p, this.p + 4)); this.p += 4; return s; }
  ucs2() { const n = this.u32(); let s = ''; for (let i = 0; i < n; i++) { const c = this.u16(); if (c) s += String.fromCharCode(c); } return s; }
  get left() { return this.b.length - this.p; }
}

// PackBits-Daten zeilenweise dekodieren
function readImage(r, w, h, depth, compressed) {
  const bpp = depth === 16 ? 2 : 1;
  const out = new Uint8Array(w * h);
  if (!compressed) {
    for (let i = 0; i < w * h; i++) out[i] = bpp === 2 ? (r.u16() >> 8) : r.u8();
    return out;
  }
  const lens = []; for (let y = 0; y < h; y++) lens.push(r.u16());
  const rowBytes = w * bpp, row = new Uint8Array(rowBytes);
  for (let y = 0; y < h; y++) {
    const end = r.p + lens[y]; let k = 0;
    while (r.p < end && k < rowBytes) {
      let n = r.u8(); if (n > 127) n -= 256;
      if (n >= 0) { for (let i = 0; i <= n && k < rowBytes; i++) row[k++] = r.u8(); }
      else if (n !== -128) { const v = r.u8(); for (let i = 0; i < 1 - n && k < rowBytes; i++) row[k++] = v; }
    }
    r.p = end;
    for (let x = 0; x < w; x++) out[y * w + x] = bpp === 2 ? row[x * 2] : row[x];
  }
  return out;
}

function toCanvas(alpha, w, h) {
  const c = makeCanvas(w, h); const x = ctxRead(c); const id = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) id.data[i * 4 + 3] = alpha[i];
  x.putImageData(id, 0, 0);
  return c;
}

function parseV12(r, version) {
  const count = r.u16(); const out = [];
  for (let i = 0; i < count && r.left > 6; i++) {
    const type = r.u16(), size = r.u32(), next = r.p + size;
    if (type === 2) {
      r.u32(); const spacing = r.u16();
      let name = '';
      if (version === 2) name = r.ucs2();
      r.u8();
      r.p += 8; // kurze Grenzen
      const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
      const depth = r.u16(), comp = r.u8();
      const w = right - left, h = bottom - top;
      if (w > 0 && h > 0 && w < 6000 && h < 6000) out.push({ name: name || `Pinsel ${out.length + 1}`, spacing: spacing / 100, canvas: toCanvas(readImage(r, w, h, depth, comp), w, h) });
    }
    r.p = next;
  }
  return out;
}

function parseV6(r, sub) {
  // Abschnitte "8BIM" + Schlüssel + Länge durchlaufen, bis "samp" gefunden ist
  const out = [];
  while (r.left > 12) {
    const sig = r.str4(), key = r.str4(), len = r.u32();
    if (sig !== '8BIM') break;
    const end = r.p + len;
    if (key === 'samp') {
      while (r.p < end - 4) {
        const size = r.u32(); let padded = size; while (padded % 4) padded++;
        const next = r.p + padded;
        r.p += sub === 1 ? 47 : 301; // ID (Pascal-String) + Kopfdaten
        const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
        const depth = r.u16(), comp = r.u8();
        const w = right - left, h = bottom - top;
        if (w > 0 && h > 0 && w < 6000 && h < 6000) out.push({ name: `Pinsel ${out.length + 1}`, spacing: 0.25, canvas: toCanvas(readImage(r, w, h, depth, comp), w, h) });
        r.p = next;
      }
    }
    r.p = end;
  }
  return out;
}

export function parseAbr(bytes) {
  const r = new Reader(bytes);
  const version = r.u16();
  if (version === 1 || version === 2) return parseV12(r, version);
  if (version === 6 || version === 7 || version === 10) { const sub = r.u16(); return parseV6(r, sub); }
  throw new Error('Unbekannte ABR-Version ' + version);
}
