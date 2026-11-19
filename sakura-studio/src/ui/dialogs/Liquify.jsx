// Verflüssigen: Verschiebungsfeld mit Pinseln (Vorwärts krümmen, Rekonstruieren, Strudel, Zusammenziehen, Aufblasen, Glätten)
import { useEffect, useRef, useState } from 'react';
import { S, doc, closeDialog, commit, canEditPixels, view, emit, toast } from '../../state.js';
import { makeCanvas, ctx2d, ctxRead } from '../../engine/util.js';
import { Icon } from '../icons.jsx';
import { Num } from '../OptionsBar.jsx';

const TOOLS = [
  ['push', 'Vorwärts krümmen (W)', 'smudge'], ['reconstruct', 'Rekonstruieren (R)', 'history'], ['smooth', 'Glätten (E)', 'blur'],
  ['twirlCW', 'Strudel im UZS (C)', 'rotate'], ['twirlCCW', 'Strudel gegen UZS', 'undo'], ['pucker', 'Zusammenziehen (S)', 'min'], ['bloat', 'Aufblasen (B)', 'plus'],
];

// Bild über Verschiebungsfeld neu abtasten (out(p) = src(p + D(p)))
function resample(srcData, W, H, fx, fy, fw, fh, out) {
  const sd = srcData.data, od = out.data;
  const kx = (fw - 1) / Math.max(1, W - 1), ky = (fh - 1) / Math.max(1, H - 1), s = W / fw;
  for (let y = 0; y < H; y++) {
    const gy = y * ky, gy0 = Math.min(fh - 2, gy | 0), ty = gy - gy0;
    for (let x = 0; x < W; x++) {
      const gx = x * kx, gx0 = Math.min(fw - 2, gx | 0), tx = gx - gx0;
      const i00 = gy0 * fw + gx0, i10 = i00 + 1, i01 = i00 + fw, i11 = i01 + 1;
      const dx = ((fx[i00] * (1 - tx) + fx[i10] * tx) * (1 - ty) + (fx[i01] * (1 - tx) + fx[i11] * tx) * ty) * s;
      const dy = ((fy[i00] * (1 - tx) + fy[i10] * tx) * (1 - ty) + (fy[i01] * (1 - tx) + fy[i11] * tx) * ty) * s;
      let sx = x + dx, sy = y + dy;
      if (sx < 0) sx = 0; else if (sx > W - 1.001) sx = W - 1.001;
      if (sy < 0) sy = 0; else if (sy > H - 1.001) sy = H - 1.001;
      const ix = sx | 0, iy = sy | 0, ax = sx - ix, ay = sy - iy;
      const q00 = (iy * W + ix) * 4, q10 = q00 + 4, q01 = q00 + W * 4, q11 = q01 + 4, o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) od[o + c] = (sd[q00 + c] * (1 - ax) + sd[q10 + c] * ax) * (1 - ay) + (sd[q01 + c] * (1 - ax) + sd[q11 + c] * ax) * ay;
    }
  }
}

