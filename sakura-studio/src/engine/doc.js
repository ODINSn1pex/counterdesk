// Dokument-, Ebenen- und Protokollmodell
import { makeCanvas, ctx2d, cloneCanvas, nextId, hexToRgb } from './util.js';
import { ADJUSTMENTS } from './filters.js';

let revCounter = 1;
export const newRev = () => revCounter++;

export const BLEND_MODES = [
  ['normal', 'Normal'], ['dissolve', 'Sprenkeln'], null,
  ['darken', 'Abdunkeln'], ['multiply', 'Multiplizieren'], ['color-burn', 'Farbig nachbelichten'], ['linear-burn', 'Linear nachbelichten'], ['darker-color', 'Dunklere Farbe'], null,
  ['lighten', 'Aufhellen'], ['screen', 'Negativ multiplizieren'], ['color-dodge', 'Farbig abwedeln'], ['lighter', 'Linear abwedeln (Add.)'], ['lighter-color', 'Hellere Farbe'], null,
  ['overlay', 'Ineinanderkopieren'], ['soft-light', 'Weiches Licht'], ['hard-light', 'Hartes Licht'], ['vivid-light', 'Strahlendes Licht'], ['linear-light', 'Lineares Licht'], ['pin-light', 'Lichtpunkt'], ['hard-mix', 'Hart mischen'], null,
  ['difference', 'Differenz'], ['exclusion', 'Ausschluss'], ['subtract', 'Subtrahieren'], ['divide', 'Dividieren'], null,
  ['hue', 'Farbton'], ['saturation', 'Sättigung'], ['color', 'Farbe'], ['luminosity', 'Luminanz'],
];

