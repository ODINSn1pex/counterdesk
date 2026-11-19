import { useEffect, useRef } from 'react';
import { S, doc, view, emit, emitCursor, useStore, openBytes, placeImage, VIEW, applyTransform, cancelTransform, toast } from '../state.js';
import { composite } from '../engine/doc.js';
import { makeCanvas, ctx2d, loadImage } from '../engine/util.js';
import { edgeCanvas } from '../engine/selection.js';
import { warpMap as warpMapUI, meshMapFor as meshMapForUI } from '../engine/mesh.js';
import * as TL from '../tools.js';
import { TextEditor } from './TextEditor.jsx';

const RULER = 20;

// Einheiten-Umrechnung (Pixel → Anzeigeeinheit)
export function unitInfo(d) {
  const u = S.prefs.units || 'px';
  const ppi = (d && d.ppi) || 72;
  const f = { px: 1, cm: 2.54 / ppi, mm: 25.4 / ppi, in: 1 / ppi, pt: 72 / ppi, '%': d ? 100 / d.w : 1 }[u] || 1;
  return { u, f, label: { px: 'Px', cm: 'cm', mm: 'mm', in: 'Zoll', pt: 'Pt', '%': '%' }[u] || 'Px' };
}
export function fmtUnit(v, d) {
  const { f, label, u } = unitInfo(d);
  const x = v * f;
  return (u === 'px' ? Math.round(x) : x.toFixed(u === 'mm' || u === '%' ? 1 : 2)).toString().replace('.', ',') + ' ' + label;
}

function themeColors() {
  if (view.colors) return view.colors;
  const css = getComputedStyle(document.documentElement);
  const g = (k, d) => (css.getPropertyValue(k).trim() || d);
  view.colors = {
    canvasBg: g('--canvas-bg', '#17132b'), panel: g('--panel', '#2a2347'), panel2: g('--panel-2', '#231d3d'),
    text: g('--text-2', '#b9aed6'), accent: g('--accent', '#ec8fc4'), line: g('--line', '#3b3366'),
  };
  return view.colors;
}

const checkerCache = { key: null, pat: null };
function checker(x) {
  const size = { small: 6, medium: 8, large: 16 }[S.prefs.checker] || 8;
  const tone = { light: ['#ffffff', '#d9d4e4'], medium: ['#bdbdbd', '#8f8f8f'], dark: ['#555', '#3a3a3a'] }[S.prefs.checkerTone] || ['#ffffff', '#d9d4e4'];
  const key = size + tone.join();
  if (checkerCache.key === key && checkerCache.pat) return checkerCache.pat;
  const c = makeCanvas(size * 2, size * 2); const cx = ctx2d(c);
  cx.fillStyle = tone[0]; cx.fillRect(0, 0, size * 2, size * 2); cx.fillStyle = tone[1]; cx.fillRect(0, 0, size, size); cx.fillRect(size, size, size, size);
  checkerCache.key = key; checkerCache.pat = x.createPattern(c, 'repeat');
  return checkerCache.pat;
}

const ease = (t) => 1 - Math.pow(1 - t, 3);

// CMYK-Proof (Näherung ohne ICC-Profil): sehr gesättigte, helle RGB-Farben liegen außerhalb des Druckfarbraums
function gamutExcess(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, sat = mx ? (mx - mn) / mx : 0;
  if (sat < 0.3) return 0;
  let h = 0; const d = mx - mn;
  if (d) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; }
  h *= 60;
  const lim = [[0, 0.72], [30, 0.8], [60, 0.88], [120, 0.58], [180, 0.62], [220, 0.5], [270, 0.52], [320, 0.66], [360, 0.72]];
  let L = 0.7;
  for (let i = 1; i < lim.length; i++) if (h <= lim[i][0]) { const t = (h - lim[i - 1][0]) / (lim[i][0] - lim[i - 1][0]); L = lim[i - 1][1] + (lim[i][1] - lim[i - 1][1]) * t; break; }
  return Math.max(0, sat * v - L);
}
function proofCanvas(src, proof, gamut, reuse) {
  const c = reuse && reuse.width === src.width && reuse.height === src.height ? reuse : makeCanvas(src.width, src.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height), p = id.data;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], g = p[i + 1], b = p[i + 2];
    const ex = gamutExcess(r, g, b);
    if (gamut && ex > 0.03) { p[i] = p[i + 1] = p[i + 2] = 128; continue; }
    if (proof) {
      const k = Math.min(1, ex * 2.2), l = r * 0.299 + g * 0.587 + b * 0.114;
      r += (l - r) * k * 0.55; g += (l - g) * k * 0.55; b += (l - b) * k * 0.55;
      // Papierweiß & Tiefschwarz eines gestrichenen Papiers
      p[i] = 22 + r * 0.9; p[i + 1] = 20 + g * 0.9; p[i + 2] = 24 + b * 0.89;
    }
  }
  x.putImageData(id, 0, 0);
  return c;
}

