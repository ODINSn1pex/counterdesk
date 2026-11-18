// Globaler Zustand + Aktionen
import { useSyncExternalStore } from 'react';
import { Doc, Layer, createDoc, docFromImage, composite, flattenToCanvas, renderTextLayer, layerProps, applyLayerProps, getMerged } from './engine/doc.js';
import { makeCanvas, ctx2d, cloneCanvas, alphaBounds, loadImage, canvasToBytes, hexToRgb, luminance } from './engine/util.js';
import * as SEL from './engine/selection.js';
import { readPsd, writePsd } from './io/psd.js';

const listeners = new Set();
let version = 0;

const LS = {
  get(k, d) { try { const v = localStorage.getItem('sakura.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sakura.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
export { LS };

export const DEFAULT_GRADIENTS = [
  { name: 'Vordergrund → Hintergrund', fgbg: true, stops: [] },
  { name: 'Vordergrund → Transparent', fgt: true, stops: [] },
  { name: 'Sakura', stops: [{ p: 0, c: '#ffd6ec' }, { p: 0.5, c: '#e57fb8' }, { p: 1, c: '#6a3fa0' }] },
  { name: 'Mondnacht', stops: [{ p: 0, c: '#0f0c29' }, { p: 0.55, c: '#302b63' }, { p: 1, c: '#b48ad6' }] },
  { name: 'Laterne', stops: [{ p: 0, c: '#fff1c1' }, { p: 0.5, c: '#ffb86b' }, { p: 1, c: '#c2410c' }] },
  { name: 'Regenbogen', stops: [{ p: 0, c: '#ff0000' }, { p: 0.17, c: '#ff9900' }, { p: 0.33, c: '#ffee00' }, { p: 0.5, c: '#22cc44' }, { p: 0.67, c: '#2288ff' }, { p: 0.83, c: '#6633cc' }, { p: 1, c: '#cc33aa' }] },
  { name: 'Schwarz → Weiß', stops: [{ p: 0, c: '#000000' }, { p: 1, c: '#ffffff' }] },
  { name: 'Kupfer', stops: [{ p: 0, c: '#3b1d0e' }, { p: 0.5, c: '#d68a4c' }, { p: 1, c: '#fde3c8' }] },
  { name: 'Ozean', stops: [{ p: 0, c: '#001f3f' }, { p: 0.6, c: '#0077b6' }, { p: 1, c: '#90e0ef' }] },
  { name: 'Lavendel', stops: [{ p: 0, c: '#e9d5ff' }, { p: 1, c: '#7c3aed' }] },
];

export const DEFAULT_SWATCHES = [
  '#000000', '#ffffff', '#808080', '#c0c0c0', '#ff0000', '#ff8800', '#ffee00', '#22cc44', '#00c8ff', '#2255ff', '#8833ff', '#ff33aa',
  '#ffd6ec', '#f7b2d9', '#e57fb8', '#c85fa0', '#9b3f86', '#6a3fa0', '#3d2a6b', '#241b45', '#1b1730', '#fff1c1', '#ffb86b', '#e9d5ff',
  '#7fb5ff', '#b3e5fc', '#d9f99d', '#fde68a', '#fecaca', '#a7f3d0', '#5b4a8a', '#2d2550', '#f472b6', '#fb7185', '#c084fc', '#818cf8',
];

export const PATTERNS = ['sakura', 'checker', 'dots', 'stripes', 'grid', 'waves', 'stars', 'hearts'];

export const DEFAULT_PREFS = {
  // Allgemein
  showWelcome: true, recentCount: 10, autoSaveMin: 3, historyStates: 60, confirmClose: true,
  // Oberfläche
  theme: 'dark', accent: 'auto', uiScale: 1, reduceMotion: false, sakuraPetals: true, thumbSize: 'medium', tooltips: true,
  // Werkzeuge
  wheelZoom: false, animatedZoom: true, brushCursor: 'normal', pressureSize: true, pressureOpacity: false,
  proportionalTransform: true, nudgeStep: 10, snapDistance: 6,
  // Leistung
  fastPreview: true, hardwareAcceleration: true,
  // Transparenz & Raster
  checker: 'medium', checkerTone: 'light', gridSpacing: 50, gridSub: 4, gridColor: '#ff9ad5', guideColor: '#3ce0ff', pixelGrid: true,
  // Einheiten
  units: 'px', defaultPpi: 72,
  // Dateien
  saveDir: '', exportFormat: 'png', jpgQuality: 90,
};

export const S = {
  docs: [],
  activeId: null,
  tool: 'move',
  sub: { marquee: 'rect', lasso: 'lasso', wand: 'quick', crop: 'crop', eyedropper: 'eyedropper', heal: 'spot', brush: 'brush', stamp: 'clone', history: 'history', eraser: 'eraser', gradient: 'gradient', blur: 'blur', dodge: 'dodge', pen: 'pen', type: 'h', select: 'direct', shape: 'rect', view: 'hand' },
  fg: '#e57fb8',
  bg: '#ffffff',
  brush: { size: 30, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.12, mode: 'normal', smoothing: 0.2, angle: 0, roundness: 1, scatter: 0, jitter: 0, shape: 'round' },
  eraser: { size: 40, hardness: 0.7, opacity: 1, flow: 1, tolerance: 40 },
  pencil: { size: 4, opacity: 1 },
  stampOpts: { aligned: true, sampleAll: false, pattern: 'sakura' },
  retouch: { size: 60, strength: 0.5, range: 'midtones', exposure: 0.4, sponge: 'desaturate' },
  heal: { size: 40 },
  sel: { mode: 'new', feather: 0, aa: true, tolerance: 32, contiguous: true, sampleAll: false, ratio: 'free' },
  fill: { tolerance: 32, contiguous: true, sampleAll: false, source: 'fg', opacity: 1, mode: 'normal', pattern: 'sakura' },
  gradient: { index: 0, type: 'linear', reverse: false, opacity: 1, mode: 'normal', transparency: true },
  text: { font: 'Segoe UI', size: 64, color: null, bold: false, italic: false, underline: false, strike: false, caps: false, align: 'left', leading: 1.2, tracking: 0, vertical: false, aa: true },
  shape: { fill: true, stroke: false, strokeWidth: 4, strokeColor: '#ffffff', radius: 24, sides: 5, lineWidth: 6, arrow: false, starInner: 0.45 },
  move: { autoSelect: false, showTransform: false },
  eyedrop: { sample: 1, allLayers: true },
  crop: { ratio: 'free', deleteCropped: true },
  gradients: LS.get('gradients', null) || DEFAULT_GRADIENTS,
  swatches: LS.get('swatches', null) || DEFAULT_SWATCHES,
  recentColors: LS.get('recentColors', []),
  recent: LS.get('recent', []),
  prefs: { ...DEFAULT_PREFS, ...LS.get('prefs', {}) },
  ui: {
    dialog: null,
    menu: null,
    showRulers: LS.get('rulers', true),
    showGrid: false,
    showGuides: true,
    snap: true,
    quickMask: false,
    toast: null,
    panelTabs: { color: 'color', props: 'props', layers: 'layers', extra: 'history' },
    hiddenPanels: LS.get('hiddenPanels', {}),
    textEdit: null,
    contextMenu: null,
    tutorial: false,
    welcome: true,
    screenMode: 0,
  },
  transform: null,
  measure: null,
  cursor: { x: 0, y: 0, inside: false, color: null },
  clipboard: null,
  version: 0,
};

// Dokument-bezogene Zustände
S.cropState = null;

// Standardwerte der Werkzeugoptionen (für „Zurücksetzen“)
const TOOL_DEFAULTS = JSON.parse(JSON.stringify({ brush: S.brush, eraser: S.eraser, pencil: S.pencil, stampOpts: S.stampOpts, retouch: S.retouch, heal: S.heal, sel: S.sel, fill: S.fill, gradient: S.gradient, text: S.text, shape: S.shape, move: S.move, eyedrop: S.eyedrop, crop: S.crop }));
const TOOL_KEYS_FOR = { brush: ['brush', 'pencil'], eraser: ['eraser'], stamp: ['brush', 'stampOpts'], history: ['brush'], heal: ['heal'], blur: ['retouch'], dodge: ['retouch'], marquee: ['sel'], lasso: ['sel'], wand: ['sel', 'brush'], gradient: ['gradient', 'fill'], type: ['text'], shape: ['shape'], move: ['move'], eyedropper: ['eyedrop'], crop: ['crop'] };
export function resetToolOptions(all = false) {
  const keys = all ? Object.keys(TOOL_DEFAULTS) : (TOOL_KEYS_FOR[S.tool] || []);
  keys.forEach((k) => { S[k] = JSON.parse(JSON.stringify(TOOL_DEFAULTS[k])); });
  toast(all ? 'Alle Werkzeuge zurückgesetzt' : 'Werkzeug zurückgesetzt');
  view.overlay(); emit();
}

Doc.maxHistory = S.prefs.historyStates || 60;

// Eigener, leichter Kanal für Mausposition (verhindert Neurendern der ganzen Oberfläche)
const cursorListeners = new Set();
let cursorVersion = 0;
export function emitCursor() { cursorVersion++; cursorListeners.forEach((l) => l()); }
export function useCursor() {
  useSyncExternalStore((fn) => { cursorListeners.add(fn); return () => cursorListeners.delete(fn); }, () => cursorVersion);
  return S.cursor;
}

export function emit() {
  version++;
  S.version = version;
  listeners.forEach((l) => l());
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function useStore() { useSyncExternalStore(subscribe, () => version); return S; }

export function doc() { return S.docs.find((d) => d.id === S.activeId) || null; }

// Neuzeichnen anfordern (Canvas-Ansicht hört darauf)
export const view = {
  needs: true, compositeDirty: true, full: true, rect: null,
  // komplettes Neuzusammensetzen
  request() { this.needs = true; this.compositeDirty = true; this.full = true; this.rect = null; },
  // nur einen Bildausschnitt neu zusammensetzen (Malen)
  requestRect(r) {
    this.needs = true; this.compositeDirty = true;
    if (this.full) return;
    if (!this.rect) this.rect = { ...r };
    else {
      const x0 = Math.min(this.rect.x, r.x), y0 = Math.min(this.rect.y, r.y);
      const x1 = Math.max(this.rect.x + this.rect.w, r.x + r.w), y1 = Math.max(this.rect.y + this.rect.h, r.y + r.h);
      this.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  },
  overlay() { this.needs = true; },
};

export function toast(msg, ms = 2200) {
  S.ui.toast = { msg, id: Math.random() };
  emit();
  const id = S.ui.toast.id;
  setTimeout(() => { if (S.ui.toast && S.ui.toast.id === id) { S.ui.toast = null; emit(); } }, ms);
}

export function commit(name) {
  const d = doc();
  if (!d) return;
  d.commit(name);
  view.request();
  emit();
}

let laterT = null;
export function commitLater(name, ms = 450) {
  clearTimeout(laterT);
  laterT = setTimeout(() => commit(name), ms);
}

export function setTool(t, sub) {
  finishTextEdit();
  if (S.transform && t !== 'move') cancelTransform();
  S.tool = t;
  if (sub) S.sub[t] = sub;
  if (t === 'crop') initCrop();
  else S.cropState = null;
  view.overlay();
  emit();
}

export function addDoc(d) {
  S.docs.push(d);
  S.activeId = d.id;
  S.ui.welcome = false;
  view.request();
  emit();
}

export function newDocument(opts) {
  const n = S.docs.length + 1;
  const d = createDoc({ name: opts.name || `Unbenannt-${n}`, ...opts });
  d.ppi = opts.ppi || S.prefs.defaultPpi || 72;
  addDoc(d);
}

export function closeDoc(id, force = false) {
  const d = S.docs.find((x) => x.id === id);
  if (!d) return;
  if (d.dirty && !force) {
    S.ui.dialog = { type: 'confirmClose', docId: id };
    emit();
    return;
  }
  clearRecovery(d);
  S.docs = S.docs.filter((x) => x.id !== id);
  if (S.activeId === id) S.activeId = S.docs.length ? S.docs[S.docs.length - 1].id : null;
  if (!S.docs.length) S.ui.welcome = true;
  view.request();
  emit();
}

// ---------------- Datei-IO ----------------
const IMG_FILTERS = [
  { name: 'Alle unterstützten', extensions: ['sakura', 'psd', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico'] },
  { name: 'Sakura-Projekt', extensions: ['sakura'] },
  { name: 'Photoshop-Datei (PSD)', extensions: ['psd'] },
  { name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico'] },
];

function mimeFor(name) {
  const e = name.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon' }[e] || 'application/octet-stream';
}

function addRecent(p) {
  if (!p) return;
  S.recent = [p, ...S.recent.filter((x) => x !== p)].slice(0, S.prefs.recentCount || 10);
  LS.set('recent', S.recent);
}

export async function openBytes(name, bytes, path) {
  const ext = name.split('.').pop().toLowerCase();
  try {
    let d;
    if (ext === 'sakura') d = await loadProject(new TextDecoder().decode(bytes), name);
    else if (ext === 'psd') d = readPsd(bytes, name.replace(/\.psd$/i, ''));
    else {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(name) }));
      const img = await loadImage(url);
      d = docFromImage(img, name);
      URL.revokeObjectURL(url);
    }
    d.filePath = path && /\.(sakura|psd)$/i.test(path) ? path : null;
    if (path) addRecent(path);
    addDoc(d);
    toast(`„${name}“ geöffnet`);
  } catch (e) {
    console.error(e);
    toast('Datei konnte nicht geöffnet werden: ' + (e.message || e));
  }
}

function pickFileBrowser(accept, multi) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = !!multi;
    inp.onchange = async () => {
      const out = [];
      for (const f of inp.files) out.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()), path: null });
      res(out);
    };
    inp.click();
  });
}