// Füllmethoden, die Canvas nicht kennt, werden pixelgenau berechnet
export const CUSTOM_BLENDS = new Set(['linear-burn', 'darker-color', 'lighter-color', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'subtract', 'divide']);
export function gcoFor(mode) {
  if (mode === 'dissolve' || mode === 'normal' || CUSTOM_BLENDS.has(mode)) return 'source-over';
  return mode;
}
export function needsPixelBlend(l) {
  if (CUSTOM_BLENDS.has(l.blend)) return true;
  const b = l.blendIf; return !!(b && (b.thisLo > 0 || b.thisHi < 255 || b.underLo > 0 || b.underHi < 255));
}
const lumOf = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;
function bandWeight(v, lo, hi, soft) {
  if (v < lo) return soft ? Math.max(0, 1 - (lo - v) / soft) : 0;
  if (v > hi) return soft ? Math.max(0, 1 - (v - hi) / soft) : 0;
  return 1;
}
function blendChannel(mode, a, b) {
  switch (mode) {
    case 'linear-burn': return a + b - 1;
    case 'linear-light': return a + 2 * b - 1;
    case 'vivid-light': return b < 0.5 ? (b <= 0 ? 0 : 1 - (1 - a) / (2 * b)) : (b >= 1 ? 1 : a / (2 * (1 - b)));
    case 'pin-light': return b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1);
    case 'hard-mix': return a + b >= 1 ? 1 : 0;
    case 'subtract': return a - b;
    case 'divide': return b <= 0 ? 1 : a / b;
    default: return b;
  }
}
// src (Canvas) mit Füllmethode/Fülloptionen in Kontext x zeichnen
export function pixelBlend(x, src, layer, opacity) {
  const W = x.canvas.width, H = x.canvas.height;
  const dI = x.getImageData(0, 0, W, H), d = dI.data;
  const s = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const mode = layer.blend, bi = layer.blendIf || {};
  const tLo = bi.thisLo ?? 0, tHi = bi.thisHi ?? 255, uLo = bi.underLo ?? 0, uHi = bi.underHi ?? 255, soft = bi.soft ?? 0;
  const useIf = needsPixelBlend({ blend: 'normal', blendIf: bi });
  for (let i = 0; i < d.length; i += 4) {
    let sa = s[i + 3] / 255 * opacity;
    if (sa <= 0) continue;
    const da = d[i + 3] / 255;
    if (useIf) sa *= bandWeight(lumOf(s[i], s[i + 1], s[i + 2]), tLo, tHi, soft) * (da > 0 ? bandWeight(lumOf(d[i], d[i + 1], d[i + 2]), uLo, uHi, soft) : 1);
    if (sa <= 0) continue;
    let r = s[i], g = s[i + 1], b = s[i + 2];
    if (da > 0 && mode !== 'normal' && CUSTOM_BLENDS.has(mode)) {
      if (mode === 'darker-color' || mode === 'lighter-color') {
        const ls = lumOf(r, g, b), ld = lumOf(d[i], d[i + 1], d[i + 2]);
        if ((mode === 'darker-color') === (ld < ls)) { r = d[i]; g = d[i + 1]; b = d[i + 2]; }
      } else {
        r = Math.max(0, Math.min(1, blendChannel(mode, d[i] / 255, r / 255))) * 255;
        g = Math.max(0, Math.min(1, blendChannel(mode, d[i + 1] / 255, g / 255))) * 255;
        b = Math.max(0, Math.min(1, blendChannel(mode, d[i + 2] / 255, b / 255))) * 255;
      }
      // Ergebnis nur wo Untergrund vorhanden; sonst Quellfarbe
      r = s[i] + (r - s[i]) * da; g = s[i + 1] + (g - s[i + 1]) * da; b = s[i + 2] + (b - s[i + 2]) * da;
    }
    const oa = sa + da * (1 - sa);
    d[i] = (r * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }
  x.putImageData(dI, 0, 0);
}

// Globaler Lichteinfall (Ebenenstile) und Musterquelle (aus dem Zustand gesetzt)
export const FX_ENV = { angle: 120, altitude: 30, pattern: null };

export class Layer {
  constructor(w, h, name) {
    this.id = nextId();
    this.name = name || 'Ebene';
    this.canvas = makeCanvas(w, h);
    this.visible = true;
    this.opacity = 1;
    this.fill = 1;
    this.blend = 'normal';
    this.lockPixels = false;
    this.lockPosition = false;
    this.lockAlpha = false;
    this.lockAll = false;
    this.isBackground = false;
    this.mask = null; // Canvas: Alpha = sichtbar
    this.maskEnabled = true;
    this.editMask = false;
    this.clip = false;
    this.type = 'raster';
    this.text = null;
    this.fx = {};
    this.parent = null;     // ID der übergeordneten Gruppe
    this.collapsed = false; // Gruppe eingeklappt
    this.adjust = null;     // Einstellungsebene: { id, params }
    this.shape = null;      // Vektor-Formebene
    this.smart = null;      // Smart-Objekt: { src, m:[a,b,c,d,e,f], filters:[] }
    this.rev = newRev();
    this.thumbRev = -1;
  }
  get isGroup() { return this.type === 'group'; }
  get hasPixels() { return this.type !== 'group' && this.type !== 'adjust'; }
  get ctx() { return ctx2d(this.canvas); }
  touch() { this.rev = newRev(); }
}

export class Doc {
  static maxHistory = 60;
  constructor(w, h, name = 'Unbenannt-1') {
    this.id = nextId();
    this.name = name;
    this.w = w; this.h = h;
    this.layers = [];
    this.active = 0;
    this.selection = null;
    this.selRev = newRev();
    this.lastSelection = null;
    this.history = [];
    this.histIdx = -1;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.paths = [];
    this.artboards = []; // Zeichenflächen: { name, x, y, w, h, bg }
    this.frames = [];    // Animation: { vis: {layerId: bool}, delay }
    this.globalLight = { angle: 120, altitude: 30 }; // Globaler Lichteinfall
    this.comps = [];     // Ebenenkompositionen
    this.samplers = [];  // Farbaufnahmepunkte
    this.counts = [];    // Zählungen
    this.notes = [];     // Anmerkungen
    this.slices = [];    // Slices
    this.activePath = -1;
    this.guides = [];
    this.alphaChannels = [];
    this.channelView = { r: true, g: true, b: true };
    this.filePath = null;
    this.dirty = false;
    this.needsFit = true;
    this.ppi = 72;
  }

  get layer() { return this.layers[this.active]; }

  addLayer(layer, index) {
    const ref = this.layers[this.active];
    if (index == null && ref && layer.parent == null) layer.parent = ref.parent || null;
    const i = index == null ? this.active + 1 : index;
    this.layers.splice(i, 0, layer);
    this.layers = normalizeTree(this.layers);
    this.active = this.layers.indexOf(layer);
    return layer;
  }

  newLayer(name) {
    const n = name || `Ebene ${this.layers.length}`;
    return this.addLayer(new Layer(this.w, this.h, n));
  }

  // ---------- Auswahl ----------
  ensureSelectionCanvas() {
    if (!this.selection) this.selection = makeCanvas(this.w, this.h);
    return this.selection;
  }
  setSelection(canvas) {
    this.selection = canvas;
    this.selRev = newRev();
  }
  deselect() {
    if (this.selection) this.lastSelection = this.selection;
    this.selection = null;
    this.selRev = newRev();
  }
  selectAll() {
    const c = makeCanvas(this.w, this.h);
    const x = ctx2d(c); x.fillStyle = '#fff'; x.fillRect(0, 0, this.w, this.h);
    this.setSelection(c);
  }

  // ---------- Protokoll ----------
  snapshot() {
    const prev = this.history[this.histIdx];
    const prevMap = new Map();
    if (prev) prev.state.layers.forEach((l) => prevMap.set(l.id + ':' + l.rev, l));
    const layers = this.layers.map((l) => {
      const cached = prevMap.get(l.id + ':' + l.rev);
      return {
        id: l.id, rev: l.rev,
        canvas: cached ? cached.canvas : cloneCanvas(l.canvas),
        mask: cached ? cached.mask : (l.mask ? cloneCanvas(l.mask) : null),
        props: layerProps(l),
      };
    });
    let selection = null;
    if (this.selection) {
      selection = prev && prev.state.selRev === this.selRev ? prev.state.selection : cloneCanvas(this.selection);
    }
    return {
      w: this.w, h: this.h, active: this.active, layers,
      selection, selRev: this.selRev,
      paths: JSON.parse(JSON.stringify(this.paths)),
      artboards: JSON.parse(JSON.stringify(this.artboards || [])),
      frames: JSON.parse(JSON.stringify(this.frames || [])),
      extra: JSON.stringify({ globalLight: this.globalLight, comps: this.comps, samplers: this.samplers, counts: this.counts, notes: this.notes, slices: this.slices }),
      alphaChannels: this.alphaChannels.map((a) => ({ name: a.name, canvas: a.canvas })),
    };
  }

  commit(name) {
    this.history = this.history.slice(0, this.histIdx + 1);
    this.history.push({ name, state: this.snapshot(), time: Date.now() });
    if (this.history.length > Doc.maxHistory) this.history.shift();
    this.histIdx = this.history.length - 1;
    if (this.history.length > 1) this.dirty = true;
  }

  restore(idx) {
    const h = this.history[idx];
    if (!h) return;
    const s = h.state;
    this.w = s.w; this.h = s.h;
    this.layers = s.layers.map((e) => {
      const l = new Layer(1, 1);
      l.id = e.id;
      l.canvas = cloneCanvas(e.canvas);
      l.mask = e.mask ? cloneCanvas(e.mask) : null;
      applyLayerProps(l, e.props);
      l.rev = e.rev;
      return l;
    });
    this.active = Math.min(s.active, this.layers.length - 1);
    this.selection = s.selection ? cloneCanvas(s.selection) : null;
    this.selRev = s.selRev;
    this.paths = JSON.parse(JSON.stringify(s.paths));
    this.artboards = JSON.parse(JSON.stringify(s.artboards || []));
    this.frames = JSON.parse(JSON.stringify(s.frames || []));
    if (s.extra) Object.assign(this, JSON.parse(s.extra));
    this.alphaChannels = s.alphaChannels.map((a) => ({ ...a }));
    this.histIdx = idx;
    this.dirty = true;
  }

  undo() { if (this.histIdx > 0) this.restore(this.histIdx - 1); }
  redo() { if (this.histIdx < this.history.length - 1) this.restore(this.histIdx + 1); }
}

// Quelle wird nie verändert → Referenz genügt; Transformation & Filter werden kopiert
export function cloneSmart(sm) {
  return { src: sm.src, name: sm.name, t: JSON.parse(JSON.stringify(sm.t || {})), filters: JSON.parse(JSON.stringify(sm.filters || [])) };
}

export function layerProps(l) {
  return {
    name: l.name, visible: l.visible, opacity: l.opacity, fill: l.fill, blend: l.blend,
    lockPixels: l.lockPixels, lockPosition: l.lockPosition, lockAlpha: l.lockAlpha, lockAll: l.lockAll,
    isBackground: l.isBackground, maskEnabled: l.maskEnabled, editMask: l.editMask, clip: l.clip,
    type: l.type, text: l.text ? { ...l.text } : null, fx: JSON.parse(JSON.stringify(l.fx || {})),
    parent: l.parent || null, collapsed: !!l.collapsed, blendIf: l.blendIf ? { ...l.blendIf } : null,
    adjust: l.adjust ? JSON.parse(JSON.stringify(l.adjust)) : null,
    shape: l.shape ? JSON.parse(JSON.stringify(l.shape)) : null,
    smart: l.smart ? cloneSmart(l.smart) : null,
    frame: l.frame ? { ...l.frame } : null, vmask: l.vmask ? JSON.parse(JSON.stringify(l.vmask)) : null,
  };
}

export function applyLayerProps(l, p) {
  Object.assign(l, p);
  l.text = p.text ? { ...p.text } : null;
  l.fx = JSON.parse(JSON.stringify(p.fx || {}));
  l.adjust = p.adjust ? JSON.parse(JSON.stringify(p.adjust)) : null;
  l.shape = p.shape ? JSON.parse(JSON.stringify(p.shape)) : null;
  l.smart = p.smart ? cloneSmart(p.smart) : null;
  l.blendIf = p.blendIf ? { ...p.blendIf } : null;
  l.frame = p.frame ? { ...p.frame } : null;
  l.vmask = p.vmask ? JSON.parse(JSON.stringify(p.vmask)) : null;
  l.parent = p.parent || null;
}

// ---------- Ebenenbaum (flache Liste mit parent-Verweisen) ----------
export function childrenOf(layers, parentId) { return layers.filter((l) => (l.parent || null) === (parentId || null)); }
export function descendants(layers, g) {
  const out = [];
  const walk = (id) => layers.forEach((l) => { if (l.parent === id) { out.push(l); if (l.type === 'group') walk(l.id); } });
  walk(g.id);
  return out;
}
export function ancestors(layers, l) {
  const out = []; let p = l.parent;
  while (p) { const g = layers.find((x) => x.id === p); if (!g) break; out.push(g); p = g.parent; }
  return out;
}
export function effectiveVisible(layers, l) { return l.visible && ancestors(layers, l).every((g) => g.visible); }
// Bringt die Liste in Baum-Reihenfolge: Kinder direkt unter ihrer Gruppe (Gruppe oben)
export function normalizeTree(layers) {
  const ids = new Set(layers.map((l) => l.id));
  layers.forEach((l) => { if (l.parent && !ids.has(l.parent)) l.parent = null; });
  const out = [];
  const emit = (parentId) => {
    layers.filter((l) => (l.parent || null) === parentId).forEach((l) => {
      if (l.type === 'group') emit(l.id);
      out.push(l);
    });
  };
  emit(null);
  return out;
}

// ---------- Text-Ebenen ----------
// Zeilenumbruch für Absatztext (Textrahmen) bzw. Punkttext
export function layoutText(x, t) {
  const raw = (t.content || '').split('\n').map((s) => (t.caps ? s.toUpperCase() : s));
  if (!t.box) return raw.map((s) => ({ s, last: true }));
  const out = [], maxW = Math.max(10, t.box.w);
  for (const para of raw) {
    const words = para.split(/(\s+)/).filter((q) => q.length);
    let line = '';
    for (const wd of words) {
      const test = line + wd;
      if (line && x.measureText(test.trimEnd()).width > maxW && wd.trim()) { out.push({ s: line.trimEnd(), last: false }); line = wd.trimStart(); }
      else line = test;
      // einzelnes Wort länger als der Rahmen: hart umbrechen
      while (x.measureText(line).width > maxW && line.length > 1) {
        let k = line.length - 1; while (k > 1 && x.measureText(line.slice(0, k)).width > maxW) k--;
        out.push({ s: line.slice(0, k), last: false }); line = line.slice(k);
      }
    }
    out.push({ s: line.trimEnd(), last: true });
  }
  return out;
}
const fontOf = (t) => `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px "${t.font}"`;

export function renderTextLayer(layer, w, h) {
  const t = layer.text;
  if (!t) return;
  if (layer.canvas.width !== w || layer.canvas.height !== h) { layer.canvas.width = w; layer.canvas.height = h; }
  const x = layer.ctx;
  x.clearRect(0, 0, w, h);
  if (t.path && t.path.length > 1) { renderTextOnPath(x, t); layer.touch(); return; }
  x.save();
  x.fillStyle = t.color;
  x.textBaseline = 'top';
  x.font = fontOf(t);
  try { x.letterSpacing = (t.tracking || 0) + 'px'; } catch (e) { /* alt */ }
  const lh = t.size * (t.leading || 1.2);
  const lines = layoutText(x, t);
  const align = t.align || 'left';
  if (t.box) { x.beginPath(); x.rect(t.x, t.y, t.box.w, t.box.h); x.clip(); }
  const anchorX = t.box ? (align === 'center' ? t.x + t.box.w / 2 : align === 'right' ? t.x + t.box.w : t.x) : t.x;
  lines.forEach((ln, i) => {
    const y = t.y + i * lh, s = ln.s;
    if (t.box && align === 'justify' && !ln.last && s.includes(' ')) {
      // Blocksatz: Wortabstände verteilen
      const words = s.split(/\s+/), total = words.reduce((a, q) => a + x.measureText(q).width, 0);
      const gap = (t.box.w - total) / (words.length - 1);
      x.textAlign = 'left'; let cx = t.x;
      for (const q of words) { x.fillText(q, cx, y); cx += x.measureText(q).width + gap; }
    } else {
      x.textAlign = align === 'justify' ? 'left' : align;
      x.fillText(s, anchorX, y);
    }
    if (t.underline || t.strike) {
      const m = x.measureText(s);
      let lx = anchorX;
      if (x.textAlign === 'center') lx -= m.width / 2; else if (x.textAlign === 'right') lx -= m.width;
      const mw = t.box && align === 'justify' && !ln.last ? t.box.w : m.width;
      if (t.underline) x.fillRect(lx, y + t.size * 1.05, mw, Math.max(1, t.size / 14));
      if (t.strike) x.fillRect(lx, y + t.size * 0.55, mw, Math.max(1, t.size / 14));
    }
  });
  x.restore();
  if (t.warp && t.warp.style && t.warp.style !== 'none' && t.warp.bend) warpText(layer, t, w, h);
  layer.touch();
}

// Text verkrümmen: spaltenweise Versatz/Skalierung des gerenderten Textes
export const TEXT_WARPS = [['none', 'Ohne'], ['arc', 'Bogen'], ['arch', 'Torbogen'], ['bulge', 'Wölbung'], ['flag', 'Flagge'], ['wave', 'Welle'], ['fish', 'Fisch'], ['rise', 'Ansteigend'], ['squeeze', 'Stauchen']];
function warpText(layer, t, w, h) {
  const b0 = textBoundsRaw(t);
  const pad = Math.ceil(t.size * 0.4);
  const bx = Math.max(0, Math.floor(b0.x - pad)), by = Math.max(0, Math.floor(b0.y - pad));
  const bw = Math.min(w, Math.ceil(b0.x + b0.w + pad)) - bx, bh = Math.min(h, Math.ceil(b0.y + b0.h + pad)) - by;
  if (bw <= 2 || bh <= 2) return;
  const src = makeCanvas(bw, bh); ctx2d(src).drawImage(layer.canvas, bx, by, bw, bh, 0, 0, bw, bh);
  const x = layer.ctx; x.clearRect(bx, by, bw, bh);
  const k = Math.max(-1, Math.min(1, t.warp.bend / 100)), st = t.warp.style;
  const step = 2;
  for (let c = 0; c < bw; c += step) {
    const u = (c + step / 2) / bw, m = 2 * u - 1, para = 1 - m * m;
    let dy = 0, sy = 1, top = 0;
    if (st === 'arc') dy = -k * para * bh * 0.6;
    else if (st === 'arch') { dy = -k * para * bh * 0.6; sy = 1 + k * para * 0.3; }
    else if (st === 'bulge') { sy = 1 + k * para * 0.8; top = -(sy - 1) / 2; }
    else if (st === 'flag') dy = Math.sin(u * Math.PI * 2) * k * bh * 0.25;
    else if (st === 'wave') { dy = Math.sin(u * Math.PI * 2) * k * bh * 0.25; sy = 1 + Math.cos(u * Math.PI * 2) * k * 0.2; }
    else if (st === 'fish') { sy = 1 + k * para * 0.6; top = -(sy - 1) * (u < 0.5 ? 0.8 : 0.2); }
    else if (st === 'rise') dy = -(u - 0.5) * k * bh;
    else if (st === 'squeeze') { sy = 1 - k * para * 0.5; top = (1 - sy) / 2; }
    x.drawImage(src, c, 0, step, bh, bx + c, by + dy + top * bh, step, bh * sy);
  }
}

function textBoundsRaw(t) {
  if (t.box) return { x: t.x, y: t.y, w: t.box.w, h: t.box.h };
  const c = makeCanvas(1, 1).getContext('2d');
  c.font = fontOf(t);
  const lines = layoutText(c, t);
  const w = Math.max(20, ...lines.map((l) => c.measureText(l.s).width));
  const lh = t.size * (t.leading || 1.2);
  let x = t.x;
  if (t.align === 'center') x -= w / 2; else if (t.align === 'right') x -= w;
  return { x, y: t.y, w, h: lines.length * lh };
}

// Text entlang einer Polylinie (Text auf Pfad)
function renderTextOnPath(x, t) {
  const pts = t.path;
  const segs = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(l); total += l; }
  const at = (s) => {
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= s || i === segs.length - 1) {
        const k = segs[i] ? Math.min(1, Math.max(0, (s - acc) / segs[i])) : 0;
        const a = pts[i], b = pts[i + 1];
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ang: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      acc += segs[i];
    }
    return { x: pts[0].x, y: pts[0].y, ang: 0 };
  };
  x.save();
  x.fillStyle = t.color;
  x.font = `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px "${t.font}"`;
  x.textBaseline = 'alphabetic';
  let str = (t.content || '').replace(/\n/g, ' ');
  if (t.caps) str = str.toUpperCase();
  const tr = t.tracking || 0;
  const widths = [...str].map((ch) => x.measureText(ch).width + tr);
  const tw = widths.reduce((a, b) => a + b, 0);
  let s = (t.pathOffset || 0) + (t.align === 'center' ? (total - tw) / 2 : t.align === 'right' ? total - tw : 0);
  [...str].forEach((ch, i) => {
    const mid = s + widths[i] / 2;
    if (mid >= 0 && mid <= total) {
      const p = at(mid);
      x.save(); x.translate(p.x, p.y); x.rotate(p.ang); x.fillText(ch, -widths[i] / 2 + tr / 2, -(t.baselineShift || 0)); x.restore();
    }
    s += widths[i];
  });
  x.restore();
}