export function CanvasView() {
  useStore();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const state = useRef({ comp: makeCanvas(1, 1), edges: null, edgesRev: -1, docId: null, lastDraw: 0, guideDrag: null });
  const d = doc();

  useEffect(() => {
    const ro = new ResizeObserver(() => { view.request(); });
    ro.observe(wrapRef.current);
    view.comp = state.current.comp;
    view.fitZoom = (dd) => {
      const w = wrapRef.current; if (!w) return null;
      const vw = w.clientWidth - (S.ui.showRulers ? RULER : 0), vh = w.clientHeight - (S.ui.showRulers ? RULER : 0);
      return Math.max(0.02, Math.min(1, (vw - 60) / dd.w, (vh - 60) / dd.h));
    };
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
    const onScheme = () => { if (S.prefs.theme === 'system') import('../state.js').then((m) => m.applyTheme()); view.colors = null; view.request(); };
    if (mq) mq.addEventListener('change', onScheme);
    return () => { ro.disconnect(); if (mq) mq.removeEventListener('change', onScheme); };
  }, []);

  // Zeichen-Schleife
  useEffect(() => {
    let raf;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const dd = doc();
      const st = state.current;
      const a = view.anim;
      if (a) {
        if (a.doc !== dd) view.anim = null;
        else {
          const k = Math.min(1, (t - a.t0) / a.dur), e = ease(k);
          dd.zoom = a.z0 + (a.z1 - a.z0) * e; dd.panX = a.px0 + (a.px1 - a.px0) * e; dd.panY = a.py0 + (a.py1 - a.py0) * e;
          view.needs = true;
          if (k >= 1) { view.anim = null; emit(); }
        }
      }
      const hasAnts = dd && (dd.selection || TL.opState());
      if (!view.needs && !(hasAnts && t - st.lastDraw > 110)) return;
      st.lastDraw = t;
      try { draw(t); } catch (err) { console.error(err); }
      view.needs = false;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function geom(dd, cw, ch) {
    const rx = S.ui.showRulers ? RULER : 0;
    const vw = cw - rx, vh = ch - rx;
    if (dd.needsFit && vw > 50) {
      dd.zoom = Math.max(0.02, Math.min(1, (vw - 60) / dd.w, (vh - 60) / dd.h));
      dd.panX = 0; dd.panY = 0; dd.needsFit = false;
      setTimeout(emit, 0);
    }
    const ox = Math.round(rx + vw / 2 + dd.panX - (dd.w * dd.zoom) / 2);
    const oy = Math.round(rx + vh / 2 + dd.panY - (dd.h * dd.zoom) / 2);
    return { ox, oy, z: dd.zoom, vw, vh, rx, cx: rx + vw / 2, cy: rx + vh / 2 };
  }

  function draw(t) {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    }
    const col = themeColors();
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = col.canvasBg;
    x.fillRect(0, 0, cw, ch);
    const dd = doc();
    if (!dd) return;
    const st = state.current;
    const g = geom(dd, cw, ch);
    st.g = g;

    if (view.compositeDirty || st.docId !== dd.id || st.comp.width !== dd.w || st.comp.height !== dd.h) {
      const sameDoc = st.docId === dd.id && st.comp.width === dd.w && st.comp.height === dd.h;
      if (!sameDoc) { st.comp.width = dd.w; st.comp.height = dd.h; }
      const partial = sameDoc && !view.full && view.rect && !(dd.channelView && !(dd.channelView.r && dd.channelView.g && dd.channelView.b));
      composite(dd, st.comp, partial ? { cached: true, rect: view.rect } : { cached: true });
      view.compositeDirty = false; view.full = false; view.rect = null; st.docId = dd.id; view.compRev = (view.compRev || 0) + 1;
    }
    const dw = dd.w * g.z, dh = dd.h * g.z;
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 22;
    x.fillStyle = '#fff'; x.fillRect(g.ox, g.oy, dw, dh);
    x.restore();
    x.save();
    x.beginPath(); x.rect(g.ox, g.oy, dw, dh); x.clip();
    x.fillStyle = checker(x); x.translate(g.ox, g.oy); x.fillRect(0, 0, dw, dh); x.translate(-g.ox, -g.oy);
    x.imageSmoothingEnabled = g.z < 2;
    x.imageSmoothingQuality = g.z < 0.5 ? 'medium' : 'high';
    let shown = st.comp;
    if (S.ui.proof || S.ui.gamut) {
      const key = view.compRev + ':' + !!S.ui.proof + ':' + !!S.ui.gamut;
      if (st.proofKey !== key) { st.proof = proofCanvas(st.comp, S.ui.proof, S.ui.gamut, st.proof); st.proofKey = key; }
      shown = st.proof;
    }
    x.drawImage(shown, g.ox, g.oy, dw, dh);

    if (S.ui.quickMask && dd.selection) {
      if (!st.qm || st.qmRev !== dd.selRev || st.qm.width !== dd.w || st.qm.height !== dd.h) {
        st.qm = st.qm && st.qm.width === dd.w && st.qm.height === dd.h ? st.qm : makeCanvas(dd.w, dd.h);
        const qx = ctx2d(st.qm); qx.globalCompositeOperation = 'source-over'; qx.clearRect(0, 0, dd.w, dd.h);
        qx.fillStyle = 'rgba(255,40,80,0.5)'; qx.fillRect(0, 0, dd.w, dd.h);
        qx.globalCompositeOperation = 'destination-out'; qx.drawImage(dd.selection, 0, 0);
        st.qmRev = dd.selRev;
      }
      x.drawImage(st.qm, g.ox, g.oy, dw, dh);
    }
    x.restore();

    if (S.ui.showGrid) {
      const sp = Math.max(1, S.prefs.gridSpacing || 50), sub = Math.max(1, S.prefs.gridSub || 1);
      x.save(); x.lineWidth = 1;
      const lines = (step, alpha) => {
        if (step * g.z < 4) return;
        x.globalAlpha = alpha; x.strokeStyle = S.prefs.gridColor || '#ff9ad5'; x.beginPath();
        for (let gx = 0; gx <= dd.w; gx += step) { const sx = Math.round(g.ox + gx * g.z) + 0.5; x.moveTo(sx, g.oy); x.lineTo(sx, g.oy + dh); }
        for (let gy = 0; gy <= dd.h; gy += step) { const sy = Math.round(g.oy + gy * g.z) + 0.5; x.moveTo(g.ox, sy); x.lineTo(g.ox + dw, sy); }
        x.stroke();
      };
      if (sub > 1) lines(sp / sub, 0.15);
      lines(sp, 0.45);
      x.restore();
    }
    if (g.z >= 8 && S.prefs.pixelGrid !== false) {
      x.save(); x.strokeStyle = 'rgba(128,128,128,0.3)'; x.beginPath();
      const x0 = Math.max(0, Math.floor(-g.ox / g.z)), x1 = Math.min(dd.w, Math.ceil((cw - g.ox) / g.z));
      const y0 = Math.max(0, Math.floor(-g.oy / g.z)), y1 = Math.min(dd.h, Math.ceil((ch - g.oy) / g.z));
      for (let i = x0; i <= x1; i++) { const sx = Math.round(g.ox + i * g.z) + 0.5; x.moveTo(sx, g.oy + y0 * g.z); x.lineTo(sx, g.oy + y1 * g.z); }
      for (let j = y0; j <= y1; j++) { const sy = Math.round(g.oy + j * g.z) + 0.5; x.moveTo(g.ox + x0 * g.z, sy); x.lineTo(g.ox + x1 * g.z, sy); }
      x.stroke(); x.restore();
    }

    if (dd.selection && !S.ui.quickMask) {
      if (st.edgesRev !== dd.selRev || st.edgesDoc !== dd.id) { st.edges = edgeCanvas(dd.selection); st.edgesRev = dd.selRev; st.edgesDoc = dd.id; }
      if (st.edges) drawAnts(x, st, g, dd, t);
    }

    x.save();
    x.translate(g.ox, g.oy); x.scale(g.z, g.z);
    const lw = 1 / g.z;
    const op = TL.opState();
    if (op) {
      if (op.kind === 'marquee') {
        const r = TL.norm(TL.rectFrom(op.a, op.b, op.e || {}, S.sel.ratio === 'free' ? null : Number(S.sel.ratio)));
        dashed(x, lw, t, () => { x.beginPath(); if (S.sub.marquee === 'ellipse' && !op.object) x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); else x.rect(r.x, r.y, r.w, r.h); });
      }
      if (op.kind === 'lasso' || op.kind === 'poly') {
        dashed(x, lw, t, () => { x.beginPath(); op.pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); if (op.kind === 'poly' && op.hover) x.lineTo(op.hover.x, op.hover.y); });
      }
      if (op.kind === 'gradient') {
        x.strokeStyle = '#fff'; x.lineWidth = 2 * lw; x.beginPath(); x.moveTo(op.a.x, op.a.y); x.lineTo(op.b.x, op.b.y); x.stroke();
        x.strokeStyle = '#000'; x.lineWidth = lw; x.stroke();
        for (const q of [op.a, op.b]) { x.fillStyle = '#fff'; x.beginPath(); x.arc(q.x, q.y, 4 * lw, 0, 7); x.fill(); x.stroke(); }
      }
      if (op.kind === 'shape') { x.save(); TL.shapePreview(x); x.restore(); }
    }
    dd.paths.forEach((p, i) => {
      if (!p.points.length) return;
      const active = i === dd.activePath || S.tool === 'pen' || S.tool === 'select';
      if (!active) return;
      x.save(); x.strokeStyle = '#38bdf8'; x.lineWidth = 1.5 * lw;
      TL.tracePath(x, p); x.stroke();
      if (i === dd.activePath) p.points.forEach((pt) => {
        x.fillStyle = '#fff'; x.strokeStyle = '#2b7fff';
        if (pt.ox != null) { x.beginPath(); x.moveTo(pt.ix, pt.iy); x.lineTo(pt.ox, pt.oy); x.stroke(); for (const [hx, hy] of [[pt.ix, pt.iy], [pt.ox, pt.oy]]) { x.beginPath(); x.arc(hx, hy, 3 * lw, 0, 7); x.fill(); x.stroke(); } }
        x.fillRect(pt.x - 3 * lw, pt.y - 3 * lw, 6 * lw, 6 * lw); x.strokeRect(pt.x - 3 * lw, pt.y - 3 * lw, 6 * lw, 6 * lw);
      });
      x.restore();
    });
    if (S.measure && S.tool === 'eyedropper' && S.sub.eyedropper === 'ruler') {
      const m = S.measure; x.strokeStyle = '#ffde59'; x.lineWidth = 1.5 * lw; x.beginPath(); x.moveTo(m.a.x, m.a.y); x.lineTo(m.b.x, m.b.y); x.stroke();
      for (const q of [m.a, m.b]) { x.beginPath(); x.moveTo(q.x - 6 * lw, q.y); x.lineTo(q.x + 6 * lw, q.y); x.moveTo(q.x, q.y - 6 * lw); x.lineTo(q.x, q.y + 6 * lw); x.stroke(); }
    }
    if (S.ui.showGuides) {
      x.strokeStyle = S.prefs.guideColor || '#3ce0ff'; x.lineWidth = lw;
      dd.guides.forEach((gd) => { x.beginPath(); if (gd.dir === 'v') { x.moveTo(gd.pos, -1e5); x.lineTo(gd.pos, 1e5); } else { x.moveTo(-1e5, gd.pos); x.lineTo(1e5, gd.pos); } x.stroke(); });
    }
    if (st.guideDrag && st.guidePos != null) {
      x.strokeStyle = col.accent; x.lineWidth = lw; x.beginPath();
      if (st.guideDrag === 'v') { x.moveTo(st.guidePos, -1e5); x.lineTo(st.guidePos, 1e5); } else { x.moveTo(-1e5, st.guidePos); x.lineTo(1e5, st.guidePos); }
      x.stroke();
    }
    if (S.tool === 'type' || S.ui.textEdit) {
      dd.layers.forEach((l) => { if (l.type === 'text' && l.visible && l.text) { const b = textBoundsSafe(l); if (b) { x.strokeStyle = col.accent; x.globalAlpha = 0.7; x.lineWidth = lw; x.setLineDash([4 * lw, 3 * lw]); x.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4); x.setLineDash([]); x.globalAlpha = 1; } } });
    }
    x.restore();

    if (S.tool === 'crop' && S.cropState) {
      const r = TL.norm(S.cropState);
      const sx = g.ox + r.x * g.z, sy = g.oy + r.y * g.z, sw = r.w * g.z, sh = r.h * g.z;
      x.save(); x.fillStyle = 'rgba(10,8,20,0.6)';
      x.beginPath(); x.rect(0, 0, cw, ch); x.rect(sx, sy, sw, sh); x.fill('evenodd');
      x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.beginPath();
      for (let i = 1; i < 3; i++) { x.moveTo(sx + sw * i / 3, sy); x.lineTo(sx + sw * i / 3, sy + sh); x.moveTo(sx, sy + sh * i / 3); x.lineTo(sx + sw, sy + sh * i / 3); }
      x.stroke();
      x.fillStyle = '#fff';
      TL.cropHandles().forEach((h) => { x.fillRect(g.ox + h.x * g.z - 5, g.oy + h.y * g.z - 5, 10, 10); });
      x.restore();
    }
    if (S.transform && S.transform.mesh) {
      const t = S.transform;
      x.save(); x.strokeStyle = col.accent; x.lineWidth = 1;
      const P = (q) => [g.ox + q.x * g.z, g.oy + q.y * g.z];
      if (t.mesh === 'puppet') {
        const m = meshMapForUI(t);
        x.globalAlpha = 0.35; x.beginPath();
        const N = 12;
        for (let k = 0; k <= N; k++) { for (let s2 = 0; s2 <= N; s2++) { const q = m(k / N, s2 / N); s2 ? x.lineTo(...P(q)) : x.moveTo(...P(q)); } for (let s2 = 0; s2 <= N; s2++) { const q = m(s2 / N, k / N); s2 ? x.lineTo(...P(q)) : x.moveTo(...P(q)); } }
        x.stroke(); x.globalAlpha = 1;
        (t.pins || []).forEach((pn) => { const [sx, sy] = P(pn.q); x.fillStyle = '#ffde59'; x.strokeStyle = '#000'; x.beginPath(); x.arc(sx, sy, 6, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#000'; x.beginPath(); x.arc(sx, sy, 2, 0, 7); x.fill(); });
      } else if (t.mesh === 'warp') {
        // Hüllkurve des Verformungsfeldes + Kontrollgitter
        const m = warpMapUI(t.grid);
        x.globalAlpha = 0.9; x.beginPath();
        for (let k = 0; k <= 3; k++) { for (let s2 = 0; s2 <= 24; s2++) { const q = m(k / 3, s2 / 24); s2 ? x.lineTo(...P(q)) : x.moveTo(...P(q)); } for (let s2 = 0; s2 <= 24; s2++) { const q = m(s2 / 24, k / 3); s2 ? x.lineTo(...P(q)) : x.moveTo(...P(q)); } }
        x.stroke();
        x.globalAlpha = 0.5; x.setLineDash([3, 3]); x.beginPath();
        t.grid.forEach((r) => r.forEach((q, i) => { i ? x.lineTo(...P(q)) : x.moveTo(...P(q)); }));
        for (let i = 0; i < 4; i++) t.grid.forEach((r, j) => { j ? x.lineTo(...P(r[i])) : x.moveTo(...P(r[i])); });
        x.stroke(); x.setLineDash([]); x.globalAlpha = 1;
        TL.meshPoints(t).forEach((q) => { const [sx, sy] = P(q); x.fillStyle = '#fff'; x.beginPath(); x.arc(sx, sy, 4, 0, 7); x.fill(); x.stroke(); });
      } else {
        x.beginPath(); t.corners.forEach((q, i) => (i ? x.lineTo(...P(q)) : x.moveTo(...P(q)))); x.closePath(); x.stroke();
        t.corners.forEach((q) => { const [sx, sy] = P(q); x.fillStyle = '#fff'; x.fillRect(sx - 5, sy - 5, 10, 10); x.strokeRect(sx - 5, sy - 5, 10, 10); });
      }
      x.restore();
    } else if (S.transform) {
      const hs = TL.transformHandles(S.transform);
      x.save(); x.strokeStyle = col.accent; x.lineWidth = 1.2;
      x.beginPath();
      [0, 2, 4, 6].forEach((i, k) => { const h = hs[i]; const sx = g.ox + h.x * g.z, sy = g.oy + h.y * g.z; if (!k) x.moveTo(sx, sy); else x.lineTo(sx, sy); });
      x.closePath(); x.stroke();
      hs.forEach((h) => { const sx = g.ox + h.x * g.z, sy = g.oy + h.y * g.z; x.fillStyle = '#fff'; x.fillRect(sx - 4, sy - 4, 8, 8); x.strokeRect(sx - 4, sy - 4, 8, 8); });
      const c = S.transform; x.beginPath(); x.arc(g.ox + c.cx * g.z, g.oy + c.cy * g.z, 4, 0, 7); x.stroke();
      x.restore();
    }
    const cur = S.cursor;
    if (cur.inside && brushTool() && S.prefs.brushCursor !== 'cross') {
      const size = brushSize();
      const r = Math.max(1, size * g.z / 2);
      x.save(); x.lineWidth = 1;
      x.strokeStyle = 'rgba(0,0,0,0.7)'; x.beginPath(); x.arc(cur.sx, cur.sy, r, 0, 7); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(cur.sx, cur.sy, r + 1, 0, 7); x.stroke();
      if (S.prefs.brushCursor === 'both' || r < 4) { x.beginPath(); x.moveTo(cur.sx - 5, cur.sy); x.lineTo(cur.sx + 5, cur.sy); x.moveTo(cur.sx, cur.sy - 5); x.lineTo(cur.sx, cur.sy + 5); x.stroke(); }
      x.restore();
    }
    if (S.ui.showRulers) drawRulers(x, g, cw, ch, dd, col);
  }

  // ---------- Ereignisse ----------
  function toDoc(e, base) {
    const r = base || canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const g = state.current.g || { ox: 0, oy: 0, z: 1, cx: 0, cy: 0 };
    return {
      sx, sy, p: { x: (sx - g.ox) / g.z, y: (sy - g.oy) / g.z },
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button,
      zoom: g.z, cx: sx - g.cx, cy: sy - g.cy,
      pressure: e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 1,
    };
  }

  function safe(fn) {
    try { fn(); } catch (err) { console.error(err); toast('Unerwarteter Fehler: ' + err.message); }
  }

  function onPointerDown(e) {
    if (!doc()) return;
    if (S.ui.menu) { S.ui.menu = null; emit(); }
    if (view.anim) { view.anim = null; emit(); }
    const ev = toDoc(e);
    if (S.ui.showRulers && (ev.sx < RULER || ev.sy < RULER)) {
      if (ev.sx < RULER && ev.sy < RULER) return;
      state.current.guideDrag = ev.sy < RULER ? 'h' : 'v';
      canvasRef.current.setPointerCapture(e.pointerId);
      return;
    }
    const dd = doc();
    if (S.tool === 'move' && S.ui.showGuides && !S.transform) {
      const gi = dd.guides.findIndex((gd) => Math.abs((gd.dir === 'v' ? ev.p.x : ev.p.y) - gd.pos) * ev.zoom < 4);
      if (gi >= 0) { const gd = dd.guides.splice(gi, 1)[0]; state.current.guideDrag = gd.dir === 'v' ? 'v' : 'h'; canvasRef.current.setPointerCapture(e.pointerId); return; }
    }
    if (e.button === 1) { TL.SPACE.held = true; state.current.midPan = true; }
    if (e.button === 2) return;
    canvasRef.current.setPointerCapture(e.pointerId);
    safe(() => TL.pointerDown(ev));
    view.overlay();
  }
  function onPointerMove(e) {
    const ev = toDoc(e);
    S.cursor = { x: ev.p.x, y: ev.p.y, sx: ev.sx, sy: ev.sy, inside: true };
    if (state.current.guideDrag) {
      state.current.guidePos = state.current.guideDrag === 'v' ? ev.p.x : ev.p.y;
      view.overlay(); emitCursor(); return;
    }
    if (e.buttons || TL.opState()) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (evs && evs.length > 1) {
        const r = canvasRef.current.getBoundingClientRect();
        safe(() => evs.forEach((ce) => TL.pointerMove(toDoc(ce, r))));
      } else safe(() => TL.pointerMove(ev));
    }
    view.overlay();
    emitCursor();
  }
  function onPointerUp(e) {
    const ev = toDoc(e);
    if (state.current.guideDrag) {
      const dir = state.current.guideDrag; state.current.guideDrag = null; state.current.guidePos = null;
      const pos = dir === 'v' ? ev.p.x : ev.p.y;
      const dd = doc();
      if (dd && pos > 0 && pos < (dir === 'v' ? dd.w : dd.h) && ev.sx > RULER && ev.sy > RULER) VIEW.addGuide(dir, Math.round(pos));
      else { view.request(); emit(); }
      return;
    }
    safe(() => TL.pointerUp(ev));
    if (state.current.midPan) { TL.SPACE.held = false; state.current.midPan = false; }
  }
  function onDblClick() {
    if (S.tool === 'lasso' && S.sub.lasso === 'polygon') TL.finishPoly();
    if (S.tool === 'pen') TL.finishPath();
    if (S.transform) applyTransform();
  }
  function onWheel(e) {
    const dd = doc(); if (!dd) return;
    e.preventDefault();
    const ev = toDoc(e);
    const zoomGesture = e.ctrlKey || e.altKey || (S.prefs.wheelZoom && !e.shiftKey);
    if (zoomGesture) {
      const f = Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
      VIEW.zoomBy(f, ev.cx, ev.cy, 90);
    } else {
      if (view.anim) view.anim = null;
      const k = e.deltaMode === 1 ? 30 : 1;
      if (e.shiftKey) dd.panX -= (e.deltaY || e.deltaX) * k; else { dd.panX -= e.deltaX * k; dd.panY -= e.deltaY * k; }
      view.request();
    }
  }
  function onLeave() { S.cursor = { ...S.cursor, inside: false }; view.overlay(); emitCursor(); }
  function onContext(e) {
    e.preventDefault();
    if (!doc()) return;
    S.ui.contextMenu = { x: e.clientX, y: e.clientY };
    emit();
  }

  async function onDrop(e) {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (doc() && /^image\//.test(f.type) && !/psd/i.test(f.name)) {
        const img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: f.type })));
        placeImage(img, f.name.replace(/\.[^.]+$/, ''));
      } else await openBytes(f.name, bytes, (window.native && window.native.pathForFile && window.native.pathForFile(f)) || null);
    }
  }

  const cursor = cursorFor();
  return (
    <div className="canvas-wrap" ref={wrapRef} data-tut="canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onMouseDown={(e) => e.preventDefault()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onLeave}
        onDoubleClick={onDblClick}
        onWheel={onWheel}
        onContextMenu={onContext}
      />
      {d && S.ui.textEdit && <TextEditor geom={() => state.current.g} />}
      {d && S.transform && (
        <div className="float-actions">
          <button className="btn primary" onClick={applyTransform}>✓ Anwenden</button>
          <button className="btn" onClick={cancelTransform}>Abbrechen</button>
        </div>
      )}
      {d && d.layer && d.layer.editMask && <div className="mask-badge">Maske wird bearbeitet</div>}
      {S.ui.quickMask && <div className="mask-badge qm">Maskierungsmodus (Q)</div>}
      {(S.ui.proof || S.ui.gamut) && <div className="mask-badge proof">{S.ui.proof ? 'Proof: CMYK (Näherung)' : ''}{S.ui.proof && S.ui.gamut ? ' · ' : ''}{S.ui.gamut ? 'Farbumfang-Warnung' : ''}</div>}
      {S.ui.busy && <div className="busy-badge"><span className="spin" /> {S.ui.busy} …</div>}
    </div>
  );
}