export function LiquifyDialog() {
  const d = doc();
  const ref = useRef(null);
  const st = useRef(null);
  const [tool, setTool] = useState('push');
  const [size, setSize] = useState(Math.round(Math.min(d.w, d.h) / 8));
  const [pressure, setPressure] = useState(50);
  const [density, setDensity] = useState(50);
  const [cursor, setCursor] = useState(null);
  const ok = useRef(false);

  useEffect(() => {
    const l = d.layer;
    if (!canEditPixels(l)) { closeDialog(); return; }
    // Vorschau in reduzierter Größe für flüssiges Arbeiten
    const scale = Math.min(1, 900 / Math.max(d.w, d.h));
    const W = Math.max(2, Math.round(d.w * scale)), H = Math.max(2, Math.round(d.h * scale));
    const pv = makeCanvas(W, H); const px = ctxRead(pv); px.imageSmoothingQuality = 'high'; px.drawImage(l.canvas, 0, 0, W, H);
    // Verschiebungsfeld in Vorschaupixeln (Raster = Vorschauauflösung / 2)
    const fw = Math.max(2, Math.round(W / 2)), fh = Math.max(2, Math.round(H / 2));
    st.current = { l, scale, W, H, src: px.getImageData(0, 0, W, H), out: px.createImageData(W, H), fw, fh, fx: new Float32Array(fw * fh), fy: new Float32Array(fw * fh), dirty: true };
    const c = ref.current; c.width = W; c.height = H;
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = st.current; if (!s) return;
      if (s.down && s.tool !== 'push') { applyBrush(s, s.pos, null); }
      if (!s.dirty) return;
      s.dirty = false;
      resample(s.src, s.W, s.H, s.fx, s.fy, s.fw, s.fh, s.out);
      ctx2d(c).putImageData(s.out, 0, 0);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => { if (st.current) Object.assign(st.current, { tool, size, pressure, density }); }, [tool, size, pressure, density]);
  useEffect(() => {
    const k = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const m = { w: 'push', r: 'reconstruct', e: 'smooth', c: 'twirlCW', s: 'pucker', b: 'bloat' }[e.key.toLowerCase()];
      if (m) { setTool(m); e.stopPropagation(); }
      if (e.key === '[' || e.key === ']') { setSize((v) => Math.max(2, Math.round(v * (e.key === ']' ? 1.15 : 1 / 1.15)))); e.stopPropagation(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);

  // Pinsel auf das Feld anwenden; p und v in Vorschaupixeln
  function applyBrush(s, p, v) {
    if (!p) return;
    const r = (s.size * s.scale) / 2, rf = r / 2; // Radius im Feldraster
    const cx = p.x / 2, cy = p.y / 2;
    const str = s.pressure / 100, dens = s.density / 100;
    const x0 = Math.max(0, Math.floor(cx - rf)), x1 = Math.min(s.fw - 1, Math.ceil(cx + rf));
    const y0 = Math.max(0, Math.floor(cy - rf)), y1 = Math.min(s.fh - 1, Math.ceil(cy + rf));
    const fx = s.fx, fy = s.fy;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy) / rf;
      if (dd >= 1) continue;
      // Weiche Pinselspitze (Dichte = Abfall zum Rand)
      const w = Math.pow(1 - dd * dd, 1 + dens * 2) * str;
      const i = y * s.fw + x;
      if (s.tool === 'push' && v) { fx[i] -= v.x / 2 * w; fy[i] -= v.y / 2 * w; }
      else if (s.tool === 'reconstruct') { fx[i] *= 1 - w * 0.12; fy[i] *= 1 - w * 0.12; }
      else if (s.tool === 'smooth') {
        let ax = 0, ay = 0, n = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(s.fh - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(s.fw - 1, x + 1); xx++) { ax += fx[yy * s.fw + xx]; ay += fy[yy * s.fw + xx]; n++; }
        fx[i] += (ax / n - fx[i]) * w * 0.5; fy[i] += (ay / n - fy[i]) * w * 0.5;
      } else if (s.tool === 'twirlCW' || s.tool === 'twirlCCW') {
        const a = (s.tool === 'twirlCW' ? -1 : 1) * 0.06 * w;
        const ca = Math.cos(a), sa = Math.sin(a);
        const px0 = dx + fx[i] / 2 * 0, rx = dx * ca - dy * sa - dx, ry = dx * sa + dy * ca - dy; void px0;
        fx[i] += rx * 2; fy[i] += ry * 2;
      } else if (s.tool === 'pucker') { fx[i] += dx * 0.06 * w * 2; fy[i] += dy * 0.06 * w * 2; }
      else if (s.tool === 'bloat') { fx[i] -= dx * 0.06 * w * 2; fy[i] -= dy * 0.06 * w * 2; }
    }
    s.dirty = true;
  }

  const toLocal = (e) => { const r = ref.current.getBoundingClientRect(); return { x: (e.clientX - r.left) * (ref.current.width / r.width), y: (e.clientY - r.top) * (ref.current.height / r.height) }; };
  const onDown = (e) => { const s = st.current; ref.current.setPointerCapture(e.pointerId); s.down = true; s.pos = toLocal(e); s.last = s.pos; if (s.tool === 'push') applyBrush(s, s.pos, { x: 0, y: 0 }); };
  const onMove = (e) => {
    const s = st.current; const p = toLocal(e);
    const r = ref.current.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top, r: (s.size * s.scale / 2) * (r.width / ref.current.width) });
    if (!s.down) return;
    if (s.tool === 'push') {
      const v = { x: p.x - s.last.x, y: p.y - s.last.y };
      const steps = Math.max(1, Math.ceil(Math.hypot(v.x, v.y) / 4));
      for (let k = 1; k <= steps; k++) applyBrush(s, { x: s.last.x + v.x * k / steps, y: s.last.y + v.y * k / steps }, { x: v.x / steps, y: v.y / steps });
      s.last = p;
    }
    s.pos = p;
  };
  const onUp = () => { if (st.current) st.current.down = false; };

  const apply = () => {
    const s = st.current; if (!s || ok.current) return;
    ok.current = true;
    const l = s.l;
    S.ui.busy = 'Verflüssigen'; emit();
    setTimeout(() => {
      // Feld auf volle Auflösung übertragen
      const sx = ctxRead(makeCanvas(1, 1));
      const src = ctxRead(l.canvas).getImageData(0, 0, d.w, d.h);
      const out = sx.createImageData(d.w, d.h);
      const fx = s.fx.map((v) => v), fy = s.fy.map((v) => v);
      // Werte sind in Vorschaupixeln/2 je Feldzelle → in Vollbildpixel umrechnen
      const k = 1 / s.scale;
      for (let i = 0; i < fx.length; i++) { fx[i] *= k * (s.W / s.fw) / (d.w / s.fw); fy[i] *= k * (s.W / s.fw) / (d.w / s.fw); }
      resample(src, d.w, d.h, fx, fy, s.fw, s.fh, out);
      ctxRead(l.canvas).putImageData(out, 0, 0);
      l.touch(); view.request();
      S.ui.busy = null;
      closeDialog();
      commit('Verflüssigen');
    }, 20);
  };
  const reset = () => { const s = st.current; s.fx.fill(0); s.fy.fill(0); s.dirty = true; };
  useEffect(() => {
    const k = (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') { e.preventDefault(); closeDialog(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);

  return (
    <div className="modal-back" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal liquify">
        <div className="modal-title">Verflüssigen – {d.layer.name}<div className="flex" /><button className="x" onClick={closeDialog}><Icon name="close" size={14} /></button></div>
        <div className="lq-body">
          <div className="lq-tools">{TOOLS.map(([k, n, ic]) => <button key={k} title={n} className={'tool' + (tool === k ? ' active' : '')} onClick={() => setTool(k)}><Icon name={ic} size={18} /></button>)}</div>
          <div className="lq-canvas">
            <canvas ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setCursor(null)} />
            {cursor && <span className="lq-cursor" style={{ left: cursor.x, top: cursor.y, width: cursor.r * 2, height: cursor.r * 2 }} />}
          </div>
          <div className="lq-opts">
            <h4>{TOOLS.find((t) => t[0] === tool)[1]}</h4>
            <Num label="Größe" value={size} min={2} max={3000} onChange={setSize} unit=" Px" width={56} />
            <Num label="Druck" value={pressure} min={1} max={100} onChange={setPressure} unit="%" width={44} />
            <Num label="Dichte" value={density} min={0} max={100} onChange={setDensity} unit="%" width={44} />
            <button className="btn small" onClick={reset}>Alles wiederherstellen</button>
            <div className="hint">Tasten: W Krümmen · R Rekonstruieren · E Glätten · C Strudel · S Zusammenziehen · B Aufblasen · [ ] Größe</div>
          </div>
        </div>
        <div className="modal-foot"><div className="flex" /><button className="btn" onClick={closeDialog}>Abbrechen</button><button className="btn primary" onClick={apply}>OK</button></div>
      </div>
    </div>
  );
}
