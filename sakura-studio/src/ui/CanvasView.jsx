import { useEffect, useRef } from 'react';
import { S, doc, view, emit, useStore, finishTextEdit, openBytes, placeImage, VIEW, applyTransform, cancelTransform } from '../state.js';
import { composite } from '../engine/doc.js';
import { makeCanvas, ctx2d, loadImage } from '../engine/util.js';
import { edgeCanvas } from '../engine/selection.js';
import * as TL from '../tools.js';
import { TextEditor } from './TextEditor.jsx';

const RULER = 20;

export function CanvasView() {
  useStore();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const state = useRef({ comp: makeCanvas(1, 1), edges: null, edgesRev: -1, docId: null, lastDraw: 0, w: 0, h: 0, guideDrag: null });
  const d = doc();

  // Größe
  useEffect(() => {
    const ro = new ResizeObserver(() => { view.request(); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Zeichen-Schleife
  useEffect(() => {
    let raf;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const dd = doc();
      const st = state.current;
      const hasAnts = dd && (dd.selection || TL.opState());
      if (!view.needs && !(hasAnts && t - st.lastDraw > 120)) return;
      st.lastDraw = t;
      draw(t);
      view.needs = false;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function geom(dd, cw, ch) {
    const vw = cw - (S.ui.showRulers ? RULER : 0), vh = ch - (S.ui.showRulers ? RULER : 0);
    const rx = S.ui.showRulers ? RULER : 0;
    if (dd.needsFit && vw > 50) {
      dd.zoom = Math.min(1, (vw - 60) / dd.w, (vh - 60) / dd.h);
      dd.zoom = Math.max(0.02, dd.zoom);
      dd.panX = 0; dd.panY = 0; dd.needsFit = false;
      setTimeout(emit, 0);
    }
    const ox = rx + vw / 2 + dd.panX - (dd.w * dd.zoom) / 2;
    const oy = rx + vh / 2 + dd.panY - (dd.h * dd.zoom) / 2;
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
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    x.fillStyle = css.getPropertyValue('--canvas-bg').trim() || '#16132a';
    x.fillRect(0, 0, cw, ch);
    const dd = doc();
    if (!dd) return;
    const st = state.current;
    const g = geom(dd, cw, ch);
    st.g = g;

    // Zusammensetzen
    if (view.compositeDirty || st.docId !== dd.id || st.comp.width !== dd.w || st.comp.height !== dd.h) {
      if (st.comp.width !== dd.w || st.comp.height !== dd.h) { st.comp.width = dd.w; st.comp.height = dd.h; }
      composite(dd, st.comp);
      view.compositeDirty = false; st.docId = dd.id;
    }
    const dw = dd.w * g.z, dh = dd.h * g.z;
    // Schatten + Schachbrett
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 24;
    x.fillStyle = '#fff'; x.fillRect(g.ox, g.oy, dw, dh);
    x.restore();
    x.save();
    x.beginPath(); x.rect(g.ox, g.oy, dw, dh); x.clip();
    x.fillStyle = checker(x); x.translate(g.ox, g.oy); x.fillRect(0, 0, dw, dh); x.translate(-g.ox, -g.oy);
    x.imageSmoothingEnabled = g.z < 2;
    x.imageSmoothingQuality = 'high';
    x.drawImage(st.comp, g.ox, g.oy, dw, dh);

    // Schnellmaske
    if (S.ui.quickMask && dd.selection) {
      const qm = makeCanvas(dd.w, dd.h); const qx = ctx2d(qm);
      qx.fillStyle = 'rgba(255,40,80,0.5)'; qx.fillRect(0, 0, dd.w, dd.h);
      qx.globalCompositeOperation = 'destination-out'; qx.drawImage(dd.selection, 0, 0);
      x.drawImage(qm, g.ox, g.oy, dw, dh);
    }
    // Maske in Bearbeitung → kleiner Hinweis
    x.restore();

    // Raster
    if (S.ui.showGrid) {
      x.save(); x.strokeStyle = 'rgba(255,170,220,0.25)'; x.lineWidth = 1;
      const step = gridStep(g.z) ;
      x.beginPath();
      for (let gx = 0; gx <= dd.w; gx += step) { const sx = Math.round(g.ox + gx * g.z) + 0.5; x.moveTo(sx, g.oy); x.lineTo(sx, g.oy + dh); }
      for (let gy = 0; gy <= dd.h; gy += step) { const sy = Math.round(g.oy + gy * g.z) + 0.5; x.moveTo(g.ox, sy); x.lineTo(g.ox + dw, sy); }
      x.stroke(); x.restore();
    }
    if (g.z >= 8) {
      x.save(); x.strokeStyle = 'rgba(128,128,128,0.25)'; x.beginPath();
      const x0 = Math.max(0, Math.floor(-g.ox / g.z)), x1 = Math.min(dd.w, Math.ceil((cw - g.ox) / g.z));
      const y0 = Math.max(0, Math.floor(-g.oy / g.z)), y1 = Math.min(dd.h, Math.ceil((ch - g.oy) / g.z));
      for (let i = x0; i <= x1; i++) { const sx = Math.round(g.ox + i * g.z) + 0.5; x.moveTo(sx, g.oy + y0 * g.z); x.lineTo(sx, g.oy + y1 * g.z); }
      for (let j = y0; j <= y1; j++) { const sy = Math.round(g.oy + j * g.z) + 0.5; x.moveTo(g.ox + x0 * g.z, sy); x.lineTo(g.ox + x1 * g.z, sy); }
      x.stroke(); x.restore();
    }

    // Auswahl-Ameisen
    if (dd.selection && !S.ui.quickMask) {
      if (st.edgesRev !== dd.selRev || st.edgesDoc !== dd.id) { st.edges = edgeCanvas(dd.selection); st.edgesRev = dd.selRev; st.edgesDoc = dd.id; }
      if (st.edges) drawAnts(x, st, g, dd, t);
    }

    // Overlay im Dokumentraum
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
    // Pfade
    dd.paths.forEach((p, i) => {
      if (!p.points.length) return;
      const active = i === dd.activePath || S.tool === 'pen' || S.tool === 'select';
      if (!active) return;
      x.save(); x.strokeStyle = '#7fd3ff'; x.lineWidth = 1.5 * lw;
      TL.tracePath(x, p); x.stroke();
      if (i === dd.activePath) p.points.forEach((pt) => {
        x.fillStyle = '#fff'; x.strokeStyle = '#2b7fff';
        if (pt.ox != null) { x.beginPath(); x.moveTo(pt.ix, pt.iy); x.lineTo(pt.ox, pt.oy); x.stroke(); for (const [hx, hy] of [[pt.ix, pt.iy], [pt.ox, pt.oy]]) { x.beginPath(); x.arc(hx, hy, 3 * lw, 0, 7); x.fill(); x.stroke(); } }
        x.fillRect(pt.x - 3 * lw, pt.y - 3 * lw, 6 * lw, 6 * lw); x.strokeRect(pt.x - 3 * lw, pt.y - 3 * lw, 6 * lw, 6 * lw);
      });
      x.restore();
    });
    // Messen
    if (S.measure && S.tool === 'eyedropper' && S.sub.eyedropper === 'ruler') {
      const m = S.measure; x.strokeStyle = '#ffde59'; x.lineWidth = 1.5 * lw; x.beginPath(); x.moveTo(m.a.x, m.a.y); x.lineTo(m.b.x, m.b.y); x.stroke();
      for (const q of [m.a, m.b]) { x.beginPath(); x.moveTo(q.x - 6 * lw, q.y); x.lineTo(q.x + 6 * lw, q.y); x.moveTo(q.x, q.y - 6 * lw); x.lineTo(q.x, q.y + 6 * lw); x.stroke(); }
    }
    // Hilfslinien
    if (S.ui.showGuides) {
      x.strokeStyle = '#3ce0ff'; x.lineWidth = lw;
      dd.guides.forEach((gd) => { x.beginPath(); if (gd.dir === 'v') { x.moveTo(gd.pos, -1e5); x.lineTo(gd.pos, 1e5); } else { x.moveTo(-1e5, gd.pos); x.lineTo(1e5, gd.pos); } x.stroke(); });
    }
    if (st.guideDrag && st.guidePos != null) {
      x.strokeStyle = '#ff9ad5'; x.lineWidth = lw; x.beginPath();
      if (st.guideDrag === 'v') { x.moveTo(st.guidePos, -1e5); x.lineTo(st.guidePos, 1e5); } else { x.moveTo(-1e5, st.guidePos); x.lineTo(1e5, st.guidePos); }
      x.stroke();
    }
    // Textrahmen
    if (S.tool === 'type' || S.ui.textEdit) {
      dd.layers.forEach((l) => { if (l.type === 'text' && l.visible && l.text) { const b = textBoundsSafe(l); if (b) { x.strokeStyle = 'rgba(255,170,220,0.6)'; x.lineWidth = lw; x.setLineDash([4 * lw, 3 * lw]); x.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4); x.setLineDash([]); } } });
    }
    x.restore();

    // Freistellen
    if (S.tool === 'crop' && S.cropState) {
      const r = TL.norm(S.cropState);
      const sx = g.ox + r.x * g.z, sy = g.oy + r.y * g.z, sw = r.w * g.z, sh = r.h * g.z;
      x.save(); x.fillStyle = 'rgba(10,6,24,0.6)';
      x.beginPath(); x.rect(0, 0, cw, ch); x.rect(sx, sy, sw, sh); x.fill('evenodd');
      x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.beginPath();
      for (let i = 1; i < 3; i++) { x.moveTo(sx + sw * i / 3, sy); x.lineTo(sx + sw * i / 3, sy + sh); x.moveTo(sx, sy + sh * i / 3); x.lineTo(sx + sw, sy + sh * i / 3); }
      x.stroke();
      x.fillStyle = '#fff';
      TL.cropHandles().forEach((h) => { x.fillRect(g.ox + h.x * g.z - 5, g.oy + h.y * g.z - 5, 10, 10); });
      x.restore();
    }
    // Transformieren
    if (S.transform) {
      const hs = TL.transformHandles(S.transform);
      x.save(); x.strokeStyle = '#ff9ad5'; x.lineWidth = 1.2;
      x.beginPath();
      [0, 2, 4, 6].forEach((i, k) => { const h = hs[i]; const sx = g.ox + h.x * g.z, sy = g.oy + h.y * g.z; if (!k) x.moveTo(sx, sy); else x.lineTo(sx, sy); });
      x.closePath(); x.stroke();
      hs.forEach((h) => { const sx = g.ox + h.x * g.z, sy = g.oy + h.y * g.z; x.fillStyle = '#fff'; x.fillRect(sx - 4, sy - 4, 8, 8); x.strokeRect(sx - 4, sy - 4, 8, 8); });
      const c = S.transform; x.beginPath(); x.arc(g.ox + c.cx * g.z, g.oy + c.cy * g.z, 4, 0, 7); x.stroke();
      x.restore();
    }
    // Pinsel-Cursor
    const cur = S.cursor;
    if (cur.inside && brushTool()) {
      const size = brushSize();
      x.save(); x.lineWidth = 1;
      x.strokeStyle = 'rgba(0,0,0,0.7)'; x.beginPath(); x.arc(cur.sx, cur.sy, Math.max(1, size * g.z / 2), 0, 7); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(cur.sx, cur.sy, Math.max(1, size * g.z / 2) + 1, 0, 7); x.stroke();
      x.restore();
    }
    // Lineale
    if (S.ui.showRulers) drawRulers(x, g, cw, ch, dd);
  }

  // ---------- Ereignisse ----------
  function toDoc(e) {
    const r = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const g = state.current.g || { ox: 0, oy: 0, z: 1, cx: 0, cy: 0 };
    return {
      sx, sy, p: { x: (sx - g.ox) / g.z, y: (sy - g.oy) / g.z },
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button,
      zoom: g.z, cx: sx - g.cx, cy: sy - g.cy,
      pressure: e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 1,
    };
  }

  function onPointerDown(e) {
    if (!doc()) return;
    if (S.ui.menu) { S.ui.menu = null; emit(); }
    const ev = toDoc(e);
    // Hilfslinien aus Lineal ziehen
    if (S.ui.showRulers && (ev.sx < RULER || ev.sy < RULER)) {
      if (ev.sx < RULER && ev.sy < RULER) return;
      state.current.guideDrag = ev.sy < RULER ? 'h' : 'v';
      canvasRef.current.setPointerCapture(e.pointerId);
      return;
    }
    // Hilfslinie greifen (mit Verschieben-Werkzeug)
    const dd = doc();
    if (S.tool === 'move' && S.ui.showGuides && !S.transform) {
      const gi = dd.guides.findIndex((gd) => Math.abs((gd.dir === 'v' ? ev.p.x : ev.p.y) - gd.pos) * ev.zoom < 4);
      if (gi >= 0) { const gd = dd.guides.splice(gi, 1)[0]; state.current.guideDrag = gd.dir === 'v' ? 'v' : 'h'; canvasRef.current.setPointerCapture(e.pointerId); return; }
    }
    if (e.button === 1) { TL.SPACE.held = true; state.current.midPan = true; }
    if (e.button === 2) return;
    canvasRef.current.setPointerCapture(e.pointerId);
    TL.pointerDown(ev);
    view.overlay();
  }
  function onPointerMove(e) {
    const ev = toDoc(e);
    const dd = doc();
    S.cursor = { x: ev.p.x, y: ev.p.y, sx: ev.sx, sy: ev.sy, inside: true };
    if (state.current.guideDrag) {
      state.current.guidePos = state.current.guideDrag === 'v' ? ev.p.x : ev.p.y;
      view.overlay(); infoTick(); return;
    }
    if (e.buttons || TL.opState()) TL.pointerMove(ev);
    view.overlay();
    infoTick();
    void dd;
  }
  function onPointerUp(e) {
    const ev = toDoc(e);
    if (state.current.guideDrag) {
      const dir = state.current.guideDrag; state.current.guideDrag = null;
      const pos = dir === 'v' ? ev.p.x : ev.p.y;
      const dd = doc();
      if (dd && pos > 0 && pos < (dir === 'v' ? dd.w : dd.h) && ev.sx > RULER && ev.sy > RULER) VIEW.addGuide(dir, Math.round(pos));
      else { view.request(); emit(); }
      return;
    }
    TL.pointerUp(ev);
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
    if (e.ctrlKey || e.altKey) {
      VIEW.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, ev.cx, ev.cy);
    } else if (e.shiftKey) { dd.panX -= e.deltaY; view.request(); }
    else { dd.panX -= e.deltaX; dd.panY -= e.deltaY; view.request(); }
  }
  function onLeave() { S.cursor = { ...S.cursor, inside: false }; view.overlay(); }
  function onContext(e) {
    e.preventDefault();
    if (!doc()) return;
    S.ui.contextMenu = { x: e.clientX, y: e.clientY };
    emit();
  }

  let infoT = 0;
  function infoTick() { const n = performance.now(); if (n - infoT > 60) { infoT = n; emit(); } }

  async function onDrop(e) {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (doc() && /^image\//.test(f.type) && !/psd/.test(f.name)) {
        const img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: f.type })));
        placeImage(img, f.name.replace(/\.[^.]+$/, ''));
      } else await openBytes(f.name, bytes, f.path || null);
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
    </div>
  );
}

