// PSD-Import/-Export über ag-psd: Ebenen, Gruppen, Masken, Text, Einstellungsebenen
import { readPsd as agRead, writePsd as agWrite } from 'ag-psd';
import { Doc, Layer, flattenToCanvas, normalizeTree, childrenOf } from '../engine/doc.js';
import { makeCanvas, ctx2d, alphaBounds, hexToRgb, rgbToHex } from '../engine/util.js';
import { ADJUSTMENTS } from '../engine/filters.js';

const toAg = {
  normal: 'normal', dissolve: 'dissolve', darken: 'darken', multiply: 'multiply', 'color-burn': 'color burn', 'darker-color': 'darker color',
  lighten: 'lighten', screen: 'screen', 'color-dodge': 'color dodge', lighter: 'linear dodge', overlay: 'overlay', 'soft-light': 'soft light',
  'hard-light': 'hard light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  pass: 'pass through',
};
const fromAg = Object.fromEntries(Object.entries(toAg).map(([a, b]) => [b, a]));
fromAg['linear burn'] = 'multiply'; fromAg['lighter color'] = 'lighten'; fromAg['vivid light'] = 'hard-light'; fromAg['linear light'] = 'hard-light';
fromAg['pin light'] = 'hard-light'; fromAg['hard mix'] = 'hard-light'; fromAg['subtract'] = 'difference'; fromAg['divide'] = 'color-dodge';

const rgbOf = (c) => (c && c.r != null ? rgbToHex(c.r, c.g, c.b) : '#000000');
const colOf = (hex) => { const { r, g, b } = hexToRgb(hex); return { r, g, b }; };

// ---------- Einstellungsebenen: PSD ↔ Sakura ----------
function adjFromPsd(a) {
  if (!a) return null;
  const P = (id) => Object.fromEntries(ADJUSTMENTS[id].params.map((p) => [p.key, p.def]));
  switch (a.type) {
    case 'brightness/contrast': return { id: 'brightness', params: { brightness: a.brightness || 0, contrast: a.contrast || 0 } };
    case 'levels': { const c = a.rgb || {}; return { id: 'levels', params: { inB: c.shadowInput ?? 0, inW: c.highlightInput ?? 255, outB: c.shadowOutput ?? 0, outW: c.highlightOutput ?? 255, gamma: c.midtoneInput ?? 1 } }; }
    case 'curves': { const cv = (ch) => (ch && ch.length ? ch.map((q) => [q.input, q.output]) : [[0, 0], [255, 255]]); return { id: 'curves', params: { rgb: cv(a.rgb), r: cv(a.red), g: cv(a.green), b: cv(a.blue) } }; }
    case 'exposure': return { id: 'exposure', params: { exposure: a.exposure || 0, offset: a.offset || 0, gamma: a.gamma || 1 } };
    case 'vibrance': return { id: 'vibrance', params: { vibrance: a.vibrance || 0, saturation: a.saturation || 0 } };
    case 'hue/saturation': { const m = a.master || {}; return { id: 'hueSat', params: { ...P('hueSat'), hue: m.hue || 0, sat: m.saturation || 0, light: m.lightness || 0 } }; }
    case 'color balance': {
      const range = ['midtones', 'shadows', 'highlights'].find((r) => a[r] && (a[r].cyanRed || a[r].magentaGreen || a[r].yellowBlue)) || 'midtones';
      const v = a[range] || {};
      return { id: 'colorBalance', params: { cr: v.cyanRed || 0, mg: v.magentaGreen || 0, yb: v.yellowBlue || 0, range, preserve: a.preserveLuminosity !== false } };
    }
    case 'black & white': return { id: 'blackWhite', params: { reds: a.reds ?? 40, yellows: a.yellows ?? 60, greens: a.greens ?? 40, cyans: a.cyans ?? 60, blues: a.blues ?? 20, magentas: a.magentas ?? 80, tint: !!a.useTint, tintColor: a.tintColor ? rgbOf(a.tintColor) : '#c9a27a' } };
    case 'photo filter': return { id: 'photoFilter', params: { color: a.color ? rgbOf(a.color) : '#ec8a00', density: a.density ?? 25, preserve: a.preserveLuminosity !== false } };
    case 'channel mixer': { const r = a.red || {}, g = a.green || {}, b = a.blue || {}; return { id: 'channelMixer', params: { rr: r.red ?? 100, rg: r.green ?? 0, rb: r.blue ?? 0, gr: g.red ?? 0, gg: g.green ?? 100, gb: g.blue ?? 0, br: b.red ?? 0, bg: b.green ?? 0, bb: b.blue ?? 100, mono: !!a.monochrome } }; }
    case 'invert': return { id: 'invert', params: {} };
    case 'posterize': return { id: 'posterize', params: { levels: a.levels || 4 } };
    case 'threshold': return { id: 'threshold', params: { level: a.level || 128 } };
    case 'gradient map': {
      const st = (a.colorStops || []).slice().sort((x, y) => x.location - y.location);
      const at = (t) => { if (!st.length) return '#808080'; let best = st[0]; st.forEach((s) => { if (Math.abs(s.location / 4096 - t) < Math.abs(best.location / 4096 - t)) best = s; }); return rgbOf(best.color); };
      return { id: 'gradientMap', params: { c1: at(0), c2: at(0.5), c3: at(1), reverse: !!a.reverse } };
    }
    default: return null;
  }
}

