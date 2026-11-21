// Dokument-, Ebenen- und Protokollmodell
import { makeCanvas, ctx2d, cloneCanvas, nextId, hexToRgb } from './util.js';
import { ADJUSTMENTS } from './filters.js';

let revCounter = 1;
export const newRev = () => revCounter++;

export const BLEND_MODES = [
  ['normal', 'Normal'], ['dissolve', 'Sprenkeln'], null,
  ['darken', 'Abdunkeln'], ['multiply', 'Multiplizieren'], ['color-burn', 'Farbig nachbelichten'], ['darker-color', 'Dunklere Farbe'], null,
  ['lighten', 'Aufhellen'], ['screen', 'Negativ multiplizieren'], ['color-dodge', 'Farbig abwedeln'], ['lighter', 'Linear abwedeln (Add.)'], null,
  ['overlay', 'Ineinanderkopieren'], ['soft-light', 'Weiches Licht'], ['hard-light', 'Hartes Licht'], null,
  ['difference', 'Differenz'], ['exclusion', 'Ausschluss'], null,
  ['hue', 'Farbton'], ['saturation', 'Sättigung'], ['color', 'Farbe'], ['luminosity', 'Luminanz'],
];

export function gcoFor(mode) {
  if (mode === 'dissolve' || mode === 'normal') return 'source-over';
  if (mode === 'darker-color') return 'darken';
  return mode;
}

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
    parent: l.parent || null, collapsed: !!l.collapsed,
    adjust: l.adjust ? JSON.parse(JSON.stringify(l.adjust)) : null,
    shape: l.shape ? { ...l.shape } : null,
    smart: l.smart ? cloneSmart(l.smart) : null,
  };
}

export function applyLayerProps(l, p) {
  Object.assign(l, p);
  l.text = p.text ? { ...p.text } : null;
  l.fx = JSON.parse(JSON.stringify(p.fx || {}));
  l.adjust = p.adjust ? JSON.parse(JSON.stringify(p.adjust)) : null;
  l.shape = p.shape ? { ...p.shape } : null;
  l.smart = p.smart ? cloneSmart(p.smart) : null;
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
  x.textAlign = t.align || 'left';
  const font = `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px "${t.font}"`;
  x.font = font;
  try { x.letterSpacing = (t.tracking || 0) + 'px'; } catch (e) { /* alt */ }
  const lines = (t.content || '').split('\n');
  const lh = t.size * (t.leading || 1.2);
  lines.forEach((line, i) => {
    let s = line;
    if (t.caps) s = s.toUpperCase();
    x.fillText(s, t.x, t.y + i * lh);
    if (t.underline) {
      const m = x.measureText(s);
      let lx = t.x;
      if (x.textAlign === 'center') lx -= m.width / 2; else if (x.textAlign === 'right') lx -= m.width;
      x.fillRect(lx, t.y + i * lh + t.size * 1.05, m.width, Math.max(1, t.size / 14));
    }
    if (t.strike) {
      const m = x.measureText(s);
      let lx = t.x;
      if (x.textAlign === 'center') lx -= m.width / 2; else if (x.textAlign === 'right') lx -= m.width;
      x.fillRect(lx, t.y + i * lh + t.size * 0.55, m.width, Math.max(1, t.size / 14));
    }
  });
  x.restore();
  layer.touch();
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
  const c = makeCanvas(1, 1).getContext('2d');
  c.font = `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px "${t.font}"`;
  const lines = (t.content || ' ').split('\n');
  const w = Math.max(20, ...lines.map((l) => c.measureText(l).width));
  const lh = t.size * (t.leading || 1.2);
  let x = t.x;
  if (t.align === 'center') x -= w / 2; else if (t.align === 'right') x -= w;
  return { x, y: t.y, w, h: lines.length * lh };
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
function renderLayerFx(layer, w, h, key) {
  const fx = layer.fx || {};
  const hasFx = Object.values(fx).some((f) => f && f.enabled);
  const needsMask = layer.mask && layer.maskEnabled;
  if (!hasFx && !needsMask && layer.fill >= 1 && layer.blend !== 'dissolve') return layer.canvas;

  // Inhalt (mit Maske)
  const content = tmp(key + 'c', w, h);
  const cx = ctx2d(content);
  cx.drawImage(layer.canvas, 0, 0);
  if (needsMask) { cx.globalCompositeOperation = 'destination-in'; cx.drawImage(layer.mask, 0, 0); cx.globalCompositeOperation = 'source-over'; }
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

  if (fx.shadow && fx.shadow.enabled) {
    const f = fx.shadow;
    const ang = (f.angle ?? 120) * Math.PI / 180;
    const s = sil(f.color || '#000');
    ox.save();
    ox.globalAlpha = f.opacity ?? 0.75;
    ox.filter = `blur(${(f.size ?? 8) / 2}px)`;
    ox.drawImage(s, -Math.cos(ang) * (f.distance ?? 8), Math.sin(ang) * (f.distance ?? 8));
    ox.restore();
  }
  if (fx.glow && fx.glow.enabled) {
    const f = fx.glow;
    const s = sil(f.color || '#ffd0ea');
    ox.save();
    ox.globalAlpha = f.opacity ?? 0.8;
    ox.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 2; i++) { ox.filter = `blur(${(f.size ?? 12) / 2}px)`; ox.drawImage(s, 0, 0); }
    ox.restore();
  }
  if (fx.stroke && fx.stroke.enabled) {
    const f = fx.stroke;
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
  if (fx.overlay && fx.overlay.enabled) {
    const f = fx.overlay;
    const b = tmp(key + 'b', w, h);
    const bx = ctx2d(b);
    bx.drawImage(content, 0, 0);
    bx.globalAlpha = f.opacity ?? 1;
    bx.globalCompositeOperation = 'source-atop';
    bx.fillStyle = f.color || '#ff77c8';
    bx.fillRect(0, 0, w, h);
    body = b;
  }
  if (fx.gradient && fx.gradient.enabled) {
    const f = fx.gradient;
    const b = tmp(key + 'g', w, h);
    const bx = ctx2d(b);
    bx.drawImage(body, 0, 0);
    bx.globalAlpha = f.opacity ?? 1;
    bx.globalCompositeOperation = 'source-atop';
    const g = bx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, f.color1 || '#ff9ad5'); g.addColorStop(1, f.color2 || '#6a3fa0');
    bx.fillStyle = g; bx.fillRect(0, 0, w, h);
    body = b;
  }
  if (fx.inner && fx.inner.enabled) {
    const f = fx.inner;
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
  for (const l of layers) out += l.id + ':' + l.rev + ':' + (l.visible ? 1 : 0) + ':' + l.opacity + ':' + l.blend + ':' + l.fill + ':' + (l.clip ? 1 : 0) + ':' + (l.maskEnabled ? 1 : 0) + ':' + (l.mask ? 1 : 0) + ':' + JSON.stringify(l.fx || {}) + ':' + (l.parent || '') + (l.adjust ? JSON.stringify(l.adjust) : '') + '|';
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
    const simpleAbove = above.every((l) => !l.visible || (l.blend === 'normal' && l.type !== 'adjust'));
    const okAbove = !above.length || (simpleAbove && cache.above && cache.aboveSig === w + 'x' + h + '#' + layerSig(above));
    const act = L[a];
    const plainActive = act.type !== 'adjust' && !(act.mask && act.maskEnabled) && act.fill >= 1 && act.blend !== 'dissolve' && !Object.values(act.fx || {}).some((f) => f && f.enabled);
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