export function textBounds(layer) {
  const t = layer.text;
  if (t.path && t.path.length > 1) {
    const xs = t.path.map((p) => p.x), ys = t.path.map((p) => p.y);
    const x0 = Math.min(...xs) - t.size, y0 = Math.min(...ys) - t.size;
    return { x: x0, y: y0, w: Math.max(...xs) - x0 + t.size, h: Math.max(...ys) - y0 + t.size };
  }
  const b = textBoundsRaw(t);
  if (t.warp && t.warp.style && t.warp.style !== 'none' && t.warp.bend) { const e = b.h * Math.abs(t.warp.bend) / 100 * 0.8; return { x: b.x, y: b.y - e, w: b.w, h: b.h + e * 2 }; }
  return b;
}

// ---------- Rendering / Zusammensetzen ----------
const tmpPool = {};
function tmp(key, w, h) {
  let c = tmpPool[key];
  if (!c) c = tmpPool[key] = makeCanvas(w, h);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = ctx2d(c);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
  x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetX = 0; x.shadowOffsetY = 0;
  x.clearRect(0, 0, w, h);
  return c;
}

const dissolveCache = new Map();
function dissolveNoise(w, h) {
  const key = w + 'x' + h;
  if (dissolveCache.has(key)) return dissolveCache.get(key);
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  const id = x.createImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) { id.data[i + 3] = Math.random() * 255; }
  x.putImageData(id, 0, 0);
  dissolveCache.clear();
  dissolveCache.set(key, c);
  return c;
}