export async function openFile() {
  let files;
  if (window.native) files = await window.native.openDialog({ title: 'Öffnen', filters: IMG_FILTERS, multi: true, defaultPath: S.prefs.saveDir || undefined });
  else files = await pickFileBrowser('.sakura,.psd,image/*', true);
  for (const f of files) await openBytes(f.name, new Uint8Array(f.data), f.path);
}

export async function openRecent(p) {
  if (!window.native) return;
  const f = await window.native.readFile(p);
  if (!f) { toast('Datei nicht gefunden'); S.recent = S.recent.filter((x) => x !== p); LS.set('recent', S.recent); emit(); return; }
  await openBytes(f.name, new Uint8Array(f.data), f.path);
}

export async function placeFile() {
  const d = doc(); if (!d) return;
  let files;
  if (window.native) files = await window.native.openDialog({ title: 'Platzieren', filters: [IMG_FILTERS[3]] });
  else files = await pickFileBrowser('image/*');
  for (const f of files) {
    const url = URL.createObjectURL(new Blob([f.data], { type: mimeFor(f.name) }));
    const img = await loadImage(url);
    placeImage(img, f.name.replace(/\.[^.]+$/, ''));
  }
}

export function placeImage(img, name = 'Platziert') {
  const d = doc(); if (!d) return;
  const l = new Layer(d.w, d.h, name);
  const s = Math.min(1, d.w / img.width, d.h / img.height);
  const w = img.width * s, h = img.height * s;
  l.ctx.drawImage(img, (d.w - w) / 2, (d.h - h) / 2, w, h);
  d.addLayer(l);
  commit('Platzieren');
}