function textBoundsSafe(l) {
  try { const c = makeCanvas(1, 1).getContext('2d'); const t = l.text; c.font = `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px "${t.font}"`; const lines = (t.content || ' ').split('\n'); const w = Math.max(20, ...lines.map((s) => c.measureText(s).width)); let x = t.x; if (t.align === 'center') x -= w / 2; else if (t.align === 'right') x -= w; return { x, y: t.y, w, h: lines.length * t.size * (t.leading || 1.2) }; } catch (e) { return null; }
}

function brushTool() {
  const t = S.tool;
  return (['brush', 'eraser', 'stamp', 'history', 'heal', 'blur', 'dodge'].includes(t) && !(t === 'eraser' && S.sub.eraser === 'magic') && !(t === 'heal' && S.sub.heal === 'redeye')) || (t === 'wand' && S.sub.wand === 'quick');
}
function brushSize() {
  const t = S.tool;
  if (t === 'eraser') return S.eraser.size;
  if (t === 'brush' && S.sub.brush === 'pencil') return S.pencil.size;
  if (t === 'blur' || t === 'dodge') return S.retouch.size;
  if (t === 'heal') return S.heal.size;
  return S.brush.size;
}

function cursorFor() {
  if (TL.SPACE.held) return 'grab';
  const t = S.tool;
  if (brushTool()) return S.prefs.brushCursor === 'cross' ? 'crosshair' : 'none';
  return { move: 'move', marquee: 'crosshair', lasso: 'crosshair', wand: 'crosshair', crop: 'crosshair', eyedropper: 'crosshair', gradient: 'crosshair', pen: 'crosshair', select: 'default', type: 'text', shape: 'crosshair', view: S.sub.view === 'zoom' ? 'zoom-in' : 'grab' }[t] || 'default';
}

