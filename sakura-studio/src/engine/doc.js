// Dokument-, Ebenen- und Protokollmodell
import { makeCanvas, ctx2d, cloneCanvas, nextId, hexToRgb } from './util.js';

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
    this.rev = newRev();
    this.thumbRev = -1;
  }
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
    const i = index == null ? this.active + 1 : index;
    this.layers.splice(i, 0, layer);
    this.active = i;
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
    this.alphaChannels = s.alphaChannels.map((a) => ({ ...a }));
    this.histIdx = idx;
    this.dirty = true;
  }

  undo() { if (this.histIdx > 0) this.restore(this.histIdx - 1); }
  redo() { if (this.histIdx < this.history.length - 1) this.restore(this.histIdx + 1); }
}

export function layerProps(l) {
  return {
    name: l.name, visible: l.visible, opacity: l.opacity, fill: l.fill, blend: l.blend,
    lockPixels: l.lockPixels, lockPosition: l.lockPosition, lockAlpha: l.lockAlpha, lockAll: l.lockAll,
    isBackground: l.isBackground, maskEnabled: l.maskEnabled, editMask: l.editMask, clip: l.clip,
    type: l.type, text: l.text ? { ...l.text } : null, fx: JSON.parse(JSON.stringify(l.fx || {})),
  };
}

export function applyLayerProps(l, p) {
  Object.assign(l, p);
  l.text = p.text ? { ...p.text } : null;
  l.fx = JSON.parse(JSON.stringify(p.fx || {}));
}

// ---------- Text-Ebenen ----------
export function renderTextLayer(layer, w, h) {
  const t = layer.text;
  if (!t) return;
  if (layer.canvas.width !== w || layer.canvas.height !== h) { layer.canvas.width = w; layer.canvas.height = h; }
  const x = layer.ctx;
  x.clearRect(0, 0, w, h);
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

export function textBounds(layer) {
  const t = layer.text;
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
  for (const l of layers) out += l.id + ':' + l.rev + ':' + (l.visible ? 1 : 0) + ':' + l.opacity + ':' + l.blend + ':' + l.fill + ':' + (l.clip ? 1 : 0) + ':' + (l.maskEnabled ? 1 : 0) + ':' + (l.mask ? 1 : 0) + ':' + JSON.stringify(l.fx || {}) + '|';
  return out;
}

function drawLayers(layers, x, w, h, opts = {}) {
  let base = null; // Basis für Schnittmasken
  layers.forEach((layer, i) => {
    if (!layer.visible && !opts.forceAll) { if (!layer.clip) base = null; return; }
    let src = renderLayerFx(layer, w, h, 'L' + (i % 2));
    if (layer.clip && base) {
      const c = tmp('clip', w, h);
      const cx = ctx2d(c);
      cx.drawImage(src, 0, 0);
      cx.globalCompositeOperation = 'destination-in';
      cx.drawImage(base, 0, 0);
      src = c;
    } else if (!layer.clip) {
      base = layer.canvas;
    }
    x.globalAlpha = layer.opacity;
    x.globalCompositeOperation = gcoFor(layer.blend);
    x.drawImage(src, 0, 0);
  });
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
  const canCache = opts.cached && !L.some((l) => l.clip) && a >= 0 && a < L.length;
  // Nur Ausschnitt neu zusammensetzen, wenn sich ausschließlich die aktive Ebene geändert hat
  if (canCache && opts.rect) {
    const cache = cacheFor(doc);
    const below = L.slice(0, a), above = L.slice(a + 1);
    const okBelow = !below.length || (cache.below && cache.belowSig === w + 'x' + h + '#' + layerSig(below));
    const simpleAbove = above.every((l) => !l.visible || l.blend === 'normal');
    const okAbove = !above.length || !simpleAbove || (cache.above && cache.aboveSig === w + 'x' + h + '#' + layerSig(above));
    const act = L[a];
    const plainActive = !(act.mask && act.maskEnabled) && act.fill >= 1 && act.blend !== 'dissolve' && !Object.values(act.fx || {}).some((f) => f && f.enabled);
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
        if (above.length) {
          if (simpleAbove) x.drawImage(cache.above, rx, ry, rw, rh, rx, ry, rw, rh);
          else drawLayers(above, x, w, h);
        }
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
    drawLayers([L[a]], x, w, h);
    if (above.length) {
      const simple = above.every((l) => !l.visible || l.blend === 'normal');
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
      } else drawLayers(above, x, w, h);
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