async function saveBytes(name, bytes, filters, existingPath) {
  if (window.native) {
    const p = existingPath || await window.native.saveDialog({ name, filters, dir: S.prefs.saveDir || undefined });
    if (!p) return null;
    await window.native.writeFile(p, bytes);
    return p;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes]));
  a.download = name;
  a.click();
  return name;
}

export async function saveProject(saveAs = false) {
  const d = doc(); if (!d) return;
  const isPsd = d.filePath && /\.psd$/i.test(d.filePath);
  if (isPsd && !saveAs) return exportPsd(d.filePath);
  const json = await serializeProject(d);
  const base = d.name.replace(/\.[^.]+$/, '');
  const p = await saveBytes(base + '.sakura', new TextEncoder().encode(json), [{ name: 'Sakura-Projekt', extensions: ['sakura'] }], saveAs ? null : d.filePath);
  if (!p) return;
  d.filePath = p;
  d.name = p.split(/[\\/]/).pop();
  d.dirty = false;
  clearRecovery(d);
  addRecent(p);
  toast('Gespeichert: ' + d.name);
  emit();
}

export async function exportPsd(path) {
  const d = doc(); if (!d) return;
  const bytes = writePsd(d);
  const base = d.name.replace(/\.[^.]+$/, '');
  const p = await saveBytes(base + '.psd', bytes, [{ name: 'Photoshop (PSD)', extensions: ['psd'] }], path || null);
  if (!p) return;
  if (path) d.dirty = false;
  toast('PSD gespeichert: ' + p.split(/[\\/]/).pop());
  emit();
}

export async function exportImage(fmt = 'png', quality = 0.92, scale = 1, transparent = true) {
  const d = doc(); if (!d) return;
  let c = flattenToCanvas(d, fmt === 'jpeg' || !transparent ? '#ffffff' : null);
  if (scale !== 1) {
    const s = makeCanvas(d.w * scale, d.h * scale);
    const x = ctx2d(s); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.width, s.height); c = s;
  }
  const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  const bytes = await canvasToBytes(c, mime, quality);
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;
  const base = d.name.replace(/\.[^.]+$/, '');
  const p = await saveBytes(`${base}.${ext}`, bytes, [{ name: ext.toUpperCase(), extensions: [ext] }]);
  if (p) toast('Exportiert: ' + p.split(/[\\/]/).pop());
}