function adjToPsd(adj) {
  const p = adj.params || {};
  switch (adj.id) {
    case 'brightness': return { type: 'brightness/contrast', brightness: Math.round(p.brightness), contrast: Math.round(p.contrast), useLegacy: false };
    case 'levels': return { type: 'levels', rgb: { shadowInput: p.inB, highlightInput: p.inW, shadowOutput: p.outB, highlightOutput: p.outW, midtoneInput: p.gamma } };
    case 'curves': { const cv = (pts) => (pts || [[0, 0], [255, 255]]).map(([x, y]) => ({ input: Math.round(x), output: Math.round(y) })); return { type: 'curves', rgb: cv(p.rgb), red: cv(p.r), green: cv(p.g), blue: cv(p.b) }; }
    case 'exposure': return { type: 'exposure', exposure: p.exposure, offset: p.offset, gamma: p.gamma };
    case 'vibrance': return { type: 'vibrance', vibrance: Math.round(p.vibrance), saturation: Math.round(p.saturation) };
    case 'hueSat': return { type: 'hue/saturation', master: { a: 0, b: 0, c: 0, d: 0, hue: Math.round(p.hue), saturation: Math.round(p.sat), lightness: Math.round(p.light) } };
    case 'colorBalance': { const z = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 }; return { type: 'color balance', shadows: z, midtones: z, highlights: z, [p.range || 'midtones']: { cyanRed: Math.round(p.cr), magentaGreen: Math.round(p.mg), yellowBlue: Math.round(p.yb) }, preserveLuminosity: !!p.preserve }; }
    case 'blackWhite': return { type: 'black & white', reds: p.reds, yellows: p.yellows, greens: p.greens, cyans: p.cyans, blues: p.blues, magentas: p.magentas, useTint: !!p.tint, tintColor: colOf(p.tintColor || '#c9a27a') };
    case 'photoFilter': return { type: 'photo filter', color: colOf(p.color || '#ec8a00'), density: p.density, preserveLuminosity: !!p.preserve };
    case 'channelMixer': return { type: 'channel mixer', monochrome: !!p.mono, red: { red: p.rr, green: p.rg, blue: p.rb, constant: 0 }, green: { red: p.gr, green: p.gg, blue: p.gb, constant: 0 }, blue: { red: p.br, green: p.bg, blue: p.bb, constant: 0 } };
    case 'invert': return { type: 'invert' };
    case 'posterize': return { type: 'posterize', levels: Math.round(p.levels) };
    case 'threshold': return { type: 'threshold', level: Math.round(p.level) };
    case 'gradientMap': return { type: 'gradient map', gradientType: 'solid', reverse: !!p.reverse, colorStops: [[p.c1, 0], [p.c2, 2048], [p.c3, 4096]].map(([c, loc]) => ({ color: colOf(c || '#808080'), location: loc, midpoint: 50 })), opacityStops: [{ opacity: 1, location: 0, midpoint: 50 }, { opacity: 1, location: 4096, midpoint: 50 }] };
    default: return null;
  }
}

function maskFromPsd(mask, w, h) {
  if (!mask || !mask.canvas) return null;
  const m = makeCanvas(w, h); const mx = ctx2d(m);
  if ((mask.defaultColor ?? 0) > 127) { mx.fillStyle = '#fff'; mx.fillRect(0, 0, w, h); }
  const t = makeCanvas(mask.canvas.width, mask.canvas.height); const tx = ctx2d(t);
  tx.drawImage(mask.canvas, 0, 0);
  const id = tx.getImageData(0, 0, t.width, t.height);
  for (let i = 0; i < id.data.length; i += 4) { const v = id.data[i]; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = v; }
  tx.putImageData(id, 0, 0);
  mx.clearRect(mask.left || 0, mask.top || 0, t.width, t.height);
  mx.drawImage(t, mask.left || 0, mask.top || 0);
  return m;
}

function maskToPsd(mask, w, h) {
  const m = makeCanvas(w, h); const mx = ctx2d(m);
  mx.fillStyle = '#000'; mx.fillRect(0, 0, w, h);
  const t = makeCanvas(w, h); const tx = ctx2d(t); tx.drawImage(mask, 0, 0);
  tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, w, h);
  mx.drawImage(t, 0, 0);
  return { left: 0, top: 0, canvas: m, defaultColor: 0 };
}