// Ebene inkl. Maske, Flächendeckkraft und Ebenenstilen in temp zeichnen
// Vektormaske: Pfad als scharfe Maske (optional umgekehrt / weiche Kante)
export function traceVPath(x, path) {
  const pts = path.points || []; if (!pts.length) return;
  x.moveTo(pts[0].x, pts[0].y);
  const seg = (a, b) => x.bezierCurveTo(a.ox ?? a.x, a.oy ?? a.y, b.ix ?? b.x, b.iy ?? b.y, b.x, b.y);
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  seg(pts[pts.length - 1], pts[0]); x.closePath();
}
function applyVectorMask(cx, vm, w, h) {
  const m = tmp('vmask', w, h), mx = ctx2d(m);
  mx.fillStyle = '#fff';
  if (vm.feather) mx.filter = `blur(${vm.feather}px)`;
  mx.beginPath(); for (const p of vm.paths || []) traceVPath(mx, p);
  if (vm.invert) { mx.rect(0, 0, w, h); mx.fill('evenodd'); } else mx.fill('nonzero');
  mx.filter = 'none';
  cx.globalCompositeOperation = 'destination-in'; cx.drawImage(m, 0, 0); cx.globalCompositeOperation = 'source-over';
}

const fxCache = new Map();
function renderLayerFx(layer, w, h, key) {
  const fx = layer.fx || {};
  const hasFx = Object.values(fx).some((f) => f && f.enabled);
  const needsMask = (layer.mask && layer.maskEnabled) || (layer.vmask && layer.vmask.enabled !== false);
  if (!hasFx && !needsMask && layer.fill >= 1 && layer.blend !== 'dissolve') return layer.canvas;
  // Ergebnis zwischenspeichern (Ebenenstile sind teuer)
  if (hasFx) {
    const ck = layer.rev + '|' + JSON.stringify(fx) + '|' + layer.fill + '|' + layer.maskEnabled + '|' + JSON.stringify(layer.vmask || 0) + '|' + FX_ENV.angle + '|' + FX_ENV.altitude + '|' + w + 'x' + h;
    const e = fxCache.get(layer.id);
    if (e && e.key === ck) return e.canvas;
    const res = renderLayerFxInner(layer, w, h, key);
    let c = e && e.canvas.width === w && e.canvas.height === h ? e.canvas : makeCanvas(w, h);
    const cx2 = ctx2d(c); cx2.clearRect(0, 0, w, h); cx2.drawImage(res, 0, 0);
    fxCache.set(layer.id, { key: ck, canvas: c });
    if (fxCache.size > 80) fxCache.delete(fxCache.keys().next().value);
    return c;
  }
  return renderLayerFxInner(layer, w, h, key);
}
// Mehrere Instanzen desselben Stils: shadow, shadow2, shadow3 …
export const inst = (fx, k) => Object.keys(fx).filter((n) => n.replace(/\d+$/, '') === k && fx[n] && fx[n].enabled).map((n) => fx[n]);
const angleOf = (f) => (f.useGlobal !== false ? FX_ENV.angle : (f.angle ?? 120)) * Math.PI / 180;