export async function exportLayers() {
  const d = doc(); if (!d) return;
  const base = d.name.replace(/\.[^.]+$/, '');
  const safe = (n) => n.replace(/[\\/:*?"<>|]/g, '_');
  if (window.native) {
    const dir = await window.native.chooseFolder({ title: 'Zielordner für Ebenen wählen', defaultPath: S.prefs.saveDir || undefined });
    if (!dir) return;
    let i = 0;
    for (const l of d.layers) {
      i++;
      const bytes = await canvasToBytes(l.canvas, 'image/png');
      await window.native.writeFileIn(dir, `${safe(base)}_${String(i).padStart(2, '0')}_${safe(l.name)}.png`, bytes);
    }
    toast(`${d.layers.length} Ebenen exportiert`);
    return;
  }
  for (const l of d.layers) {
    const bytes = await canvasToBytes(l.canvas, 'image/png');
    const p = await saveBytes(`${safe(base)}_${safe(l.name)}.png`, bytes, [{ name: 'PNG', extensions: ['png'] }]);
    if (!p) break;
  }
}

export async function serializeProject(d) {
  const toUrl = (c) => c.toDataURL('image/png');
  return JSON.stringify({
    app: 'Sakura Studio', version: 1, w: d.w, h: d.h, name: d.name, active: d.active, ppi: d.ppi,
    guides: d.guides, paths: d.paths,
    layers: d.layers.map((l) => ({ props: layerProps(l), png: toUrl(l.canvas), mask: l.mask ? toUrl(l.mask) : null })),
    alpha: d.alphaChannels.map((a) => ({ name: a.name, png: toUrl(a.canvas) })),
  });
}

async function loadProject(text, name) {
  const j = JSON.parse(text);
  const d = new Doc(j.w, j.h, name);
  d.ppi = j.ppi || 72;
  d.guides = j.guides || [];
  d.paths = j.paths || [];
  for (const e of j.layers) {
    const l = new Layer(j.w, j.h);
    applyLayerProps(l, e.props);
    l.ctx.drawImage(await loadImage(e.png), 0, 0);
    if (e.mask) { l.mask = makeCanvas(j.w, j.h); ctx2d(l.mask).drawImage(await loadImage(e.mask), 0, 0); }
    d.layers.push(l);
  }
  for (const a of j.alpha || []) { const c = makeCanvas(j.w, j.h); ctx2d(c).drawImage(await loadImage(a.png), 0, 0); d.alphaChannels.push({ name: a.name, canvas: c }); }
  d.active = Math.min(j.active || 0, d.layers.length - 1);
  d.commit('Öffnen');
  d.dirty = false;
  return d;
}

export async function printDoc() {
  const d = doc(); if (!d) return;
  const img = document.getElementById('print-image');
  img.src = flattenToCanvas(d, '#ffffff').toDataURL('image/png');
  await new Promise((r) => setTimeout(r, 150));
  if (window.native) await window.native.print(); else window.print();
}

// ---------------- Ebenen ----------------
export function layerOp(fn, name) {
  const d = doc(); if (!d) return;
  const r = fn(d, d.layer);
  if (r === false) return;
  commit(name);
}

export function canEditPixels(l, quiet) {
  if (!l) return false;
  if (l.lockAll || l.lockPixels) { if (!quiet) toast('Ebene ist fixiert 🔒'); return false; }
  if (!l.visible) { if (!quiet) toast('Ebene ist ausgeblendet'); return false; }
  if (l.type === 'text') rasterize(l);
  return true;
}

export function rasterize(l) {
  if (l.type === 'text') { l.type = 'raster'; l.text = null; l.touch(); }
}

export const L = {
  add: () => layerOp((d) => { d.newLayer(); }, 'Neue Ebene'),
  duplicate: () => layerOp((d, l) => {
    const n = new Layer(d.w, d.h, l.name + ' Kopie');
    applyLayerProps(n, layerProps(l));
    n.name = l.name + ' Kopie'; n.isBackground = false; n.lockPosition = false;
    n.ctx.drawImage(l.canvas, 0, 0);
    if (l.mask) n.mask = cloneCanvas(l.mask);
    d.addLayer(n);
  }, 'Ebene duplizieren'),
  remove: () => layerOp((d) => {
    if (d.layers.length <= 1) { toast('Die letzte Ebene kann nicht gelöscht werden'); return false; }
    d.layers.splice(d.active, 1);
    d.active = Math.max(0, d.active - 1);
  }, 'Ebene löschen'),
  viaCopy: (cut) => layerOp((d, l) => {
    const n = new Layer(d.w, d.h, cut ? 'Ebene durch Ausschneiden' : 'Ebene durch Kopie');
    n.ctx.drawImage(l.canvas, 0, 0);
    if (d.selection) {
      const x = n.ctx; x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection, 0, 0);
      if (cut && canEditPixels(l)) { const lx = l.ctx; lx.save(); lx.globalCompositeOperation = 'destination-out'; lx.drawImage(d.selection, 0, 0); lx.restore(); l.touch(); }
    }
    d.addLayer(n);
  }, cut ? 'Ebene durch Ausschneiden' : 'Ebene durch Kopie'),
  moveUp: () => layerOp((d) => { if (d.active >= d.layers.length - 1) return false; const [l] = d.layers.splice(d.active, 1); d.layers.splice(d.active + 1, 0, l); d.active++; }, 'Anordnen'),
  moveDown: () => layerOp((d) => { if (d.active <= 0) return false; const [l] = d.layers.splice(d.active, 1); d.layers.splice(d.active - 1, 0, l); d.active--; }, 'Anordnen'),
  toTop: () => layerOp((d) => { const [l] = d.layers.splice(d.active, 1); d.layers.push(l); d.active = d.layers.length - 1; }, 'In den Vordergrund'),
  toBottom: () => layerOp((d) => { const [l] = d.layers.splice(d.active, 1); d.layers.unshift(l); d.active = 0; }, 'In den Hintergrund'),
  reorder: (from, to) => layerOp((d) => { const [l] = d.layers.splice(from, 1); d.layers.splice(to, 0, l); d.active = to; }, 'Ebenen anordnen'),
  mergeDown: () => layerOp((d) => {
    if (d.active === 0) { toast('Keine Ebene darunter'); return false; }
    const top = d.layers[d.active], below = d.layers[d.active - 1];
    const tmp = { ...d, layers: [below, top], channelView: null };
    const c = makeCanvas(d.w, d.h);
    composite(tmp, c, { noChannels: true });
    rasterize(below);
    below.ctx.clearRect(0, 0, d.w, d.h); below.ctx.drawImage(c, 0, 0);
    below.opacity = 1; below.blend = 'normal'; below.fx = {}; below.mask = null; below.fill = 1; below.touch();
    d.layers.splice(d.active, 1); d.active--;
  }, 'Auf eine Ebene reduzieren'),
  mergeVisible: () => layerOp((d) => {
    const c = makeCanvas(d.w, d.h); composite({ ...d, channelView: null }, c, { noChannels: true });
    const vis = d.layers.filter((l) => l.visible);
    if (vis.length < 2) return false;
    const n = new Layer(d.w, d.h, 'Zusammengefügt'); n.ctx.drawImage(c, 0, 0);
    const idx = d.layers.indexOf(vis[vis.length - 1]);
    d.layers = d.layers.filter((l) => !l.visible || l === vis[vis.length - 1]);
    const at = d.layers.indexOf(vis[vis.length - 1]);
    d.layers[at] = n; d.active = at; void idx;
  }, 'Sichtbare auf eine Ebene reduzieren'),
  flatten: () => layerOp((d) => {
    const c = flattenToCanvas(d, '#ffffff');
    const n = new Layer(d.w, d.h, 'Hintergrund'); n.ctx.drawImage(c, 0, 0); n.isBackground = true; n.lockPosition = true;
    d.layers = [n]; d.active = 0;
  }, 'Auf Hintergrundebene reduzieren'),
  stampVisible: () => layerOp((d) => {
    const c = makeCanvas(d.w, d.h); composite({ ...d, channelView: null }, c, { noChannels: true });
    const n = new Layer(d.w, d.h, 'Stempel sichtbar'); n.ctx.drawImage(c, 0, 0); d.layers.push(n); d.active = d.layers.length - 1;
  }, 'Sichtbare stempeln'),
  addMask: (fromSel = true, hideAll = false) => layerOp((d, l) => {
    if (l.mask) { toast('Ebene hat bereits eine Maske'); return false; }
    l.mask = makeCanvas(d.w, d.h);
    const x = ctx2d(l.mask);
    if (fromSel && d.selection) x.drawImage(d.selection, 0, 0);
    else if (!hideAll) { x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); }
    if (l.isBackground) { l.isBackground = false; l.lockPosition = false; l.name = l.name === 'Hintergrund' ? 'Ebene 0' : l.name; }
    l.editMask = true; l.touch();
  }, 'Ebenenmaske hinzufügen'),
  deleteMask: () => layerOp((d, l) => { if (!l.mask) return false; l.mask = null; l.editMask = false; l.touch(); }, 'Ebenenmaske löschen'),
  applyMask: () => layerOp((d, l) => {
    if (!l.mask) return false;
    const x = l.ctx; x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask, 0, 0); x.globalCompositeOperation = 'source-over';
    l.mask = null; l.editMask = false; l.touch();
  }, 'Ebenenmaske anwenden'),
  invertMask: () => layerOp((d, l) => {
    if (!l.mask) return false;
    const n = makeCanvas(d.w, d.h); const x = ctx2d(n); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h);
    x.globalCompositeOperation = 'destination-out'; x.drawImage(l.mask, 0, 0); l.mask = n; l.touch();
  }, 'Maske umkehren'),
  toggleClip: () => layerOp((d, l) => { if (d.active === 0) return false; l.clip = !l.clip; l.touch(); }, 'Schnittmaske'),
  rasterize: () => layerOp((d, l) => { if (l.type !== 'text') return false; rasterize(l); }, 'Ebene rastern'),
  fromBackground: () => layerOp((d, l) => { l.isBackground = false; l.lockPosition = false; if (l.name === 'Hintergrund') l.name = 'Ebene 0'; l.touch(); }, 'Ebene aus Hintergrund'),
  fillLayer: (color) => layerOp((d) => {
    const n = new Layer(d.w, d.h, 'Farbfüllung 1'); const x = n.ctx; x.fillStyle = color || S.fg; x.fillRect(0, 0, d.w, d.h);
    if (d.selection) { n.mask = cloneCanvas(d.selection); }
    d.addLayer(n);
  }, 'Neue Füllebene'),
  gradientLayer: () => layerOp((d) => {
    const n = new Layer(d.w, d.h, 'Verlaufsfüllung 1'); const x = n.ctx;
    const g = x.createLinearGradient(0, 0, 0, d.h);
    gradientStops(S.gradients[S.gradient.index]).forEach((s) => g.addColorStop(s.p, s.c));
    x.fillStyle = g; x.fillRect(0, 0, d.w, d.h);
    if (d.selection) n.mask = cloneCanvas(d.selection);
    d.addLayer(n);
  }, 'Neue Verlaufsfüllung'),
  patternLayer: () => layerOp((d) => {
    const n = new Layer(d.w, d.h, 'Musterfüllung 1'); const x = n.ctx;
    x.fillStyle = x.createPattern(patternCanvas(S.fill.pattern), 'repeat'); x.fillRect(0, 0, d.w, d.h);
    if (d.selection) n.mask = cloneCanvas(d.selection);
    d.addLayer(n);
  }, 'Neue Musterfüllung'),
};

export function setLayerProp(l, key, value, histName) {
  l[key] = value;
  view.request();
  emit();
  if (histName) commit(histName);
}

// ---------------- Farben / Verläufe / Muster ----------------
export function setFg(c) { S.fg = c; pushRecent(c); emit(); }
export function setBg(c) { S.bg = c; emit(); }
function pushRecent(c) {
  S.recentColors = [c, ...S.recentColors.filter((x) => x !== c)].slice(0, 12);
  LS.set('recentColors', S.recentColors);
}

export function gradientStops(g) {
  if (!g) return [{ p: 0, c: S.fg }, { p: 1, c: S.bg }];
  if (g.fgbg) return [{ p: 0, c: S.fg }, { p: 1, c: S.bg }];
  if (g.fgt) { const { r, g: gg, b } = hexToRgb(S.fg); return [{ p: 0, c: S.fg }, { p: 1, c: `rgba(${r},${gg},${b},0)` }]; }
  return g.stops;
}

