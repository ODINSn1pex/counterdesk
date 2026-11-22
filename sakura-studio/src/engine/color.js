// Farbmanagement: ICC-Profile (sRGB, Display P3, Adobe RGB 1998) erzeugen, einbetten und umrechnen
export const PROFILES = {
  sRGB: {
    name: 'sRGB IEC61966-2.1', gamma: 'srgb',
    toXYZ: [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]],
    d50: [[0.4360747, 0.2225045, 0.0139322], [0.3850649, 0.7168786, 0.0971045], [0.1430804, 0.0606169, 0.7141733]],
  },
  'Display P3': {
    name: 'Display P3', gamma: 'srgb',
    toXYZ: [[0.4865709, 0.2656677, 0.1982173], [0.2289746, 0.6917385, 0.0792869], [0, 0.0451134, 1.0439444]],
    d50: [[0.5151, 0.2412, -0.0011], [0.2920, 0.6922, 0.0419], [0.1571, 0.0666, 0.7841]],
  },
  'Adobe RGB (1998)': {
    name: 'Adobe RGB (1998)', gamma: 563 / 256,
    toXYZ: [[0.5767309, 0.1855540, 0.1881852], [0.2973769, 0.6273491, 0.0752741], [0.0270343, 0.0706872, 0.9911085]],
    d50: [[0.6097559, 0.3111242, 0.0194811], [0.2052401, 0.6256560, 0.0608902], [0.1492240, 0.0632197, 0.7448387]],
  },
};

const toLin = (g, v) => (g === 'srgb' ? (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) : v ** g);
const fromLin = (g, v) => (v <= 0 ? 0 : g === 'srgb' ? (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) : v ** (1 / g));
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
const mul = (m, n) => m.map((r) => [0, 1, 2].map((j) => r[0] * n[0][j] + r[1] * n[1][j] + r[2] * n[2][j]));

// Pixel (RGBA-Array) von Profil a nach Profil b umrechnen (relativ farbmetrisch, Werte außerhalb werden begrenzt)
export function convertPixels(data, from, to) {
  if (from === to) return;
  const A = PROFILES[from], B = PROFILES[to];
  const M = mul(inv3(B.toXYZ), A.toXYZ);
  const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = toLin(A.gamma, i / 255);
  const outLut = new Uint8ClampedArray(4097); for (let i = 0; i <= 4096; i++) outLut[i] = Math.round(fromLin(B.gamma, i / 4096) * 255);
  for (let i = 0; i < data.length; i += 4) {
    const r = lut[data[i]], g = lut[data[i + 1]], b = lut[data[i + 2]];
    for (let k = 0; k < 3; k++) {
      const v = M[k][0] * r + M[k][1] * g + M[k][2] * b;
      data[i + k] = outLut[Math.max(0, Math.min(4096, Math.round(v * 4096)))];
    }
  }
}