export function readPsd(bytes, name) {
  const psd = agRead(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { skipThumbnail: true });
  const W = psd.width, H = psd.height;
  const d = new Doc(W, H, name + '.psd');
  const out = [];
  const walk = (nodes, parentId) => {
    (nodes || []).forEach((n) => {
      const l = new Layer(W, H, n.name || 'Ebene');
      l.parent = parentId;
      l.visible = !n.hidden;
      l.opacity = n.opacity ?? 1;
      l.fill = n.fillOpacity ?? 1;
      l.blend = fromAg[n.blendMode] || 'normal';
      l.clip = !!n.clipping;
      l.mask = maskFromPsd(n.mask, W, H);
      if (n.children) {
        l.type = 'group'; l.collapsed = !n.opened;
        if (!n.blendMode || n.blendMode === 'pass through') l.blend = 'pass';
        out.push(l);
        walk(n.children, l.id);
        return;
      }
      const adj = adjFromPsd(n.adjustment);
      if (adj) {
        l.type = 'adjust'; l.adjust = adj;
        if (!l.mask) { l.mask = makeCanvas(W, H); const mx = ctx2d(l.mask); mx.fillStyle = '#fff'; mx.fillRect(0, 0, W, H); }
        out.push(l); return;
      }
      if (n.canvas) l.ctx.drawImage(n.canvas, n.left || 0, n.top || 0);
      if (n.text && n.text.text != null) {
        // Text bleibt bearbeitbar; Darstellung zunächst aus der PSD übernommen
        const st = (n.text.style || {});
        const tr = n.text.transform || [1, 0, 0, 1, n.left || 0, n.top || 0];
        const scale = Math.sqrt(Math.abs(tr[0] * tr[3] - tr[1] * tr[2])) || 1;
        const size = Math.max(1, Math.round((st.fontSize || 24) * scale));
        const para = (n.text.paragraphStyle || {}).justification;
        l.type = 'text';
        l.text = {
          content: String(n.text.text).replace(/\r\n?/g, '\n'), x: tr[4], y: tr[5] - size * 0.82,
          font: (st.font && st.font.name ? st.font.name.replace(/-.*$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : 'Arial'),
          size, color: st.fillColor ? rgbOf(st.fillColor) : '#000000', bold: !!st.fauxBold, italic: !!st.fauxItalic,
          underline: !!st.underline, strike: !!st.strikethrough, caps: st.fontCaps === 2, align: para === 'center' ? 'center' : para === 'right' ? 'right' : 'left',
          leading: st.autoLeading === false && st.leading ? st.leading / (st.fontSize || 24) : 1.2, tracking: (st.tracking || 0) / 1000 * size, fromPsd: true,
        };
      }
      out.push(l);
    });
  };
  walk(psd.children, null);
  if (!out.length && psd.canvas) { const l = new Layer(W, H, 'Hintergrund'); l.ctx.drawImage(psd.canvas, 0, 0); out.push(l); }
  d.layers = normalizeTree(out);
  if (d.layers.length && /hintergrund|background/i.test(d.layers[0].name) && d.layers[0].type === 'raster' && !d.layers[0].parent) { d.layers[0].isBackground = true; d.layers[0].lockPosition = true; }
  d.active = d.layers.length - 1;
  d.commit('Öffnen');
  d.dirty = false;
  return d;
}

let lastWarnings = [];
export function psdWarnings() { return lastWarnings; }

export function writePsd(d) {
  lastWarnings = [];
  const W = d.w, H = d.h;
  const node = (l) => {
    const o = { name: l.name, opacity: l.opacity, hidden: !l.visible, blendMode: toAg[l.blend] || 'normal', clipping: !!l.clip };
    if (l.mask) o.mask = maskToPsd(l.mask, W, H);
    if (l.type === 'group') {
      o.opened = !l.collapsed;
      o.children = childrenOf(d.layers, l.id).map(node);
      return o;
    }
    if (l.type === 'adjust') {
      const a = adjToPsd(l.adjust);
      if (a) { o.adjustment = a; return o; }
      lastWarnings.push(`„${l.name}“ (${l.adjust.id}) wurde als Pixel gespeichert`);
    }
    o.fillOpacity = l.fill;
    const b = alphaBounds(l.canvas) || { x: 0, y: 0, w: 1, h: 1 };
    const c = makeCanvas(b.w, b.h); ctx2d(c).drawImage(l.canvas, -b.x, -b.y);
    Object.assign(o, { left: b.x, top: b.y, canvas: c });
    if (l.type === 'text' && l.text) {
      const t = l.text;
      o.text = {
        text: t.content.replace(/\n/g, '\r'),
        transform: [1, 0, 0, 1, t.x, t.y + t.size * 0.82],
        style: { font: { name: t.font.replace(/\s+/g, '') }, fontSize: t.size, fillColor: colOf(t.color), fauxBold: !!t.bold, fauxItalic: !!t.italic, underline: !!t.underline, strikethrough: !!t.strike, tracking: Math.round((t.tracking || 0) / t.size * 1000) },
        paragraphStyle: { justification: t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left' },
      };
    }
    return o;
  };
  const children = childrenOf(d.layers, null).map(node);
  const flat = flattenToCanvas(d);
  const buf = agWrite({ width: W, height: H, children, canvas: flat }, { generateThumbnail: false, noBackground: true, invalidateTextLayers: true });
  return new Uint8Array(buf);
}