const patCache = {};
export function patternCanvas(name) {
  if (patCache[name]) return patCache[name];
  const s = 48; const c = makeCanvas(s, s); const x = ctx2d(c);
  const fg = '#e57fb8', bg = '#2a2347';
  x.fillStyle = bg; x.fillRect(0, 0, s, s); x.fillStyle = fg; x.strokeStyle = fg;
  if (name === 'checker') { x.fillRect(0, 0, 24, 24); x.fillRect(24, 24, 24, 24); }
  else if (name === 'dots') { for (const [a, b] of [[12, 12], [36, 36]]) { x.beginPath(); x.arc(a, b, 6, 0, 7); x.fill(); } }
  else if (name === 'stripes') { x.lineWidth = 8; for (let i = -48; i < 96; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 48, 48); x.stroke(); } }
  else if (name === 'grid') { x.lineWidth = 2; x.strokeRect(0, 0, 48, 48); x.beginPath(); x.moveTo(24, 0); x.lineTo(24, 48); x.moveTo(0, 24); x.lineTo(48, 24); x.stroke(); }
  else if (name === 'waves') { x.lineWidth = 3; for (const y of [12, 36]) { x.beginPath(); for (let i = 0; i <= 48; i++) x.lineTo(i, y + Math.sin(i / 48 * Math.PI * 2) * 6); x.stroke(); } }
  else if (name === 'stars') { drawStarPath(x, 24, 24, 5, 14, 6); x.fill(); }
  else if (name === 'hearts') { drawHeartPath(x, 8, 10, 32, 30); x.fill(); }
  else { drawBlossom(x, 24, 24, 16, fg); x.fillStyle = '#ffd6ec'; drawBlossom(x, 4, 4, 6, '#ffd6ec'); drawBlossom(x, 44, 44, 6, '#ffd6ec'); }
  patCache[name] = c;
  return c;
}

export function drawStarPath(x, cx, cy, n, R, r) {
  x.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r : R;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
}

export function drawHeartPath(x, X, Y, W, H) {
  x.beginPath();
  x.moveTo(X + W / 2, Y + H * 0.3);
  x.bezierCurveTo(X + W / 2, Y, X, Y, X, Y + H * 0.3);
  x.bezierCurveTo(X, Y + H * 0.6, X + W / 2, Y + H * 0.8, X + W / 2, Y + H);
  x.bezierCurveTo(X + W / 2, Y + H * 0.8, X + W, Y + H * 0.6, X + W, Y + H * 0.3);
  x.bezierCurveTo(X + W, Y, X + W / 2, Y, X + W / 2, Y + H * 0.3);
  x.closePath();
}

export function drawBlossom(x, cx, cy, r, color) {
  x.save(); x.fillStyle = color; x.translate(cx, cy);
  for (let i = 0; i < 5; i++) {
    x.rotate((Math.PI * 2) / 5);
    x.beginPath(); x.ellipse(0, -r * 0.55, r * 0.38, r * 0.55, 0, 0, Math.PI * 2); x.fill();
  }
  x.fillStyle = '#fff3a8'; x.beginPath(); x.arc(0, 0, r * 0.16, 0, 7); x.fill();
  x.restore();
}

// ---------------- Auswahl ----------------
export const SELECT = {
  all: () => { const d = doc(); if (!d) return; d.selectAll(); commit('Alles auswählen'); },
  none: () => { const d = doc(); if (!d || !d.selection) return; d.deselect(); commit('Auswahl aufheben'); },
  reselect: () => { const d = doc(); if (!d || !d.lastSelection) return; d.setSelection(d.lastSelection); commit('Erneut auswählen'); },
  invert: () => { const d = doc(); if (!d) return; SEL.invert(d); commit('Auswahl umkehren'); },
  allLayersOpaque: () => { const d = doc(); if (!d) return; const c = makeCanvas(d.w, d.h); ctx2d(c).drawImage(d.layer.canvas, 0, 0); d.setSelection(c); commit('Ebenentransparenz laden'); },
  modify: (kind, r) => {
    const d = doc(); if (!d || !d.selection) { toast('Keine Auswahl vorhanden'); return; }
    const fn = { feather: SEL.feather, expand: SEL.expand, contract: SEL.contract, smooth: SEL.smooth, border: SEL.border }[kind];
    d.setSelection(fn(d.selection, r));
    commit({ feather: 'Weiche Auswahlkante', expand: 'Auswahl erweitern', contract: 'Auswahl verkleinern', smooth: 'Auswahl abrunden', border: 'Auswahlumrandung' }[kind]);
  },
  subject: () => {
    const d = doc(); if (!d) return;
    d.setSelection(SEL.selectSubject(getMerged(d))); commit('Motiv auswählen');
  },
  colorRange: (hex, fuzz) => {
    const d = doc(); if (!d) return;
    d.setSelection(SEL.colorRange(getMerged(d), hex, fuzz)); commit('Farbbereich');
  },
  save: (name) => { const d = doc(); if (!d || !d.selection) return; d.alphaChannels.push({ name: name || `Alpha ${d.alphaChannels.length + 1}`, canvas: cloneCanvas(d.selection) }); commit('Auswahl speichern'); },
  load: (i) => { const d = doc(); const a = d && d.alphaChannels[i]; if (!a) return; d.setSelection(cloneCanvas(a.canvas)); commit('Auswahl laden'); },
  toggleQuickMask: () => {
    S.ui.quickMask = !S.ui.quickMask;
    const d = doc();
    if (d && S.ui.quickMask && !d.selection) { d.setSelection(makeCanvas(d.w, d.h)); }
    if (d && !S.ui.quickMask) { d.setSelection(d.selection); if (SEL.isEmpty(d.selection)) d.deselect(); commit('Maskierungsmodus'); }
    view.request(); emit();
  },
};

// ---------------- Bearbeiten ----------------
export function selectionOrAll(d) {
  if (d.selection) return d.selection;
  const c = makeCanvas(d.w, d.h); const x = ctx2d(c); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); return c;
}