function textBoundsSafe(l) {
  try { const c = makeCanvas(1, 1).getContext('2d'); const t = l.text; c.font = `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px "${t.font}"`; const lines = (t.content || ' ').split('\n'); const w = Math.max(20, ...lines.map((s) => c.measureText(s).width)); let x = t.x; if (t.align === 'center') x -= w / 2; else if (t.align === 'right') x -= w; return { x, y: t.y, w, h: lines.length * t.size * (t.leading || 1.2) }; } catch (e) { return null; }
}

function brushTool() {
  const t = S.tool;
  return ['brush', 'eraser', 'stamp', 'history', 'heal', 'blur', 'dodge'].includes(t) && !(t === 'eraser' && S.sub.eraser === 'magic') && !(t === 'heal' && S.sub.heal === 'redeye') || (t === 'wand' && S.sub.wand === 'quick');
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
  if (brushTool()) return 'crosshair';
  return { move: 'move', marquee: 'crosshair', lasso: 'crosshair', wand: 'crosshair', crop: 'crosshair', eyedropper: 'crosshair', gradient: 'crosshair', pen: 'crosshair', select: 'default', type: 'text', shape: 'crosshair', view: S.sub.view === 'zoom' ? 'zoom-in' : 'grab' }[t] || 'default';
}

