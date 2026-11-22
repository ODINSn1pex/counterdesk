// Globaler Zustand + Aktionen
import { useSyncExternalStore } from 'react';
import { Doc, Layer, createDoc, docFromImage, composite, flattenToCanvas, renderTextLayer, layerProps, applyLayerProps, getMerged, normalizeTree, childrenOf, descendants, effectiveVisible, FX_ENV } from './engine/doc.js';
import { ADJUSTMENTS, FILTERS } from './engine/filters.js';
import { makeCanvas, ctx2d, cloneCanvas, alphaBounds, loadImage, canvasToBytes, hexToRgb, luminance } from './engine/util.js';
import * as SEL from './engine/selection.js';
import { readPsd, writePsd, psdWarnings } from './io/psd.js';
import { drawStarPath, drawHeartPath, drawBlossom, renderShapeLayer } from './engine/shapes.js';
import { drawMesh, meshMapFor, gridFromCorners } from './engine/mesh.js';
export { drawStarPath, drawHeartPath, drawBlossom };

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
  { name: 'Pastell', stops: [{ p: 0, c: '#ffd6ec' }, { p: 0.5, c: '#e57fb8' }, { p: 1, c: '#6a3fa0' }] },
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
  fastPreview: true, hardwareAcceleration: true, aiModel: 'isnet-anime', quickBar: true,
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
  brush: { size: 30, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.12, mode: 'normal', smoothing: 0.2, angle: 0, roundness: 1, scatter: 0, jitter: 0, shape: 'round',
    hueJitter: 0, satJitter: 0, briJitter: 0, fgbgJitter: 0, opacityJitter: 0, flowJitter: 0, angleJitter: 0, angleFollow: false,
    texture: '', textureDepth: 0.5, textureScale: 1, textureInvert: false, dual: '', dualSize: 20, dualScatter: 0.5,
    symmetry: 'none', symSegments: 6, wet: 0.5, load: 0.5, mix: 0.5, reload: true, airbrush: false, penAngle: false },
  eraser: { size: 40, hardness: 0.7, opacity: 1, flow: 1, tolerance: 40 },
  pencil: { size: 4, opacity: 1 },
  stampOpts: { aligned: true, sampleAll: false, pattern: 'sakura' },
  retouch: { size: 60, strength: 0.5, range: 'midtones', exposure: 0.4, sponge: 'desaturate' },
  heal: { size: 40 },
  sel: { mode: 'new', feather: 0, aa: true, tolerance: 32, contiguous: true, sampleAll: false, ratio: 'free' },
  fill: { tolerance: 32, contiguous: true, sampleAll: false, source: 'fg', opacity: 1, mode: 'normal', pattern: 'sakura' },
  gradient: { index: 0, type: 'linear', reverse: false, opacity: 1, mode: 'normal', transparency: true },
  text: { font: 'Segoe UI', size: 64, color: null, bold: false, italic: false, underline: false, strike: false, caps: false, align: 'left', leading: 1.2, tracking: 0, vertical: false, aa: true },
  shape: { mode: 'shape', fill: true, stroke: false, strokeWidth: 4, strokeColor: '#ffffff', radius: 24, sides: 5, lineWidth: 6, arrow: false, starInner: 0.45 },
  move: { autoSelect: false, showTransform: false },
  eyedrop: { sample: 1, allLayers: true },
  crop: { ratio: 'free', deleteCropped: true },
  gradients: LS.get('gradients', null) || DEFAULT_GRADIENTS,
  swatches: LS.get('swatches', null) || DEFAULT_SWATCHES,
  stylePresets: LS.get('stylePresets', null) || [],
  recentColors: LS.get('recentColors', []),
  customBrushes: LS.get('customBrushes', []),
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
  { name: 'Alle unterstützten', extensions: ['lumora', 'sakura', 'psd', 'psb', 'pdf', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw'] },
  { name: 'Kamera-RAW (Vorschau)', extensions: ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw'] },
  { name: 'Lumora-Projekt', extensions: ['lumora', 'sakura'] },
  { name: 'Photoshop-Datei (PSD/PSB)', extensions: ['psd', 'psb'] },
  { name: 'PDF-Dokument', extensions: ['pdf'] },
  { name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif'] },
];

export const RAW_EXT = ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'kdc', 'mrw'];
// Größtes eingebettetes JPEG einer RAW-Datei finden
function extractRawPreview(b) {
  let best = null;
  for (let i = 0; i < b.length - 3; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
    // Segmente durchlaufen bis Bilddaten (SOS), dann EOI suchen
    let j = i + 2, ok = false;
    while (j < b.length - 4) {
      if (b[j] !== 0xff) break;
      const m = b[j + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { j += 2; continue; }
      const len = (b[j + 2] << 8) | b[j + 3];
      if (m === 0xda) { ok = true; j += 2 + len; break; }
      j += 2 + len;
    }
    if (!ok) continue;
    let k = j;
    while (k < b.length - 1 && !(b[k] === 0xff && b[k + 1] === 0xd9)) k++;
    const size = k + 2 - i;
    if (!best || size > best[1]) best = [i, size];
    i = k;
  }
  return best && best[1] > 2048 ? b.slice(best[0], best[0] + best[1]) : null;
}

function mimeFor(name) {
  const e = name.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon' }[e] || 'application/octet-stream';
}

function addRecent(p) {
  if (!p) return;
  S.recent = [p, ...S.recent.filter((x) => x !== p)].slice(0, S.prefs.recentCount || 10);
  LS.set('recent', S.recent);
}

export async function openBytes(name, bytes, path, opts = {}) {
  const ext = name.split('.').pop().toLowerCase();
  if (PRESET_EXT.includes(ext)) { await importPresetFiles([{ name, data: bytes }]); return; }
  if (ext === 'pdf') { await importPdf(name, bytes); return; }
  try {
    let d;
    if (ext === 'lumora' || ext === 'sakura') d = await loadProject(new TextDecoder().decode(bytes), name);
    else if (ext === 'tif' || ext === 'tiff') { const { readTiff } = await import('./io/tiff.js'); d = docFromImage(readTiff(bytes), name); }
    else if (ext === 'psd' || ext === 'psb') d = readPsd(bytes, name.replace(/\.ps[db]$/i, ''));
    else if (RAW_EXT.includes(ext) && !opts.previewOnly) {
      // Echte RAW-Entwicklung im Dialog; eingebettete Vorschau als Ausweichlösung
      S.ui.dialog = { type: 'raw', name, bytes, fallback: () => openBytes(name, bytes, path, { previewOnly: true }) };
      emit();
      return;
    }
    else if (RAW_EXT.includes(ext)) {
      const jpg = extractRawPreview(bytes);
      if (!jpg) throw new Error('Keine eingebettete Vorschau in der RAW-Datei gefunden');
      const url = URL.createObjectURL(new Blob([jpg], { type: 'image/jpeg' }));
      const img = await loadImage(url);
      d = docFromImage(img, name.replace(/\.[^.]+$/, '') + '.jpg');
      URL.revokeObjectURL(url);
      setTimeout(() => toast('RAW: eingebettete Kamera-Vorschau geöffnet (JPEG-Qualität, keine RAW-Entwicklung)', 5000), 300);
    }
    else {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(name) }));
      const img = await loadImage(url);
      d = docFromImage(img, name);
      URL.revokeObjectURL(url);
    }
    d.filePath = path && /\.(lumora|sakura|psd)$/i.test(path) ? path : null;
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
  else files = await pickFileBrowser('.lumora,.sakura,.psd,image/*', true);
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
  if (window.native) files = await window.native.openDialog({ title: 'Platzieren', filters: [IMG_FILTERS.find((f) => f.name === 'Bilder')] });
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

export function saveBytesPublic(name, bytes, filters) { return saveBytes(name, bytes, filters).then((p) => { if (p) toast('Gespeichert: ' + String(p).split(/[\\/]/).pop()); return p; }); }

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
  const p = await saveBytes(base + '.lumora', new TextEncoder().encode(json), [{ name: 'Lumora-Projekt', extensions: ['lumora'] }], saveAs ? null : d.filePath);
  if (!p) return;
  d.filePath = p;
  d.name = p.split(/[\\/]/).pop();
  d.dirty = false;
  clearRecovery(d);
  addRecent(p);
  toast('Gespeichert: ' + d.name);
  emit();
}

export async function exportPsd(path, psb = false) {
  const d = doc(); if (!d) return;
  const bytes = writePsd(d, { psb });
  const warn = psdWarnings();
  if (warn.length) setTimeout(() => toast('Hinweis: ' + warn.join(', '), 5000), 400);
  const base = d.name.replace(/\.[^.]+$/, '');
  const p = await saveBytes(base + (psb ? '.psb' : '.psd'), bytes, [psb ? { name: 'Photoshop Großes Dokumentformat (PSB)', extensions: ['psb'] } : { name: 'Photoshop (PSD)', extensions: ['psd'] }], path || null);
  if (!p) return;
  if (path) d.dirty = false;
  toast('PSD gespeichert: ' + p.split(/[\\/]/).pop());
  emit();
}

export async function exportTiff(cmyk = true, inkLimit = 300) {
  const d = doc(); if (!d) return;
  const { writeTiff } = await import('./io/tiff.js');
  const bytes = writeTiff(flattenToCanvas(d, '#ffffff'), { cmyk, inkLimit, ppi: d.ppi });
  const p = await saveBytes(d.name.replace(/\.[^.]+$/, '') + (cmyk ? '_CMYK' : '') + '.tif', bytes, [{ name: 'TIFF', extensions: ['tif', 'tiff'] }]);
  if (p) toast(cmyk ? 'CMYK-TIFF exportiert (Farbauftrag max. ' + inkLimit + ' %)' : 'TIFF exportiert');
}

export async function exportImage(fmt = 'png', quality = 0.92, scale = 1, transparent = true) {
  const d = doc(); if (!d) return;
  let c = flattenToCanvas(d, fmt === 'jpeg' || !transparent ? '#ffffff' : null);
  if (scale !== 1) {
    const s = makeCanvas(d.w * scale, d.h * scale);
    const x = ctx2d(s); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.width, s.height); c = s;
  }
  const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  let bytes = await canvasToBytes(c, mime, quality);
  if (S.prefs.embedProfile !== false) { const { embedIcc } = await import('./engine/color.js'); bytes = await embedIcc(bytes, mime, d.profile || 'sRGB'); }
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
    app: 'Lumora', version: 1, w: d.w, h: d.h, name: d.name, active: d.active, ppi: d.ppi,
    guides: d.guides, paths: d.paths, artboards: d.artboards || [], frames: d.frames || [],
    profile: d.profile || 'sRGB', globalLight: d.globalLight, comps: d.comps || [], samplers: d.samplers || [], counts: d.counts || [], notes: d.notes || [], slices: d.slices || [],
    layers: d.layers.map((l) => {
      const props = layerProps(l);
      const smartSrc = props.smart ? toUrl(props.smart.src) : null;
      if (props.smart) props.smart = { ...props.smart, src: null };
      return { id: l.id, props, png: l.hasPixels ? toUrl(l.canvas) : null, mask: l.mask ? toUrl(l.mask) : null, smartSrc };
    }),
    alpha: d.alphaChannels.map((a) => ({ name: a.name, png: toUrl(a.canvas) })),
  });
}