export const EDIT = {
  undo: () => { const d = doc(); if (!d) return; if (S.ui.textEdit) finishTextEdit(); cancelTransform(); d.undo(); view.request(); emit(); },
  redo: () => { const d = doc(); if (!d) return; if (S.ui.textEdit) finishTextEdit(); cancelTransform(); d.redo(); view.request(); emit(); },
  copy: async (merged = false) => {
    const d = doc(); if (!d) return;
    const src = merged ? flattenToCanvas(d) : d.layer.canvas;
    const c = cloneCanvas(src);
    if (d.selection) { const x = ctx2d(c); x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection, 0, 0); }
    const b = alphaBounds(c);
    if (!b) { toast('Auswahl ist leer'); return false; }
    const out = makeCanvas(b.w, b.h); ctx2d(out).drawImage(c, -b.x, -b.y);
    S.clipboard = { canvas: out, x: b.x, y: b.y };
    try {
      const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (e) { /* intern weiter nutzbar */ }
    toast('Kopiert');
    return true;
  },
  cut: async () => {
    const d = doc(); if (!d) return;
    if (!canEditPixels(d.layer)) return;
    if (await EDIT.copy() === false) return;
    clearArea(d);
    commit('Ausschneiden');
  },
  paste: async (inPlace = false) => {
    const d = doc(); if (!d) return;
    let canvas = null, x = null, y = null;
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find((tt) => tt.startsWith('image/'));
        if (t) {
          const blob = await it.getType(t);
          const img = await loadImage(URL.createObjectURL(blob));
          if (S.clipboard && img.width === S.clipboard.canvas.width && img.height === S.clipboard.canvas.height) { canvas = S.clipboard.canvas; x = S.clipboard.x; y = S.clipboard.y; }
          else { canvas = makeCanvas(img.width, img.height); ctx2d(canvas).drawImage(img, 0, 0); }
          break;
        }
      }
    } catch (e) { /* fallback */ }
    if (!canvas && S.clipboard) { canvas = S.clipboard.canvas; x = S.clipboard.x; y = S.clipboard.y; }
    if (!canvas) { toast('Zwischenablage ist leer'); return; }
    const l = new Layer(d.w, d.h, 'Eingefügt');
    const px = inPlace && x != null ? x : Math.round((d.w - canvas.width) / 2);
    const py = inPlace && y != null ? y : Math.round((d.h - canvas.height) / 2);
    l.ctx.drawImage(canvas, px, py);
    d.addLayer(l);
    commit('Einfügen');
  },
  clear: () => {
    const d = doc(); if (!d) return;
    if (!canEditPixels(d.layer)) return;
    clearArea(d);
    commit('Löschen');
  },
  fill: (source, opacity = 1, mode = 'normal', color) => {
    const d = doc(); if (!d) return;
    const l = d.layer; if (!canEditPixels(l)) return;
    const sel = selectionOrAll(d);
    const c = makeCanvas(d.w, d.h); const x = ctx2d(c);
    if (source === 'pattern') x.fillStyle = x.createPattern(patternCanvas(S.fill.pattern), 'repeat');
    else if (source === 'content') { contentAwareFill(d, l, sel); commit('Inhaltsbasierte Füllung'); return; }
    else x.fillStyle = { fg: S.fg, bg: S.bg, black: '#000', white: '#fff', gray: '#808080', color: color || S.fg }[source] || S.fg;
    x.fillRect(0, 0, d.w, d.h);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(sel, 0, 0);
    const lx = l.ctx; lx.save(); lx.globalAlpha = opacity; lx.globalCompositeOperation = mode === 'normal' ? (l.lockAlpha ? 'source-atop' : 'source-over') : mode;
    lx.drawImage(c, 0, 0); lx.restore();
    l.touch();
    commit('Fläche füllen');
  },
  stroke: (width = 4, color, location = 'center') => {
    const d = doc(); if (!d || !d.selection) { toast('Keine Auswahl vorhanden'); return; }
    const l = d.layer; if (!canEditPixels(l)) return;
    const outer = SEL.expand(d.selection, location === 'inside' ? 0.01 : location === 'center' ? width / 2 : width);
    const inner = SEL.contract(d.selection, location === 'outside' ? 0.01 : location === 'center' ? width / 2 : width);
    const ring = cloneCanvas(outer); const rx = ctx2d(ring);
    rx.globalCompositeOperation = 'destination-out'; rx.drawImage(inner, 0, 0);
    rx.globalCompositeOperation = 'source-in'; rx.fillStyle = color || S.fg; rx.fillRect(0, 0, d.w, d.h);
    l.ctx.drawImage(ring, 0, 0); l.touch();
    commit('Kontur füllen');
  },
  defineBrushPreset: () => toast('Pinselvorgabe gespeichert'),
};

function clearArea(d) {
  const l = d.layer;
  const sel = selectionOrAll(d);
  const x = l.ctx;
  x.save();
  if (l.isBackground) {
    const c = makeCanvas(d.w, d.h); const cx = ctx2d(c); cx.fillStyle = S.bg; cx.fillRect(0, 0, d.w, d.h);
    cx.globalCompositeOperation = 'destination-in'; cx.drawImage(sel, 0, 0);
    x.drawImage(c, 0, 0);
  } else { x.globalCompositeOperation = 'destination-out'; x.drawImage(sel, 0, 0); }
  x.restore();
  l.touch();
}

// Inhaltsbasiert füllen (Näherung: Diffusion vom Rand + Textur)
function contentAwareFill(d, l, sel) {
  const w = d.w, h = d.h;
  const x = l.ctx;
  const id = x.getImageData(0, 0, w, h); const px = id.data;
  const sd = ctx2d(sel).getImageData(0, 0, w, h).data;
  const hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) hole[i] = sd[i * 4 + 3] > 20 ? 1 : 0;
  // mehrstufige Diffusion
  const known = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) known[i] = hole[i] ? 0 : 1;
  let remaining = 0, bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) if (hole[y * w + xx]) { remaining++; if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  let guard = 0;
  while (remaining > 0 && guard++ < 4000) {
    const toSet = [];
    for (let y = by0; y <= by1; y++) for (let xx = bx0; xx <= bx1; xx++) {
      const i = y * w + xx; if (known[i]) continue;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = xx + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx; if (!known[j]) continue;
        r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; a += px[j * 4 + 3]; n++;
      }
      if (n >= 2 || (n && guard > 50)) toSet.push(i, r / n, g / n, b / n, a / n);
    }
    if (!toSet.length) break;
    for (let k = 0; k < toSet.length; k += 5) {
      const i = toSet[k]; const noise = (Math.random() - 0.5) * 10;
      px[i * 4] = toSet[k + 1] + noise; px[i * 4 + 1] = toSet[k + 2] + noise; px[i * 4 + 2] = toSet[k + 3] + noise; px[i * 4 + 3] = toSet[k + 4];
      known[i] = 1; remaining--;
    }
  }
  x.putImageData(id, 0, 0);
  l.touch();
}