function renderLayerFxInner(layer, w, h, key) {
  const fx = layer.fx || {};
  const hasFx = Object.values(fx).some((f) => f && f.enabled);
  // Inhalt (mit Ebenen- und Vektormaske)
  const content = tmp(key + 'c', w, h);
  const cx = ctx2d(content);
  cx.drawImage(layer.canvas, 0, 0);
  if (layer.mask && layer.maskEnabled) { cx.globalCompositeOperation = 'destination-in'; cx.drawImage(layer.mask, 0, 0); cx.globalCompositeOperation = 'source-over'; }
  if (layer.vmask && layer.vmask.enabled !== false) applyVectorMask(cx, layer.vmask, w, h);
  if (layer.blend === 'dissolve') {
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(dissolveNoise(w, h), 0, 0);
    cx.globalCompositeOperation = 'source-over';
  }
  if (!hasFx && layer.fill >= 1) return content;

  const out = tmp(key + 'o', w, h);
  const ox = ctx2d(out);

  // Silhouette zum Einfärben
  const sil = (color) => {
    const s = tmp(key + 's', w, h);
    const sx = ctx2d(s);
    sx.drawImage(content, 0, 0);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = color; sx.fillRect(0, 0, w, h);
    return s;
  };

  for (const f of inst(fx, 'shadow')) {
    const ang = angleOf(f);
    const s = sil(f.color || '#000');
    ox.save();
    ox.globalAlpha = f.opacity ?? 0.75;
    ox.filter = `blur(${(f.size ?? 8) / 2}px)`;
    ox.drawImage(s, -Math.cos(ang) * (f.distance ?? 8), Math.sin(ang) * (f.distance ?? 8));
    ox.restore();
  }
  for (const f of inst(fx, 'glow')) {
    const s = sil(f.color || '#ffd0ea');
    ox.save();
    ox.globalAlpha = f.opacity ?? 0.8;
    ox.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 2; i++) { ox.filter = `blur(${(f.size ?? 12) / 2}px)`; ox.drawImage(s, 0, 0); }
    ox.restore();
  }
  for (const f of inst(fx, 'stroke')) {
    const s = sil(f.color || '#ffffff');
    const r = f.size ?? 3;
    ox.save();
    ox.globalAlpha = f.opacity ?? 1;
    const steps = Math.max(12, Math.round(r * 4));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ox.drawImage(s, Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let rr = 1; rr < r; rr += 1) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2; ox.drawImage(s, Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ox.restore();
  }
  // Inhalt mit Flächendeckkraft
  let body = content;
  for (const f of inst(fx, 'overlay')) {
    const b = tmp(key + 'b', w, h);
    const bx = ctx2d(b);
    bx.drawImage(content, 0, 0);
    bx.globalAlpha = f.opacity ?? 1;
    bx.globalCompositeOperation = 'source-atop';
    bx.fillStyle = f.color || '#ff77c8';
    bx.fillRect(0, 0, w, h);
    body = b;
  }
  for (const f of inst(fx, 'gradient')) {
    const b = tmp(key + 'g', w, h);
    const bx = ctx2d(b);
    bx.drawImage(body, 0, 0);
    bx.globalAlpha = f.opacity ?? 1;
    bx.globalCompositeOperation = 'source-atop';
    const ga = ((f.angle ?? 90) - 90) * Math.PI / 180, R = Math.hypot(w, h) / 2;
    const g = f.style === 'radial' ? bx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, R) : bx.createLinearGradient(w / 2 - Math.sin(-ga) * R, h / 2 - Math.cos(ga) * R, w / 2 + Math.sin(-ga) * R, h / 2 + Math.cos(ga) * R);
    g.addColorStop(f.reverse ? 1 : 0, f.color1 || '#ff9ad5'); g.addColorStop(f.reverse ? 0 : 1, f.color2 || '#6a3fa0');
    bx.fillStyle = g; bx.fillRect(0, 0, w, h);
    body = b;
  }
  if (fx.pattern && fx.pattern.enabled && FX_ENV.pattern) {
    const f = fx.pattern;
    const b = tmp(key + 'p', w, h); const bx = ctx2d(b);
    bx.drawImage(body, 0, 0);
    const pc = FX_ENV.pattern(f.name || 'sakura', f.scale || 1);
    if (pc) { bx.globalAlpha = f.opacity ?? 1; bx.globalCompositeOperation = 'source-atop'; bx.fillStyle = bx.createPattern(pc, 'repeat'); bx.fillRect(0, 0, w, h); }
    body = b;
  }
  if (fx.satin && fx.satin.enabled) {
    // Glanz: zwei versetzte, weichgezeichnete Silhouetten, deren Differenz eingefärbt wird
    const f = fx.satin, ang = angleOf({ ...f, useGlobal: false }), dd = f.distance ?? 11;
    const a1 = tmp(key + 'sa', w, h), ax = ctx2d(a1);
    ax.filter = `blur(${(f.size ?? 14) / 2}px)`;
    ax.drawImage(content, Math.cos(ang) * dd, Math.sin(ang) * dd);
    ax.globalCompositeOperation = 'xor'; ax.drawImage(content, -Math.cos(ang) * dd, -Math.sin(ang) * dd);
    ax.filter = 'none'; ax.globalCompositeOperation = 'source-in'; ax.fillStyle = f.color || '#000'; ax.fillRect(0, 0, w, h);
    const b = tmp(key + 'sb', w, h); const bx = ctx2d(b);
    bx.drawImage(body, 0, 0); bx.globalAlpha = f.opacity ?? 0.5; bx.globalCompositeOperation = 'source-atop'; bx.drawImage(a1, 0, 0);
    body = b;
  }
  if (fx.innerGlow && fx.innerGlow.enabled) {
    const f = fx.innerGlow;
    const b = tmp(key + 'ig', w, h); const bx = ctx2d(b);
    bx.drawImage(body, 0, 0);
    const inv = tmp(key + 'iv', w, h); const ix = ctx2d(inv);
    ix.fillStyle = f.color || '#fff6c8'; ix.fillRect(0, 0, w, h);
    ix.globalCompositeOperation = 'destination-out'; ix.drawImage(content, 0, 0);
    bx.save(); bx.globalCompositeOperation = 'source-atop'; bx.globalAlpha = f.opacity ?? 0.75;
    bx.filter = `blur(${(f.size ?? 10) / 2}px)`; bx.drawImage(inv, 0, 0); bx.drawImage(inv, 0, 0); bx.restore();
    body = b;
  }
  if (fx.bevel && fx.bevel.enabled) {
    // Abgeflachte Kante und Relief: Höhenfeld aus weichgezeichneter Kontur, beleuchtet aus dem Lichtwinkel
    const f = fx.bevel, size = Math.max(1, f.size ?? 6), depth = (f.depth ?? 100) / 100;
    const hm = tmp(key + 'hm', w, h), hx = ctx2d(hm);
    hx.filter = `blur(${size / 2}px)`;
    if (f.style === 'outer') { hx.fillStyle = '#000'; hx.fillRect(0, 0, w, h); }
    hx.drawImage(content, 0, 0); hx.filter = 'none';
    const H = hx.getImageData(0, 0, w, h).data;
    const ang = angleOf(f), alt = (f.useGlobal !== false ? FX_ENV.altitude : (f.altitude ?? 30)) * Math.PI / 180;
    const lx = Math.cos(ang) * Math.cos(alt), ly = -Math.sin(ang) * Math.cos(alt), lz = Math.sin(alt);
    const lightC = makeCanvas(w, h), lc = ctx2d(lightC), lid = lc.createImageData(w, h), L = lid.data;
    const darkC = makeCanvas(w, h), dc = ctx2d(darkC), did = dc.createImageData(w, h), D = did.data;
    const hi = hexToRgb(f.highlight || '#ffffff'), sh = hexToRgb(f.shadow || '#000000');
    const k = depth * 255 / size * 4;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const nx = -(H[i + 7] - H[i - 1]) / k, ny = -(H[i + w * 4 + 3] - H[i - w * 4 + 3]) / k;
      const len = Math.hypot(nx, ny, 1), dot = (nx * lx + ny * ly + lz) / len - lz;
      if (dot > 0.01) { L[i] = hi.r; L[i + 1] = hi.g; L[i + 2] = hi.b; L[i + 3] = Math.min(255, dot * 255 * 2.2); }
      else if (dot < -0.01) { D[i] = sh.r; D[i + 1] = sh.g; D[i + 2] = sh.b; D[i + 3] = Math.min(255, -dot * 255 * 2.2); }
    }
    lc.putImageData(lid, 0, 0); dc.putImageData(did, 0, 0);
    const b = tmp(key + 'bv', w, h); const bx = ctx2d(b);
    bx.drawImage(body, 0, 0);
    if (f.style === 'outer' || f.style === 'emboss' || f.style === 'pillow') {
      // außerhalb sichtbar: unter den Inhalt legen
      const o2 = tmp(key + 'bo', w, h), ox2 = ctx2d(o2);
      ox2.globalAlpha = f.opacity ?? 0.75; ox2.drawImage(lightC, 0, 0); ox2.drawImage(darkC, 0, 0); ox2.globalAlpha = 1;
      if (f.style === 'outer') { ox2.globalCompositeOperation = 'destination-out'; ox2.drawImage(content, 0, 0); }
      ox.drawImage(o2, 0, 0);
    }
    if (f.style !== 'outer') {
      bx.globalCompositeOperation = 'source-atop'; bx.globalAlpha = f.opacity ?? 0.75;
      bx.drawImage(lightC, 0, 0); bx.drawImage(darkC, 0, 0);
    }
    body = b;
  }
  for (const f of inst(fx, 'inner')) {
    const b = tmp(key + 'i', w, h);
    const bx = ctx2d(b);
    bx.drawImage(body, 0, 0);
    // inverse Silhouette weichzeichnen und innen anwenden
    const inv = tmp(key + 'v', w, h);
    const ix = ctx2d(inv);
    ix.fillStyle = f.color || '#000'; ix.fillRect(0, 0, w, h);
    ix.globalCompositeOperation = 'destination-out'; ix.drawImage(content, 0, 0);
    bx.save(); bx.globalCompositeOperation = 'source-atop'; bx.globalAlpha = f.opacity ?? 0.6;
    bx.filter = `blur(${(f.size ?? 8) / 2}px)`; bx.drawImage(inv, 0, 0); bx.restore();
    body = b;
  }
  ox.globalAlpha = layer.fill;
  ox.drawImage(body, 0, 0);
  ox.globalAlpha = 1;
  return out;
}