async function loadProject(text, name) {
  const j = JSON.parse(text);
  const d = new Doc(j.w, j.h, name);
  d.ppi = j.ppi || 72;
  d.guides = j.guides || [];
  d.paths = j.paths || [];
  d.artboards = j.artboards || [];
  const idMap = new Map();
  for (const e of j.layers) {
    const l = new Layer(j.w, j.h);
    if (e.props.smart && e.smartSrc) { const img = await loadImage(e.smartSrc); const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); e.props.smart.src = c; }
    else if (e.props.smart) e.props.smart = null;
    applyLayerProps(l, e.props);
    if (e.png) l.ctx.drawImage(await loadImage(e.png), 0, 0);
    if (e.mask) { l.mask = makeCanvas(j.w, j.h); ctx2d(l.mask).drawImage(await loadImage(e.mask), 0, 0); }
    if (e.id != null) idMap.set(e.id, l.id);
    d.layers.push(l);
  }
  // Gruppen-Verweise auf neue IDs umstellen
  d.layers.forEach((l) => { if (l.parent != null) l.parent = idMap.get(l.parent) ?? null; });
  d.frames = (j.frames || []).map((f) => ({ delay: f.delay, vis: Object.fromEntries(Object.entries(f.vis || {}).map(([k, v]) => [idMap.get(Number(k)) ?? k, v])) }));
  const remap = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [idMap.get(Number(k)) ?? k, v]));
  d.comps = (j.comps || []).map((c) => ({ ...c, state: remap(c.state) }));
  if (j.globalLight) d.globalLight = j.globalLight;
  d.profile = j.profile || 'sRGB';
  d.samplers = j.samplers || []; d.counts = j.counts || []; d.notes = j.notes || []; d.slices = j.slices || [];
  d.layers = normalizeTree(d.layers);
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
  if (l.type === 'group') { if (!quiet) toast('Gruppe gewählt – bitte eine Ebene in der Gruppe wählen'); return false; }
  if (l.type === 'adjust') { if (!quiet) toast('Einstellungsebene – bearbeite die Werte im Eigenschaften-Bedienfeld oder male in die Maske'); return false; }
  if (l.type === 'smart') { if (!quiet) toast('Smart-Objekt – zum Malen zuerst rastern (Ebene › Rastern)'); return false; }
  if (l.lockAll || l.lockPixels) { if (!quiet) toast('Ebene ist fixiert 🔒'); return false; }
  const d = doc();
  if (d && !effectiveVisible(d.layers, l)) { if (!quiet) toast('Ebene ist ausgeblendet'); return false; }
  if (l.type === 'text' || l.type === 'shape') { rasterize(l); if (!quiet) toast('Ebene wurde gerastert'); }
  return true;
}

export function rasterize(l) {
  if (l.type === 'text' || l.type === 'shape' || l.type === 'smart') { l.type = 'raster'; l.text = null; l.shape = null; l.smart = null; l.touch(); }
}

// Smart-Objekt aus Quelle + Transformation (+ Smartfilter) neu zeichnen
export function renderSmartLayer(l, w, h, noFilters) {
  const sm = l.smart; if (!sm) return;
  const t = sm.t;
  const x = ctx2d(l.canvas);
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
  x.imageSmoothingQuality = 'high';
  if (t.mesh) { x.restore(); drawMesh(x, sm.src, meshMapFor(t), t.mesh === 'warp' ? 24 : 16); }
  else {
    x.translate(t.cx, t.cy); x.rotate(t.rot || 0); x.transform(1, 0, Math.tan(t.skx || 0), 1, 0, 0); x.scale(t.sx, t.sy);
    x.drawImage(sm.src, -sm.src.width / 2, -sm.src.height / 2);
    x.restore();
  }
  if (!noFilters) for (const f of sm.filters || []) {
    if (!f.on) continue;
    const def = (f.kind === 'adjust' ? ADJUSTMENTS : FILTERS)[f.id]; if (!def) continue;
    const out = def.apply(cloneCanvas(l.canvas), f.params || {});
    x.clearRect(0, 0, w, h); x.drawImage(out, 0, 0);
  }
  l.touch();
}

// Baum-Reihenfolge wiederherstellen, aktive Ebene behalten
function settle(d, activeLayer) {
  d.layers = normalizeTree(d.layers);
  const i = d.layers.indexOf(activeLayer || d.layer);
  d.active = i >= 0 ? i : Math.min(d.active, d.layers.length - 1);
}
function insertAbove(d, n, ref) {
  ref = ref || d.layer;
  n.parent = ref ? ref.parent : null;
  const i = ref ? d.layers.indexOf(ref) + 1 : d.layers.length;
  d.layers.splice(i, 0, n);
  settle(d, n);
  return n;
}
// Geschwister in Baum-Reihenfolge (unten → oben)
function siblings(d, l) { return d.layers.filter((x) => (x.parent || null) === (l.parent || null)); }
function cloneSubtree(d, l, newParent) {
  const n = new Layer(d.w, d.h, l.name);
  applyLayerProps(n, layerProps(l));
  n.isBackground = false; n.lockPosition = false; n.parent = newParent;
  n.ctx.drawImage(l.canvas, 0, 0);
  if (l.mask) n.mask = cloneCanvas(l.mask);
  const out = [n];
  if (l.type === 'group') childrenOf(d.layers, l.id).forEach((c) => out.push(...cloneSubtree(d, c, n.id)));
  return out;
}
// Teilbaum als Pixel-Ebene rendern
function renderSubtree(d, l) {
  const c = makeCanvas(d.w, d.h);
  const sub = [l, ...(l.type === 'group' ? descendants(d.layers, l) : [])].map((x) => x);
  const fake = { w: d.w, h: d.h, active: 0, channelView: null, layers: normalizeTree(sub.map((x) => Object.assign(Object.create(Object.getPrototypeOf(x)), x, { parent: x === l ? null : x.parent }))) };
  composite(fake, c, { noChannels: true });
  return c;
}

export const ADJ_LAYER_TYPES = ['cameraRaw', 'brightness', 'levels', 'curves', 'exposure', 'vibrance', 'hueSat', 'colorBalance', 'blackWhite', 'photoFilter', 'channelMixer', 'invert', 'posterize', 'threshold', 'gradientMap', 'selectiveColor'];

