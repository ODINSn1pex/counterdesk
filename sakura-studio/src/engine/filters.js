// Korrekturen & Filter: Canvas rein → Canvas raus
import { makeCanvas, ctx2d, clamp, rgbToHsl, hslToRgb, hexToRgb } from './util.js';

function pix(src, fn) {
  const w = src.width, h = src.height;
  const out = makeCanvas(w, h);
  const id = ctx2d(src).getImageData(0, 0, w, h);
  fn(id.data, w, h, id);
  ctx2d(out).putImageData(id, 0, 0);
  return out;
}

function lutOp(src, lut, lutG, lutB) {
  return pix(src, (d) => {
    const g = lutG || lut, b = lutB || lut;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
  });
}

function makeLut(fn) {
  const l = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) l[i] = clamp(Math.round(fn(i)), 0, 255);
  return l;
}

function cssFilter(src, filter) {
  const out = makeCanvas(src.width, src.height);
  const x = ctx2d(out);
  x.filter = filter;
  x.drawImage(src, 0, 0);
  return out;
}

function convolve(src, kernel, divisor = 1, offset = 0, keepAlpha = true) {
  const w = src.width, h = src.height;
  const sd = ctx2d(src).getImageData(0, 0, w, h).data;
  return pix(src, (d) => {
    const k = Math.sqrt(kernel.length) | 0, half = k >> 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < k; ky++) {
        const yy = clamp(y + ky - half, 0, h - 1);
        for (let kx = 0; kx < k; kx++) {
          const xx = clamp(x + kx - half, 0, w - 1);
          const p = (yy * w + xx) * 4, kv = kernel[ky * k + kx];
          r += sd[p] * kv; g += sd[p + 1] * kv; b += sd[p + 2] * kv;
        }
      }
      const o = (y * w + x) * 4;
      d[o] = r / divisor + offset; d[o + 1] = g / divisor + offset; d[o + 2] = b / divisor + offset;
      if (!keepAlpha) d[o + 3] = 255;
    }
  });
}

export function histogram(canvas) {
  const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const step = d.length > 4 * 2000000 ? 16 : 4;
  for (let i = 0; i < d.length; i += step) {
    if (d[i + 3] === 0) continue;
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
    l[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  }
  return { r, g, b, l };
}

function levelsLut(inB, gamma, inW, outB, outW) {
  return makeLut((v) => {
    let t = clamp((v - inB) / Math.max(1, inW - inB), 0, 1);
    t = Math.pow(t, 1 / gamma);
    return outB + t * (outW - outB);
  });
}

function autoRange(arr, clip = 0.001) {
  let total = 0; for (let i = 0; i < 256; i++) total += arr[i];
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += arr[lo]; if (acc > total * clip) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += arr[hi]; if (acc > total * clip) break; }
  return [lo, Math.max(lo + 1, hi)];
}

// Kurven: Punkte [[x,y],...] → LUT (monotone kubische Interpolation)
export function curveLut(points) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const m = new Array(n).fill(0);
  const dx = [], dy = [], s = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1; dy[i] = ys[i + 1] - ys[i]; s[i] = dy[i] / dx[i]; }
  m[0] = s[0] || 0; m[n - 1] = s[n - 2] || 0;
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  return makeLut((v) => {
    if (v <= xs[0]) return ys[0];
    if (v >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && v > xs[i + 1]) i++;
    const h = dx[i], t = (v - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  });
}

function boxBlurAlpha(src, r) { return cssFilter(src, `blur(${r}px)`); }