// Signatur einer Ebenenliste (Inhalt + Eigenschaften) für Caches
export function layerSig(layers) {
  let out = '';
  for (const l of layers) out += l.id + ':' + l.rev + ':' + (l.visible ? 1 : 0) + ':' + l.opacity + ':' + l.blend + ':' + l.fill + ':' + (l.clip ? 1 : 0) + ':' + (l.maskEnabled ? 1 : 0) + ':' + (l.mask ? 1 : 0) + ':' + JSON.stringify(l.fx || {}) + ':' + (l.parent || '') + (l.adjust ? JSON.stringify(l.adjust) : '') + (l.blendIf ? JSON.stringify(l.blendIf) : '') + '|';
  return out;
}

// Einstellungsebene auf den bisher gezeichneten Inhalt anwenden (Ergebnis zwischengespeichert)
const adjCache = new Map();
function applyAdjustLayer(layer, x, w, h, key) {
  const def = ADJUSTMENTS[layer.adjust && layer.adjust.id];
  if (!def) return;
  const ck = key + '#' + w + 'x' + h + '#' + JSON.stringify(layer.adjust.params);
  let e = adjCache.get(layer.id);
  if (!e || e.key !== ck) {
    const src = makeCanvas(w, h); ctx2d(src).drawImage(x.canvas, 0, 0);
    e = { key: ck, canvas: def.apply(src, layer.adjust.params || {}) };
    adjCache.set(layer.id, e);
    if (adjCache.size > 64) adjCache.delete(adjCache.keys().next().value);
  }
  let res = e.canvas;
  if (layer.mask && layer.maskEnabled) {
    const t = tmp('adjm', w, h); const tx = ctx2d(t);
    tx.drawImage(res, 0, 0); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(layer.mask, 0, 0);
    res = t;
  }
  x.save();
  x.globalAlpha = layer.opacity * layer.fill;
  x.globalCompositeOperation = layer.blend === 'normal' || layer.blend === 'pass' ? 'source-atop' : gcoFor(layer.blend);
  x.drawImage(res, 0, 0);
  x.restore();
}