function dashed(x, lw, t, path) {
  x.save(); path(); x.lineWidth = lw; x.strokeStyle = '#000'; x.setLineDash([]); x.stroke();
  x.strokeStyle = '#fff'; x.setLineDash([4 * lw, 4 * lw]); x.lineDashOffset = -(t / 60) * lw; x.stroke(); x.restore();
}

const ants = { c: null, pats: [] };
function antPattern(x, off) {
  if (!ants.pats[off]) {
    const p = makeCanvas(8, 8); const px = ctx2d(p);
    px.fillStyle = '#000'; px.fillRect(0, 0, 8, 8); px.fillStyle = '#fff';
    px.translate(off, 0);
    for (let i = -16; i < 16; i += 8) { px.beginPath(); px.moveTo(i, 0); px.lineTo(i + 4, 0); px.lineTo(i + 12, 8); px.lineTo(i + 8, 8); px.fill(); }
    ants.pats[off] = x.createPattern(p, 'repeat');
  }
  return ants.pats[off];
}
function drawAnts(x, st, g, dd, t) {
  if (!ants.c || ants.c.width !== dd.w || ants.c.height !== dd.h) { ants.c = makeCanvas(dd.w, dd.h); ants.pats = []; }
  const a = ants.c; const ax = ctx2d(a);
  ax.globalCompositeOperation = 'source-over';
  ax.clearRect(0, 0, dd.w, dd.h);
  ax.fillStyle = antPattern(ax, Math.floor(t / 100) % 8);
  ax.fillRect(0, 0, dd.w, dd.h);
  ax.globalCompositeOperation = 'destination-in';
  ax.drawImage(st.edges, 0, 0);
  x.save();
  x.imageSmoothingEnabled = g.z < 1;
  x.drawImage(a, g.ox, g.oy, dd.w * g.z, dd.h * g.z);
  if (g.z < 1) { x.globalAlpha = 0.6; x.drawImage(a, g.ox + 0.5, g.oy + 0.5, dd.w * g.z, dd.h * g.z); }
  x.restore();
}

