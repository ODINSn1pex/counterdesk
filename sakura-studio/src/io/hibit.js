// 16-Bit-Export (PNG und TIFF) aus der Gleitkomma-Pipeline
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b, c = 0xffffffff) { for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return c; }
async function deflate(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }
const q16 = (v) => (v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535));

export async function encodePng16({ data, w, h }, iccChunk = null) {
  // Zeilen mit Filter „Sub“ (gute Kompression bei glatten Verläufen)
  const stride = w * 8, raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1); raw[o] = 1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = o + 1 + x * 8;
      const r = q16(data[i]), g = q16(data[i + 1]), b = q16(data[i + 2]), a = q16(data[i + 3]);
      raw[j] = r >> 8; raw[j + 1] = r & 255; raw[j + 2] = g >> 8; raw[j + 3] = g & 255; raw[j + 4] = b >> 8; raw[j + 5] = b & 255; raw[j + 6] = a >> 8; raw[j + 7] = a & 255;
    }
    // Filter „Sub“: Differenz zum Byte 8 Stellen davor
    for (let k = stride - 1; k >= 8; k--) raw[o + 1 + k] = (raw[o + 1 + k] - raw[o + 1 + k - 8]) & 255;
  }
  const idat = await deflate(raw);
  const chunk = (type, body) => { const c = new Uint8Array(12 + body.length), dv = new DataView(c.buffer); dv.setUint32(0, body.length); c.set(new TextEncoder().encode(type), 4); c.set(body, 8); dv.setUint32(8 + body.length, (crc32(c.subarray(4, 8 + body.length)) ^ 0xffffffff) >>> 0); return c; };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 16; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (iccChunk) parts.push(iccChunk);
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
  const n = parts.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

export function encodeTiff16({ data, w, h }, ppi = 72) {
  const px = w * h * 8, entries = 12, ifdSize = 2 + entries * 12 + 4;
  const bpsOff = 8 + ifdSize, resOff = bpsOff + 8, dataOff = resOff + 16;
  const buf = new ArrayBuffer(dataOff + px), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8[0] = 0x49; u8[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  let o = 8; dv.setUint16(o, entries, true); o += 2;
  const tag = (t, type, count, val) => { dv.setUint16(o, t, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true); if (type === 3 && count === 1) dv.setUint16(o + 8, val, true); else dv.setUint32(o + 8, val, true); o += 12; };
  tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 4, bpsOff); tag(259, 3, 1, 1); tag(262, 3, 1, 2);
  tag(273, 4, 1, dataOff); tag(277, 3, 1, 4); tag(278, 4, 1, h); tag(279, 4, 1, px);
  tag(282, 5, 1, resOff); tag(283, 5, 1, resOff + 8); tag(338, 3, 1, 2);
  dv.setUint32(o, 0, true);
  for (let i = 0; i < 4; i++) dv.setUint16(bpsOff + i * 2, 16, true);
  dv.setUint32(resOff, ppi, true); dv.setUint32(resOff + 4, 1, true); dv.setUint32(resOff + 8, ppi, true); dv.setUint32(resOff + 12, 1, true);
  for (let i = 0, j = dataOff; i < w * h * 4; i++, j += 2) dv.setUint16(j, q16(data[i]), true);
  return u8;
}
