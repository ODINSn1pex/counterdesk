// Frame-Animation (wie die Zeitleiste in Photoshop): Frames speichern die Sichtbarkeit/Deckkraft der Ebenen
import { S, doc, emit, view, commit, toast, flattenToCanvas } from './state.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { makeCanvas, ctxRead, canvasToBytes } from './engine/util.js';

const snapshotVis = (d) => Object.fromEntries(d.layers.map((l) => [l.id, l.visible ? (l.opacity ?? 1) : 0]));

export function applyFrame(i) {
  const d = doc(); const f = d && d.frames[i]; if (!f) return;
  d.layers.forEach((l) => { if (l.id in f.vis) { const v = f.vis[l.id]; l.visible = v > 0; if (v > 0) l.opacity = v; } });
  d.curFrame = i; view.request(); emit();
}
export function captureFrame(i) { const d = doc(); if (!d || !d.frames[i]) return; d.frames[i].vis = snapshotVis(d); commit('Frame aktualisieren'); }
export function addFrame() {
  const d = doc(); if (!d) return;
  const delay = d.frames.length ? d.frames[d.frames.length - 1].delay : 200;
  d.frames.splice((d.curFrame ?? d.frames.length - 1) + 1, 0, { vis: snapshotVis(d), delay });
  d.curFrame = (d.curFrame ?? d.frames.length - 2) + 1;
  commit('Neuer Frame');
}
export function removeFrame(i) { const d = doc(); d.frames.splice(i, 1); d.curFrame = Math.min(i, d.frames.length - 1); commit('Frame löschen'); }
export function setDelay(i, ms) { const d = doc(); d.frames[i].delay = ms; commit('Frameverzögerung'); }
// Ein Frame je Ebene (unterste Ebene bleibt als Hintergrund sichtbar)
export function framesFromLayers() {
  const d = doc(); if (!d) return;
  const px = d.layers.filter((l) => l.hasPixels);
  const bg = px[0];
  d.frames = px.slice(bg && px.length > 1 ? 1 : 0).map((l) => ({ delay: 200, vis: Object.fromEntries(d.layers.map((x) => [x.id, x === l || (x === bg && px.length > 1) ? (x.opacity || 1) : 0])) }));
  d.curFrame = 0; applyFrame(0); commit('Frames aus Ebenen');
}

let playTimer = null;
export function isPlaying() { return !!playTimer; }
export function togglePlay() {
  const d = doc(); if (!d || d.frames.length < 2) { toast('Mindestens zwei Frames anlegen'); return; }
  if (playTimer) { clearTimeout(playTimer); playTimer = null; emit(); return; }
  const step = () => {
    const dd = doc(); if (!dd || !dd.frames.length) { playTimer = null; emit(); return; }
    const n = ((dd.curFrame ?? -1) + 1) % dd.frames.length;
    applyFrame(n);
    playTimer = setTimeout(step, Math.max(20, dd.frames[n].delay));
  };
  step();
}

function renderFrames(d, scale = 1) {
  const keep = d.layers.map((l) => [l.visible, l.opacity]);
  const out = d.frames.map((f, i) => {
    applyFrame(i);
    let c = flattenToCanvas(d, null);
    if (scale !== 1) { const s = makeCanvas(d.w * scale, d.h * scale); const x = s.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.width, s.height); c = s; }
    return { canvas: c, delay: f.delay };
  });
  d.layers.forEach((l, i) => { l.visible = keep[i][0]; l.opacity = keep[i][1]; });
  view.request(); emit();
  return out;
}

export async function exportGif({ scale = 1, loop = 0, bg = null } = {}) {
  const d = doc(); if (!d || !d.frames.length) { toast('Keine Frames vorhanden'); return null; }
  const frames = renderFrames(d, scale);
  const gif = GIFEncoder();
  for (const f of frames) {
    const c = makeCanvas(f.canvas.width, f.canvas.height); const x = ctxRead(c);
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(f.canvas, 0, 0);
    const { data, width, height } = x.getImageData(0, 0, c.width, c.height);
    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(data, palette, 'rgba4444');
    const ti = palette.findIndex((p) => p[3] === 0);
    gif.writeFrame(index, width, height, { palette, delay: f.delay, repeat: loop, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: 2 });
  }
  gif.finish();
  return gif.bytes();
}

export function videoFormats() {
  const list = [['video/mp4;codecs=avc1', 'MP4 (H.264)', 'mp4'], ['video/webm;codecs=vp9', 'WebM (VP9)', 'webm'], ['video/webm', 'WebM', 'webm']];
  return typeof MediaRecorder === 'undefined' ? [] : list.filter(([m]) => MediaRecorder.isTypeSupported(m));
}

// Video: Frames in Echtzeit über MediaRecorder aufnehmen
export async function exportVideo(mime, { scale = 1, loops = 1 } = {}) {
  const d = doc(); if (!d || !d.frames.length) { toast('Keine Frames vorhanden'); return null; }
  const frames = renderFrames(d, scale);
  const w = frames[0].canvas.width & ~1, h = frames[0].canvas.height & ~1;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => { rec.onstop = r; });
  const draw = (f) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.drawImage(f.canvas, 0, 0, w, h); };
  draw(frames[0]); rec.start(100);
  for (let k = 0; k < loops; k++) for (const f of frames) { draw(f); await new Promise((r) => setTimeout(r, Math.max(34, f.delay))); }
  rec.stop(); await done;
  return new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
}

export { canvasToBytes };