let checkerPat = null;
function checker(x) {
  if (checkerPat) return checkerPat;
  const c = makeCanvas(16, 16); const cx = ctx2d(c);
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 16, 16); cx.fillStyle = '#d9d4e4'; cx.fillRect(0, 0, 8, 8); cx.fillRect(8, 8, 8, 8);
  checkerPat = x.createPattern(c, 'repeat');
  return checkerPat;
}

function gridStep(z) { const target = 32 / z; const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]; return steps.find((s) => s >= target) || 1000; }

function dashed(x, lw, t, path) {
  x.save(); path(); x.lineWidth = lw; x.strokeStyle = '#000'; x.setLineDash([]); x.stroke();
  x.strokeStyle = '#fff'; x.setLineDash([4 * lw, 4 * lw]); x.lineDashOffset = -(t / 60) * lw; x.stroke(); x.restore();
}

const antsTmp = { c: null };
function drawAnts(x, st, g, dd, t) {
  if (!antsTmp.c || antsTmp.c.width !== dd.w || antsTmp.c.height !== dd.h) antsTmp.c = makeCanvas(dd.w, dd.h);
  const a = antsTmp.c; const ax = ctx2d(a);
  ax.globalCompositeOperation = 'source-over';
  ax.clearRect(0, 0, dd.w, dd.h);
  // diagonales Streifenmuster
  const p = makeCanvas(8, 8); const px = ctx2d(p);
  px.fillStyle = '#000'; px.fillRect(0, 0, 8, 8); px.fillStyle = '#fff';
  for (let i = -8; i < 16; i += 8) { px.beginPath(); px.moveTo(i, 0); px.lineTo(i + 4, 0); px.lineTo(i + 12, 8); px.lineTo(i + 8, 8); px.fill(); }
  const pat = ax.createPattern(p, 'repeat');
  const off = Math.floor(t / 100) % 8;
  ax.save(); ax.translate(off, 0); ax.fillStyle = pat; ax.fillRect(-off, 0, dd.w, dd.h); ax.restore();
  ax.globalCompositeOperation = 'destination-in';
  ax.drawImage(st.edges, 0, 0);
  x.save();
  x.imageSmoothingEnabled = false;
  if (g.z < 1) { x.imageSmoothingEnabled = true; }
  x.drawImage(a, g.ox, g.oy, dd.w * g.z, dd.h * g.z);
  if (g.z < 1) { x.globalAlpha = 0.6; x.drawImage(a, g.ox + 0.5, g.oy + 0.5, dd.w * g.z, dd.h * g.z); }
  x.restore();
}