function drawRulers(x, g, cw, ch, dd, col) {
  const { f } = unitInfo(dd);
  x.save();
  x.fillStyle = col.panel2;
  x.fillRect(0, 0, cw, RULER); x.fillRect(0, 0, RULER, ch);
  x.strokeStyle = col.line; x.fillStyle = col.text;
  x.font = '9px "Segoe UI", sans-serif'; x.lineWidth = 1;
  const pxPerUnit = g.z / f;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const stepU = steps.find((s) => s * pxPerUnit >= 64) || 5000;
  const step = stepU / f;
  const fmt = (v) => { const u = v * f; const r = Math.round(u * 10) / 10; return Math.abs(r) < 1e-6 ? '0' : (Number.isInteger(r) ? String(r) : String(r).replace('.', ',')); };
  x.beginPath();
  const startX = Math.floor(-g.ox / g.z / step) * step;
  for (let v = startX; g.ox + v * g.z < cw; v += step / 4) {
    const sx = Math.round(g.ox + v * g.z) + 0.5; if (sx < RULER) continue;
    const major = Math.abs(Math.round(v / step) * step - v) < step * 1e-3;
    x.moveTo(sx, major ? 3 : 14); x.lineTo(sx, RULER);
    if (major) x.fillText(fmt(v), sx + 3, 10);
  }
  const startY = Math.floor(-g.oy / g.z / step) * step;
  for (let v = startY; g.oy + v * g.z < ch; v += step / 4) {
    const sy = Math.round(g.oy + v * g.z) + 0.5; if (sy < RULER) continue;
    const major = Math.abs(Math.round(v / step) * step - v) < step * 1e-3;
    x.moveTo(major ? 3 : 14, sy); x.lineTo(RULER, sy);
    if (major) { x.save(); x.translate(10, sy + 3); x.rotate(-Math.PI / 2); x.fillText(fmt(v), 0, 0); x.restore(); }
  }
  x.stroke();
  if (S.cursor.inside) {
    x.strokeStyle = col.accent; x.beginPath();
    x.moveTo(S.cursor.sx + 0.5, 0); x.lineTo(S.cursor.sx + 0.5, RULER); x.moveTo(0, S.cursor.sy + 0.5); x.lineTo(RULER, S.cursor.sy + 0.5); x.stroke();
  }
  x.fillStyle = col.panel; x.fillRect(0, 0, RULER, RULER);
  x.restore();
}
