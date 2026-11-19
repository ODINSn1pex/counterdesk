import { useEffect, useMemo, useRef, useState } from 'react';
import { S, emit, useStore, doc, view, commit, closeDialog, newDocument, IMAGE, EDIT, SELECT, VIEW, exportImage, closeDoc, savePrefs, saveSwatches, setFg, setBg, saveProject, DEFAULT_PREFS, ACCENTS, resetToolOptions, restoreRecovery, L, toast } from '../state.js';
import { feather as selFeather, expand as selExpand, contract as selContract, smooth as selSmooth } from '../engine/selection.js';
import { cloneCanvas } from '../engine/util.js';
import { ADJUSTMENTS, FILTERS, histogram, curveLut } from '../engine/filters.js';
import { BLEND_MODES } from '../engine/doc.js';
import { beginPreview, previewFilter, showOriginal, finishFilter, cancelPreview } from './dialogs/applyFilter.js';
import { Num, Sel, Check, gradientCss } from './OptionsBar.jsx';
import { ColorField } from './Panels.jsx';
import { allShortcuts } from '../commands.js';
import { Blossom, Icon, Logo } from './icons.jsx';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../engine/util.js';

function Modal({ title, children, onOk, onCancel, okLabel = 'OK', width = 420, extra }) {
  const ref = useRef(null);
  const cb = useRef({});
  cb.current = { onOk, onCancel };
  useEffect(() => {
    const k = (e) => {
      const { onOk: ok, onCancel: cancel } = cb.current;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel && cancel(); }
      else if (e.key === 'Enter' && ok && !(e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON'))) {
        e.preventDefault(); e.stopPropagation();
        if (e.target && e.target.blur) e.target.blur();
        setTimeout(() => cb.current.onOk && cb.current.onOk(), 0);
      }
    };
    window.addEventListener('keydown', k, true);
    const first = ref.current && ref.current.querySelector('input:not([type=checkbox]):not([type=range]):not([type=color]):not([readonly])');
    if (first) setTimeout(() => first.focus(), 30);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal" style={{ width }} ref={ref} role="dialog" aria-label={title}>
        <div className="modal-title"><Blossom size={16} /> {title}<div className="flex" /><button className="x" onClick={onCancel}><Icon name="close" size={14} /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          {extra}
          <div className="flex" />
          <button className="btn" onClick={onCancel}>Abbrechen</button>
          {onOk && <button className="btn primary" onClick={onOk}>{okLabel}</button>}
        </div>
      </div>
    </div>
  );
}

export function Dialogs() {
  useStore();
  const dg = S.ui.dialog;
  if (!dg) return null;
  const C = {
    new: NewDocDialog, filter: FilterDialog, imageSize: ImageSizeDialog, canvasSize: CanvasSizeDialog, fill: FillDialog, stroke: StrokeDialog,
    export: ExportDialog, modifySel: ModifySelDialog, colorRange: ColorRangeDialog, layerStyle: LayerStyleDialog, colorPicker: ColorPickerDialog,
    shortcuts: ShortcutsDialog, prefs: PrefsDialog, about: AboutDialog, confirmClose: ConfirmCloseDialog, guide: GuideDialog, histogram: HistogramDialog,
    gradientEditor: GradientEditorDialog, features: FeaturesDialog, appClose: AppCloseDialog, selectMask: SelectMaskDialog, recovery: RecoveryDialog,
  }[dg.type];
  return C ? <C dg={dg} key={dg.type + (dg.id || '') + (dg.tab || '')} /> : null;
}

// ---------------- Neu ----------------
const PRESETS = [
  ['Full HD 1920 × 1080', 1920, 1080], ['4K UHD 3840 × 2160', 3840, 2160], ['Instagram Quadrat 1080 × 1080', 1080, 1080], ['Instagram Story 1080 × 1920', 1080, 1920],
  ['YouTube-Thumbnail 1280 × 720', 1280, 720], ['A4 (300 ppi) 2480 × 3508', 2480, 3508], ['Postkarte 1748 × 1240', 1748, 1240], ['Icon 512 × 512', 512, 512], ['Wallpaper 2560 × 1440', 2560, 1440],
];
function NewDocDialog() {
  const [w, setW] = useState(1920), [h, setH] = useState(1080), [name, setName] = useState(`Unbenannt-${S.docs.length + 1}`), [bg, setBg2] = useState('white'), [color, setColor] = useState('#ffd6ec'), [ppi, setPpi] = useState(S.prefs.defaultPpi || 72);
  const ok = () => { closeDialog(); newDocument({ w, h, name, background: bg, color, ppi }); };
  return (
    <Modal title="Neues Dokument" onOk={ok} onCancel={closeDialog} okLabel="Erstellen" width={620}>
      <div className="nd">
        <div className="nd-presets">
          {PRESETS.map(([n, pw, ph]) => (
            <button key={n} className={'preset' + (w === pw && h === ph ? ' on' : '')} onClick={() => { setW(pw); setH(ph); if (/300 ppi/.test(n)) setPpi(300); }}>
              <span className="pv" style={{ aspectRatio: `${pw}/${ph}` }} />{n}
            </button>
          ))}
        </div>
        <div className="nd-form">
          <label className="field col"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="row"><Num label="Breite" value={w} min={1} max={16000} onChange={setW} unit=" Px" width={70} /><Num label="Höhe" value={h} min={1} max={16000} onChange={setH} unit=" Px" width={70} /></div>
          <button className="btn small" onClick={() => { setW(h); setH(w); }}>⇄ Ausrichtung tauschen</button>
          <Num label="Auflösung" value={ppi} min={1} max={2400} onChange={setPpi} unit=" ppi" width={70} />
          <label className="field col"><span>Hintergrundinhalt</span>
            <Sel value={bg} onChange={setBg2} options={[['white', 'Weiß'], ['black', 'Schwarz'], ['transparent', 'Transparent'], ['color', 'Eigene Farbe']]} width="100%" />
          </label>
          {bg === 'color' && <input type="color" className="color-in big" value={color} onChange={(e) => setColor(e.target.value)} />}
          <div className="hint">{w} × {h} Px · {(w * h * 4 / 1048576).toFixed(1)} MB</div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Filter / Korrekturen mit Vorschau ----------------
function FilterDialog({ dg }) {
  const def = dg.kind === 'adjust' ? ADJUSTMENTS[dg.id] : FILTERS[dg.id];
  const defaults = () => Object.fromEntries(def.params.map((x) => [x.key, x.def]));
  const [p, setP] = useState(() => ({ ...defaults(), ...((S.filterMemory || {})[dg.id] || {}) }));
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const pv = useRef(null);
  const timer = useRef(null);
  const done = useRef(false);
  useEffect(() => { pv.current = beginPreview(); return () => { if (pv.current && !done.current) cancelPreview(pv.current); }; }, []);
  const extra = { fg: S.fg, bg: S.bg };
  useEffect(() => {
    if (!pv.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!preview) { showOriginal(pv.current); return; }
      setBusy(true);
      await previewFilter(pv.current, dg.kind, dg.id, { ...p, ...extra }, S.prefs.fastPreview !== false);
      setBusy(false);
    }, 90);
    return () => clearTimeout(timer.current);
  }, [p, preview]);
  const ok = async () => {
    if (done.current) return;
    done.current = true;
    S.filterMemory = { ...(S.filterMemory || {}), [dg.id]: p };
    clearTimeout(timer.current);
    const cur = pv.current; pv.current = null;
    closeDialog();
    if (!cur) return;
    document.body.classList.add('busy'); S.ui.busy = def.name.replace('…', ''); emit();
    await finishFilter(cur, dg.kind, dg.id, { ...p, ...extra }, def.name.replace('…', ''));
    document.body.classList.remove('busy'); S.ui.busy = null; emit();
  };
  const cancel = () => { if (pv.current) cancelPreview(pv.current); pv.current = null; done.current = true; closeDialog(); };
  if (!doc()) return null;
  return (
    <Modal title={def.name.replace('…', '')} onOk={ok} onCancel={cancel} width={def.custom === 'curves' ? 520 : 460}
      extra={<><Check label="Vorschau" value={preview} onChange={setPreview} /><button className="btn small" onClick={() => setP(defaults())}>Zurücksetzen</button>{busy && <span className="spin" title="Berechne Vorschau…" />}</>}>
      {!pv.current && <div className="hint warn">Diese Ebene kann nicht bearbeitet werden (fixiert oder ausgeblendet).</div>}
      {def.custom === 'levels' && <LevelsHisto p={p} />}
      {def.custom === 'curves' && <CurvesEditor p={p} setP={setP} />}
      <div className="params">
        {def.params.map((x) => (
          <ParamRow key={x.key} x={x} value={p[x.key]} onChange={(v) => setP((old) => ({ ...old, [x.key]: v }))} />
        ))}
        {def.usesColors && <div className="hint">Verwendet Vorder- und Hintergrundfarbe.</div>}
      </div>
    </Modal>
  );
}

export function ParamRow({ x, value, onChange }) {
  if (x.type === 'checkbox') return <Check label={x.label} value={value} onChange={onChange} />;
  if (x.type === 'select') return <label className="prow"><span>{x.label}</span><Sel value={value} onChange={onChange} options={x.options} width={180} /></label>;
  if (x.type === 'color') return <label className="prow"><span>{x.label}</span><input type="color" className="color-in" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
  return (
    <label className="prow slider">
      <span>{x.label}</span>
      <input type="range" min={x.min} max={x.max} step={x.step || 1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input className="pv-num" value={value} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(Math.min(x.max, Math.max(x.min, v))); }} />
    </label>
  );
}