// ---------------- Bild ----------------
export const IMAGE = {
  resize: (w, h, method = 'high') => {
    const d = doc(); if (!d) return;
    w = Math.round(w); h = Math.round(h);
    const scale = (c) => { const n = makeCanvas(w, h); const x = ctx2d(n); x.imageSmoothingEnabled = method !== 'nearest'; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h); return n; };
    d.layers.forEach((l) => {
      if (l.type === 'text') { const kx = w / d.w, ky = h / d.h; l.text.x *= kx; l.text.y *= ky; l.text.size *= Math.sqrt(kx * ky); }
      l.canvas = scale(l.canvas); if (l.mask) l.mask = scale(l.mask); l.touch();
      if (l.type === 'text') renderTextLayer(l, w, h);
    });
    if (d.selection) d.setSelection(scale(d.selection));
    d.alphaChannels.forEach((a) => { a.canvas = scale(a.canvas); });
    d.w = w; d.h = h; d.needsFit = true;
    commit('Bildgröße');
  },
  canvasSize: (w, h, ax = 0.5, ay = 0.5, fill = null) => {
    const d = doc(); if (!d) return;
    w = Math.round(w); h = Math.round(h);
    const ox = Math.round((w - d.w) * ax), oy = Math.round((h - d.h) * ay);
    const re = (c, isBg) => {
      const n = makeCanvas(w, h); const x = ctx2d(n);
      if (isBg) { x.fillStyle = fill || S.bg; x.fillRect(0, 0, w, h); }
      x.drawImage(c, ox, oy); return n;
    };
    d.layers.forEach((l) => {
      l.canvas = re(l.canvas, l.isBackground); if (l.mask) l.mask = re(l.mask);
      if (l.text) { l.text.x += ox; l.text.y += oy; }
      l.touch();
    });
    if (d.selection) d.setSelection(re(d.selection));
    d.alphaChannels.forEach((a) => { a.canvas = re(a.canvas); });
    d.guides = d.guides.map((g) => ({ ...g, pos: g.pos + (g.dir === 'v' ? ox : oy) }));
    d.w = w; d.h = h; d.needsFit = true;
    commit('Arbeitsfläche');
  },
  crop: (r, name = 'Freistellen') => {
    const d = doc(); if (!d) return;
    r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    const re = (c) => { const n = makeCanvas(r.w, r.h); ctx2d(n).drawImage(c, -r.x, -r.y); return n; };
    d.layers.forEach((l) => { l.canvas = re(l.canvas); if (l.mask) l.mask = re(l.mask); if (l.text) { l.text.x -= r.x; l.text.y -= r.y; } l.touch(); });
    if (d.selection) d.setSelection(null);
    d.alphaChannels.forEach((a) => { a.canvas = re(a.canvas); });
    d.guides = [];
    d.w = r.w; d.h = r.h; d.needsFit = true;
    commit(name);
  },
  cropToSelection: () => {
    const d = doc(); if (!d || !d.selection) { toast('Keine Auswahl vorhanden'); return; }
    const b = SEL.selectionBounds(d.selection); if (!b) return;
    IMAGE.crop(b);
  },
  trim: () => {
    const d = doc(); if (!d) return;
    const b = alphaBounds(flattenToCanvas(d));
    if (b) IMAGE.crop(b, 'Zuschneiden');
  },
  rotate: (deg) => {
    const d = doc(); if (!d) return;
    const swap = Math.abs(deg) === 90;
    const W = swap ? d.h : d.w, H = swap ? d.w : d.h;
    const re = (c) => { const n = makeCanvas(W, H); const x = ctx2d(n); x.translate(W / 2, H / 2); x.rotate(deg * Math.PI / 180); x.drawImage(c, -c.width / 2, -c.height / 2); return n; };
    d.layers.forEach((l) => { rasterize(l); l.canvas = re(l.canvas); if (l.mask) l.mask = re(l.mask); l.touch(); });
    if (d.selection) d.setSelection(re(d.selection));
    d.alphaChannels.forEach((a) => { a.canvas = re(a.canvas); });
    d.w = W; d.h = H; d.needsFit = true;
    commit('Bilddrehung');
  },
  flip: (horiz) => {
    const d = doc(); if (!d) return;
    const re = (c) => { const n = makeCanvas(c.width, c.height); const x = ctx2d(n); if (horiz) { x.translate(c.width, 0); x.scale(-1, 1); } else { x.translate(0, c.height); x.scale(1, -1); } x.drawImage(c, 0, 0); return n; };
    d.layers.forEach((l) => { rasterize(l); l.canvas = re(l.canvas); if (l.mask) l.mask = re(l.mask); l.touch(); });
    if (d.selection) d.setSelection(re(d.selection));
    commit(horiz ? 'Arbeitsfläche horizontal spiegeln' : 'Arbeitsfläche vertikal spiegeln');
  },
  grayscale: () => {
    const d = doc(); if (!d) return;
    d.layers.forEach((l) => {
      const x = l.ctx; const id = x.getImageData(0, 0, d.w, d.h); const p = id.data;
      for (let i = 0; i < p.length; i += 4) { const v = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114; p[i] = p[i + 1] = p[i + 2] = v; }
      x.putImageData(id, 0, 0); l.touch();
    });
    commit('Graustufen');
  },
  duplicate: () => {
    const d = doc(); if (!d) return;
    const n = new Doc(d.w, d.h, d.name.replace(/\.[^.]+$/, '') + ' Kopie');
    d.layers.forEach((l) => { const c = new Layer(d.w, d.h); applyLayerProps(c, layerProps(l)); c.ctx.drawImage(l.canvas, 0, 0); if (l.mask) c.mask = cloneCanvas(l.mask); n.layers.push(c); });
    n.active = d.active; n.commit('Duplizieren');
    addDoc(n);
  },
};

// Transformationen der aktiven Ebene (Bearbeiten > Transformieren)
export function transformLayer(kind) {
  const d = doc(); if (!d) return;
  const l = d.layer; if (!canEditPixels(l)) return;
  const src = cloneCanvas(l.canvas);
  const sel = d.selection;
  let part = src;
  if (sel) { part = cloneCanvas(src); const px = ctx2d(part); px.globalCompositeOperation = 'destination-in'; px.drawImage(sel, 0, 0); }
  const b = alphaBounds(part); if (!b) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const x = l.ctx;
  if (sel) { x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(sel, 0, 0); x.restore(); } else x.clearRect(0, 0, d.w, d.h);
  x.save(); x.translate(cx, cy);
  if (kind === 'r180') x.rotate(Math.PI); else if (kind === 'r90') x.rotate(Math.PI / 2); else if (kind === 'r-90') x.rotate(-Math.PI / 2);
  else if (kind === 'fh') x.scale(-1, 1); else if (kind === 'fv') x.scale(1, -1);
  x.drawImage(part, -cx, -cy); x.restore();
  l.touch();
  commit({ r180: '180° drehen', r90: '90° im UZS drehen', 'r-90': '90° gegen UZS drehen', fh: 'Horizontal spiegeln', fv: 'Vertikal spiegeln' }[kind]);
}

// ---------------- Freies Transformieren ----------------
export function startTransform() {
  const d = doc(); if (!d) return;
  const l = d.layer;
  if (l.lockAll || l.lockPosition) { toast('Position ist fixiert 🔒'); return; }
  if (l.isBackground) { L.fromBackground(); }
  rasterize(l);
  const before = cloneCanvas(l.canvas);
  let float = cloneCanvas(l.canvas);
  if (d.selection) { const fx = ctx2d(float); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(d.selection, 0, 0); }
  const b = alphaBounds(float);
  if (!b) { toast('Keine Pixel zum Transformieren'); return; }
  const piece = makeCanvas(b.w, b.h); ctx2d(piece).drawImage(float, -b.x, -b.y);
  const base = cloneCanvas(before);
  const bx = ctx2d(base);
  if (d.selection) { bx.globalCompositeOperation = 'destination-out'; bx.drawImage(d.selection, 0, 0); } else bx.clearRect(0, 0, d.w, d.h);
  S.transform = { layer: l, before, base, piece, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, cx0: b.x + b.w / 2, cy0: b.y + b.h / 2, sx: 1, sy: 1, rot: 0, skx: 0, hadSel: !!d.selection, maskBefore: l.mask && !d.selection ? cloneCanvas(l.mask) : null };
  if (S.tool !== 'move') S.tool = 'move';
  renderTransform();
  emit();
}

export function renderTransform() {
  const t = S.transform; if (!t) return;
  const x = t.layer.ctx;
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, t.layer.canvas.width, t.layer.canvas.height);
  x.drawImage(t.base, 0, 0);
  x.translate(t.cx, t.cy); x.rotate(t.rot); x.transform(1, 0, Math.tan(t.skx || 0), 1, 0, 0); x.scale(t.sx, t.sy);
  x.imageSmoothingQuality = 'high';
  x.drawImage(t.piece, -t.w / 2, -t.h / 2);
  x.restore();
  if (t.maskBefore && t.layer.mask) {
    const mx = ctx2d(t.layer.mask);
    mx.save(); mx.setTransform(1, 0, 0, 1, 0, 0); mx.clearRect(0, 0, t.layer.mask.width, t.layer.mask.height);
    mx.translate(t.cx, t.cy); mx.rotate(t.rot); mx.transform(1, 0, Math.tan(t.skx || 0), 1, 0, 0); mx.scale(t.sx, t.sy); mx.translate(-t.cx0, -t.cy0);
    mx.drawImage(t.maskBefore, 0, 0); mx.restore();
  }
  t.layer.touch();
  view.request();
}

export function applyTransform() {
  const t = S.transform; if (!t) return;
  const d = doc();
  if (t.hadSel && d) {
    const s = makeCanvas(d.w, d.h); const x = ctx2d(s);
    x.translate(t.cx, t.cy); x.rotate(t.rot); x.scale(t.sx, t.sy);
    x.fillStyle = '#fff'; x.fillRect(-t.w / 2, -t.h / 2, t.w, t.h);
    const pm = cloneCanvas(t.piece); const px = ctx2d(pm); px.globalCompositeOperation = 'source-in'; px.fillStyle = '#fff'; px.fillRect(0, 0, t.w, t.h);
    const s2 = makeCanvas(d.w, d.h); const x2 = ctx2d(s2); x2.translate(t.cx, t.cy); x2.rotate(t.rot); x2.scale(t.sx, t.sy); x2.drawImage(pm, -t.w / 2, -t.h / 2);
    d.setSelection(s2);
  }
  S.transform = null;
  commit('Frei transformieren');
}

