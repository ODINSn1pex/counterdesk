// TIFF: Import (über UTIF) und CMYK-/RGB-Export
import UTIF from 'utif2';
import { makeCanvas, ctxRead } from '../engine/util.js';

export function readTiff(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('Leere TIFF-Datei');
  // größte Seite verwenden
  ifds.forEach((i) => { try { UTIF.decodeImage(buf, i); } catch (e) { /* Seite ohne Bild */ } });
  const page = ifds.filter((i) => i.width && i.height).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!page) throw new Error('Keine Bilddaten in der TIFF-Datei');
  const rgba = UTIF.toRGBA8(page);
  const c = makeCanvas(page.width, page.height); const x = ctxRead(c);
  const id = x.createImageData(page.width, page.height); id.data.set(rgba.subarray(0, id.data.length)); x.putImageData(id, 0, 0);
  return c;
}

// RGB → CMYK mit Unterfarbenreduktion (GCR) und Gesamtfarbauftrag-Begrenzung (ohne ICC-Profil)
export function rgbToCmyk(r, g, b, inkLimit = 3.0, gcr = 0.75) {
  const R = r / 255, G = g / 255, B = b / 255;
  let c = 1 - R, m = 1 - G, y = 1 - B;
  const k = Math.min(c, m, y) * gcr;
  if (k < 1) { c = (c - k) / (1 - k); m = (m - k) / (1 - k); y = (y - k) / (1 - k); } else { c = m = y = 0; }
  const total = c + m + y + k;
  if (total > inkLimit) { const s = (inkLimit - k) / (c + m + y); c *= s; m *= s; y *= s; }
  return [c, m, y, k];
}

function ifdBytes(entries, dataOffsetBase) {
  // entries: [tag, type, count, valueOrBytes]; liefert IFD + Zusatzdaten
  entries.sort((a, b) => a[0] - b[0]);
  const n = entries.length, ifdLen = 2 + n * 12 + 4;
  const heap = []; let heapLen = 0;
  const ifd = new DataView(new ArrayBuffer(ifdLen));
  ifd.setUint16(0, n, true);
  entries.forEach(([tag, type, count, val], i) => {
    const o = 2 + i * 12; ifd.setUint16(o, tag, true); ifd.setUint16(o + 2, type, true); ifd.setUint32(o + 4, count, true);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] * count;
    let bytes;
    if (val instanceof Uint8Array) bytes = val;
    else { const dv = new DataView(new ArrayBuffer(Math.max(4, size))); (Array.isArray(val) ? val : [val]).forEach((v, k) => { if (type === 3) dv.setUint16(k * 2, v, true); else if (type === 4) dv.setUint32(k * 4, v, true); else if (type === 5) { dv.setUint32(k * 8, v[0], true); dv.setUint32(k * 8 + 4, v[1], true); } else dv.setUint8(k, v); }); bytes = new Uint8Array(dv.buffer, 0, Math.max(4, size)); }
    if (size <= 4) { for (let k = 0; k < 4; k++) ifd.setUint8(o + 8 + k, bytes[k] || 0); }
    else { ifd.setUint32(o + 8, dataOffsetBase + ifdLen + heapLen, true); heap.push(bytes); heapLen += bytes.length + (bytes.length % 2); if (bytes.length % 2) heap.push(new Uint8Array(1)); }
  });
  return { ifd: new Uint8Array(ifd.buffer), heap, heapLen, ifdLen };
}

export function writeTiff(canvas, { cmyk = true, inkLimit = 300, ppi = 72 } = {}) {
  const w = canvas.width, h = canvas.height;
  const src = ctxRead(canvas).getImageData(0, 0, w, h).data;
  const spp = cmyk ? 4 : 3;
  const pixels = new Uint8Array(w * h * spp);
  for (let i = 0, j = 0; i < w * h; i++, j += spp) {
    const a = src[i * 4 + 3] / 255;
    // auf Weiß reduzieren (Druck kennt keine Transparenz)
    const r = src[i * 4] * a + 255 * (1 - a), g = src[i * 4 + 1] * a + 255 * (1 - a), b = src[i * 4 + 2] * a + 255 * (1 - a);
    if (cmyk) { const [c, m, y, k] = rgbToCmyk(r, g, b, inkLimit / 100); pixels[j] = Math.round(c * 255); pixels[j + 1] = Math.round(m * 255); pixels[j + 2] = Math.round(y * 255); pixels[j + 3] = Math.round(k * 255); }
    else { pixels[j] = r; pixels[j + 1] = g; pixels[j + 2] = b; }
  }
  const sw = new TextEncoder().encode('Lumora\0');
  const entries = [
    [254, 4, 1, 0], [256, 4, 1, w], [257, 4, 1, h], [258, 3, spp, Array(spp).fill(8)], [259, 3, 1, 1],
    [262, 3, 1, cmyk ? 5 : 2], [273, 4, 1, 0], [277, 3, 1, spp], [278, 4, 1, h], [279, 4, 1, pixels.length],
    [282, 5, 1, [[ppi, 1]]], [283, 5, 1, [[ppi, 1]]], [284, 3, 1, 1], [296, 3, 1, 2], [305, 2, sw.length, sw],
  ];
  if (cmyk) entries.push([332, 3, 1, 1]); // InkSet = CMYK
  const { ifd, heap, heapLen, ifdLen } = ifdBytes(entries, 8);
  const dataOff = 8 + ifdLen + heapLen;
  // StripOffsets nachtragen
  const n = new DataView(ifd.buffer).getUint16(0, true);
  for (let i = 0; i < n; i++) { const o = 2 + i * 12; if (new DataView(ifd.buffer).getUint16(o, true) === 273) new DataView(ifd.buffer).setUint32(o + 8, dataOff, true); }
  const out = new Uint8Array(dataOff + pixels.length);
  out.set([0x49, 0x49, 42, 0, 8, 0, 0, 0], 0);
  out.set(ifd, 8);
  let p = 8 + ifdLen; heap.forEach((hb) => { out.set(hb, p); p += hb.length; });
  out.set(pixels, dataOff);
  return out;
}