export function LevelsHisto() {
  const d = doc();
  const h = useMemo(() => histogram(d.layer.canvas), []);
  const max = Math.max(...h.l, 1);
  return (
    <svg className="histo big" viewBox="0 0 256 100" preserveAspectRatio="none">
      <path d={'M0 100 ' + Array.from(h.l).map((v, i) => `L${i} ${100 - (v / max) * 96}`).join(' ') + ' L255 100Z'} fill="rgba(240,220,255,0.75)" />
    </svg>
  );
}

export function CurvesEditor({ p, setP }) {
  const [ch, setCh] = useState('rgb');
  const pts = p[ch] || [[0, 0], [255, 255]];
  const ref = useRef(null);
  const d = doc();
  const h = useMemo(() => histogram(d.layer.canvas), []);
  const max = Math.max(...h.l, 1);
  const lut = curveLut(pts);
  const toPt = (e) => { const r = ref.current.getBoundingClientRect(); return [Math.round(Math.min(255, Math.max(0, (e.clientX - r.left) / r.width * 255))), Math.round(Math.min(255, Math.max(0, 255 - (e.clientY - r.top) / r.height * 255)))]; };
  const down = (e) => {
    const q = toPt(e);
    let idx = pts.findIndex((pt) => Math.abs(pt[0] - q[0]) < 10 && Math.abs(pt[1] - q[1]) < 14);
    let arr = pts.map((x) => [...x]);
    if (idx < 0) { arr.push(q); arr.sort((a, b) => a[0] - b[0]); idx = arr.findIndex((x) => x[0] === q[0] && x[1] === q[1]); }
    setP({ ...p, [ch]: arr });
    const mv = (ev) => {
      const nq = toPt(ev);
      const out = ev.clientY > ref.current.getBoundingClientRect().bottom + 30 && idx > 0 && idx < arr.length - 1;
      let a2 = arr.map((x) => [...x]);
      if (out) a2.splice(idx, 1);
      else { const lo = idx > 0 ? a2[idx - 1][0] + 1 : 0, hi = idx < a2.length - 1 ? a2[idx + 1][0] - 1 : 255; a2[idx] = [Math.min(hi, Math.max(lo, nq[0])), nq[1]]; }
      setP({ ...p, [ch]: a2 });
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const col = { rgb: '#fff', r: '#ff6b6b', g: '#6bff8a', b: '#6bb5ff' }[ch];
  return (
    <div className="curves">
      <div className="seg">{[['rgb', 'RGB'], ['r', 'Rot'], ['g', 'Grün'], ['b', 'Blau']].map(([k, n]) => <button key={k} className={ch === k ? 'on' : ''} onClick={() => setCh(k)}>{n}</button>)}</div>
      <svg ref={ref} viewBox="0 0 256 256" className="curve-box" onPointerDown={down}>
        <path d={'M0 256 ' + Array.from(h.l).map((v, i) => `L${i} ${256 - (v / max) * 200}`).join(' ') + ' L255 256Z'} fill="rgba(255,255,255,0.12)" />
        {[64, 128, 192].map((v) => <g key={v}><line x1={v} y1="0" x2={v} y2="256" stroke="rgba(255,255,255,.12)" /><line x1="0" y1={v} x2="256" y2={v} stroke="rgba(255,255,255,.12)" /></g>)}
        <line x1="0" y1="256" x2="256" y2="0" stroke="rgba(255,255,255,.2)" />
        <path d={'M' + Array.from(lut).map((v, i) => `${i} ${255 - v}`).join(' L')} stroke={col} strokeWidth="2" fill="none" />
        {pts.map((pt, i) => <rect key={i} x={pt[0] - 4} y={255 - pt[1] - 4} width="8" height="8" fill="#1b1730" stroke={col} />)}
      </svg>
      <div className="hint">Klicken = Punkt hinzufügen · Ziehen = verändern · nach unten herausziehen = löschen</div>
    </div>
  );
}

// ---------------- Bildgröße / Arbeitsfläche ----------------
function ImageSizeDialog() {
  const d = doc();
  const [w, setW] = useState(d.w), [h, setH] = useState(d.h), [lock, setLock] = useState(true), [unit, setUnit] = useState('px'), [method, setMethod] = useState('high');
  const k = d.h / d.w;
  const ok = () => { closeDialog(); IMAGE.resize(unit === '%' ? d.w * w / 100 : w, unit === '%' ? d.h * h / 100 : h, method); };
  return (
    <Modal title="Bildgröße" onOk={ok} onCancel={closeDialog}>
      <div className="hint">Aktuell: {d.w} × {d.h} Px</div>
      <Sel value={unit} onChange={(u) => { setUnit(u); if (u === '%') { setW(100); setH(100); } else { setW(d.w); setH(d.h); } }} options={[['px', 'Pixel'], ['%', 'Prozent']]} width={120} />
      <div className="row">
        <div className="col">
          <Num label="Breite" value={w} min={1} max={unit === '%' ? 1000 : 16000} onChange={(v) => { setW(v); if (lock) setH(unit === '%' ? v : Math.round(v * k)); }} width={70} />
          <Num label="Höhe" value={h} min={1} max={unit === '%' ? 1000 : 16000} onChange={(v) => { setH(v); if (lock) setW(unit === '%' ? v : Math.round(v / k)); }} width={70} />
        </div>
        <button className={'link-btn' + (lock ? ' on' : '')} onClick={() => setLock(!lock)} title="Proportionen beibehalten"><Icon name="link" size={16} /></button>
      </div>
      <label className="prow"><span>Neu berechnen</span><Sel value={method} onChange={setMethod} options={[['high', 'Bikubisch (glatt)'], ['nearest', 'Pixelwiederholung (hart)']]} width={200} /></label>
    </Modal>
  );
}

function CanvasSizeDialog() {
  const d = doc();
  const [w, setW] = useState(d.w), [h, setH] = useState(d.h), [ax, setAx] = useState(0.5), [ay, setAy] = useState(0.5), [rel, setRel] = useState(false), [fill, setFill] = useState(S.bg);
  const ok = () => { closeDialog(); IMAGE.canvasSize(rel ? d.w + w : w, rel ? d.h + h : h, ax, ay, fill); };
  return (
    <Modal title="Arbeitsfläche" onOk={ok} onCancel={closeDialog}>
      <div className="hint">Aktuelle Größe: {d.w} × {d.h} Px</div>
      <Check label="Relativ" value={rel} onChange={(v) => { setRel(v); setW(v ? 0 : d.w); setH(v ? 0 : d.h); }} />
      <div className="row"><Num label="Breite" value={w} min={rel ? -16000 : 1} max={16000} onChange={setW} unit=" Px" width={70} /><Num label="Höhe" value={h} min={rel ? -16000 : 1} max={16000} onChange={setH} unit=" Px" width={70} /></div>
      <div className="row">
        <span className="lbl">Anker:</span>
        <div className="anchor">
          {[0, 0.5, 1].map((yy) => [0, 0.5, 1].map((xx) => <button key={xx + '-' + yy} className={ax === xx && ay === yy ? 'on' : ''} onClick={() => { setAx(xx); setAy(yy); }} />))}
        </div>
        <span className="lbl">Erweiterungsfarbe:</span><input type="color" className="color-in" value={fill} onChange={(e) => setFill(e.target.value)} />
      </div>
    </Modal>
  );
}

// ---------------- Fläche / Kontur ----------------
function FillDialog() {
  const [src, setSrc] = useState('fg'), [mode, setMode] = useState('normal'), [op, setOp] = useState(100), [color, setColor] = useState(S.fg);
  const ok = () => { closeDialog(); EDIT.fill(src, op / 100, mode, color); };
  return (
    <Modal title="Fläche füllen" onOk={ok} onCancel={closeDialog}>
      <label className="prow"><span>Inhalt</span><Sel value={src} onChange={setSrc} options={[['fg', 'Vordergrundfarbe'], ['bg', 'Hintergrundfarbe'], ['color', 'Farbe…'], ['content', 'Inhaltsbasiert'], ['pattern', 'Muster'], ['black', 'Schwarz'], ['gray', '50 % Grau'], ['white', 'Weiß']]} width={200} /></label>
      {src === 'color' && <label className="prow"><span>Farbe</span><input type="color" className="color-in" value={color} onChange={(e) => setColor(e.target.value)} /></label>}
      {src !== 'content' && <>
        <label className="prow"><span>Modus</span><Sel value={mode} onChange={setMode} options={BLEND_MODES} width={200} /></label>
        <Num label="Deckkraft" value={op} onChange={setOp} unit="%" />
      </>}
    </Modal>
  );
}

function StrokeDialog() {
  const [w, setW] = useState(4), [c, setC] = useState(S.fg), [loc, setLoc] = useState('center');
  const ok = () => { closeDialog(); EDIT.stroke(w, c, loc); };
  return (
    <Modal title="Kontur füllen" onOk={ok} onCancel={closeDialog}>
      <Num label="Breite" value={w} min={1} max={250} onChange={setW} unit=" Px" />
      <label className="prow"><span>Farbe</span><input type="color" className="color-in" value={c} onChange={(e) => setC(e.target.value)} /></label>
      <label className="prow"><span>Position</span><Sel value={loc} onChange={setLoc} options={[['inside', 'Innen'], ['center', 'Mitte'], ['outside', 'Außen']]} width={160} /></label>
    </Modal>
  );
}

// ---------------- Export ----------------
function ExportDialog() {
  const [fmt, setFmt] = useState('png'), [q, setQ] = useState(90), [scale, setScale] = useState(100), [transp, setTransp] = useState(true);
  const d = doc();
  const ok = () => { closeDialog(); exportImage(fmt, q / 100, scale / 100, transp); };
  return (
    <Modal title="Exportieren als" onOk={ok} onCancel={closeDialog} okLabel="Exportieren…">
      <label className="prow"><span>Format</span><Sel value={fmt} onChange={setFmt} options={[['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]} width={160} /></label>
      {fmt !== 'png' && <Num label="Qualität" value={q} min={1} max={100} onChange={setQ} unit="%" />}
      {fmt !== 'jpeg' && <Check label="Transparenz" value={transp} onChange={setTransp} />}
      <Num label="Skalierung" value={scale} min={1} max={400} onChange={setScale} unit="%" />
      <div className="hint">Ergebnis: {Math.round(d.w * scale / 100)} × {Math.round(d.h * scale / 100)} Px</div>
      <button className="btn small" onClick={() => { closeDialog(); import('../state.js').then((m) => m.exportPsd()); }}>Stattdessen als PSD (mit Ebenen) speichern…</button>
    </Modal>
  );
}

// ---------------- Auswahl ----------------
function ModifySelDialog({ dg }) {
  const [r, setR] = useState(dg.kind === 'feather' ? 10 : 5);
  const t = { feather: 'Weiche Auswahlkante', expand: 'Auswahl erweitern', contract: 'Auswahl verkleinern', smooth: 'Auswahl abrunden', border: 'Auswahlumrandung' }[dg.kind];
  return (
    <Modal title={t} onOk={() => { closeDialog(); SELECT.modify(dg.kind, r); }} onCancel={closeDialog}>
      <Num label={dg.kind === 'feather' ? 'Radius' : 'Um'} value={r} min={0.1} max={500} step={0.1} onChange={setR} unit=" Px" width={60} />
    </Modal>
  );
}

function ColorRangeDialog() {
  const [c, setC] = useState(S.fg), [f, setF] = useState(40);
  return (
    <Modal title="Farbbereich" onOk={() => { closeDialog(); SELECT.colorRange(c, f); }} onCancel={closeDialog}>
      <label className="prow"><span>Farbe</span><input type="color" className="color-in" value={c} onChange={(e) => setC(e.target.value)} /></label>
      <Num label="Toleranz" value={f} min={0} max={200} onChange={setF} />
      <div className="hint">Tipp: Mit der Pipette (I) eine Bildfarbe als Vordergrundfarbe wählen.</div>
    </Modal>
  );
}

// ---------------- Ebenenstil ----------------
const FX_DEFS = {
  shadow: { name: 'Schlagschatten', def: { enabled: true, color: '#000000', opacity: 0.75, angle: 120, distance: 10, size: 12 } },
  glow: { name: 'Schein nach außen', def: { enabled: true, color: '#ffc1e3', opacity: 0.8, size: 18 } },
  stroke: { name: 'Kontur', def: { enabled: true, color: '#ffffff', opacity: 1, size: 3 } },
  inner: { name: 'Schatten nach innen', def: { enabled: true, color: '#000000', opacity: 0.6, size: 10 } },
  overlay: { name: 'Farbüberlagerung', def: { enabled: true, color: '#e57fb8', opacity: 1 } },
  gradient: { name: 'Verlaufsüberlagerung', def: { enabled: true, color1: '#ffd6ec', color2: '#6a3fa0', opacity: 1 } },
};
function LayerStyleDialog({ dg }) {
  const d = doc(); const l = d.layer;
  const orig = useRef({ fx: JSON.parse(JSON.stringify(l.fx || {})), blend: l.blend, opacity: l.opacity, fill: l.fill });
  const [tab, setTab] = useState(dg.tab || 'shadow');
  const [, force] = useState(0);
  useEffect(() => { if (tab !== 'blend' && !l.fx[tab]) { l.fx[tab] = { ...FX_DEFS[tab].def }; upd(); } }, [tab]);
  const upd = () => { l.touch(); view.request(); force((x) => x + 1); emit(); };
  const f = l.fx[tab];
  const set = (k) => (v) => { f[k] = v; upd(); };
  const cancel = () => { Object.assign(l, { fx: orig.current.fx, blend: orig.current.blend, opacity: orig.current.opacity, fill: orig.current.fill }); upd(); closeDialog(); };
  const ok = () => { closeDialog(); commit('Ebenenstil'); };
  return (
    <Modal title={`Ebenenstil – ${l.name}`} onOk={ok} onCancel={cancel} width={600}>
      <div className="ls">
        <div className="ls-list">
          <button className={tab === 'blend' ? 'on' : ''} onClick={() => setTab('blend')}>Fülloptionen</button>
          {Object.entries(FX_DEFS).map(([k, v]) => (
            <div key={k} className={'ls-item' + (tab === k ? ' on' : '')}>
              <input type="checkbox" checked={!!(l.fx[k] && l.fx[k].enabled)} onChange={(e) => { if (!l.fx[k]) l.fx[k] = { ...v.def }; l.fx[k].enabled = e.target.checked; upd(); }} />
              <button onClick={() => setTab(k)}>{v.name}</button>
            </div>
          ))}
        </div>
        <div className="ls-body">
          {tab === 'blend' ? <>
            <label className="prow"><span>Füllmethode</span><Sel value={l.blend} onChange={(v) => { l.blend = v; upd(); }} options={BLEND_MODES} width={200} /></label>
            <Num label="Deckkraft" value={Math.round(l.opacity * 100)} onChange={(v) => { l.opacity = v / 100; upd(); }} unit="%" />
            <Num label="Flächendeckkraft" value={Math.round(l.fill * 100)} onChange={(v) => { l.fill = v / 100; upd(); }} unit="%" />
            <Check label="Schnittmaske (an Ebene darunter)" value={l.clip} onChange={(v) => { l.clip = v; upd(); }} />
          </> : f ? <>
            <h4>{FX_DEFS[tab].name}</h4>
            {'color' in f && <label className="prow"><span>Farbe</span><input type="color" className="color-in" value={f.color} onChange={(e) => set('color')(e.target.value)} /></label>}
            {'color1' in f && <label className="prow"><span>Verlauf</span><input type="color" className="color-in" value={f.color1} onChange={(e) => set('color1')(e.target.value)} /><input type="color" className="color-in" value={f.color2} onChange={(e) => set('color2')(e.target.value)} /></label>}
            <Num label="Deckkraft" value={Math.round(f.opacity * 100)} onChange={(v) => set('opacity')(v / 100)} unit="%" />
            {'angle' in f && <Num label="Winkel" value={f.angle} min={-180} max={180} onChange={set('angle')} unit="°" />}
            {'distance' in f && <Num label="Distanz" value={f.distance} min={0} max={300} onChange={set('distance')} unit=" Px" />}
            {'size' in f && <Num label="Größe" value={f.size} min={0} max={250} onChange={set('size')} unit=" Px" />}
          </> : null}
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Farbwähler ----------------
function ColorPickerDialog({ dg }) {
  const [c, setC] = useState(dg.target === 'bg' ? S.bg : S.fg);
  const { r, g, b } = hexToRgb(c);
  const hsv = rgbToHsv(r, g, b);
  const ok = () => { closeDialog(); if (dg.target === 'bg') setBg(c); else setFg(c); };
  return (
    <Modal title={`Farbwähler (${dg.target === 'bg' ? 'Hintergrundfarbe' : 'Vordergrundfarbe'})`} onOk={ok} onCancel={closeDialog} width={520}>
      <div className="cpick">
        <ColorField color={c} onChange={setC} height={256} />
        <div className="cpick-side">
          <div className="cmp"><span style={{ background: c }}>neu</span><span style={{ background: dg.target === 'bg' ? S.bg : S.fg }}>aktuell</span></div>
          <Num label="H" value={Math.round(hsv.h)} min={0} max={359} onChange={(v) => { const q = hsvToRgb(v, hsv.s, hsv.v); setC(rgbToHex(q.r, q.g, q.b)); }} unit="°" width={44} />
          <Num label="S" value={Math.round(hsv.s * 100)} onChange={(v) => { const q = hsvToRgb(hsv.h, v / 100, hsv.v); setC(rgbToHex(q.r, q.g, q.b)); }} unit="%" width={44} />
          <Num label="B" value={Math.round(hsv.v * 100)} onChange={(v) => { const q = hsvToRgb(hsv.h, hsv.s, v / 100); setC(rgbToHex(q.r, q.g, q.b)); }} unit="%" width={44} />
          <Num label="R" value={r} max={255} onChange={(v) => setC(rgbToHex(v, g, b))} width={44} />
          <Num label="G" value={g} max={255} onChange={(v) => setC(rgbToHex(r, v, b))} width={44} />
          <Num label="B" value={b} max={255} onChange={(v) => setC(rgbToHex(r, g, v))} width={44} />
          <label className="num"><span className="num-label">#</span><input style={{ width: 70 }} defaultValue={c.slice(1)} key={c} onBlur={(e) => { const v = e.target.value.replace(/[^0-9a-f]/gi, ''); if (v.length === 6) setC('#' + v.toLowerCase()); }} /></label>
          <button className="btn small" onClick={() => { S.swatches.push(c); saveSwatches(); }}>Zu Farbfeldern</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Verlaufseditor ----------------
function GradientEditorDialog() {
  const base = S.gradients[S.gradient.index];
  const [name, setName] = useState((base.name || 'Verlauf') + ' Kopie');
  const [stops, setStops] = useState(() => (base.stops && base.stops.length ? base.stops : [{ p: 0, c: S.fg }, { p: 1, c: S.bg }]).map((s) => ({ ...s, c: s.c.startsWith('#') ? s.c : '#ffffff' })));
  const [sel, setSel] = useState(0);
  const ok = () => { S.gradients.push({ name, stops: [...stops].sort((a, b) => a.p - b.p) }); S.gradient.index = S.gradients.length - 1; saveSwatches(); closeDialog(); };
  const g = { stops: [...stops].sort((a, b) => a.p - b.p) };
  return (
    <Modal title="Verlaufseditor" onOk={ok} onCancel={closeDialog} okLabel="Neu speichern" width={520}>
      <label className="field col"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="gbar" style={{ background: gradientCss(g) }} onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const p = (e.clientX - r.left) / r.width; setStops([...stops, { p, c: S.fg }]); setSel(stops.length); }}>
        {stops.map((s, i) => <span key={i} className={'gstop' + (sel === i ? ' on' : '')} style={{ left: `${s.p * 100}%`, background: s.c }} onMouseDown={(e) => {
          setSel(i); const bar = e.currentTarget.parentElement.getBoundingClientRect();
          const mv = (ev) => { const p = Math.min(1, Math.max(0, (ev.clientX - bar.left) / bar.width)); setStops((st) => st.map((x, j) => (j === i ? { ...x, p } : x))); };
          const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
        }} />)}
      </div>
      <div className="hint">Doppelklick auf die Leiste fügt eine Farbe hinzu.</div>
      {stops[sel] && <div className="row">
        <span className="lbl">Farbe:</span><input type="color" className="color-in" value={stops[sel].c} onChange={(e) => setStops(stops.map((x, j) => (j === sel ? { ...x, c: e.target.value } : x)))} />
        <Num label="Position" value={Math.round(stops[sel].p * 100)} onChange={(v) => setStops(stops.map((x, j) => (j === sel ? { ...x, p: v / 100 } : x)))} unit="%" />
        <button className="btn small" disabled={stops.length <= 2} onClick={() => { setStops(stops.filter((_, j) => j !== sel)); setSel(0); }}>Löschen</button>
      </div>}
    </Modal>
  );
}

// ---------------- Sonstige ----------------
function ShortcutsDialog() {
  const rows = allShortcuts();
  const tools = [['V', 'Verschieben'], ['M', 'Auswahlrechteck/-ellipse'], ['L', 'Lasso/Polygon-Lasso'], ['W', 'Schnellauswahl/Zauberstab/Objekt'], ['C', 'Freistellen'], ['I', 'Pipette/Lineal'], ['J', 'Reparatur-Pinsel'], ['B', 'Pinsel/Buntstift/Farbe ersetzen'], ['S', 'Kopier-/Musterstempel'], ['Y', 'Protokollpinsel'], ['E', 'Radiergummi'], ['G', 'Verlauf/Füllen'], ['R', 'Weichzeichner/Scharfzeichner/Wischfinger'], ['O', 'Abwedler/Nachbelichter/Schwamm'], ['P', 'Zeichenstift'], ['T', 'Text'], ['A', 'Direktauswahl'], ['U', 'Formen'], ['H', 'Hand'], ['Z', 'Zoom'], ['Umschalt + Taste', 'Werkzeug in Gruppe wechseln'], ['Leertaste', 'Temporär Hand-Werkzeug'], ['[ / ]', 'Pinselgröße'], ['0–9', 'Deckkraft'], ['X', 'Farben tauschen'], ['D', 'Standardfarben'], ['Q', 'Maskierungsmodus'], ['F', 'Bildschirmmodus'], ['Tab', 'Bedienfelder ein/aus'], ['Alt (Pinsel)', 'Pipette'], ['Strg+Klick (Verschieben)', 'Ebene automatisch wählen'], ['Pfeiltasten', 'Ebene um 1 Px (Umschalt: 10 Px) verschieben'], ['Strg+Mausrad / Alt+Mausrad', 'Zoomen']];
  return (
    <Modal title="Tastaturbefehle" onCancel={closeDialog} width={720}>
      <div className="sc-grid">
        <div><h4>Werkzeuge</h4><table className="sc"><tbody>{tools.map(([k, n]) => <tr key={k}><td>{n}</td><td><kbd>{k}</kbd></td></tr>)}</tbody></table></div>
        <div><h4>Menübefehle</h4><table className="sc"><tbody>{rows.map(([m, n, k], i) => <tr key={i}><td><span className="muted">{m} › </span>{n}</td><td><kbd>{k}</kbd></td></tr>)}</tbody></table></div>
      </div>
    </Modal>
  );
}

function Row({ label, children, hint }) { return <div className="pref-row"><span className="pref-label">{label}</span><div className="pref-ctl">{children}{hint && <div className="hint">{hint}</div>}</div></div>; }

const PREF_CATS = [['general', 'Allgemein'], ['ui', 'Benutzeroberfläche'], ['tools', 'Werkzeuge'], ['perf', 'Leistung'], ['grid', 'Transparenz & Raster'], ['units', 'Einheiten & Lineale'], ['files', 'Dateien'], ['reset', 'Zurücksetzen']];
function PrefsDialog({ dg }) {
  useStore();
  const [cat, setCat] = useState(dg.cat || 'general');
  const p = S.prefs;
  const set = (k) => (v) => { p[k] = v; savePrefs(); };
  const chooseDir = async () => { if (!window.native) { toast('Nur in der Desktop-App'); return; } const d = await window.native.chooseFolder({ title: 'Standard-Speicherordner wählen', defaultPath: p.saveDir || undefined }); if (d) set('saveDir')(d); };
  return (
    <Modal title="Voreinstellungen" onCancel={closeDialog} onOk={closeDialog} width={760}>
      <div className="prefs">
        <div className="prefs-nav">{PREF_CATS.map(([k, n]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{n}</button>)}</div>
        <div className="prefs-body">
          {cat === 'general' && <>
            <h4>Allgemein</h4>
            <Row label="Startbildschirm"><Check label="Startbildschirm anzeigen, wenn kein Dokument offen ist" value={p.showWelcome} onChange={set('showWelcome')} /></Row>
            <Row label="Automatisch sichern" hint="Ungespeicherte Dokumente werden für die Wiederherstellung nach einem Absturz gesichert."><Sel value={String(p.autoSaveMin)} onChange={(v) => set('autoSaveMin')(Number(v))} options={[['0', 'Aus'], ['1', 'Jede Minute'], ['3', 'Alle 3 Minuten'], ['5', 'Alle 5 Minuten'], ['10', 'Alle 10 Minuten']]} width={200} /></Row>
            <Row label="Protokollobjekte" hint="Mehr Schritte benötigen mehr Arbeitsspeicher."><Num value={p.historyStates} min={5} max={300} onChange={set('historyStates')} width={60} /></Row>
            <Row label="Zuletzt verwendet"><Num value={p.recentCount} min={0} max={30} onChange={set('recentCount')} unit=" Dateien" width={70} /></Row>
            <Row label="Beim Beenden"><Check label="Bei ungespeicherten Änderungen nachfragen" value={p.confirmClose} onChange={set('confirmClose')} /></Row>
            <Row label="Tutorial"><button className="btn small" onClick={() => { localStorage.removeItem('sakura.tutorialDone'); S.ui.tutorial = true; closeDialog(); }}>Tutorial jetzt erneut anzeigen</button></Row>
          </>}
          {cat === 'ui' && <>
            <h4>Benutzeroberfläche</h4>
            <Row label="Farbschema">
              <div className="theme-grid">
                {[['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'Wie System'], ['anime', 'Anime · Sakura-Nacht'], ['anime-day', 'Anime · Sakura-Tag']].map(([k, n]) => (
                  <button key={k} className={'theme-card t-' + k + (p.theme === k ? ' on' : '')} onClick={() => set('theme')(k)}><span className="tc-prev"><i /><i /><i /></span>{n}</button>
                ))}
              </div>
            </Row>
            <Row label="Akzentfarbe">
              <div className="accents">
                <button className={'acc auto' + (p.accent === 'auto' ? ' on' : '')} onClick={() => set('accent')('auto')} title="Automatisch (passend zum Farbschema)">A</button>
                {Object.entries(ACCENTS).map(([k, c]) => <button key={k} className={'acc' + (p.accent === k ? ' on' : '')} style={{ background: c[0] }} title={k} onClick={() => set('accent')(k)} />)}
              </div>
            </Row>
            <Row label="Skalierung der Oberfläche" hint={window.native ? '' : 'Nur in der Desktop-App wirksam.'}><Sel value={String(p.uiScale)} onChange={(v) => set('uiScale')(Number(v))} options={[['0.8', '80 %'], ['0.9', '90 %'], ['1', '100 %'], ['1.1', '110 %'], ['1.25', '125 %'], ['1.5', '150 %']]} width={120} /></Row>
            <Row label="Ebenen-Miniaturen"><Sel value={p.thumbSize} onChange={set('thumbSize')} options={[['small', 'Klein'], ['medium', 'Mittel'], ['large', 'Groß']]} width={120} /></Row>
            <Row label="Animationen"><Check label="Bewegungen reduzieren (keine Animationen)" value={p.reduceMotion} onChange={set('reduceMotion')} /></Row>
            <Row label="Anime-Theme"><Check label="Fallende Kirschblüten auf dem Startbildschirm" value={p.sakuraPetals} onChange={set('sakuraPetals')} /></Row>
            <Row label="QuickInfos"><Check label="QuickInfos (Tooltips) anzeigen" value={p.tooltips} onChange={set('tooltips')} /></Row>
          </>}
          {cat === 'tools' && <>
            <h4>Werkzeuge</h4>
            <Row label="Mausrad"><Sel value={p.wheelZoom ? 'zoom' : 'scroll'} onChange={(v) => set('wheelZoom')(v === 'zoom')} options={[['scroll', 'Scrollen (Strg/Alt + Rad = Zoom)'], ['zoom', 'Zoomen (Umschalt + Rad = Scrollen)']]} width={300} /></Row>
            <Row label="Zoom"><Check label="Animiertes Zoomen" value={p.animatedZoom} onChange={set('animatedZoom')} /></Row>
            <Row label="Malwerkzeug-Cursor"><Sel value={p.brushCursor} onChange={set('brushCursor')} options={[['normal', 'Pinselspitze (Kreis)'], ['both', 'Pinselspitze + Fadenkreuz'], ['cross', 'Präzise (Fadenkreuz)']]} width={240} /></Row>
            <Row label="Grafiktablett"><Check label="Stiftdruck steuert Größe" value={p.pressureSize} onChange={set('pressureSize')} /><Check label="Stiftdruck steuert Deckkraft" value={p.pressureOpacity} onChange={set('pressureOpacity')} /></Row>
            <Row label="Transformieren" hint="Umschalttaste kehrt das Verhalten jeweils um."><Check label="Ecken proportional skalieren" value={p.proportionalTransform} onChange={set('proportionalTransform')} /></Row>
            <Row label="Pfeiltasten"><Num label="Umschalt + Pfeil:" value={p.nudgeStep} min={2} max={200} onChange={set('nudgeStep')} unit=" Px" width={56} /></Row>
            <Row label="Einrasten"><Num label="Abstand:" value={p.snapDistance} min={1} max={30} onChange={set('snapDistance')} unit=" Px" width={50} /></Row>
            <Row label="Werkzeugoptionen"><button className="btn small" onClick={() => resetToolOptions(true)}>Alle Werkzeuge zurücksetzen</button></Row>
          </>}
          {cat === 'perf' && <>
            <h4>Leistung</h4>
            <Row label="Filtervorschau" hint="Bei großen Bildern wird die Vorschau verkleinert berechnet – das Ergebnis wird immer in voller Auflösung angewendet."><Check label="Schnelle Vorschau bei großen Bildern" value={p.fastPreview} onChange={set('fastPreview')} /></Row>
            <Row label="Grafikprozessor" hint="Änderung wird nach einem Neustart wirksam. Nur bei Darstellungsfehlern deaktivieren."><Check label="Hardwarebeschleunigung verwenden" value={p.hardwareAcceleration} onChange={(v) => { set('hardwareAcceleration')(v); if (window.native && window.native.setMainSetting) window.native.setMainSetting('hardwareAcceleration', v); }} /></Row>
            <Row label="Protokoll" hint="Weniger Schritte = weniger Arbeitsspeicher."><Num value={p.historyStates} min={5} max={300} onChange={set('historyStates')} width={60} /></Row>
          </>}
          {cat === 'grid' && <>
            <h4>Transparenz & Raster</h4>
            <Row label="Schachbrett-Größe"><Sel value={p.checker} onChange={set('checker')} options={[['small', 'Klein'], ['medium', 'Mittel'], ['large', 'Groß']]} width={120} /></Row>
            <Row label="Schachbrett-Farbe"><Sel value={p.checkerTone} onChange={set('checkerTone')} options={[['light', 'Hell'], ['medium', 'Mittel'], ['dark', 'Dunkel']]} width={120} /></Row>
            <Row label="Raster"><Num label="Abstand:" value={p.gridSpacing} min={2} max={2000} onChange={set('gridSpacing')} unit=" Px" width={56} /><Num label="Unterteilungen:" value={p.gridSub} min={1} max={20} onChange={set('gridSub')} width={40} /></Row>
            <Row label="Farben"><label className="chk">Raster <input type="color" className="color-in" value={p.gridColor} onChange={(e) => set('gridColor')(e.target.value)} /></label><label className="chk">Hilfslinien <input type="color" className="color-in" value={p.guideColor} onChange={(e) => set('guideColor')(e.target.value)} /></label></Row>
            <Row label="Pixelraster"><Check label="Pixelraster ab 800 % Zoom anzeigen" value={p.pixelGrid} onChange={set('pixelGrid')} /></Row>
          </>}
          {cat === 'units' && <>
            <h4>Einheiten & Lineale</h4>
            <Row label="Lineale & Anzeige"><Sel value={p.units} onChange={set('units')} options={[['px', 'Pixel'], ['cm', 'Zentimeter'], ['mm', 'Millimeter'], ['in', 'Zoll'], ['pt', 'Punkt'], ['%', 'Prozent']]} width={160} /></Row>
            <Row label="Auflösung neuer Dokumente"><Num value={p.defaultPpi} min={1} max={2400} onChange={set('defaultPpi')} unit=" ppi" width={64} /></Row>
            {doc() && <Row label="Aktuelles Dokument" hint="Ändert nur die Angabe für Druck/Einheiten, nicht die Pixel."><Num value={doc().ppi} min={1} max={2400} onChange={(v) => { doc().ppi = v; view.request(); emit(); }} unit=" ppi" width={64} /></Row>}
          </>}
          {cat === 'files' && <>
            <h4>Dateien</h4>
            <Row label="Standard-Speicherordner" hint={p.saveDir ? '' : 'Standard: Desktop\\Sakura Studio\\Projekte'}>
              <div className="row"><input className="path-in" readOnly value={p.saveDir || '(Standard)'} /><button className="btn small" onClick={chooseDir}>Ändern…</button>{p.saveDir && <button className="btn small" onClick={() => set('saveDir')('')}>Standard</button>}</div>
            </Row>
            <Row label="Export-Format (Schnell-Export)"><Sel value={p.exportFormat} onChange={set('exportFormat')} options={[['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]} width={120} /></Row>
            <Row label="JPG/WebP-Qualität"><Num value={p.jpgQuality} min={1} max={100} onChange={set('jpgQuality')} unit=" %" width={50} /></Row>
          </>}
          {cat === 'reset' && <>
            <h4>Zurücksetzen</h4>
            <Row label="Voreinstellungen"><button className="btn small" onClick={() => { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, DEFAULT_PREFS); savePrefs(); toast('Voreinstellungen zurückgesetzt'); }}>Alle Voreinstellungen zurücksetzen</button></Row>
            <Row label="Werkzeuge"><button className="btn small" onClick={() => resetToolOptions(true)}>Alle Werkzeugoptionen zurücksetzen</button></Row>
            <Row label="Farbfelder & Verläufe"><button className="btn small" onClick={() => { import('../state.js').then((m) => { S.swatches = [...m.DEFAULT_SWATCHES]; S.gradients = [...m.DEFAULT_GRADIENTS]; S.gradient.index = 0; saveSwatches(); toast('Farbfelder & Verläufe zurückgesetzt'); }); }}>Auf Standard zurücksetzen</button></Row>
            <Row label="Arbeitsbereich"><button className="btn small" onClick={() => { S.ui.hiddenPanels = {}; S.ui.flyout = null; localStorage.removeItem('sakura.hiddenPanels'); emit(); toast('Arbeitsbereich zurückgesetzt'); }}>Bedienfelder zurücksetzen</button></Row>
          </>}
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Auswählen und maskieren ----------------
function SelectMaskDialog() {
  const d = doc();
  const orig = useRef(d && d.selection ? cloneCanvas(d.selection) : null);
  const [smoothR, setSmooth] = useState(0), [featherR, setFeather] = useState(0), [shift, setShift] = useState(0), [out, setOut] = useState('selection');
  const compute = () => {
    let c = orig.current; if (!c) return null;
    if (smoothR > 0) c = selSmooth(c, smoothR);
    if (shift > 0) c = selExpand(c, shift * 0.5); else if (shift < 0) c = selContract(c, -shift * 0.5);
    if (featherR > 0) c = selFeather(c, featherR);
    return c;
  };
  useEffect(() => { if (!orig.current) return; const t = setTimeout(() => { const c = compute(); if (c) { d.setSelection(c); view.request(); } }, 60); return () => clearTimeout(t); }, [smoothR, featherR, shift]);
  const cancel = () => { if (orig.current) { d.setSelection(orig.current); view.request(); } closeDialog(); };
  const ok = () => {
    closeDialog();
    if (!orig.current) return;
    if (out === 'mask') { L.addMask(true); d.deselect(); commit('Auswahl als Maske'); }
    else if (out === 'layer') { L.viaCopy(false); }
    else commit('Auswählen und maskieren');
  };
  if (!d) return null;
  return (
    <Modal title="Auswählen und maskieren" onOk={ok} onCancel={cancel} width={440}>
      {!orig.current ? <div className="hint warn">Erstelle zuerst eine Auswahl (z. B. mit der Schnellauswahl W).</div> : <>
        <div className="hint">Kante verfeinern – Änderungen sind sofort sichtbar.</div>
        <ParamRow x={{ label: 'Abrunden', min: 0, max: 50 }} value={smoothR} onChange={setSmooth} />
        <ParamRow x={{ label: 'Weiche Kante (Px)', min: 0, max: 100, step: 0.5 }} value={featherR} onChange={setFeather} />
        <ParamRow x={{ label: 'Kante verschieben', min: -100, max: 100 }} value={shift} onChange={setShift} />
        <label className="prow"><span>Ausgabe an</span><Sel value={out} onChange={setOut} options={[['selection', 'Auswahl'], ['mask', 'Ebenenmaske'], ['layer', 'Neue Ebene']]} width={180} /></label>
      </>}
    </Modal>
  );
}

// ---------------- Wiederherstellung ----------------
function RecoveryDialog({ dg }) {
  const items = dg.items || [];
  return (
    <Modal title="Dokumente wiederherstellen" onCancel={async () => { if (window.native) await window.native.recoveryClear(); closeDialog(); }} onOk={() => { closeDialog(); restoreRecovery(items); }} okLabel="Wiederherstellen">
      <p>Sakura Studio wurde nicht ordnungsgemäß beendet. Folgende ungespeicherte Dokumente können wiederhergestellt werden:</p>
      <ul className="rec-list">{items.map((it) => { let n = it.name; try { n = JSON.parse(new TextDecoder().decode(new Uint8Array(it.data))).name; } catch (e) { /* */ } return <li key={it.name}>{n}</li>; })}</ul>
      <div className="hint">„Abbrechen“ verwirft die Sicherungen.</div>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title="Über Sakura Studio" onCancel={closeDialog} width={480}>
      <div className="about">
        <Logo size={64} />
        <h2>Sakura Studio</h2>
        <div>Version 1.1.0 · Bildbearbeitung für Windows</div>
        <p>Ebenen, Masken, Auswahlen, Pinsel, Retusche, Text, Formen, Pfade, über 50 Korrekturen & Filter, PSD-Import/-Export und mehr.</p>
        <p className="muted">Arbeitsordner: Desktop\Sakura Studio\Projekte · Einstellungen: Bearbeiten › Voreinstellungen (Strg+K)</p>
        <details className="licenses"><summary>Open-Source-Komponenten</summary>
          <ul>
            <li>Electron – MIT-Lizenz</li><li>Chromium – BSD-Lizenz u. a. (siehe LICENSES.chromium.html im Programmordner)</li>
            <li>React, React DOM – MIT-Lizenz</li><li>ag-psd – MIT-Lizenz</li><li>Vite – MIT-Lizenz (nur Entwicklung)</li>
          </ul>
        </details>
      </div>
    </Modal>
  );
}

function FeaturesDialog() {
  const groups = [
    ['Datei', 'Neu (Vorlagen), Öffnen (PNG, JPG, WebP, GIF, BMP, SVG, PSD, .sakura), Zuletzt geöffnet, Speichern als Projekt, PSD mit Ebenen speichern, Export PNG/JPG/WebP mit Qualität & Skalierung, Ebenen als Dateien exportieren, Platzieren, Drag & Drop, Drucken'],
    ['Ebenen', 'Neue Ebene, Ebene durch Kopie/Ausschneiden, Duplizieren, Löschen, 19 Füllmethoden, Deckkraft, Flächendeckkraft, 4 Fixierungen, Ebenenmasken (malen, umkehren, anwenden), Schnittmasken, Füllebenen (Farbe/Verlauf/Muster), Anordnen, Ausrichten, Reduzieren, Sichtbare stempeln, Ebenenstile (Schlagschatten, Schein, Kontur, Schatten innen, Farb- und Verlaufsüberlagerung)'],
    ['Auswahl', 'Rechteck, Ellipse, Zeile, Spalte, Lasso, Polygon-Lasso, Schnellauswahl, Zauberstab, Objektauswahl, Motiv, Farbbereich, Hinzufügen/Subtrahieren/Schnittmenge, Weiche Kante, Erweitern, Verkleinern, Abrunden, Umrandung, Umkehren, Erneut auswählen, Maskierungsmodus, Auswahl speichern/laden (Alphakanäle)'],
    ['Malen & Retusche', 'Pinsel (Größe, Härte, Winkel, Rundheit, Abstand, Streuung, Jitter, Glättung, Stifdruck), Buntstift, Farbe ersetzen, Radiergummi, Hintergrund-Radiergummi, Magischer Radiergummi, Verlauf (5 Arten), Füllwerkzeug, Kopierstempel, Musterstempel, Protokollpinsel, Bereichsreparatur, Reparatur-Pinsel, Rote Augen, Weichzeichner, Scharfzeichner, Wischfinger, Abwedler, Nachbelichter, Schwamm'],
    ['Transformieren', 'Frei transformieren (Skalieren, Drehen, Neigen, Spiegeln), 90°/180°, Bildgröße, Arbeitsfläche, Bilddrehung, Freistellen mit Seitenverhältnis, Zuschneiden, Gerade ausrichten mit Lineal'],
    ['Korrekturen', 'Helligkeit/Kontrast, Tonwertkorrektur, Gradationskurven (RGB & Kanäle), Belichtung, Dynamik, Farbton/Sättigung, Farbbalance, Schwarzweiß, Fotofilter, Kanalmixer, Umkehren, Tontrennung, Schwellenwert, Verlaufsumsetzung, Selektive Farbkorrektur, Tiefen/Lichter, HDR-Tonung, Sättigung verringern, Farbe ersetzen, Tonwertangleichung, Auto-Farbton/-Kontrast/-Farbe'],
    ['Filter', 'Gaußscher Weichzeichner, Bewegungsunschärfe, Radialer Weichzeichner, Tilt-Shift, Matter machen, Durchschnitt, Scharfzeichnen, Unscharf maskieren, Rauschen hinzufügen/entfernen, Median, Relief, Konturen finden, Leuchtende Konturen, Solarisation, Ölfarbe, Strudel, Wölben, Distorsion, Welle, Kräuseln, Polarkoordinaten, Verflüssigen, Mosaik, Kristallisieren, Farbraster, Wolken, Blendenflecke, Vignette, Hochpass, Verschiebungseffekt, Min/Max'],
    ['Text, Formen & Pfade', 'Horizontaler/vertikaler Text, Schriftart, Größe, Farbe, Fett/Kursiv/Unterstrichen/Durchgestrichen/Großbuchstaben, Zeilenabstand, Laufweite, Ausrichtung; Rechteck, abgerundetes Rechteck, Ellipse, Dreieck, Polygon, Stern, Herz, Kirschblüte, Pfeil, Sprechblase, Linie mit Pfeilspitze; Zeichenstift, Freiform-Zeichenstift, Direktauswahl, Pfad füllen/Kontur/als Auswahl'],
    ['Themes & Einstellungen', 'Dunkel, Hell, Wie System, Anime · Sakura-Nacht, Anime · Sakura-Tag, 7 Akzentfarben, UI-Skalierung, reduzierte Bewegung; Voreinstellungen für Autosave/Wiederherstellung, Protokolltiefe, Mausrad-Zoom, Pinselcursor, Stiftdruck, Transformieren, Leistung, Schachbrett, Raster, Hilfslinien, Einheiten (Px, cm, mm, Zoll, Pt, %), Speicherordner und Export'],
    ['Ansicht & Arbeitsbereich', 'Zoom, Hand, Navigator, Lineale, Hilfslinien (aus Linealen ziehen), Raster, Einrasten, Pixelraster, Kanalansicht, Bildschirmmodi, Protokoll mit Rücksprung, Info mit Histogramm, Farb-, Farbfeld-, Verlaufs-, Muster-, Bibliotheks-, Pinsel-, Zeichen- und Absatz-Bedienfelder, mehrere Dokumente als Reiter'],
  ];
  return (
    <Modal title="Funktionsübersicht" onCancel={closeDialog} width={720}>
      <div className="features">{groups.map(([g, t]) => <div key={g}><h4>{g}</h4><p>{t}</p></div>)}</div>
    </Modal>
  );
}

function ConfirmCloseDialog({ dg }) {
  const d = S.docs.find((x) => x.id === dg.docId);
  if (!d) return null;
  return (
    <Modal title="Änderungen speichern?" onCancel={closeDialog} extra={<button className="btn" onClick={() => { closeDialog(); closeDoc(d.id, true); }}>Nicht speichern</button>}
      onOk={async () => { closeDialog(); S.activeId = d.id; await saveProject(false); if (!d.dirty) closeDoc(d.id, true); }} okLabel="Speichern">
      <p>Möchtest du die Änderungen an „{d.name}“ speichern?</p>
    </Modal>
  );
}

function AppCloseDialog() {
  const dirty = S.docs.filter((d) => d.dirty);
  return (
    <Modal title="Sakura Studio beenden" onCancel={closeDialog} onOk={() => window.native && window.native.confirmClose()} okLabel="Ohne Speichern beenden">
      <p>{dirty.length} Dokument(e) mit ungespeicherten Änderungen:</p>
      <ul>{dirty.map((d) => <li key={d.id}>{d.name}</li>)}</ul>
    </Modal>
  );
}

function GuideDialog() {
  const [dir, setDir] = useState('v'), [pos, setPos] = useState(100);
  return (
    <Modal title="Neue Hilfslinie" onOk={() => { closeDialog(); VIEW.addGuide(dir, pos); }} onCancel={closeDialog}>
      <label className="prow"><span>Ausrichtung</span><Sel value={dir} onChange={setDir} options={[['v', 'Vertikal'], ['h', 'Horizontal']]} width={150} /></label>
      <Num label="Position" value={pos} min={0} max={16000} onChange={setPos} unit=" Px" width={60} />
    </Modal>
  );
}

function HistogramDialog() {
  const d = doc();
  const h = useMemo(() => histogram(d.layer.canvas), []);
  const max = Math.max(...h.r, ...h.g, ...h.b, 1);
  const path = (a) => 'M0 120 ' + Array.from(a).map((v, i) => `L${i} ${120 - (v / max) * 116}`).join(' ') + ' L255 120Z';
  return (
    <Modal title="Histogramm" onCancel={closeDialog}>
      <svg className="histo big" viewBox="0 0 256 120" preserveAspectRatio="none" style={{ mixBlendMode: 'normal' }}>
        <path d={path(h.r)} fill="rgba(255,80,80,0.5)" /><path d={path(h.g)} fill="rgba(80,255,120,0.5)" /><path d={path(h.b)} fill="rgba(80,150,255,0.5)" />
      </svg>
      <div className="hint">Ebene: {d.layer.name}</div>
    </Modal>
  );
}