// ======================= KORREKTUREN =======================
export const ADJUSTMENTS = {
  brightness: {
    name: 'Helligkeit/Kontrast…',
    params: [
      { key: 'brightness', label: 'Helligkeit', min: -150, max: 150, def: 0 },
      { key: 'contrast', label: 'Kontrast', min: -50, max: 100, def: 0 },
    ],
    apply: (c, p) => {
      const cf = (259 * (p.contrast * 1.5 + 255)) / (255 * (259 - p.contrast * 1.5));
      return lutOp(c, makeLut((v) => cf * (v + p.brightness * 0.6 - 128) + 128));
    },
  },
  levels: {
    name: 'Tonwertkorrektur…', custom: 'levels',
    params: [
      { key: 'inB', label: 'Tiefen (Eingabe)', min: 0, max: 253, def: 0 },
      { key: 'gamma', label: 'Mitteltöne (Gamma)', min: 0.1, max: 9.99, step: 0.01, def: 1 },
      { key: 'inW', label: 'Lichter (Eingabe)', min: 2, max: 255, def: 255 },
      { key: 'outB', label: 'Tonwertumfang Schwarz', min: 0, max: 255, def: 0 },
      { key: 'outW', label: 'Tonwertumfang Weiß', min: 0, max: 255, def: 255 },
    ],
    apply: (c, p) => lutOp(c, levelsLut(p.inB, p.gamma, p.inW, p.outB, p.outW)),
  },
  curves: {
    name: 'Gradationskurven…', custom: 'curves', params: [],
    apply: (c, p) => {
      const rgb = curveLut(p.rgb || [[0, 0], [255, 255]]);
      const r = curveLut(p.r || [[0, 0], [255, 255]]), g = curveLut(p.g || [[0, 0], [255, 255]]), b = curveLut(p.b || [[0, 0], [255, 255]]);
      const R = makeLut((v) => r[rgb[v]]), G = makeLut((v) => g[rgb[v]]), B = makeLut((v) => b[rgb[v]]);
      return lutOp(c, R, G, B);
    },
  },
  exposure: {
    name: 'Belichtung…',
    params: [
      { key: 'exposure', label: 'Belichtung', min: -5, max: 5, step: 0.01, def: 0 },
      { key: 'offset', label: 'Versatz', min: -0.5, max: 0.5, step: 0.001, def: 0 },
      { key: 'gamma', label: 'Gamma-Korrektur', min: 0.1, max: 3, step: 0.01, def: 1 },
    ],
    apply: (c, p) => lutOp(c, makeLut((v) => {
      let t = Math.pow(v / 255, 2.2) * Math.pow(2, p.exposure) + p.offset;
      t = Math.pow(clamp(t, 0, 1), 1 / 2.2);
      return Math.pow(t, 1 / p.gamma) * 255;
    })),
  },
  vibrance: {
    name: 'Dynamik…',
    params: [
      { key: 'vibrance', label: 'Dynamik', min: -100, max: 100, def: 0 },
      { key: 'saturation', label: 'Sättigung', min: -100, max: 100, def: 0 },
    ],
    apply: (c, p) => pix(c, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), avg = (r + g + b) / 3;
        const sat = (mx - Math.min(r, g, b)) / 255;
        const amt = (p.vibrance / 100) * (1 - sat) + p.saturation / 100;
        d[i] = r + (r - avg) * amt; d[i + 1] = g + (g - avg) * amt; d[i + 2] = b + (b - avg) * amt;
      }
    }),
  },
  hueSat: {
    name: 'Farbton/Sättigung…',
    params: [
      { key: 'hue', label: 'Farbton', min: -180, max: 180, def: 0 },
      { key: 'sat', label: 'Sättigung', min: -100, max: 100, def: 0 },
      { key: 'light', label: 'Helligkeit', min: -100, max: 100, def: 0 },
      { key: 'colorize', label: 'Färben', type: 'checkbox', def: false },
    ],
    apply: (c, p) => pix(c, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (p.colorize) { h = ((p.hue + 180) / 360); s = clamp(0.25 + p.sat / 200, 0, 1); }
        else { h = (h + p.hue / 360 + 1) % 1; s = clamp(p.sat > 0 ? s + (1 - s) * p.sat / 100 : s * (1 + p.sat / 100), 0, 1); }
        l = p.light > 0 ? l + (1 - l) * p.light / 100 : l * (1 + p.light / 100);
        const [r, g, b] = hslToRgb(h, s, l);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }),
  },
  colorBalance: {
    name: 'Farbbalance…',
    params: [
      { key: 'cr', label: 'Cyan ↔ Rot', min: -100, max: 100, def: 0 },
      { key: 'mg', label: 'Magenta ↔ Grün', min: -100, max: 100, def: 0 },
      { key: 'yb', label: 'Gelb ↔ Blau', min: -100, max: 100, def: 0 },
      { key: 'range', label: 'Tonbalance', type: 'select', options: [['shadows', 'Tiefen'], ['midtones', 'Mitteltöne'], ['highlights', 'Lichter']], def: 'midtones' },
      { key: 'preserve', label: 'Luminanz erhalten', type: 'checkbox', def: true },
    ],
    apply: (c, p) => pix(c, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        let wgt = p.range === 'shadows' ? clamp(1 - l * 2, 0, 1) : p.range === 'highlights' ? clamp(l * 2 - 1, 0, 1) : 1 - Math.abs(l - 0.5) * 2;
        wgt *= 0.6;
        let r = d[i] + p.cr * wgt, g = d[i + 1] + p.mg * wgt, b = d[i + 2] + p.yb * wgt;
        if (p.preserve) {
          const nl = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          const k = l - nl; r += k * 255; g += k * 255; b += k * 255;
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }),
  },
  blackWhite: {
    name: 'Schwarzweiß…',
    params: [
      { key: 'reds', label: 'Rottöne', min: -200, max: 300, def: 40 },
      { key: 'yellows', label: 'Gelbtöne', min: -200, max: 300, def: 60 },
      { key: 'greens', label: 'Grüntöne', min: -200, max: 300, def: 40 },
      { key: 'cyans', label: 'Cyantöne', min: -200, max: 300, def: 60 },
      { key: 'blues', label: 'Blautöne', min: -200, max: 300, def: 20 },
      { key: 'magentas', label: 'Magentatöne', min: -200, max: 300, def: 80 },
      { key: 'tint', label: 'Farbton', type: 'checkbox', def: false },
      { key: 'tintColor', label: 'Tönungsfarbe', type: 'color', def: '#c9a27a' },
    ],
    apply: (c, p) => {
      const tc = hexToRgb(p.tintColor);
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const [h, s] = rgbToHsl(r, g, b);
          const hd = h * 360;
          const ws = [p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas];
          const pos = hd / 60, i0 = Math.floor(pos) % 6, i1 = (i0 + 1) % 6, f = pos - Math.floor(pos);
          const wgt = (ws[i0] * (1 - f) + ws[i1] * f) / 100;
          const base = r * 0.299 + g * 0.587 + b * 0.114;
          let v = clamp(base + base * (wgt - 0.5) * s, 0, 255);
          if (p.tint) { d[i] = v * tc.r / 200; d[i + 1] = v * tc.g / 200; d[i + 2] = v * tc.b / 200; }
          else d[i] = d[i + 1] = d[i + 2] = v;
        }
      });
    },
  },
  photoFilter: {
    name: 'Fotofilter…',
    params: [
      { key: 'color', label: 'Filterfarbe', type: 'color', def: '#ec8a00' },
      { key: 'density', label: 'Dichte', min: 0, max: 100, def: 25 },
      { key: 'preserve', label: 'Luminanz erhalten', type: 'checkbox', def: true },
    ],
    apply: (c, p) => {
      const f = hexToRgb(p.color), k = p.density / 100;
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          let r = d[i] * (1 - k) + (d[i] * f.r / 255) * k * 2.2 * 0.5 + f.r * k * 0.2;
          let g = d[i + 1] * (1 - k) + (d[i + 1] * f.g / 255) * k * 1.1 + f.g * k * 0.2;
          let b = d[i + 2] * (1 - k) + (d[i + 2] * f.b / 255) * k * 1.1 + f.b * k * 0.2;
          if (p.preserve) { const nl = r * 0.299 + g * 0.587 + b * 0.114, q = l - nl; r += q; g += q; b += q; }
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
        }
      });
    },
  },
  channelMixer: {
    name: 'Kanalmixer…',
    params: [
      { key: 'rr', label: 'Rot ← Rot %', min: -200, max: 200, def: 100 },
      { key: 'rg', label: 'Rot ← Grün %', min: -200, max: 200, def: 0 },
      { key: 'rb', label: 'Rot ← Blau %', min: -200, max: 200, def: 0 },
      { key: 'gr', label: 'Grün ← Rot %', min: -200, max: 200, def: 0 },
      { key: 'gg', label: 'Grün ← Grün %', min: -200, max: 200, def: 100 },
      { key: 'gb', label: 'Grün ← Blau %', min: -200, max: 200, def: 0 },
      { key: 'br', label: 'Blau ← Rot %', min: -200, max: 200, def: 0 },
      { key: 'bg', label: 'Blau ← Grün %', min: -200, max: 200, def: 0 },
      { key: 'bb', label: 'Blau ← Blau %', min: -200, max: 200, def: 100 },
      { key: 'mono', label: 'Monochrom (nutzt Rot-Zeile)', type: 'checkbox', def: false },
    ],
    apply: (c, p) => pix(c, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const R = (r * p.rr + g * p.rg + b * p.rb) / 100;
        if (p.mono) { d[i] = d[i + 1] = d[i + 2] = R; continue; }
        d[i] = R; d[i + 1] = (r * p.gr + g * p.gg + b * p.gb) / 100; d[i + 2] = (r * p.br + g * p.bg + b * p.bb) / 100;
      }
    }),
  },
  invert: { name: 'Umkehren', params: [], apply: (c) => lutOp(c, makeLut((v) => 255 - v)) },
  posterize: {
    name: 'Tontrennung…', params: [{ key: 'levels', label: 'Stufen', min: 2, max: 255, def: 4 }],
    apply: (c, p) => lutOp(c, makeLut((v) => Math.round(Math.round((v / 255) * (p.levels - 1)) * 255 / (p.levels - 1)))),
  },
  threshold: {
    name: 'Schwellenwert…', params: [{ key: 'level', label: 'Schwellenwert', min: 1, max: 255, def: 128 }],
    apply: (c, p) => pix(c, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) >= p.level ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }),
  },
  gradientMap: {
    name: 'Verlaufsumsetzung…',
    params: [
      { key: 'c1', label: 'Tiefen-Farbe', type: 'color', def: '#2a1846' },
      { key: 'c2', label: 'Mitteltöne', type: 'color', def: '#c85fa0' },
      { key: 'c3', label: 'Lichter-Farbe', type: 'color', def: '#ffe6f4' },
      { key: 'reverse', label: 'Umkehren', type: 'checkbox', def: false },
    ],
    apply: (c, p) => {
      const cs = [hexToRgb(p.c1), hexToRgb(p.c2), hexToRgb(p.c3)];
      if (p.reverse) cs.reverse();
      const lut = [];
      for (let i = 0; i < 256; i++) {
        const t = i / 255, a = t < 0.5 ? cs[0] : cs[1], b = t < 0.5 ? cs[1] : cs[2], f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
        lut[i] = [a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f];
      }
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
          d[i] = lut[l][0]; d[i + 1] = lut[l][1]; d[i + 2] = lut[l][2];
        }
      });
    },
  },
  selectiveColor: {
    name: 'Selektive Farbkorrektur…',
    params: [
      { key: 'target', label: 'Farben', type: 'select', options: [['r', 'Rottöne'], ['y', 'Gelbtöne'], ['g', 'Grüntöne'], ['c', 'Cyantöne'], ['b', 'Blautöne'], ['m', 'Magentatöne'], ['w', 'Weiß'], ['n', 'Neutrale Farben'], ['k', 'Schwarz']], def: 'r' },
      { key: 'cyan', label: 'Cyan', min: -100, max: 100, def: 0 },
      { key: 'magenta', label: 'Magenta', min: -100, max: 100, def: 0 },
      { key: 'yellow', label: 'Gelb', min: -100, max: 100, def: 0 },
      { key: 'black', label: 'Schwarz', min: -100, max: 100, def: 0 },
    ],
    apply: (c, p) => {
      const hueC = { r: 0, y: 60, g: 120, c: 180, b: 240, m: 300 };
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
          let w;
          if (p.target in hueC) { let dh = Math.abs(h * 360 - hueC[p.target]); dh = Math.min(dh, 360 - dh); w = clamp(1 - dh / 45, 0, 1) * s; }
          else if (p.target === 'w') w = clamp((l - 0.7) / 0.3, 0, 1);
          else if (p.target === 'k') w = clamp((0.3 - l) / 0.3, 0, 1);
          else w = (1 - s) * (1 - Math.abs(l - 0.5) * 2);
          if (w <= 0) continue;
          const k = 1.28 * w;
          d[i] -= p.cyan * k + p.black * k; d[i + 1] -= p.magenta * k + p.black * k; d[i + 2] -= p.yellow * k + p.black * k;
        }
      });
    },
  },
  shadowsHighlights: {
    name: 'Tiefen/Lichter…',
    params: [
      { key: 'shadows', label: 'Tiefen aufhellen %', min: 0, max: 100, def: 35 },
      { key: 'highlights', label: 'Lichter abdunkeln %', min: 0, max: 100, def: 0 },
      { key: 'radius', label: 'Radius', min: 1, max: 100, def: 30 },
    ],
    apply: (c, p) => {
      const blur = cssFilter(c, `blur(${p.radius}px)`);
      const bd = ctx2d(blur).getImageData(0, 0, c.width, c.height).data;
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const bl = (bd[i] * 0.299 + bd[i + 1] * 0.587 + bd[i + 2] * 0.114) / 255;
          const lift = (p.shadows / 100) * Math.pow(1 - bl, 2) * 0.9;
          const drop = (p.highlights / 100) * Math.pow(bl, 2) * 0.9;
          for (let k = 0; k < 3; k++) {
            let v = d[i + k] / 255;
            v = v + (1 - v) * lift * (1 - v * 0.5);
            v = v - v * drop;
            d[i + k] = v * 255;
          }
        }
      });
    },
  },
  hdrToning: {
    name: 'HDR-Tonung…',
    params: [
      { key: 'radius', label: 'Radius', min: 1, max: 200, def: 60 },
      { key: 'strength', label: 'Stärke', min: 0, max: 3, step: 0.01, def: 0.8 },
      { key: 'detail', label: 'Detail %', min: -100, max: 300, def: 60 },
    ],
    apply: (c, p) => {
      const blur = cssFilter(c, `blur(${p.radius}px)`);
      const bd = ctx2d(blur).getImageData(0, 0, c.width, c.height).data;
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) {
          const det = d[i + k] - bd[i + k];
          d[i + k] = 128 + (bd[i + k] - 128) * (1 - p.strength * 0.4) + det * (1 + p.detail / 100) + (d[i + k] - 128) * 0;
        }
      });
    },
  },
  desaturate: { name: 'Sättigung verringern', params: [], apply: (c) => pix(c, (d) => { for (let i = 0; i < d.length; i += 4) { const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; d[i] = d[i + 1] = d[i + 2] = v; } }) },
  equalize: {
    name: 'Tonwertangleichung', params: [],
    apply: (c) => {
      const hgm = histogram(c).l; let tot = 0; for (let i = 0; i < 256; i++) tot += hgm[i];
      const cdf = []; let acc = 0; for (let i = 0; i < 256; i++) { acc += hgm[i]; cdf[i] = acc / (tot || 1); }
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
          const k = l ? (cdf[l] * 255) / l : 1;
          d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
        }
      });
    },
  },
  autoTone: {
    name: 'Auto-Farbton', params: [],
    apply: (c) => {
      const hg = histogram(c);
      const [r0, r1] = autoRange(hg.r), [g0, g1] = autoRange(hg.g), [b0, b1] = autoRange(hg.b);
      return lutOp(c, levelsLut(r0, 1, r1, 0, 255), levelsLut(g0, 1, g1, 0, 255), levelsLut(b0, 1, b1, 0, 255));
    },
  },
  autoContrast: {
    name: 'Auto-Kontrast', params: [],
    apply: (c) => { const [a, b] = autoRange(histogram(c).l); return lutOp(c, levelsLut(a, 1, b, 0, 255)); },
  },
  autoColor: {
    name: 'Auto-Farbe', params: [],
    apply: (c) => {
      const t = ADJUSTMENTS.autoTone.apply(c);
      // Mitteltöne neutralisieren
      const d = ctx2d(t).getImageData(0, 0, t.width, t.height).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 64) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      const avg = (r + g + b) / (3 * n);
      const gr = Math.log(avg / 255) / Math.log((r / n) / 255 || 0.5), gg = Math.log(avg / 255) / Math.log((g / n) / 255 || 0.5), gb = Math.log(avg / 255) / Math.log((b / n) / 255 || 0.5);
      const mk = (gm) => makeLut((v) => 255 * Math.pow(v / 255, clamp(gm, 0.6, 1.6)));
      return lutOp(t, mk(gr), mk(gg), mk(gb));
    },
  },
  matchColor: {
    name: 'Farbe ersetzen…',
    params: [
      { key: 'from', label: 'Quellfarbe', type: 'color', def: '#e48bc0' },
      { key: 'to', label: 'Ersatzfarbe', type: 'color', def: '#7fb5ff' },
      { key: 'fuzz', label: 'Toleranz', min: 0, max: 200, def: 60 },
    ],
    apply: (c, p) => {
      const f = hexToRgb(p.from), t = hexToRgb(p.to);
      const [th, ts] = rgbToHsl(t.r, t.g, t.b);
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const dd = Math.hypot(d[i] - f.r, d[i + 1] - f.g, d[i + 2] - f.b);
          const w = clamp(1 - dd / (p.fuzz + 1), 0, 1);
          if (!w) continue;
          const [, , l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
          const [r, g, b] = hslToRgb(th, ts, l);
          d[i] += (r - d[i]) * w; d[i + 1] += (g - d[i + 1]) * w; d[i + 2] += (b - d[i + 2]) * w;
        }
      });
    },
  },
};