export function cancelTransform() {
  const t = S.transform; if (!t) return;
  const x = t.layer.ctx; x.clearRect(0, 0, t.layer.canvas.width, t.layer.canvas.height); x.drawImage(t.before, 0, 0);
  if (t.maskBefore && t.layer.mask) { const mx = ctx2d(t.layer.mask); mx.clearRect(0, 0, t.layer.mask.width, t.layer.mask.height); mx.drawImage(t.maskBefore, 0, 0); }
  t.layer.touch();
  S.transform = null;
  view.request(); emit();
}

// ---------------- Freistellen ----------------
export function initCrop() {
  const d = doc(); if (!d) return;
  S.cropState = { x: 0, y: 0, w: d.w, h: d.h };
}
export function applyCrop() {
  const c = S.cropState; if (!c) return;
  IMAGE.crop({ x: Math.min(c.x, c.x + c.w), y: Math.min(c.y, c.y + c.h), w: Math.abs(c.w), h: Math.abs(c.h) });
  initCrop();
}

// ---------------- Text ----------------
export function finishTextEdit() {
  const te = S.ui.textEdit; if (!te) return;
  const d = doc();
  S.ui.textEdit = null;
  if (!d) return;
  const l = d.layers.find((x) => x.id === te.layerId);
  if (l && (!l.text || !l.text.content.trim())) {
    d.layers = d.layers.filter((x) => x !== l); d.active = Math.max(0, Math.min(d.active, d.layers.length - 1));
    view.request(); emit(); return;
  }
  if (l) { l.name = l.text.content.split('\n')[0].slice(0, 30) || 'Text'; }
  commit(te.isNew ? 'Textebene' : 'Text bearbeiten');
}

// ---------------- Ansicht ----------------
export const VIEW = {
  // Zoom um einen Bildschirmpunkt (relativ zur Mitte), sanft animiert
  zoomBy: (f, cx = 0, cy = 0, dur) => {
    const d = doc(); if (!d) return;
    const a = view.anim && view.anim.doc === d ? view.anim : null;
    const z0 = a ? a.z1 : d.zoom, px0 = a ? a.px1 : d.panX, py0 = a ? a.py1 : d.panY;
    const nz = Math.min(64, Math.max(0.02, z0 * f));
    VIEW.zoomTo(nz, cx - (cx - px0) * (nz / z0), cy - (cy - py0) * (nz / z0), dur);
  },
  zoomTo: (z, px, py, dur = 140) => {
    const d = doc(); if (!d) return;
    if (!S.prefs.animatedZoom || S.prefs.reduceMotion || dur === 0) { view.anim = null; d.zoom = z; d.panX = px; d.panY = py; view.request(); emit(); return; }
    view.anim = { doc: d, t0: performance.now(), dur, z0: d.zoom, z1: z, px0: d.panX, px1: px, py0: d.panY, py1: py };
    view.request();
  },
  fit: () => { const d = doc(); if (!d) return; const f = view.fitZoom ? view.fitZoom(d) : null; if (f) VIEW.zoomTo(f, 0, 0, 200); else { d.needsFit = true; view.request(); emit(); } },
  actual: () => { const d = doc(); if (d) VIEW.zoomTo(1, 0, 0, 200); },
  toggle: (k) => { S.ui[k] = !S.ui[k]; if (k === 'showRulers') LS.set('rulers', S.ui[k]); view.request(); emit(); },
  addGuide: (dir, pos) => { const d = doc(); if (!d) return; d.guides.push({ dir, pos }); view.request(); emit(); },
  clearGuides: () => { const d = doc(); if (!d) return; d.guides = []; view.request(); emit(); },
};

export function openDialog(type, data = {}) { finishTextEdit(); S.ui.dialog = { type, ...data }; S.ui.menu = null; emit(); }
export function closeDialog() { S.ui.dialog = null; emit(); }

export function savePrefs() {
  LS.set('prefs', S.prefs);
  Doc.maxHistory = S.prefs.historyStates || 60;
  applyTheme();
  view.colors = null; view.request();
  emit();
}

// ---------------- Themes ----------------
export const ACCENTS = {
  blue: ['#4c9dff', '#8cc0ff', '#2f6fd1'], pink: ['#ec8fc4', '#f7b6da', '#c45a98'], violet: ['#a78bfa', '#c9b8ff', '#7c5bd6'],
  teal: ['#2dd4bf', '#7ee8db', '#159e8e'], orange: ['#ff9f43', '#ffc58a', '#d9771e'], green: ['#4ade80', '#93f0b5', '#22a35a'], red: ['#ff6b81', '#ffa3b0', '#d93a52'],
};
export function resolvedTheme() {
  const t = S.prefs.theme || 'dark';
  if (t === 'system') return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return t;
}
export function isAnime() { return resolvedTheme().startsWith('anime'); }
export function applyTheme() {
  const root = document.documentElement;
  const t = resolvedTheme();
  root.dataset.theme = t;
  root.classList.toggle('reduce-motion', !!S.prefs.reduceMotion);
  const acc = S.prefs.accent === 'auto' ? (t.startsWith('anime') ? 'pink' : 'blue') : S.prefs.accent;
  const [a, a2, a3] = ACCENTS[acc] || ACCENTS.blue;
  root.style.setProperty('--accent', a);
  root.style.setProperty('--accent-2', a2);
  root.style.setProperty('--accent-deep', a3);
  const { r, g, b } = hexToRgb(a);
  root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.35)`);
  root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.16)`);
  root.style.setProperty('--accent-mid', `rgba(${r},${g},${b},0.3)`);
  if (window.native && window.native.setZoom) window.native.setZoom(S.prefs.uiScale || 1);
}

// ---------------- Wiederherstellung (Autosave) ----------------
export async function autosaveAll() {
  if (!window.native || !window.native.recoveryWrite) return;
  for (const d of S.docs) {
    if (!d.dirty || d.autosavedRev === d.histIdx + ':' + d.history.length) continue;
    try {
      const json = await serializeProject(d);
      await window.native.recoveryWrite('doc-' + d.id + '.sakura', new TextEncoder().encode(JSON.stringify({ name: d.name, filePath: d.filePath, time: Date.now(), project: json })));
      d.autosavedRev = d.histIdx + ':' + d.history.length;
    } catch (e) { console.warn('Autosave fehlgeschlagen', e); }
  }
}
export function clearRecovery(d) {
  if (window.native && window.native.recoveryDelete) window.native.recoveryDelete('doc-' + d.id + '.sakura');
}
export async function restoreRecovery(items) {
  for (const it of items) {
    try {
      const j = JSON.parse(new TextDecoder().decode(new Uint8Array(it.data)));
      const d = await loadProject(j.project, j.name);
      d.filePath = j.filePath || null; d.dirty = true; d.name = j.name;
      addDoc(d);
    } catch (e) { toast('Wiederherstellung fehlgeschlagen: ' + it.name); }
  }
  if (window.native) await window.native.recoveryClear();
}
export function saveSwatches() { LS.set('swatches', S.swatches); LS.set('gradients', S.gradients); emit(); }

export function maskColorIsReveal() { return luminance(S.fg) >= 0.5; }

export { SEL, flattenToCanvas, composite, renderTextLayer, Layer };