// ---------- ICC v2 Profil erzeugen ----------
export function makeIcc(key) {
  const P = PROFILES[key] || PROFILES.sRGB;
  const parts = [];
  const s15 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, Math.round(v * 65536)); return b; };
  const sig = (s) => new TextEncoder().encode(s);
  const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
  const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; };
  const xyz = (x, y, z) => cat(sig('XYZ '), u32(0), s15(x), s15(y), s15(z));
  const desc = (t) => { const a = cat(new TextEncoder().encode(t), new Uint8Array(1)); return cat(sig('desc'), u32(0), u32(a.length), a, u32(0), u32(0), u16(0), new Uint8Array(1), new Uint8Array(67)); };
  const text = (t) => cat(sig('text'), u32(0), new TextEncoder().encode(t), new Uint8Array(1));
  let trc;
  if (typeof P.gamma === 'number') trc = cat(sig('curv'), u32(0), u32(1), u16(Math.round(P.gamma * 256)));
  else { const n = 1024, arr = []; for (let i = 0; i < n; i++) arr.push(u16(Math.round(toLin('srgb', i / (n - 1)) * 65535))); trc = cat(sig('curv'), u32(0), u32(n), ...arr); }
  const tags = [
    ['desc', desc(P.name)], ['cprt', text('Erzeugt mit Lumora')], ['wtpt', xyz(0.9642, 1, 0.8249)],
    ['rXYZ', xyz(...P.d50[0])], ['gXYZ', xyz(...P.d50[1])], ['bXYZ', xyz(...P.d50[2])],
    ['rTRC', trc], ['gTRC', trc], ['bTRC', trc],
  ];
  let off = 128 + 4 + tags.length * 12;
  const table = [u32(tags.length)], data = [];
  const seen = new Map();
  for (const [s, d] of tags) {
    let o = seen.get(d);
    if (o == null) { while (off % 4) { data.push(new Uint8Array(1)); off++; } o = off; seen.set(d, o); data.push(d); off += d.length; }
    table.push(sig(s), u32(o), u32(d.length));
  }
  const total = off;
  const now = new Date();
  const hdr = cat(u32(total), u32(0), u32(0x02100000), sig('mntr'), sig('RGB '), sig('XYZ '),
    u16(now.getUTCFullYear()), u16(now.getUTCMonth() + 1), u16(now.getUTCDate()), u16(0), u16(0), u16(0),
    sig('acsp'), u32(0), u32(0), u32(0), u32(0), new Uint8Array(8), u32(0), s15(0.9642), s15(1), s15(0.8249), u32(0), new Uint8Array(16), new Uint8Array(28));
  parts.push(hdr, ...table, ...data);
  return cat(...parts);
}

// ---------- Einbetten ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function zlib(bytes) {
  const cs = new CompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(await out);
}
export async function embedIcc(bytes, mime, key) {
  const u8 = new Uint8Array(bytes);
  const icc = makeIcc(key);
  if (mime === 'image/png' && u8[1] === 0x50) {
    const name = new TextEncoder().encode((PROFILES[key] || PROFILES.sRGB).name.slice(0, 79));
    const body = new Uint8Array(name.length + 2 + 0); body.set(name, 0);
    const comp = await zlib(icc);
    const payload = new Uint8Array(name.length + 2 + comp.length); payload.set(name, 0); payload[name.length] = 0; payload[name.length + 1] = 0; payload.set(comp, name.length + 2);
    const type = new TextEncoder().encode('iCCP');
    const chunk = new Uint8Array(12 + payload.length); const dv = new DataView(chunk.buffer);
    dv.setUint32(0, payload.length); chunk.set(type, 4); chunk.set(payload, 8);
    dv.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));
    const ihdrEnd = 8 + 8 + 13 + 4;
    // vorhandene sRGB/gAMA/iCCP-Chunks werden nicht erzeugt (Chromium schreibt keine), daher direkt nach IHDR einfügen
    const out = new Uint8Array(u8.length + chunk.length); out.set(u8.subarray(0, ihdrEnd), 0); out.set(chunk, ihdrEnd); out.set(u8.subarray(ihdrEnd), ihdrEnd + chunk.length);
    return out;
  }
  if (mime === 'image/jpeg' && u8[0] === 0xff && u8[1] === 0xd8) {
    const head = new TextEncoder().encode('ICC_PROFILE');
    const seg = new Uint8Array(2 + 2 + head.length + 1 + 2 + icc.length); const dv = new DataView(seg.buffer);
    seg[0] = 0xff; seg[1] = 0xe2; dv.setUint16(2, seg.length - 2); seg.set(head, 4); seg[4 + head.length] = 0; seg[5 + head.length] = 1; seg[6 + head.length] = 1; seg.set(icc, 7 + head.length);
    // nach APP0 (JFIF) einfügen, falls vorhanden
    let pos = 2; if (u8[2] === 0xff && u8[3] === 0xe0) pos = 4 + ((u8[4] << 8) | u8[5]);
    const out = new Uint8Array(u8.length + seg.length); out.set(u8.subarray(0, pos), 0); out.set(seg, pos); out.set(u8.subarray(pos), pos + seg.length);
    return out;
  }
  return u8;
}