const grpPool = [];
function grpCanvas(depth, w, h) {
  let c = grpPool[depth];
  if (!c) c = grpPool[depth] = makeCanvas(w, h);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = ctx2d(c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
  return c;
}

function subtreeSig(all, l) { return layerSig([l]) + (l.type === 'group' ? layerSig(descendants(all, l)) : ''); }

// Zeichnet eine Geschwisterliste (inkl. Gruppen rekursiv) in den Kontext x
function drawNodes(all, nodes, x, w, h, opts, depth, key) {
  let base = null; // Basis für Schnittmasken
  let acc = key;
  nodes.forEach((node, i) => {
    if (!node.visible && !opts.forceAll) { if (!node.clip) base = null; return; }
    if (node.type === 'adjust') {
      applyAdjustLayer(node, x, w, h, acc);
      acc += layerSig([node]);
      return;
    }
    let src;
    if (node.type === 'group') {
      const kids = childrenOf(all, node.id);
      const passThrough = (node.blend === 'pass' || node.blend === 'normal') && node.opacity >= 1 && node.fill >= 1 && !(node.mask && node.maskEnabled) && !node.clip && node.blend === 'pass';
      if (passThrough) {
        drawNodes(all, kids, x, w, h, opts, depth + 1, acc);
        acc += subtreeSig(all, node);
        base = null;
        return;
      }
      const g = grpCanvas(depth, w, h);
      drawNodes(all, kids, ctx2d(g), w, h, opts, depth + 1, 'g' + node.id + '#' + subtreeSig(all, node));
      if (node.mask && node.maskEnabled) { const gx = ctx2d(g); gx.globalCompositeOperation = 'destination-in'; gx.drawImage(node.mask, 0, 0); gx.globalCompositeOperation = 'source-over'; }
      src = g;
    } else {
      src = renderLayerFx(node, w, h, 'L' + (i % 2) + '_' + depth);
    }
    if (node.clip && base) {
      const c = tmp('clip' + depth, w, h);
      const cx = ctx2d(c);
      cx.drawImage(src, 0, 0);
      cx.globalCompositeOperation = 'destination-in';
      cx.drawImage(base, 0, 0);
      src = c;
    } else if (!node.clip) {
      base = node.type === 'group' ? src : node.canvas;
    }
    if (needsPixelBlend(node)) { pixelBlend(x, src, node, node.opacity * (node.type === 'group' ? node.fill : 1)); acc += subtreeSig(all, node); return; }
    x.globalAlpha = node.opacity * (node.type === 'group' ? node.fill : 1);
    x.globalCompositeOperation = gcoFor(node.blend === 'pass' ? 'normal' : node.blend);
    x.drawImage(src, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    acc += subtreeSig(all, node);
  });
}

function drawLayers(layers, x, w, h, opts = {}, key = 'flat') {
  drawNodes(layers, layers.filter((l) => !l.parent), x, w, h, opts, 0, key);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
}

// Einzelne Ebene (inkl. Stile/Masken) als Bild rendern
export function renderLayerAlone(l, w, h) {
  const c = makeCanvas(w, h); drawLayers([{ ...l, parent: null, visible: true, opacity: 1, blend: 'normal', clip: false, canvas: l.canvas, mask: l.mask, fx: l.fx, type: l.type, id: l.id, rev: l.rev }], ctx2d(c), w, h, { forceAll: true }, 'alone' + l.id);
  return c;
}

const compCache = new WeakMap();
function cacheFor(doc) {
  let c = compCache.get(doc);
  if (!c) { c = { belowSig: null, below: null, aboveSig: null, above: null, mergedSig: null, merged: null }; compCache.set(doc, c); }
  return c;
}

// Gesamtes Dokument rendern. Ebenen unter/über der aktiven Ebene werden zwischengespeichert,
// sodass beim Malen nur die aktive Ebene neu zusammengesetzt werden muss.
export function composite(doc, target, opts = {}) {
  const { w, h } = doc;
  if (doc.globalLight) { FX_ENV.angle = doc.globalLight.angle; FX_ENV.altitude = doc.globalLight.altitude; }
  const x = target.getContext('2d');
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  const L = doc.layers;
  const a = doc.active;
  const tree = L.some((l) => l.type === 'group' || l.parent);
  const canCache = opts.cached && !tree && !L.some((l) => l.clip) && a >= 0 && a < L.length;
  // Nur Ausschnitt neu zusammensetzen, wenn sich ausschließlich die aktive Ebene geändert hat
  if (canCache && opts.rect) {
    const cache = cacheFor(doc);
    const below = L.slice(0, a), above = L.slice(a + 1);
    const okBelow = !below.length || (cache.below && cache.belowSig === w + 'x' + h + '#' + layerSig(below));
    const simpleAbove = above.every((l) => !l.visible || (l.blend === 'normal' && l.type !== 'adjust' && !needsPixelBlend(l)));
    const okAbove = !above.length || (simpleAbove && cache.above && cache.aboveSig === w + 'x' + h + '#' + layerSig(above));
    const act = L[a];
    const plainActive = act.type !== 'adjust' && !needsPixelBlend(act) && !(act.mask && act.maskEnabled) && !act.vmask && act.fill >= 1 && act.blend !== 'dissolve' && !Object.values(act.fx || {}).some((f) => f && f.enabled);
    if (okBelow && okAbove && plainActive) {
      const r = opts.rect;
      const rx = Math.max(0, Math.floor(r.x)), ry = Math.max(0, Math.floor(r.y));
      const rw = Math.min(w, Math.ceil(r.x + r.w)) - rx, rh = Math.min(h, Math.ceil(r.y + r.h)) - ry;
      if (rw > 0 && rh > 0) {
        x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
        x.clearRect(rx, ry, rw, rh);
        if (below.length) x.drawImage(cache.below, rx, ry, rw, rh, rx, ry, rw, rh);
        if (act.visible) {
          x.globalAlpha = act.opacity; x.globalCompositeOperation = gcoFor(act.blend);
          x.drawImage(act.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
          x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
        }
        if (above.length) x.drawImage(cache.above, rx, ry, rw, rh, rx, ry, rw, rh);
      }
      x.restore();
      return;
    }
  }
  x.clearRect(0, 0, target.width, target.height);
  if (!canCache || L.length < 3) {
    drawLayers(L, x, w, h, opts);
  } else {
    const cache = cacheFor(doc);
    const below = L.slice(0, a), above = L.slice(a + 1);
    if (below.length) {
      const sig = w + 'x' + h + '#' + layerSig(below);
      if (sig !== cache.belowSig || !cache.below) {
        if (!cache.below) cache.below = makeCanvas(w, h);
        if (cache.below.width !== w || cache.below.height !== h) { cache.below.width = w; cache.below.height = h; }
        const bx = ctx2d(cache.below); bx.clearRect(0, 0, w, h);
        drawLayers(below, bx, w, h);
        cache.belowSig = sig;
      }
      x.drawImage(cache.below, 0, 0);
    }
    drawLayers([L[a]], x, w, h, {}, 'b#' + layerSig(below));
    if (above.length) {
      const simple = above.every((l) => !l.visible || (l.blend === 'normal' && l.type !== 'adjust'));
      if (simple) {
        const sig = w + 'x' + h + '#' + layerSig(above);
        if (sig !== cache.aboveSig || !cache.above) {
          if (!cache.above) cache.above = makeCanvas(w, h);
          if (cache.above.width !== w || cache.above.height !== h) { cache.above.width = w; cache.above.height = h; }
          const ax = ctx2d(cache.above); ax.clearRect(0, 0, w, h);
          drawLayers(above, ax, w, h);
          cache.aboveSig = sig;
        }
        x.drawImage(cache.above, 0, 0);
      } else drawLayers(above, x, w, h, {}, 'ba#' + layerSig(L.slice(0, a + 1)));
    }
  }
  x.restore();

  // Kanalansicht
  const cv = doc.channelView;
  if (cv && !(cv.r && cv.g && cv.b) && !opts.noChannels) {
    const id = x.getImageData(0, 0, w, h); const d = id.data;
    const on = [cv.r, cv.g, cv.b];
    const count = on.filter(Boolean).length;
    for (let p = 0; p < d.length; p += 4) {
      if (count === 1) {
        const v = on[0] ? d[p] : on[1] ? d[p + 1] : d[p + 2];
        d[p] = d[p + 1] = d[p + 2] = v;
      } else {
        if (!on[0]) d[p] = 0; if (!on[1]) d[p + 1] = 0; if (!on[2]) d[p + 2] = 0;
      }
    }
    x.putImageData(id, 0, 0);
  }
}

// Zusammengesetztes Bild (zwischengespeichert, solange sich nichts ändert)
export function getMerged(doc) {
  const cache = cacheFor(doc);
  const sig = doc.w + 'x' + doc.h + '#' + layerSig(doc.layers);
  if (sig !== cache.mergedSig || !cache.merged) {
    if (!cache.merged) cache.merged = makeCanvas(doc.w, doc.h);
    if (cache.merged.width !== doc.w || cache.merged.height !== doc.h) { cache.merged.width = doc.w; cache.merged.height = doc.h; }
    composite({ w: doc.w, h: doc.h, layers: doc.layers, active: doc.active, channelView: null }, cache.merged, { noChannels: true });
    cache.mergedSig = sig;
  }
  return cache.merged;
}

export function flattenToCanvas(doc, bg) {
  const c = makeCanvas(doc.w, doc.h);
  const tmpc = makeCanvas(doc.w, doc.h);
  composite(doc, tmpc, { noChannels: true });
  const x = ctx2d(c);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, doc.w, doc.h); }
  x.drawImage(tmpc, 0, 0);
  return c;
}

// Neues Dokument
export function createDoc({ w, h, name, background = 'white', color }) {
  const d = new Doc(w, h, name);
  const l = new Layer(w, h, background === 'transparent' ? 'Ebene 1' : 'Hintergrund');
  if (background !== 'transparent') {
    const x = l.ctx;
    x.fillStyle = background === 'white' ? '#ffffff' : background === 'black' ? '#000000' : (color || '#ffffff');
    x.fillRect(0, 0, w, h);
    l.isBackground = true;
    l.lockPosition = true;
  }
  d.layers.push(l);
  d.active = 0;
  d.commit('Neu');
  d.dirty = false;
  return d;
}

export function docFromImage(img, name) {
  const d = new Doc(img.width, img.height, name);
  const l = new Layer(img.width, img.height, 'Hintergrund');
  l.ctx.drawImage(img, 0, 0);
  l.isBackground = true; l.lockPosition = true;
  d.layers.push(l);
  d.commit('Öffnen');
  d.dirty = false;
  return d;
}

export function fillColorRgb(hex) { return hexToRgb(hex); }