export const L = {
  add: () => layerOp((d) => { insertAbove(d, new Layer(d.w, d.h, `Ebene ${d.layers.length}`)); }, 'Neue Ebene'),
  duplicate: () => layerOp((d, l) => {
    const items = cloneSubtree(d, l, l.parent);
    items[0].name = l.name + ' Kopie';
    const i = d.layers.indexOf(l) + 1;
    d.layers.splice(i, 0, ...items);
    settle(d, items[0]);
  }, 'Ebene duplizieren'),
  remove: () => layerOp((d, l) => {
    const kill = new Set([l, ...(l.type === 'group' ? descendants(d.layers, l) : [])]);
    if (d.layers.length - kill.size < 1) { toast('Die letzte Ebene kann nicht gelöscht werden'); return false; }
    const idx = d.active;
    d.layers = d.layers.filter((x) => !kill.has(x));
    d.active = Math.max(0, Math.min(idx - kill.size + 1, d.layers.length - 1));
    if (d.active > 0 && !d.layers[d.active]) d.active = d.layers.length - 1;
    settle(d, d.layers[Math.max(0, Math.min(d.active, d.layers.length - 1))]);
  }, 'Ebene löschen'),
  viaCopy: (cut) => layerOp((d, l) => {
    if (!l.hasPixels) { toast('Diese Ebene enthält keine Pixel'); return false; }
    const n = new Layer(d.w, d.h, cut ? 'Ebene durch Ausschneiden' : 'Ebene durch Kopie');
    n.ctx.drawImage(l.canvas, 0, 0);
    if (d.selection) {
      const x = n.ctx; x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection, 0, 0);
      if (cut && canEditPixels(l)) { const lx = l.ctx; lx.save(); lx.globalCompositeOperation = 'destination-out'; lx.drawImage(d.selection, 0, 0); lx.restore(); l.touch(); }
    }
    insertAbove(d, n, l);
  }, cut ? 'Ebene durch Ausschneiden' : 'Ebene durch Kopie'),
  // Anordnen innerhalb der Geschwister
  moveUp: () => layerOp((d, l) => {
    const sib = siblings(d, l); const i = sib.indexOf(l);
    if (i < sib.length - 1) { const other = sib[i + 1]; const ia = d.layers.indexOf(l), ib = d.layers.indexOf(other); d.layers[ia] = other; d.layers[ib] = l; }
    else if (l.parent) { const g = d.layers.find((x) => x.id === l.parent); l.parent = g.parent; d.layers.splice(d.layers.indexOf(l), 1); d.layers.splice(d.layers.indexOf(g) + 1, 0, l); }
    else return false;
    settle(d, l);
  }, 'Anordnen'),
  moveDown: () => layerOp((d, l) => {
    const sib = siblings(d, l); const i = sib.indexOf(l);
    if (i > 0) { const other = sib[i - 1]; const ia = d.layers.indexOf(l), ib = d.layers.indexOf(other); d.layers[ia] = other; d.layers[ib] = l; }
    else if (l.parent) { const g = d.layers.find((x) => x.id === l.parent); l.parent = g.parent; d.layers.splice(d.layers.indexOf(l), 1); d.layers.splice(d.layers.indexOf(g), 0, l); }
    else return false;
    settle(d, l);
  }, 'Anordnen'),
  toTop: () => layerOp((d, l) => { d.layers.splice(d.layers.indexOf(l), 1); d.layers.push(l); settle(d, l); }, 'In den Vordergrund'),
  toBottom: () => layerOp((d, l) => { d.layers.splice(d.layers.indexOf(l), 1); d.layers.unshift(l); settle(d, l); }, 'In den Hintergrund'),
  // Ziehen im Ebenen-Bedienfeld: über/unter Ziel oder in eine Gruppe hinein
  dropOn: (from, target, where) => layerOp((d) => {
    if (!from || !target || from === target) return false;
    if (from.type === 'group' && (target === from || descendants(d.layers, from).includes(target))) { toast('Gruppe kann nicht in sich selbst verschoben werden'); return false; }
    d.layers.splice(d.layers.indexOf(from), 1);
    if (where === 'into' && target.type === 'group') { from.parent = target.id; d.layers.splice(d.layers.indexOf(target), 0, from); target.collapsed = false; }
    else { from.parent = target.parent; const ti = d.layers.indexOf(target); d.layers.splice(where === 'above' ? ti + 1 : ti, 0, from); }
    settle(d, from);
  }, 'Ebenen anordnen'),
  reorder: (from, to) => layerOp((d) => { const [l] = d.layers.splice(from, 1); d.layers.splice(to, 0, l); settle(d, l); }, 'Ebenen anordnen'),
  // ---- Gruppen ----
  newGroup: () => layerOp((d) => {
    const g = new Layer(d.w, d.h, `Gruppe ${d.layers.filter((x) => x.type === 'group').length + 1}`);
    g.type = 'group'; g.blend = 'pass';
    insertAbove(d, g);
  }, 'Neue Gruppe'),
  group: () => layerOp((d, l) => {
    const g = new Layer(d.w, d.h, `Gruppe ${d.layers.filter((x) => x.type === 'group').length + 1}`);
    g.type = 'group'; g.blend = 'pass'; g.parent = l.parent;
    d.layers.splice(d.layers.indexOf(l) + 1, 0, g);
    l.parent = g.id;
    if (l.isBackground) { l.isBackground = false; l.lockPosition = false; }
    settle(d, g);
  }, 'Ebenen gruppieren'),
  ungroup: () => layerOp((d, g) => {
    if (g.type !== 'group') { toast('Keine Gruppe ausgewählt'); return false; }
    const kids = childrenOf(d.layers, g.id);
    kids.forEach((k) => { k.parent = g.parent; });
    d.layers.splice(d.layers.indexOf(g), 1);
    settle(d, kids[kids.length - 1] || d.layers[0]);
  }, 'Gruppierung aufheben'),
  toggleCollapse: (g) => { g.collapsed = !g.collapsed; emit(); },
  // ---- Zusammenfügen ----
  mergeDown: () => layerOp((d, top) => {
    if (top.type === 'group') {
      const c = renderSubtree(d, top);
      const n = new Layer(d.w, d.h, top.name); n.parent = top.parent; n.ctx.drawImage(c, 0, 0);
      const kill = new Set([top, ...descendants(d.layers, top)]);
      const i = d.layers.indexOf(top);
      d.layers.splice(i, 0, n);
      d.layers = d.layers.filter((x) => !kill.has(x));
      settle(d, n);
      return;
    }
    const sib = siblings(d, top); const si = sib.indexOf(top);
    if (si <= 0) { toast('Keine Ebene darunter'); return false; }
    const below = sib[si - 1];
    if (!below.hasPixels || below.type === 'group') { toast('Darunter liegt keine Pixelebene'); return false; }
    const tmpd = { w: d.w, h: d.h, active: 0, layers: [Object.assign(Object.create(Object.getPrototypeOf(below)), below, { parent: null }), Object.assign(Object.create(Object.getPrototypeOf(top)), top, { parent: null })], channelView: null };
    const c = makeCanvas(d.w, d.h);
    composite(tmpd, c, { noChannels: true });
    rasterize(below);
    below.ctx.clearRect(0, 0, d.w, d.h); below.ctx.drawImage(c, 0, 0);
    below.opacity = 1; below.blend = 'normal'; below.fx = {}; below.mask = null; below.fill = 1; below.touch();
    d.layers.splice(d.layers.indexOf(top), 1);
    settle(d, below);
  }, 'Auf eine Ebene reduzieren'),
  mergeVisible: () => layerOp((d) => {
    const vis = d.layers.filter((l) => effectiveVisible(d.layers, l) && l.type !== 'group');
    if (vis.length < 2) return false;
    const c = makeCanvas(d.w, d.h); composite({ w: d.w, h: d.h, layers: d.layers, active: d.active, channelView: null }, c, { noChannels: true });
    const n = new Layer(d.w, d.h, 'Zusammengefügt'); n.ctx.drawImage(c, 0, 0);
    const kill = new Set(d.layers.filter((l) => effectiveVisible(d.layers, l)));
    const keep = d.layers.filter((l) => !kill.has(l) && !(l.type === 'group' && !descendants(d.layers, l).length && kill.has(l)));
    d.layers = [...keep.filter((l) => !l.parent || keep.some((g) => g.id === l.parent)), n];
    settle(d, n);
  }, 'Sichtbare auf eine Ebene reduzieren'),
  flatten: () => layerOp((d) => {
    const c = flattenToCanvas(d, '#ffffff');
    const n = new Layer(d.w, d.h, 'Hintergrund'); n.ctx.drawImage(c, 0, 0); n.isBackground = true; n.lockPosition = true;
    d.layers = [n]; d.active = 0;
  }, 'Auf Hintergrundebene reduzieren'),
  stampVisible: () => layerOp((d) => {
    const c = makeCanvas(d.w, d.h); composite({ w: d.w, h: d.h, layers: d.layers, active: d.active, channelView: null }, c, { noChannels: true });
    const n = new Layer(d.w, d.h, 'Stempel sichtbar'); n.ctx.drawImage(c, 0, 0); d.layers.push(n); settle(d, n);
  }, 'Sichtbare stempeln'),
  // ---- Masken ----
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
    if (!l.mask || !l.hasPixels) return false;
    if (l.type !== 'raster') rasterize(l);
    const x = l.ctx; x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask, 0, 0); x.globalCompositeOperation = 'source-over';
    l.mask = null; l.editMask = false; l.touch();
  }, 'Ebenenmaske anwenden'),
  invertMask: () => layerOp((d, l) => {
    if (!l.mask) return false;
    const n = makeCanvas(d.w, d.h); const x = ctx2d(n); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h);
    x.globalCompositeOperation = 'destination-out'; x.drawImage(l.mask, 0, 0); l.mask = n; l.touch();
  }, 'Maske umkehren'),
  toggleClip: () => layerOp((d, l) => { if (siblings(d, l).indexOf(l) <= 0) { toast('Keine Ebene darunter'); return false; } l.clip = !l.clip; l.touch(); }, 'Schnittmaske'),
  rasterize: () => layerOp((d, l) => {
    if (l.type === 'group') { L.mergeDown(); return false; }
    if (l.type === 'adjust') { toast('Einstellungsebenen enthalten keine Pixel'); return false; }
    if (l.type === 'raster') { toast('Ebene ist bereits eine Pixelebene'); return false; }
    if (l.type === 'smart') renderSmartLayer(l, d.w, d.h);
    rasterize(l);
  }, 'Ebene rastern'),
  fromBackground: () => layerOp((d, l) => { l.isBackground = false; l.lockPosition = false; if (l.name === 'Hintergrund') l.name = 'Ebene 0'; l.touch(); }, 'Ebene aus Hintergrund'),
  // ---- Einstellungsebenen ----
  adjustLayer: (id) => layerOp((d) => {
    const def = ADJUSTMENTS[id]; if (!def) return false;
    const n = new Layer(d.w, d.h, def.name.replace('…', ''));
    n.type = 'adjust';
    n.adjust = { id, params: Object.fromEntries(def.params.map((p) => [p.key, p.def])) };
    if (id === 'curves') Object.assign(n.adjust.params, { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] });
    n.mask = makeCanvas(d.w, d.h);
    const mx = ctx2d(n.mask);
    if (d.selection) mx.drawImage(d.selection, 0, 0); else { mx.fillStyle = '#fff'; mx.fillRect(0, 0, d.w, d.h); }
    insertAbove(d, n);
    S.ui.panelTabs.props = 'props'; delete S.ui.hiddenPanels.props;
  }, 'Neue Einstellungsebene'),
  // ---- Smart-Objekte ----
  toSmart: () => layerOp((d, l) => {
    if (l.type === 'smart') { toast('Ist bereits ein Smart-Objekt'); return false; }
    if (!l.hasPixels && l.type !== 'group') { toast('Diese Ebene kann kein Smart-Objekt werden'); return false; }
    let src = l.type === 'group' ? renderSubtree(d, l) : cloneCanvas(l.canvas);
    const b = alphaBounds(src);
    if (!b) { toast('Ebene ist leer'); return false; }
    const piece = makeCanvas(b.w, b.h); ctx2d(piece).drawImage(src, -b.x, -b.y);
    let target = l;
    if (l.type === 'group') {
      const n = new Layer(d.w, d.h, l.name); n.parent = l.parent;
      const kill = new Set([l, ...descendants(d.layers, l)]);
      d.layers.splice(d.layers.indexOf(l), 0, n);
      d.layers = d.layers.filter((x) => !kill.has(x));
      target = n;
    }
    target.type = 'smart'; target.text = null; target.shape = null; target.isBackground = false; target.lockPosition = false;
    target.smart = { src: piece, name: l.name, t: { cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, rot: 0, skx: 0 }, filters: [] };
    renderSmartLayer(target, d.w, d.h);
    settle(d, target);
  }, 'In Smart-Objekt konvertieren'),
  editSmart: () => {
    const d = doc(); const l = d && d.layer; if (!l || l.type !== 'smart') { toast('Kein Smart-Objekt gewählt'); return; }
    const nd = createDoc({ w: l.smart.src.width, h: l.smart.src.height, name: (l.smart.name || l.name) + '.psb', background: 'transparent' });
    nd.layers[0].ctx.drawImage(l.smart.src, 0, 0); nd.layers[0].name = l.name; nd.layers[0].touch(); nd.commit('Inhalt');
    nd.smartLink = { docId: d.id, layerId: l.id };
    addDoc(nd);
    toast('Bearbeite den Inhalt und wähle dann „Ebene › Smart-Objekt › Inhalt übernehmen“');
  },
  commitSmart: () => {
    const nd = doc(); if (!nd || !nd.smartLink) { toast('Dieses Dokument ist kein Smart-Objekt-Inhalt'); return; }
    const pd = S.docs.find((x) => x.id === nd.smartLink.docId);
    const l = pd && pd.layers.find((x) => x.id === nd.smartLink.layerId);
    if (!l || !l.smart) { toast('Ursprüngliches Smart-Objekt nicht gefunden'); return; }
    l.smart = { ...l.smart, src: flattenToCanvas(nd) };
    renderSmartLayer(l, pd.w, pd.h);
    nd.dirty = false;
    S.activeId = pd.id; pd.commit('Smart-Objekt aktualisiert');
    closeDoc(nd.id, true);
    view.request(); emit();
  },
  replaceSmart: async () => {
    const d = doc(); const l = d && d.layer; if (!l || l.type !== 'smart') { toast('Kein Smart-Objekt gewählt'); return; }
    let files;
    if (window.native) files = await window.native.openDialog({ title: 'Inhalt ersetzen', filters: [IMG_FILTERS.find((f) => f.name === 'Bilder')] });
    else files = await pickFileBrowser('image/*');
    const f = files[0]; if (!f) return;
    const img = await loadImage(URL.createObjectURL(new Blob([f.data], { type: mimeFor(f.name) })));
    const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0);
    const ow = l.smart.src.width, oh = l.smart.src.height;
    const k = Math.min(ow / img.width, oh / img.height);
    l.smart = { ...l.smart, src: c, t: { ...l.smart.t, sx: l.smart.t.sx * k, sy: l.smart.t.sy * k } };
    renderSmartLayer(l, d.w, d.h); commit('Inhalt ersetzen');
  },
  toggleSmartFilter: (l, i) => { const f = l.smart.filters[i]; f.on = !f.on; const d = doc(); renderSmartLayer(l, d.w, d.h); commit('Smartfilter'); },
  removeSmartFilter: (l, i) => { l.smart.filters.splice(i, 1); const d = doc(); renderSmartLayer(l, d.w, d.h); commit('Smartfilter löschen'); },
  // ---- KI: Hintergrund entfernen (als Ebenenmaske, nicht-destruktiv) ----
  removeBackground: async () => {
    const d = doc(); if (!d) return;
    const l = d.layer;
    if (!l.hasPixels) { toast('Bitte eine Pixel-Ebene wählen'); return; }
    S.ui.busy = 'KI entfernt Hintergrund'; emit();
    try {
      const { aiSubjectMask } = await import('./engine/ai.js');
      const m = await aiSubjectMask(l.canvas, S.prefs.aiModel);
      if (l.isBackground) { l.isBackground = false; l.lockPosition = false; if (l.name === 'Hintergrund') l.name = 'Ebene 0'; }
      l.mask = m; l.maskEnabled = true; l.editMask = false; l.touch();
      commit('Hintergrund entfernen (KI)');
      toast('Hintergrund als Maske entfernt – mit Pinsel in der Maske nachbessern');
    } catch (e) { console.error(e); toast('KI-Freistellung fehlgeschlagen: ' + e.message); }
    S.ui.busy = null; emit(); view.request();
  },
  // ---- Füllebenen ----
  fillLayer: (color) => layerOp((d) => {
    const n = new Layer(d.w, d.h, 'Farbfüllung 1'); const x = n.ctx; x.fillStyle = color || S.fg; x.fillRect(0, 0, d.w, d.h);
    n.mask = makeCanvas(d.w, d.h); const mx = ctx2d(n.mask); if (d.selection) mx.drawImage(d.selection, 0, 0); else { mx.fillStyle = '#fff'; mx.fillRect(0, 0, d.w, d.h); }
    insertAbove(d, n);
  }, 'Neue Füllebene'),
  gradientLayer: () => layerOp((d) => {
    const n = new Layer(d.w, d.h, 'Verlaufsfüllung 1'); const x = n.ctx;
    const g = x.createLinearGradient(0, 0, 0, d.h);
    gradientStops(S.gradients[S.gradient.index]).forEach((s) => g.addColorStop(s.p, s.c));
    x.fillStyle = g; x.fillRect(0, 0, d.w, d.h);
    if (d.selection) n.mask = cloneCanvas(d.selection);
    insertAbove(d, n);
  }, 'Neue Verlaufsfüllung'),
  patternLayer: () => layerOp((d) => {
    const n = new Layer(d.w, d.h, 'Musterfüllung 1'); const x = n.ctx;
    x.fillStyle = x.createPattern(patternCanvas(S.fill.pattern), 'repeat'); x.fillRect(0, 0, d.w, d.h);
    if (d.selection) n.mask = cloneCanvas(d.selection);
    insertAbove(d, n);
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
const patScaled = {};
FX_ENV.pattern = (name, scale) => {
  const base = patternCanvas(name); if (scale === 1) return base;
  const k = name + '@' + scale; if (patScaled[k] && patScaled[k].src === base) return patScaled[k].c;
  const c = makeCanvas(Math.max(1, Math.round(base.width * scale)), Math.max(1, Math.round(base.height * scale)));
  ctx2d(c).drawImage(base, 0, 0, c.width, c.height); patScaled[k] = { src: base, c }; return c;
};
// Importierte Muster (.pat) und eigene Muster
export const CUSTOM_PATTERNS = {};
export function patternCanvas(name) {
  if (CUSTOM_PATTERNS[name]) return CUSTOM_PATTERNS[name];
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
  // Motiv auswählen: lokale KI (Fallback: klassisches Verfahren)
  subject: async () => {
    const d = doc(); if (!d) return;
    S.ui.busy = 'KI erkennt Motiv'; emit();
    try {
      const { aiSubjectMask } = await import('./engine/ai.js');
      const t0 = performance.now();
      const m = await aiSubjectMask(getMerged(d), S.prefs.aiModel);
      d.setSelection(m); commit('Motiv auswählen (KI)');
      toast(`Motiv erkannt (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      console.warn('KI nicht verfügbar, nutze Fallback', e);
      d.setSelection(SEL.selectSubject(getMerged(d))); commit('Motiv auswählen');
    }
    S.ui.busy = null; emit(); view.request();
  },
  subjectClassic: () => { const d = doc(); if (!d) return; d.setSelection(SEL.selectSubject(getMerged(d))); commit('Motiv auswählen'); },
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
    else if (source === 'content') { EDIT.remove(); return; }
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
  // Markierten Bereich aus dem Bild entfernen und mit passendem Inhalt füllen (KI, Fallback: klassisch)
  remove: async (maskCanvas) => {
    const d = doc(); if (!d) return;
    const l = d.layer; if (!canEditPixels(l)) return;
    const mask = maskCanvas || d.selection;
    if (!mask) { toast('Markiere zuerst den Bereich, der verschwinden soll (z. B. mit dem Lasso L)'); return; }
    // Auswahl leicht erweitern, damit Kanten und Schatten mit verschwinden
    const m = SEL.expand(mask, 4);
    S.ui.busy = 'KI entfernt Bereich'; emit();
    try {
      const { aiInpaint } = await import('./engine/ai.js');
      const res = await aiInpaint(l.canvas, m);
      const x = l.ctx; x.clearRect(0, 0, d.w, d.h); x.drawImage(res, 0, 0); l.touch();
      if (!maskCanvas) d.deselect();
      commit('Entfernen (KI)');
    } catch (e) {
      console.warn('KI-Entfernen nicht verfügbar, klassisches Verfahren', e);
      contentAwareFill(d, l, m);
      if (!maskCanvas) d.deselect();
      commit('Entfernen');
    }
    S.ui.busy = null; emit(); view.request();
  },
  // Auswahl in eigene Ebene ausschneiden bzw. kopieren
  cutToLayer: () => L.viaCopy(true),
  copyToLayer: () => L.viaCopy(false),
  // Motiv freistellen und als neue Ebene (Hintergrund bleibt erhalten)
  subjectToLayer: async () => {
    const d = doc(); if (!d) return;
    await SELECT.subject();
    if (d.selection) L.viaCopy(false);
  },
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
  recordStep({ type: 'transform', kind });
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
export function startTransform(mesh) {
  const d = doc(); if (!d) return;
  if (S.transform) { if (mesh) setTransformMode(mesh); return; }
  const l = d.layer;
  if (l.lockAll || l.lockPosition) { toast('Position ist fixiert 🔒'); return; }
  if (l.type === 'group') { toast('Gruppen: bitte eine Ebene wählen oder die Gruppe in ein Smart-Objekt konvertieren'); return; }
  if (l.type === 'adjust') { toast('Einstellungsebenen haben keine Pixel zum Transformieren'); return; }
  if (l.isBackground) { L.fromBackground(); }
  const before = cloneCanvas(l.canvas);
  // Smart-Objekt: verlustfrei aus der Quelle
  if (l.type === 'smart' && !d.selection) {
    const sm = l.smart, t0 = sm.t;
    S.transform = { layer: l, smart: true, before, base: makeCanvas(d.w, d.h), piece: sm.src, w: sm.src.width, h: sm.src.height,
      cx: t0.cx, cy: t0.cy, cx0: t0.cx, cy0: t0.cy, sx: t0.sx, sy: t0.sy, rot: t0.rot || 0, skx: t0.skx || 0,
      mesh: t0.mesh || null, corners: t0.corners ? t0.corners.map((p) => ({ ...p })) : null, grid: t0.grid ? t0.grid.map((r) => r.map((p) => ({ ...p }))) : null, pins: t0.pins ? JSON.parse(JSON.stringify(t0.pins)) : null };
    if (S.tool !== 'move') S.tool = 'move';
    if (mesh) setTransformMode(mesh); else renderTransform();
    emit(); return;
  }
  const vectorShape = l.type === 'shape' && !d.selection && !mesh;
  if (l.type === 'text' || (l.type === 'shape' && !vectorShape)) { rasterize(l); toast('Ebene wurde für die Transformation gerastert'); }
  let float = cloneCanvas(l.canvas);
  if (d.selection) { const fx = ctx2d(float); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(d.selection, 0, 0); }
  const b = alphaBounds(float);
  if (!b) { toast('Keine Pixel zum Transformieren'); return; }
  const piece = makeCanvas(b.w, b.h); ctx2d(piece).drawImage(float, -b.x, -b.y);
  const base = cloneCanvas(before);
  const bx = ctx2d(base);
  if (d.selection) { bx.globalCompositeOperation = 'destination-out'; bx.drawImage(d.selection, 0, 0); } else bx.clearRect(0, 0, d.w, d.h);
  S.transform = { layer: l, before, base, piece, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, cx0: b.x + b.w / 2, cy0: b.y + b.h / 2, sx: 1, sy: 1, rot: 0, skx: 0, hadSel: !!d.selection, maskBefore: l.mask && !d.selection ? cloneCanvas(l.mask) : null, vectorShape, shapeBefore: vectorShape ? { ...l.shape } : null, mesh: null };
  if (S.tool !== 'move') S.tool = 'move';
  if (mesh) setTransformMode(mesh); else renderTransform();
  emit();
}

// Ecken der freien Transformation (oben links, oben rechts, unten rechts, unten links)
export function freeCorners(t) {
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot), k = Math.tan(t.skx || 0);
  const map = (lx, ly) => { const sx = lx * t.sx + ly * t.sy * k, sy = ly * t.sy; return { x: t.cx + sx * cos - sy * sin, y: t.cy + sx * sin + sy * cos }; };
  const hw = t.w / 2, hh = t.h / 2;
  return [map(-hw, -hh), map(hw, -hh), map(hw, hh), map(-hw, hh)];
}

export function setTransformMode(mode) {
  const t = S.transform; if (!t) return;
  if (mode === 'free') {
    if (t.mesh) { toast('Zurück zu „Frei“ ist nach dem Verformen nicht möglich – Abbrechen setzt zurück'); return; }
    return;
  }
  if (t.vectorShape) { rasterize(t.layer); t.vectorShape = false; toast('Formebene wurde gerastert'); }
  if (!t.mesh) t.corners = freeCorners(t);
  if (mode === 'puppet') {
    if (t.mesh === 'warp') t.corners = [t.grid[0][0], t.grid[0][3], t.grid[3][3], t.grid[3][0]].map((p) => ({ ...p }));
    t.pins = t.pins || [];
    t.mesh = 'puppet';
    toast('Formgitter: Klicke ins Motiv, um Pins zu setzen, und ziehe sie. Alt+Klick entfernt einen Pin.', 4500);
    renderTransform(); emit(); return;
  }
  if (mode === 'warp' && (!t.grid || t.mesh !== 'warp')) t.grid = gridFromCorners(t.corners);
  if (mode !== 'warp' && t.mesh === 'warp') t.corners = [t.grid[0][0], t.grid[0][3], t.grid[3][3], t.grid[3][0]].map((p) => ({ ...p }));
  t.mesh = mode;
  renderTransform(); emit();
}

function drawTransformed(x, t, img) {
  if (t.mesh) { drawMesh(x, img, meshMapFor(t), t.mesh === 'warp' || t.mesh === 'puppet' ? 28 : 16); return; }
  x.save();
  x.translate(t.cx, t.cy); x.rotate(t.rot); x.transform(1, 0, Math.tan(t.skx || 0), 1, 0, 0); x.scale(t.sx, t.sy);
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, -t.w / 2, -t.h / 2);
  x.restore();
}

export function renderTransform() {
  const t = S.transform; if (!t) return;
  const x = t.layer.ctx;
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, t.layer.canvas.width, t.layer.canvas.height);
  x.drawImage(t.base, 0, 0);
  x.restore();
  drawTransformed(x, t, t.piece);
  if (t.maskBefore && t.layer.mask && !t.mesh) {
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
  const l = t.layer;
  if (t.smart) {
    l.smart = { ...l.smart, t: { cx: t.cx, cy: t.cy, sx: t.sx, sy: t.sy, rot: t.rot, skx: t.skx, mesh: t.mesh, corners: t.corners, grid: t.grid, pins: t.pins } };
    S.transform = null;
    renderSmartLayer(l, d.w, d.h);
    commit('Smart-Objekt transformieren');
    return;
  }
  if (t.vectorShape && l.shape) {
    const s0 = t.shapeBefore;
    const cx0 = s0.x + s0.w / 2, cy0 = s0.y + s0.h / 2;
    const ncx = cx0 + (t.cx - t.cx0), ncy = cy0 + (t.cy - t.cy0);
    const nw = s0.w * t.sx, nh = s0.h * t.sy;
    l.shape = { ...s0, x: ncx - nw / 2, y: ncy - nh / 2, w: nw, h: nh, rot: (s0.rot || 0) + t.rot };
    if (s0.parts && s0.parts.length) l.shape.parts = s0.parts.map((q) => { const pcx = ncx + (q.x + q.w / 2 - cx0) * t.sx, pcy = ncy + (q.y + q.h / 2 - cy0) * t.sy, pw = q.w * t.sx, ph = q.h * t.sy; return { ...q, x: pcx - pw / 2, y: pcy - ph / 2, w: pw, h: ph }; });
    if (t.skx || (s0.parts && s0.parts.length && t.rot)) { rasterize(l); }
    else { renderShapeLayer(l, d.w, d.h); }
  }
  if (t.hadSel && d) {
    const pm = cloneCanvas(t.piece); const px = ctx2d(pm); px.globalCompositeOperation = 'source-in'; px.fillStyle = '#fff'; px.fillRect(0, 0, t.w, t.h);
    const s2 = makeCanvas(d.w, d.h); drawTransformed(ctx2d(s2), t, pm);
    d.setSelection(s2);
  }
  S.transform = null;
  commit(t.mesh ? { warp: 'Verformen', perspective: 'Perspektivisch verzerren', distort: 'Verzerren', puppet: 'Formgitter' }[t.mesh] : 'Frei transformieren');
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
// Formular-Dialog als Promise: liefert die Werte oder null
let formSeq = 0;
export function askForm(title, fields, opts = {}) {
  return new Promise((resolve) => openDialog('form', { title, fields, resolve, id: ++formSeq, ...opts }));
}

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
  let t = S.prefs.theme || 'dark';
  if (t === 'anime-day') t = 'anime';
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
      await window.native.recoveryWrite('doc-' + d.id + '.lumora', new TextEncoder().encode(JSON.stringify({ name: d.name, filePath: d.filePath, time: Date.now(), project: json })));
      d.autosavedRev = d.histIdx + ':' + d.history.length;
    } catch (e) { console.warn('Autosave fehlgeschlagen', e); }
  }
}
export function clearRecovery(d) {
  if (window.native && window.native.recoveryDelete) window.native.recoveryDelete('doc-' + d.id + '.lumora');
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

export { SEL, flattenToCanvas, composite, renderTextLayer, Layer, renderShapeLayer };


// ---------------- Aktionen: Aufzeichnung ----------------
export const REC = { on: false, steps: null, depth: 0, action: null };
const isPlain = (v, depth = 0) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)
  || (Array.isArray(v) ? depth < 5 && v.every((x) => isPlain(x, depth + 1)) : (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && depth < 5 && Object.values(v).every((x) => isPlain(x, depth + 1))));
export function recordStep(step) { if (REC.on && REC.depth === 0 && REC.steps) { REC.steps.push(step); try { localStorage.setItem('sakura.actions', JSON.stringify(S.actions)); } catch (e) { /* */ } } }
const REC_SKIP = { L: ['toggleCollapse', 'dropOn', 'reorder', 'editSmart', 'commitSmart', 'replaceSmart', 'toggleSmartFilter', 'removeSmartFilter'], EDIT: ['copy', 'cut', 'paste', 'undo', 'redo', 'defineBrushPreset'], SELECT: ['save', 'load', 'toggleQuickMask'], IMAGE: ['duplicate'] };
for (const [ns, obj] of Object.entries({ IMAGE, L, SELECT, EDIT })) {
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] !== 'function' || (REC_SKIP[ns] || []).includes(k)) continue;
    const orig = obj[k];
    obj[k] = (...args) => {
      const a = args.filter((x) => !(x && typeof x === 'object' && (x.nativeEvent || x.target)));
      if (REC.on && REC.depth === 0 && a.every((x) => isPlain(x))) recordStep({ ns, fn: k, args: a });
      REC.depth++;
      let r;
      try { r = orig(...a); } catch (e) { REC.depth--; throw e; }
      if (r && typeof r.then === 'function') return r.finally(() => { REC.depth--; });
      REC.depth--;
      return r;
    };
  }
}


// ---------------- Zeichenflächen ----------------
export const ARTBOARD_PRESETS = [['Instagram-Beitrag', 1080, 1080], ['Instagram-Story', 1080, 1920], ['Full HD', 1920, 1080], ['YouTube-Thumbnail', 1280, 720], ['A4 (150 ppi)', 1240, 1754], ['iPhone', 1179, 2556], ['Web-Banner', 728, 90], ['Eigene Größe', 800, 600]];
export const ARTBOARDS = {
  // Neue Zeichenfläche rechts neben den bestehenden; Arbeitsfläche wächst automatisch mit
  add: (name, w, h, bg = '#ffffff', rect) => {
    const d = doc(); if (!d) return;
    d.artboards = d.artboards || [];
    let r = rect;
    if (!r) {
      const right = d.artboards.reduce((m, a) => Math.max(m, a.x + a.w), 0);
      r = d.artboards.length ? { x: right + 80, y: 0, w, h } : { x: 0, y: 0, w, h };
    }
    const needW = Math.max(d.w, Math.round(r.x + r.w)), needH = Math.max(d.h, Math.round(r.y + r.h));
    if (needW > d.w || needH > d.h) IMAGE.canvasSize(needW, needH, 0, 0, 'rgba(0,0,0,0)');
    const ab = { name: name || `Zeichenfläche ${d.artboards.length + 1}`, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), bg };
    d.artboards.push(ab);
    // Hintergrund der Zeichenfläche als eigene Ebene ganz unten
    if (bg && bg !== 'transparent') {
      const l = new Layer(d.w, d.h, ab.name + ' – Hintergrund');
      l.ctx.fillStyle = bg; l.ctx.fillRect(ab.x, ab.y, ab.w, ab.h);
      d.layers.unshift(l); d.layers = normalizeTree(d.layers); d.active = Math.min(d.active + 1, d.layers.length - 1);
    }
    view.request(); commit('Zeichenfläche');
  },
  remove: (i) => { const d = doc(); if (!d || !d.artboards[i]) return; d.artboards.splice(i, 1); view.request(); commit('Zeichenfläche löschen'); },
  rename: (i, n) => { const d = doc(); d.artboards[i].name = n; commit('Zeichenfläche umbenennen'); },
  exportAll: async (fmt = 'png') => {
    const d = doc(); if (!d || !d.artboards.length) { toast('Keine Zeichenflächen vorhanden'); return; }
    const full = flattenToCanvas(d, fmt === 'jpeg' ? '#ffffff' : null);
    const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png', ext = fmt === 'jpeg' ? 'jpg' : fmt;
    const safe = (n) => n.replace(/[\\/:*?"<>|]/g, '_');
    let dir = null;
    if (window.native) { dir = await window.native.chooseFolder({ title: 'Zielordner für Zeichenflächen' }); if (!dir) return; }
    for (const ab of d.artboards) {
      const c = makeCanvas(ab.w, ab.h); ctx2d(c).drawImage(full, -ab.x, -ab.y);
      const bytes = await canvasToBytes(c, mime, 0.92);
      if (dir) await window.native.writeFileIn(dir, `${safe(ab.name)}.${ext}`, bytes);
      else await saveBytes(`${safe(ab.name)}.${ext}`, bytes, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    }
    toast(`${d.artboards.length} Zeichenflächen exportiert`);
  },
};


// ---------------- Vorgaben-Import (.abr, .pat, .asl, .grd, .aco) ----------------
export const PRESET_EXT = ['abr', 'pat', 'asl', 'grd', 'aco'];
function savePatterns() {
  const out = {};
  for (const [k, c] of Object.entries(CUSTOM_PATTERNS)) { try { out[k] = c.toDataURL('image/png'); } catch { /* */ } }
  LS.set('patterns', out);
}
export async function loadSavedPatterns() {
  const saved = LS.get('patterns', {}) || {};
  for (const [k, url] of Object.entries(saved)) {
    try { const img = await loadImage(url); const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); CUSTOM_PATTERNS[k] = c; if (!PATTERNS.includes(k)) PATTERNS.push(k); } catch { /* */ }
  }
  emit();
}
function addPattern(name, canvas) {
  let c = canvas;
  if (c.width > 512 || c.height > 512) { const k = 512 / Math.max(c.width, c.height); const t = makeCanvas(Math.round(c.width * k), Math.round(c.height * k)); ctx2d(t).drawImage(c, 0, 0, t.width, t.height); c = t; }
  let n = name, i = 2; while (PATTERNS.includes(n)) n = `${name} ${i++}`;
  CUSTOM_PATTERNS[n] = c; PATTERNS.push(n);
  return n;
}
export function defineStylePreset(name) {
  const d = doc(); if (!d || !d.layer) return;
  S.stylePresets.push({ name: name || `Stil ${S.stylePresets.length + 1}`, fx: JSON.parse(JSON.stringify(d.layer.fx || {})) });
  LS.set('stylePresets', S.stylePresets); emit(); toast('Stil gespeichert');
}
export function applyStylePreset(i) {
  const d = doc(); const p = S.stylePresets[i]; if (!d || !p) return;
  d.layer.fx = JSON.parse(JSON.stringify(p.fx)); d.layer.touch(); view.request(); commit('Stil anwenden');
}
export function removeStylePreset(i) { S.stylePresets.splice(i, 1); LS.set('stylePresets', S.stylePresets); emit(); }
export async function importPresetFiles(files) {
  const P = await import('./io/presets.js');
  const msg = [];
  for (const f of files || []) {
    const ext = f.name.split('.').pop().toLowerCase(), u8 = new Uint8Array(f.data), base = f.name.replace(/\.[^.]+$/, '');
    try {
      if (ext === 'abr') {
        const { parseAbr } = await import('./io/abr.js'); const { addTipFromAlpha } = await import('./tools.js');
        let n = 0, last = null; for (const b of parseAbr(u8)) { last = addTipFromAlpha(b.canvas, `${base} – ${b.name}`, b.spacing); n++; }
        if (last) S.brush.shape = 'custom:' + last;
        msg.push(`${n} Pinsel`);
      } else if (ext === 'pat') {
        const list = P.parsePat(u8); list.forEach((p) => addPattern(p.name, p.canvas)); savePatterns();
        if (list.length) { S.fill.pattern = PATTERNS[PATTERNS.length - 1]; }
        msg.push(`${list.length} Muster`);
      } else if (ext === 'asl') {
        const { patterns, styles } = P.parseAsl(u8);
        patterns.forEach((p) => addPattern(p.name, p.canvas)); if (patterns.length) savePatterns();
        styles.forEach((st) => S.stylePresets.push(st)); LS.set('stylePresets', S.stylePresets);
        msg.push(`${styles.length} Stile` + (patterns.length ? ` und ${patterns.length} Muster` : ''));
      } else if (ext === 'grd') {
        const list = P.parseGrd(u8);
        for (const g of list) {
          const alphaAt = (p) => { const o = g.ops; if (!o.length) return 1; if (p <= o[0].p) return o[0].a; for (let i = 1; i < o.length; i++) if (p <= o[i].p) { const t = (p - o[i - 1].p) / ((o[i].p - o[i - 1].p) || 1); return o[i - 1].a + (o[i].a - o[i - 1].a) * t; } return o[o.length - 1].a; };
          const stops = g.stops.map((st) => { const hx = st.c === 'fg' ? S.fg : st.c === 'bg' ? S.bg : st.c; const a = alphaAt(st.p); const { r, g: gg, b } = hexToRgb(hx); return { p: st.p, c: a >= 0.999 ? hx : `rgba(${r},${gg},${b},${a.toFixed(3)})` }; });
          if (stops.length) S.gradients.push({ name: g.name, stops: stops.sort((a, b) => a.p - b.p) });
        }
        saveSwatches(); msg.push(`${list.length} Verläufe`);
      } else if (ext === 'aco') {
        const list = P.parseAco(u8); list.forEach((c) => { if (!S.swatches.includes(c.c)) S.swatches.push(c.c); }); saveSwatches();
        msg.push(`${list.length} Farbfelder`);
      }
    } catch (e) { msg.push(`${f.name}: ${e.message}`); }
  }
  emit();
  if (msg.length) toast('Importiert: ' + msg.join(', '));
}

// ---------------- Ebenenkompositionen ----------------
const compState = (d) => Object.fromEntries(d.layers.map((l) => [l.id, { visible: l.visible, opacity: l.opacity, blend: l.blend, fill: l.fill, fx: JSON.parse(JSON.stringify(l.fx || {})) }]));
export const COMPS = {
  add(name) { const d = doc(); if (!d) return; d.comps.push({ name: name || `Ebenenkomp. ${d.comps.length + 1}`, state: compState(d) }); commit('Neue Ebenenkomposition'); },
  apply(i) {
    const d = doc(); const c = d && d.comps[i]; if (!c) return;
    for (const l of d.layers) { const st = c.state[l.id]; if (!st) continue; Object.assign(l, { visible: st.visible, opacity: st.opacity, blend: st.blend, fill: st.fill, fx: JSON.parse(JSON.stringify(st.fx || {})) }); l.touch(); }
    d.compIndex = i; view.request(); commit(`Ebenenkomp. „${c.name}“`);
  },
  update(i) { const d = doc(); if (!d || !d.comps[i]) return; d.comps[i].state = compState(d); commit('Ebenenkomp. aktualisieren'); toast('Ebenenkomposition aktualisiert'); },
  remove(i) { const d = doc(); if (!d) return; d.comps.splice(i, 1); commit('Ebenenkomp. löschen'); },
  rename(i, n) { const d = doc(); d.comps[i].name = n; commit('Ebenenkomp. umbenennen'); },
  step(dir) { const d = doc(); if (!d || !d.comps.length) return; const i = ((d.compIndex ?? -1) + dir + d.comps.length) % d.comps.length; COMPS.apply(i); },
  async exportAll() {
    const d = doc(); if (!d || !d.comps.length) { toast('Keine Ebenenkompositionen vorhanden'); return; }
    const before = compState(d), items = [];
    for (let i = 0; i < d.comps.length; i++) { COMPS.apply(i); items.push({ name: d.comps[i].name, canvas: flattenToCanvas(d) }); }
    for (const l of d.layers) { const st = before[l.id]; if (st) { Object.assign(l, st); l.touch(); } }
    view.request(); emit();
    await exportSet(items, 'png', 'Ebenenkompositionen');
  },
};

// Mehrere Bilder in einen Ordner exportieren
export async function exportSet(items, fmt = 'png', what = 'Bilder', quality = 0.92) {
  const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png', ext = fmt === 'jpeg' ? 'jpg' : fmt;
  const safe = (n) => String(n).replace(/[\\/:*?"<>|]/g, '_');
  let dir = null;
  if (window.native) { dir = await window.native.chooseFolder({ title: `Zielordner für ${what}` }); if (!dir) return 0; }
  let n = 0;
  for (const it of items) {
    let c = it.canvas;
    if (fmt === 'jpeg') { const t = makeCanvas(c.width, c.height); const tx = ctx2d(t); tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height); tx.drawImage(c, 0, 0); c = t; }
    let bytes = await canvasToBytes(c, mime, quality);
    if (S.prefs.embedProfile !== false) { const { embedIcc } = await import('./engine/color.js'); bytes = await embedIcc(bytes, mime, (doc() && doc().profile) || 'sRGB'); }
    if (dir) await window.native.writeFileIn(dir, `${safe(it.name)}.${ext}`, bytes);
    else if (!(await saveBytes(`${safe(it.name)}.${ext}`, bytes, [{ name: ext.toUpperCase(), extensions: [ext] }]))) break;
    n++;
  }
  toast(`${n} ${what} exportiert`);
  return n;
}

// ---------------- Vektormasken & Pfadoperationen ----------------
export const VEC = {
  maskFromPath() {
    const d = doc(); if (!d) return;
    const paths = d.activePath != null && d.paths[d.activePath] ? [d.paths[d.activePath]] : d.paths;
    const ok = paths.filter((p) => p.points && p.points.length > 2);
    if (!ok.length) { toast('Zuerst mit dem Zeichenstift einen geschlossenen Pfad zeichnen'); return; }
    d.layer.vmask = { paths: JSON.parse(JSON.stringify(ok)), invert: false, feather: 0, enabled: true };
    d.layer.touch(); view.request(); commit('Vektormaske hinzufügen');
  },
  maskReveal() {
    const d = doc(); if (!d) return;
    if (d.selection) { toast('Vektormasken entstehen aus Pfaden – Auswahl ggf. über Pfade-Bedienfeld in Pfad umwandeln'); }
    VEC.maskFromPath();
  },
  toggle() { const d = doc(); const v = d && d.layer.vmask; if (!v) return; v.enabled = v.enabled === false; d.layer.touch(); view.request(); commit(v.enabled ? 'Vektormaske aktivieren' : 'Vektormaske deaktivieren'); },
  invert() { const d = doc(); const v = d && d.layer.vmask; if (!v) return; v.invert = !v.invert; d.layer.touch(); view.request(); commit('Vektormaske umkehren'); },
  feather(px) { const d = doc(); const v = d && d.layer.vmask; if (!v) return; v.feather = px; d.layer.touch(); view.request(); commit('Vektormaske weiche Kante'); },
  remove() { const d = doc(); if (!d || !d.layer.vmask) return; d.layer.vmask = null; d.layer.touch(); view.request(); commit('Vektormaske löschen'); },
  // Aktive Form-Ebene mit der Form-Ebene darunter verknüpfen
  combine(op) {
    const d = doc(); if (!d) return;
    const top = d.layer, i = d.layers.indexOf(top);
    let j = i - 1; while (j >= 0 && d.layers[j].parent !== top.parent) j--;
    const below = d.layers[j];
    if (!top.shape || !below || !below.shape || top.shape.kind === 'line' || below.shape.kind === 'line') { toast('Benötigt zwei übereinanderliegende Form-Ebenen (Rechteck, Ellipse, Polygon …)'); return; }
    if (top.shape.rot || below.shape.rot) { toast('Gedrehte Formen können nicht kombiniert werden'); return; }
    const { parts: tp, ...main } = top.shape;
    below.shape.parts = [...(below.shape.parts || []), { ...main, op }, ...(tp || []).map((p) => ({ ...p, op: p.op === 'add' ? op : p.op }))];
    renderShapeLayer(below, d.w, d.h);
    d.layers.splice(i, 1); d.active = d.layers.indexOf(below);
    view.request(); commit({ add: 'Formen vereinigen', subtract: 'Vordere Form subtrahieren', intersect: 'Schnittmenge von Formen', exclude: 'Überlappende Formen ausschließen' }[op]);
  },
  // Einzelne Eckradien für Rechtecke
  async cornerRadii() {
    const d = doc(); const s = d && d.layer.shape;
    if (!s || (s.kind !== 'rect' && s.kind !== 'rounded')) { toast('Nur für Rechteck-Formen'); return; }
    const r = s.radii || [s.radius || 0, s.radius || 0, s.radius || 0, s.radius || 0];
    const v = await askForm('Eckenradien', [
      { key: 'tl', type: 'num', label: 'Oben links', value: r[0], max: 2000, unit: ' Px' }, { key: 'tr', type: 'num', label: 'Oben rechts', value: r[1], max: 2000, unit: ' Px' },
      { key: 'br', type: 'num', label: 'Unten rechts', value: r[2], max: 2000, unit: ' Px' }, { key: 'bl', type: 'num', label: 'Unten links', value: r[3], max: 2000, unit: ' Px' },
    ]);
    if (!v) return;
    s.kind = 'rounded'; s.radii = [v.tl, v.tr, v.br, v.bl];
    renderShapeLayer(d.layer, d.w, d.h); view.request(); commit('Eckenradien');
  },
};

// Bereich füllen: KI-Inpainting (LaMa), sonst klassisches inhaltsbasiertes Füllen
export async function inpaintCanvas(src, mask) {
  try { const { aiInpaint } = await import('./engine/ai.js'); return await aiInpaint(src, mask); }
  catch (e) {
    console.warn('KI-Füllung nicht verfügbar, klassisch', e);
    const c = cloneCanvas(src);
    contentAwareFill({ w: c.width, h: c.height }, { canvas: c, ctx: ctx2d(c), touch() {} }, mask);
    return c;
  }
}

// Neues Dokument aus einem Canvas (leer = ohne Ebenen, Aufrufer füllt sie)
export function newDocFromCanvas(c, name, empty = false) {
  const d = empty ? new Doc(c.width, c.height, name) : docFromImage(c, name);
  d.ppi = S.prefs.defaultPpi || 72;
  addDoc(d);
  return d;
}

// PDF öffnen: Seite und Auflösung wählen, jede Seite optional als eigene Ebene
async function importPdf(name, bytes) {
  let info;
  S.ui.busy = 'PDF wird gelesen'; emit();
  try { const P = await import('./io/pdf.js'); info = await P.pdfInfo(bytes); info.P = P; }
  catch (e) { toast('PDF konnte nicht gelesen werden: ' + e.message); return; }
  finally { S.ui.busy = null; emit(); }
  const v = await askForm('PDF importieren', [
    { key: 'page', type: 'num', label: 'Seite', min: 1, max: info.pages, value: 1 },
    { key: 'all', type: 'check', label: `Alle ${info.pages} Seiten als Ebenen`, value: false },
    { key: 'ppi', type: 'num', label: 'Auflösung', min: 36, max: 600, unit: ' ppi', value: 150 },
  ], { hint: `${info.pages} Seite(n), Seitengröße ${Math.round(info.w / 72 * 25.4)} × ${Math.round(info.h / 72 * 25.4)} mm. Text und Vektoren werden gerastert.` });
  if (!v) return;
  S.ui.busy = 'PDF wird gerastert'; emit();
  try {
    const pages = v.all ? Array.from({ length: Math.min(info.pages, 50) }, (_, i) => i + 1) : [Math.round(v.page)];
    const canv = [];
    for (const n of pages) canv.push(await info.P.renderPdfPage(info.doc, n, v.ppi));
    const W = Math.max(...canv.map((c) => c.width)), H = Math.max(...canv.map((c) => c.height));
    const d = new Doc(W, H, name.replace(/\.pdf$/i, '') + (pages.length === 1 ? ` (Seite ${pages[0]})` : ''));
    d.ppi = v.ppi;
    canv.forEach((c, i) => { const l = new Layer(W, H, `Seite ${pages[i]}`); l.ctx.drawImage(c, 0, 0); l.visible = i === 0 || !v.all ? true : false; d.layers.push(l); });
    d.layers.reverse(); d.active = d.layers.length - 1;
    if (v.all) d.layers.forEach((l, i) => { l.visible = i === d.layers.length - 1; });
    d.commit('PDF öffnen'); d.dirty = false; addDoc(d);
  } catch (e) { toast('PDF-Import fehlgeschlagen: ' + e.message); }
  finally { S.ui.busy = null; emit(); }
}

// Skript ausführen: JavaScript-Datei mit Zugriff auf die Lumora-Schnittstelle
export async function runScriptFile() {
  let files;
  if (window.native) files = await window.native.openDialog({ title: 'Skript ausführen', filters: [{ name: 'JavaScript', extensions: ['js', 'mjs'] }] });
  else files = await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.js,.mjs'; i.onchange = async () => res([{ name: i.files[0].name, data: new Uint8Array(await i.files[0].arrayBuffer()) }]); i.click(); });
  const f = files && files[0]; if (!f) return;
  const code = new TextDecoder().decode(f.data);
  try {
    const api = { S, doc, view, commit, toast, emit, L, IMAGE, EDIT, SELECT, Layer, makeCanvas, ctx2d, askForm, flattenToCanvas, openDocument: openBytes };
    const fn = new Function('lumora', '"use strict"; return (async () => {\n' + code + '\n})();');
    await fn(api);
    view.request(); emit();
    toast('Skript ausgeführt: ' + f.name);
  } catch (e) { console.error(e); toast('Skriptfehler: ' + e.message, 6000); }
}

// ---------------- Farbprofile ----------------
export const COLOR = {
  async assign() {
    const d = doc(); if (!d) return;
    const { PROFILES } = await import('./engine/color.js');
    const v = await askForm('Profil zuweisen', [{ key: 'p', type: 'select', label: 'Profil', options: Object.keys(PROFILES).map((k) => [k, k]), value: d.profile || 'sRGB' }],
      { hint: 'Ändert nur die Kennzeichnung – die Pixelwerte bleiben gleich. Beim Export wird dieses ICC-Profil eingebettet.' });
    if (!v) return; d.profile = v.p; commit('Profil zuweisen'); emit();
  },
  async convert() {
    const d = doc(); if (!d) return;
    const C = await import('./engine/color.js');
    const v = await askForm('In Profil umwandeln', [
      { key: 'from', type: 'info', label: `Quellprofil: ${d.profile || 'sRGB'}` },
      { key: 'p', type: 'select', label: 'Zielprofil', options: Object.keys(C.PROFILES).map((k) => [k, k]), value: (d.profile || 'sRGB') === 'sRGB' ? 'Display P3' : 'sRGB' },
    ], { hint: 'Rechnet die Pixel so um, dass die Farben im Zielprofil gleich aussehen (relativ farbmetrisch). Hinweis: Die Bildschirmanzeige von Lumora geht von sRGB aus.' });
    if (!v || v.p === (d.profile || 'sRGB')) return;
    const from = d.profile || 'sRGB';
    for (const l of d.layers) {
      const tgts = [l.type === 'raster' || l.type === 'smart' ? l.canvas : null, l.smart && l.smart.src].filter(Boolean);
      for (const c of tgts) { const x = ctx2d(c), id = x.getImageData(0, 0, c.width, c.height); C.convertPixels(id.data, from, v.p); x.putImageData(id, 0, 0); }
      l.touch();
    }
    d.profile = v.p; view.request(); commit('In Profil umwandeln');
    toast(`In „${v.p}“ umgewandelt`);
  },
};

// ---------------- Updates ----------------
export const APP_VERSION = '5.0.0';
const vnum = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
export async function checkUpdates(silent = false) {
  const url = (S.prefs.updateUrl || '').trim();
  if (!url) { if (!silent) toast('Kein Update-Server eingetragen (Voreinstellungen › Allgemein › Update-Adresse)', 5000); return; }
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.version && newer(j.version, APP_VERSION)) {
      const v = await askForm('Update verfügbar', [{ key: 'i', type: 'info', label: `Lumora ${j.version} ist verfügbar (installiert: ${APP_VERSION}).${j.notes ? ' ' + j.notes : ''}` }], { okLabel: 'Herunterladen' });
      if (v && j.url) window.open(j.url, '_blank');
    } else if (!silent) toast(`Lumora ist aktuell (${APP_VERSION})`);
  } catch (e) { if (!silent) toast('Update-Prüfung fehlgeschlagen: ' + e.message, 5000); }
}