// ======================= FILTER =======================
export const FILTERS = {
  gaussian: { group: 'Weichzeichnungsfilter', name: 'Gaußscher Weichzeichner…', params: [{ key: 'radius', label: 'Radius (Px)', min: 0.1, max: 250, step: 0.1, def: 4 }], apply: (c, p) => cssFilter(c, `blur(${p.radius}px)`) },
  boxBlur: {
    group: 'Weichzeichnungsfilter', name: 'Durchschnitt berechnen', params: [],
    apply: (c) => pix(c, (d) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
    }),
  },
  motionBlur: {
    group: 'Weichzeichnungsfilter', name: 'Bewegungsunschärfe…',
    params: [{ key: 'angle', label: 'Winkel', min: -180, max: 180, def: 0 }, { key: 'dist', label: 'Abstand (Px)', min: 1, max: 300, def: 20 }],
    apply: (c, p) => {
      const out = makeCanvas(c.width, c.height); const x = ctx2d(out);
      const steps = Math.min(60, Math.max(4, Math.round(p.dist / 2)));
      const a = p.angle * Math.PI / 180;
      for (let i = 0; i < steps; i++) {
        const t = (i / (steps - 1) - 0.5) * p.dist;
        x.globalAlpha = 1 / (i + 1);
        x.drawImage(c, Math.cos(a) * t, -Math.sin(a) * t);
      }
      return out;
    },
  },
  radialBlur: {
    group: 'Weichzeichnungsfilter', name: 'Radialer Weichzeichner…',
    params: [{ key: 'amount', label: 'Stärke', min: 1, max: 100, def: 10 }, { key: 'mode', label: 'Methode', type: 'select', options: [['zoom', 'Strahlenförmig'], ['spin', 'Kreisförmig']], def: 'zoom' }],
    apply: (c, p) => {
      const out = makeCanvas(c.width, c.height); const x = ctx2d(out);
      const steps = 24, cx = c.width / 2, cy = c.height / 2;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1) - 0.5;
        x.save(); x.globalAlpha = 1 / (i + 1);
        x.translate(cx, cy);
        if (p.mode === 'zoom') { const s = 1 + t * p.amount / 150; x.scale(s, s); } else x.rotate(t * p.amount * Math.PI / 360);
        x.drawImage(c, -cx, -cy); x.restore();
      }
      return out;
    },
  },
  lensBlur: { group: 'Weichzeichnungsfilter', name: 'Tiefenschärfe (Tilt-Shift)…', params: [{ key: 'radius', label: 'Radius', min: 1, max: 60, def: 10 }, { key: 'focus', label: 'Schärfezone %', min: 5, max: 90, def: 30 }],
    apply: (c, p) => {
      const blur = cssFilter(c, `blur(${p.radius}px)`);
      const out = makeCanvas(c.width, c.height); const x = ctx2d(out);
      x.drawImage(blur, 0, 0);
      const m = makeCanvas(c.width, c.height); const mx = ctx2d(m);
      const g = mx.createLinearGradient(0, 0, 0, c.height);
      const f = p.focus / 200;
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(Math.max(0, 0.5 - f - 0.15), 'rgba(0,0,0,0)');
      g.addColorStop(0.5 - f, '#000'); g.addColorStop(0.5 + f, '#000');
      g.addColorStop(Math.min(1, 0.5 + f + 0.15), 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      mx.fillStyle = g; mx.fillRect(0, 0, c.width, c.height);
      mx.globalCompositeOperation = 'source-in'; mx.drawImage(c, 0, 0);
      x.drawImage(m, 0, 0);
      return out;
    } },
  surfaceBlur: {
    group: 'Weichzeichnungsfilter', name: 'Matter machen…',
    params: [{ key: 'radius', label: 'Radius', min: 1, max: 20, def: 5 }, { key: 'threshold', label: 'Schwellenwert', min: 2, max: 255, def: 25 }],
    apply: (c, p) => {
      const blur = cssFilter(c, `blur(${p.radius}px)`);
      const bd = ctx2d(blur).getImageData(0, 0, c.width, c.height).data;
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const diff = Math.abs(d[i] - bd[i]) + Math.abs(d[i + 1] - bd[i + 1]) + Math.abs(d[i + 2] - bd[i + 2]);
          const w = clamp(1 - diff / (p.threshold * 3), 0, 1);
          for (let k = 0; k < 3; k++) d[i + k] += (bd[i + k] - d[i + k]) * w;
        }
      });
    },
  },
  sharpen: { group: 'Scharfzeichnungsfilter', name: 'Scharfzeichnen', params: [], apply: (c) => convolve(c, [0, -1, 0, -1, 5, -1, 0, -1, 0]) },
  sharpenMore: { group: 'Scharfzeichnungsfilter', name: 'Stärker scharfzeichnen', params: [], apply: (c) => convolve(c, [-1, -1, -1, -1, 9, -1, -1, -1, -1]) },
  unsharp: {
    group: 'Scharfzeichnungsfilter', name: 'Unscharf maskieren…',
    params: [{ key: 'amount', label: 'Stärke %', min: 1, max: 500, def: 100 }, { key: 'radius', label: 'Radius (Px)', min: 0.1, max: 100, step: 0.1, def: 2 }, { key: 'threshold', label: 'Schwellenwert', min: 0, max: 255, def: 0 }],
    apply: (c, p) => {
      const bd = ctx2d(cssFilter(c, `blur(${p.radius}px)`)).getImageData(0, 0, c.width, c.height).data;
      return pix(c, (d) => {
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) {
          const diff = d[i + k] - bd[i + k];
          if (Math.abs(diff) >= p.threshold) d[i + k] += diff * p.amount / 100;
        }
      });
    },
  },
  addNoise: {
    group: 'Rauschfilter', name: 'Rauschen hinzufügen…',
    params: [{ key: 'amount', label: 'Stärke %', min: 0.1, max: 400, step: 0.1, def: 12 }, { key: 'gauss', label: 'Gaußsche Normalverteilung', type: 'checkbox', def: true }, { key: 'mono', label: 'Monochromatisch', type: 'checkbox', def: false }],
    apply: (c, p) => pix(c, (d) => {
      const a = p.amount * 1.28;
      const rnd = () => p.gauss ? (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 : Math.random() * 2 - 1;
      for (let i = 0; i < d.length; i += 4) {
        if (p.mono) { const n = rnd() * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
        else { d[i] += rnd() * a; d[i + 1] += rnd() * a; d[i + 2] += rnd() * a; }
      }
    }),
  },
  median: {
    group: 'Rauschfilter', name: 'Median…', params: [{ key: 'radius', label: 'Radius', min: 1, max: 6, def: 1 }],
    apply: (c, p) => {
      const w = c.width, h = c.height, r = p.radius;
      const sd = ctx2d(c).getImageData(0, 0, w, h).data;
      return pix(c, (d) => {
        const buf = [[], [], []];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          buf[0].length = buf[1].length = buf[2].length = 0;
          for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
            const q = (yy * w + xx) * 4; buf[0].push(sd[q]); buf[1].push(sd[q + 1]); buf[2].push(sd[q + 2]);
          }
          const o = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) { buf[k].sort((a, b) => a - b); d[o + k] = buf[k][buf[k].length >> 1]; }
        }
      });
    },
  },
  despeckle: { group: 'Rauschfilter', name: 'Rauschen entfernen', params: [], apply: (c) => FILTERS.surfaceBlur.apply(c, { radius: 2, threshold: 18 }) },
  emboss: {
    group: 'Stilisierungsfilter', name: 'Relief…', params: [{ key: 'gray', label: 'Graustufen', type: 'checkbox', def: true }],
    apply: (c, p) => {
      const o = convolve(c, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1, 0);
      return p.gray ? ADJUSTMENTS.desaturate.apply(o) : o;
    },
  },
  findEdges: { group: 'Stilisierungsfilter', name: 'Konturen finden', params: [], apply: (c) => ADJUSTMENTS.invert.apply(convolve(c, [-1, -1, -1, -1, 8, -1, -1, -1, -1])) },
  glowingEdges: { group: 'Stilisierungsfilter', name: 'Leuchtende Konturen', params: [], apply: (c) => convolve(c, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 0) },
  solarize: { group: 'Stilisierungsfilter', name: 'Solarisation', params: [], apply: (c) => lutOp(c, makeLut((v) => (v > 127 ? 255 - v : v) * 2)) },
  oilPaint: {
    group: 'Stilisierungsfilter', name: 'Ölfarbe…', params: [{ key: 'radius', label: 'Stilisierung', min: 1, max: 6, def: 3 }, { key: 'levels', label: 'Sauberkeit', min: 4, max: 40, def: 16 }],
    apply: (c, p) => {
      const w = c.width, h = c.height, r = p.radius, L = p.levels;
      const sd = ctx2d(c).getImageData(0, 0, w, h).data;
      return pix(c, (d) => {
        const cnt = new Int32Array(L), sr = new Int32Array(L), sg = new Int32Array(L), sb = new Int32Array(L);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
          for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
            const q = (yy * w + xx) * 4;
            const li = (((sd[q] + sd[q + 1] + sd[q + 2]) / 3) * L / 256) | 0;
            cnt[li]++; sr[li] += sd[q]; sg[li] += sd[q + 1]; sb[li] += sd[q + 2];
          }
          let best = 0; for (let i = 1; i < L; i++) if (cnt[i] > cnt[best]) best = i;
          const o = (y * w + x) * 4;
          d[o] = sr[best] / cnt[best]; d[o + 1] = sg[best] / cnt[best]; d[o + 2] = sb[best] / cnt[best];
        }
      });
    },
  },
  twirl: {
    group: 'Verzerrungsfilter', name: 'Strudel…', params: [{ key: 'angle', label: 'Winkel', min: -999, max: 999, def: 180 }],
    apply: (c, p) => warp(c, (x, y, cx, cy, R) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r > R) return [x, y];
      const a = Math.atan2(dy, dx) + (p.angle * Math.PI / 180) * (1 - r / R);
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }),
  },
  spherize: {
    group: 'Verzerrungsfilter', name: 'Wölben…', params: [{ key: 'amount', label: 'Stärke %', min: -100, max: 100, def: 60 }],
    apply: (c, p) => warp(c, (x, y, cx, cy, R) => {
      const dx = (x - cx) / R, dy = (y - cy) / R, r = Math.hypot(dx, dy);
      if (r >= 1 || r === 0) return [x, y];
      const k = p.amount / 100;
      const nr = k >= 0 ? Math.pow(r, 1 + k) : r + (Math.sin(r * Math.PI / 2) - r) * -k;
      return [cx + dx / r * nr * R, cy + dy / r * nr * R];
    }),
  },
  pinch: {
    group: 'Verzerrungsfilter', name: 'Distorsion (Zusammenziehen)…', params: [{ key: 'amount', label: 'Stärke %', min: -100, max: 100, def: 50 }],
    apply: (c, p) => warp(c, (x, y, cx, cy, R) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r >= R || r === 0) return [x, y];
      const f = Math.pow(Math.sin(Math.PI * r / R / 2), -p.amount / 100);
      return [cx + dx * f, cy + dy * f];
    }),
  },
  wave: {
    group: 'Verzerrungsfilter', name: 'Welle…', params: [{ key: 'amp', label: 'Amplitude', min: 1, max: 200, def: 12 }, { key: 'len', label: 'Wellenlänge', min: 2, max: 600, def: 80 }],
    apply: (c, p) => warp(c, (x, y) => [x + Math.sin(y / p.len * Math.PI * 2) * p.amp, y + Math.sin(x / p.len * Math.PI * 2) * p.amp]),
  },
  ripple: {
    group: 'Verzerrungsfilter', name: 'Kräuseln…', params: [{ key: 'amp', label: 'Stärke', min: 1, max: 60, def: 6 }],
    apply: (c, p) => warp(c, (x, y, cx, cy) => {
      const r = Math.hypot(x - cx, y - cy);
      const o = Math.sin(r / 12) * p.amp;
      return [x + o, y + o];
    }),
  },
  polar: {
    group: 'Verzerrungsfilter', name: 'Polarkoordinaten', params: [],
    apply: (c) => warp(c, (x, y, cx, cy, R, w, h) => {
      const dx = x - cx, dy = y - cy;
      const a = (Math.atan2(dx, -dy) + Math.PI) / (2 * Math.PI);
      return [a * w, Math.hypot(dx, dy) / R * h];
    }),
  },
  pixelate: {
    group: 'Vergröberungsfilter', name: 'Mosaik…', params: [{ key: 'size', label: 'Zellengröße', min: 2, max: 200, def: 12 }],
    apply: (c, p) => {
      const s = p.size, w = Math.ceil(c.width / s), h = Math.ceil(c.height / s);
      const small = makeCanvas(w, h); const sx = ctx2d(small); sx.imageSmoothingQuality = 'high'; sx.drawImage(c, 0, 0, w, h);
      const out = makeCanvas(c.width, c.height); const ox = ctx2d(out);
      ox.imageSmoothingEnabled = false; ox.drawImage(small, 0, 0, w * s, h * s);
      return out;
    },
  },
  crystallize: {
    group: 'Vergröberungsfilter', name: 'Kristallisieren…', params: [{ key: 'size', label: 'Zellengröße', min: 3, max: 120, def: 16 }],
    apply: (c, p) => {
      const w = c.width, h = c.height, s = p.size;
      const sd = ctx2d(c).getImageData(0, 0, w, h).data;
      const gw = Math.ceil(w / s), gh = Math.ceil(h / s);
      const pts = [];
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) pts.push([(i + Math.random()) * s, (j + Math.random()) * s]);
      return pix(c, (d) => {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const gi = (x / s) | 0, gj = (y / s) | 0;
          let best = 1e9, bp = null;
          for (let jj = gj - 1; jj <= gj + 1; jj++) for (let ii = gi - 1; ii <= gi + 1; ii++) {
            if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
            const q = pts[jj * gw + ii], dd = (q[0] - x) ** 2 + (q[1] - y) ** 2;
            if (dd < best) { best = dd; bp = q; }
          }
          const sx = clamp(bp[0] | 0, 0, w - 1), sy = clamp(bp[1] | 0, 0, h - 1), q = (sy * w + sx) * 4, o = (y * w + x) * 4;
          d[o] = sd[q]; d[o + 1] = sd[q + 1]; d[o + 2] = sd[q + 2];
        }
      });
    },
  },
  halftone: {
    group: 'Vergröberungsfilter', name: 'Farbraster…', params: [{ key: 'size', label: 'Max. Radius', min: 3, max: 40, def: 8 }],
    apply: (c, p) => {
      const s = p.size * 2, w = c.width, h = c.height;
      const sd = ctx2d(c).getImageData(0, 0, w, h).data;
      const out = makeCanvas(w, h); const x = ctx2d(out);
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += s) for (let xx = 0; xx < w; xx += s) {
        const q = (Math.min(h - 1, y + s / 2 | 0) * w + Math.min(w - 1, xx + s / 2 | 0)) * 4;
        const l = 1 - (sd[q] * 0.299 + sd[q + 1] * 0.587 + sd[q + 2] * 0.114) / 255;
        x.fillStyle = `rgb(${sd[q]},${sd[q + 1]},${sd[q + 2]})`;
        x.beginPath(); x.arc(xx + s / 2, y + s / 2, Math.max(0.5, (0.35 + l * 0.65) * s / 2), 0, Math.PI * 2); x.fill();
      }
      return out;
    },
  },
  clouds: {
    group: 'Renderfilter', name: 'Wolken', params: [], usesColors: true,
    apply: (c, p) => {
      const out = makeCanvas(c.width, c.height); const x = ctx2d(out);
      const a = hexToRgb(p.fg || '#000'), b = hexToRgb(p.bg || '#fff');
      const id = x.createImageData(c.width, c.height);
      const noise = valueNoise(c.width, c.height);
      for (let i = 0, j = 0; i < id.data.length; i += 4, j++) {
        const t = noise[j];
        id.data[i] = a.r + (b.r - a.r) * t; id.data[i + 1] = a.g + (b.g - a.g) * t; id.data[i + 2] = a.b + (b.b - a.b) * t; id.data[i + 3] = 255;
      }
      x.putImageData(id, 0, 0);
      return out;
    },
  },
  lensFlare: {
    group: 'Renderfilter', name: 'Blendenflecke…', params: [{ key: 'x', label: 'Position X %', min: 0, max: 100, def: 30 }, { key: 'y', label: 'Position Y %', min: 0, max: 100, def: 30 }, { key: 'bright', label: 'Helligkeit %', min: 10, max: 300, def: 100 }],
    apply: (c, p) => {
      const out = makeCanvas(c.width, c.height); const x = ctx2d(out);
      x.drawImage(c, 0, 0);
      const fx = c.width * p.x / 100, fy = c.height * p.y / 100, cx = c.width / 2, cy = c.height / 2;
      const R = Math.min(c.width, c.height) * 0.25 * p.bright / 100;
      x.globalCompositeOperation = 'screen';
      const blob = (px, py, r, col, a) => {
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      };
      blob(fx, fy, R, '255,255,240', 1); blob(fx, fy, R * 0.25, '255,255,255', 1);
      [[0.3, 0.12, '255,180,220'], [0.6, 0.06, '180,200,255'], [1.2, 0.18, '255,210,150'], [1.6, 0.09, '200,255,220']].forEach(([t, s, col]) => {
        blob(fx + (cx - fx) * t * 2, fy + (cy - fy) * t * 2, R * s * 2, col, 0.35);
      });
      return out;
    },
  },
  vignette: {
    group: 'Renderfilter', name: 'Vignette…', params: [{ key: 'amount', label: 'Stärke %', min: 0, max: 100, def: 55 }, { key: 'size', label: 'Größe %', min: 10, max: 100, def: 60 }],
    apply: (c, p) => {
      const out = makeCanvas(c.width, c.height); const x = ctx2d(out); x.drawImage(c, 0, 0);
      const r = Math.hypot(c.width, c.height) / 2;
      const g = x.createRadialGradient(c.width / 2, c.height / 2, r * p.size / 100 * 0.6, c.width / 2, c.height / 2, r);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${p.amount / 100})`);
      x.globalCompositeOperation = 'source-atop'; x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      return out;
    },
  },
  highPass: {
    group: 'Sonstige Filter', name: 'Hochpass…', params: [{ key: 'radius', label: 'Radius (Px)', min: 0.1, max: 200, step: 0.1, def: 10 }],
    apply: (c, p) => {
      const bd = ctx2d(cssFilter(c, `blur(${p.radius}px)`)).getImageData(0, 0, c.width, c.height).data;
      return pix(c, (d) => { for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = 128 + d[i + k] - bd[i + k]; });
    },
  },
  offset: {
    group: 'Sonstige Filter', name: 'Verschiebungseffekt…', params: [{ key: 'dx', label: 'Horizontal (Px)', min: -2000, max: 2000, def: 100 }, { key: 'dy', label: 'Vertikal (Px)', min: -2000, max: 2000, def: 100 }],
    apply: (c, p) => {
      const out = makeCanvas(c.width, c.height); const x = ctx2d(out);
      const w = c.width, h = c.height, dx = ((p.dx % w) + w) % w, dy = ((p.dy % h) + h) % h;
      for (const ox of [dx - w, dx]) for (const oy of [dy - h, dy]) x.drawImage(c, ox, oy);
      return out;
    },
  },
  maximum: { group: 'Sonstige Filter', name: 'Helle Bereiche vergrößern…', params: [{ key: 'r', label: 'Radius', min: 1, max: 10, def: 1 }], apply: (c, p) => morph(c, p.r, Math.max) },
  minimum: { group: 'Sonstige Filter', name: 'Dunkle Bereiche vergrößern…', params: [{ key: 'r', label: 'Radius', min: 1, max: 10, def: 1 }], apply: (c, p) => morph(c, p.r, Math.min) },
  liquifyLite: {
    group: 'Verzerrungsfilter', name: 'Verflüssigen (Aufblasen)…',
    params: [{ key: 'x', label: 'Mitte X %', min: 0, max: 100, def: 50 }, { key: 'y', label: 'Mitte Y %', min: 0, max: 100, def: 50 }, { key: 'r', label: 'Radius %', min: 2, max: 60, def: 15 }, { key: 'amount', label: 'Stärke %', min: -100, max: 100, def: 40 }],
    apply: (c, p) => warp(c, (x, y, cx0, cy0, R0, w, h) => {
      const cx = w * p.x / 100, cy = h * p.y / 100, R = Math.min(w, h) * p.r / 100;
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r >= R) return [x, y];
      const t = r / R, f = 1 - (p.amount / 100) * (1 - t * t) * 0.6;
      return [cx + dx * f, cy + dy * f];
    }),
  },
};

function morph(c, r, op) {
  const w = c.width, h = c.height, sd = ctx2d(c).getImageData(0, 0, w, h).data;
  return pix(c, (d) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let v0 = sd[o], v1 = sd[o + 1], v2 = sd[o + 2];
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const q = (yy * w + xx) * 4; v0 = op(v0, sd[q]); v1 = op(v1, sd[q + 1]); v2 = op(v2, sd[q + 2]);
      }
      d[o] = v0; d[o + 1] = v1; d[o + 2] = v2;
    }
  });
}

function warp(c, fn) {
  const w = c.width, h = c.height;
  const sd = ctx2d(c).getImageData(0, 0, w, h).data;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  return pix(c, (d) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [sx, sy] = fn(x, y, cx, cy, R, w, h);
      const ix = Math.floor(sx), iy = Math.floor(sy), o = (y * w + x) * 4;
      if (ix < 0 || iy < 0 || ix >= w - 1 || iy >= h - 1) {
        const q = (clamp(Math.round(sy), 0, h - 1) * w + clamp(Math.round(sx), 0, w - 1)) * 4;
        d[o] = sd[q]; d[o + 1] = sd[q + 1]; d[o + 2] = sd[q + 2]; d[o + 3] = sd[q + 3];
        continue;
      }
      const fx = sx - ix, fy = sy - iy;
      const q00 = (iy * w + ix) * 4, q10 = q00 + 4, q01 = q00 + w * 4, q11 = q01 + 4;
      for (let k = 0; k < 4; k++) {
        d[o + k] = (sd[q00 + k] * (1 - fx) + sd[q10 + k] * fx) * (1 - fy) + (sd[q01 + k] * (1 - fx) + sd[q11 + k] * fx) * fy;
      }
    }
  });
}

function valueNoise(w, h) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let oct = 0; oct < 6; oct++) {
    const cell = Math.max(2, 256 >> oct);
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const grid = new Float32Array(gw * gh).map(() => Math.random());
    for (let y = 0; y < h; y++) {
      const gy = y / cell, iy = gy | 0, fy = gy - iy, sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < w; x++) {
        const gx = x / cell, ix = gx | 0, fx = gx - ix, sx = fx * fx * (3 - 2 * fx);
        const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1], c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
        out[y * w + x] += ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy) * amp;
      }
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export { cssFilter, pix, boxBlurAlpha };