function drawRulers(x, g, cw, ch, dd) {
  const css = getComputedStyle(document.documentElement);
  x.save();
  x.fillStyle = css.getPropertyValue('--panel-2').trim() || '#231d3d';
  x.fillRect(0, 0, cw, RULER); x.fillRect(0, 0, RULER, ch);
  x.strokeStyle = 'rgba(220,200,255,0.35)'; x.fillStyle = 'rgba(230,215,255,0.7)';
  x.font = '9px Segoe UI, sans-serif'; x.lineWidth = 1;
  const step = gridStep(g.z) * (g.z > 2 ? 1 : 2);
  x.beginPath();
  const startX = Math.floor(-g.ox / g.z / step) * step;
  for (let v = startX; g.ox + v * g.z < cw; v += step / 2) {
    const sx = Math.round(g.ox + v * g.z) + 0.5; if (sx < RULER) continue;
    const major = Math.abs(v % step) < 1e-6;
    x.moveTo(sx, major ? 4 : 13); x.lineTo(sx, RULER);
    if (major) x.fillText(String(Math.round(v)), sx + 2, 10);
  }
  const startY = Math.floor(-g.oy / g.z / step) * step;
  for (let v = startY; g.oy + v * g.z < ch; v += step / 2) {
    const sy = Math.round(g.oy + v * g.z) + 0.5; if (sy < RULER) continue;
    const major = Math.abs(v % step) < 1e-6;
    x.moveTo(major ? 4 : 13, sy); x.lineTo(RULER, sy);
    if (major) { x.save(); x.translate(10, sy + 2); x.rotate(-Math.PI / 2); x.fillText(String(Math.round(v)), 0, 0); x.restore(); }
  }
  x.stroke();
  // Cursor-Markierung
  if (S.cursor.inside) {
    x.strokeStyle = '#ff9ad5'; x.beginPath();
    x.moveTo(S.cursor.sx + 0.5, 0); x.lineTo(S.cursor.sx + 0.5, RULER); x.moveTo(0, S.cursor.sy + 0.5); x.lineTo(RULER, S.cursor.sy + 0.5); x.stroke();
  }
  x.fillStyle = css.getPropertyValue('--panel').trim() || '#2a2347'; x.fillRect(0, 0, RULER, RULER);
  x.restore();
  void dd;
}
