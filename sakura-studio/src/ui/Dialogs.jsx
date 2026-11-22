import { useEffect, useMemo, useRef, useState } from 'react';
import { S, emit, useStore, doc, view, commit, closeDialog, newDocument, IMAGE, EDIT, SELECT, VIEW, exportImage, closeDoc, savePrefs, saveSwatches, setFg, setBg, saveProject, DEFAULT_PREFS, ACCENTS, resetToolOptions, restoreRecovery, L, toast, PATTERNS } from '../state.js';
import { feather as selFeather, expand as selExpand, contract as selContract, smooth as selSmooth } from '../engine/selection.js';
import { cloneCanvas } from '../engine/util.js';
import { LiquifyDialog } from './dialogs/Liquify.jsx';
import { RawDialog } from './dialogs/RawDialog.jsx';
import { FormDialog } from './dialogs/FormDialog.jsx';
import { BrushSettingsDialog } from './dialogs/BrushSettings.jsx';
import { ADJUSTMENTS, FILTERS, histogram, curveLut } from '../engine/filters.js';
import { BLEND_MODES, GPU } from '../engine/doc.js';
import { beginPreview, previewFilter, showOriginal, finishFilter, cancelPreview } from './dialogs/applyFilter.js';
import { Num, Sel, Check, gradientCss } from './OptionsBar.jsx';
import { ColorField } from './Panels.jsx';
import { allShortcuts } from '../commands.js';
import { Blossom, Icon, Logo } from './icons.jsx';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../engine/util.js';

export function Modal({ title, children, onOk, onCancel, okLabel = 'OK', width = 420, extra }) {
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
    gradientEditor: GradientEditorDialog, features: FeaturesDialog, appClose: AppCloseDialog, selectMask: SelectMaskDialog, recovery: RecoveryDialog, liquify: LiquifyDialog, batch: BatchDialog, raw: RawDialog, artboard: ArtboardDialog, animExport: AnimExportDialog, genfill: GenFillDialog, help: HelpDialog, form: FormDialog, brushSettings: BrushSettingsDialog,
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
  const [ink, setInk] = useState(300);
  const [fmt, setFmt] = useState('png'), [q, setQ] = useState(90), [scale, setScale] = useState(100), [transp, setTransp] = useState(true);
  const d = doc();
  const ok = () => { closeDialog(); if (fmt === 'tiff' || fmt === 'cmyk') import('../state.js').then((m) => m.exportTiff(fmt === 'cmyk', ink)); else exportImage(fmt, q / 100, scale / 100, transp); };
  return (
    <Modal title="Exportieren als" onOk={ok} onCancel={closeDialog} okLabel="Exportieren…">
      <label className="prow"><span>Format</span><Sel value={fmt} onChange={setFmt} options={[['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['tiff', 'TIFF (RGB)'], ['cmyk', 'TIFF (CMYK für Druck)']]} width={200} /></label>
      {fmt === 'cmyk' && <><Num label="Max. Farbauftrag" value={ink} min={200} max={400} onChange={setInk} unit=" %" /><div className="hint">Umrechnung mit Unterfarbenreduktion (GCR), ohne Druckerprofil. Für farbkritischen Druck die Datei von der Druckerei prüfen lassen.</div></>}
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
  bevel: { name: 'Abgeflachte Kante und Relief', def: { enabled: true, style: 'inner', depth: 100, size: 6, highlight: '#ffffff', shadow: '#000000', opacity: 0.75, useGlobal: true, angle: 120, altitude: 30 } },
  stroke: { name: 'Kontur', multi: true, def: { enabled: true, color: '#ffffff', opacity: 1, size: 3 } },
  inner: { name: 'Schatten nach innen', multi: true, def: { enabled: true, color: '#000000', opacity: 0.6, size: 10 } },
  innerGlow: { name: 'Schein nach innen', def: { enabled: true, color: '#fff6c8', opacity: 0.75, size: 10 } },
  satin: { name: 'Glanz', def: { enabled: true, color: '#000000', opacity: 0.5, angle: 19, distance: 11, size: 14 } },
  overlay: { name: 'Farbüberlagerung', multi: true, def: { enabled: true, color: '#e57fb8', opacity: 1 } },
  gradient: { name: 'Verlaufsüberlagerung', multi: true, def: { enabled: true, color1: '#ffd6ec', color2: '#6a3fa0', opacity: 1, angle: 90, style: 'linear', reverse: false } },
  pattern: { name: 'Musterüberlagerung', def: { enabled: true, name: 'sakura', scale: 1, opacity: 1 } },
  glow: { name: 'Schein nach außen', def: { enabled: true, color: '#ffc1e3', opacity: 0.8, size: 18 } },
  shadow: { name: 'Schlagschatten', multi: true, def: { enabled: true, color: '#000000', opacity: 0.75, useGlobal: true, angle: 120, distance: 10, size: 12 } },
};
const fxBase = (k) => k.replace(/\d+$/, '');
const fxLabel = (k) => FX_DEFS[fxBase(k)].name + (/\d$/.test(k) ? ' ' + k.match(/\d+$/)[0] : '');
function LayerStyleDialog({ dg }) {
  const d = doc(); const l = d.layer;
  const orig = useRef({ fx: JSON.parse(JSON.stringify(l.fx || {})), blend: l.blend, opacity: l.opacity, fill: l.fill, blendIf: l.blendIf ? { ...l.blendIf } : null, light: { ...d.globalLight } });
  const [tab, setTab] = useState(dg.tab || 'blend');
  const [, force] = useState(0);
  useEffect(() => { if (tab !== 'blend' && !l.fx[tab]) { l.fx[tab] = { ...FX_DEFS[fxBase(tab)].def }; upd(); } }, [tab]);
  const upd = () => { l.touch(); view.request(); force((x) => x + 1); emit(); };
  const f = l.fx[tab];
  const set = (k) => (v) => { f[k] = v; upd(); };
  const cancel = () => { Object.assign(l, { fx: orig.current.fx, blend: orig.current.blend, opacity: orig.current.opacity, fill: orig.current.fill, blendIf: orig.current.blendIf }); d.globalLight = orig.current.light; upd(); closeDialog(); };
  const ok = () => { closeDialog(); commit('Ebenenstil'); };
  // Liste: jeder Stil, darunter weitere Instanzen
  const keys = [];
  for (const k of Object.keys(FX_DEFS)) { keys.push(k); Object.keys(l.fx).filter((n) => n !== k && fxBase(n) === k).sort().forEach((n) => keys.push(n)); }
  const addInst = (k) => { let i = 2; while (l.fx[k + i]) i++; l.fx[k + i] = { ...(l.fx[k] || FX_DEFS[k].def), enabled: true }; setTab(k + i); upd(); };
  const delInst = (k) => { delete l.fx[k]; setTab(fxBase(k)); upd(); };
  const bi = l.blendIf || { thisLo: 0, thisHi: 255, underLo: 0, underHi: 255, soft: 0 };
  const setBi = (k) => (v) => { l.blendIf = { ...bi, [k]: v }; upd(); };
  const light = d.globalLight || { angle: 120, altitude: 30 };
  const setLight = (k) => (v) => { d.globalLight = { ...light, [k]: v }; upd(); };
  const usesLight = f && 'useGlobal' in f;
  return (
    <Modal title={`Ebenenstil – ${l.name}`} onOk={ok} onCancel={cancel} width={640}>
      <div className="ls">
        <div className="ls-list">
          <button className={tab === 'blend' ? 'on' : ''} onClick={() => setTab('blend')}>Fülloptionen</button>
          {keys.map((k) => (
            <div key={k} className={'ls-item' + (tab === k ? ' on' : '')}>
              <input type="checkbox" checked={!!(l.fx[k] && l.fx[k].enabled)} onChange={(e) => { if (!l.fx[k]) l.fx[k] = { ...FX_DEFS[fxBase(k)].def }; l.fx[k].enabled = e.target.checked; upd(); }} />
              <button onClick={() => setTab(k)}>{fxLabel(k)}</button>
              {FX_DEFS[fxBase(k)].multi && (k === fxBase(k)
                ? <button className="ls-add" title="Weitere Instanz hinzufügen" onClick={() => addInst(k)}>+</button>
                : <button className="ls-add" title="Instanz entfernen" onClick={() => delInst(k)}>−</button>)}
            </div>
          ))}
        </div>
        <div className="ls-body">
          {tab === 'blend' ? <>
            <h4>Allgemeine Füllmethode</h4>
            <label className="prow"><span>Füllmethode</span><Sel value={l.blend} onChange={(v) => { l.blend = v; upd(); }} options={BLEND_MODES} width={200} /></label>
            <Num label="Deckkraft" value={Math.round(l.opacity * 100)} onChange={(v) => { l.opacity = v / 100; upd(); }} unit="%" />
            <h4>Erweiterte Füllmethode</h4>
            <Num label="Flächendeckkraft" value={Math.round(l.fill * 100)} onChange={(v) => { l.fill = v / 100; upd(); }} unit="%" />
            <Check label="Schnittmaske (an Ebene darunter)" value={l.clip} onChange={(v) => { l.clip = v; upd(); }} />
            <h4>Farbbereich (Helligkeit)</h4>
            <div className="hint">Blendet Pixel dieser Ebene aus, deren Helligkeit (oder die der darunterliegenden Pixel) außerhalb des Bereichs liegt.</div>
            <div className="bi-row"><span>Diese Ebene</span><Num label="von" value={bi.thisLo} max={255} onChange={setBi('thisLo')} /><Num label="bis" value={bi.thisHi} max={255} onChange={setBi('thisHi')} /></div>
            <div className="bi-bar" style={{ '--lo': bi.thisLo / 2.55 + '%', '--hi': bi.thisHi / 2.55 + '%' }} />
            <div className="bi-row"><span>Darunter liegende Ebene</span><Num label="von" value={bi.underLo} max={255} onChange={setBi('underLo')} /><Num label="bis" value={bi.underHi} max={255} onChange={setBi('underHi')} /></div>
            <div className="bi-bar" style={{ '--lo': bi.underLo / 2.55 + '%', '--hi': bi.underHi / 2.55 + '%' }} />
            <Num label="Weicher Übergang" value={bi.soft} max={128} onChange={setBi('soft')} />
            <h4>Globaler Lichteinfall</h4>
            <Num label="Winkel" value={light.angle} min={-180} max={180} onChange={setLight('angle')} unit="°" />
            <Num label="Höhe" value={light.altitude} min={0} max={90} onChange={setLight('altitude')} unit="°" />
          </> : f ? <>
            <h4>{fxLabel(tab)}</h4>
            {'style' in f && fxBase(tab) === 'bevel' && <label className="prow"><span>Stil</span><Sel value={f.style} onChange={set('style')} options={[['inner', 'Abgeflachte Kante innen'], ['outer', 'Abgeflachte Kante außen'], ['emboss', 'Relief'], ['pillow', 'Relief an allen Kanten']]} width={200} /></label>}
            {'style' in f && fxBase(tab) === 'gradient' && <label className="prow"><span>Art</span><Sel value={f.style} onChange={set('style')} options={[['linear', 'Linear'], ['radial', 'Radial']]} width={120} /></label>}
            {'color' in f && <label className="prow"><span>Farbe</span><input type="color" className="color-in" value={f.color} onChange={(e) => set('color')(e.target.value)} /></label>}
            {'highlight' in f && <label className="prow"><span>Lichter / Tiefen</span><input type="color" className="color-in" value={f.highlight} onChange={(e) => set('highlight')(e.target.value)} /><input type="color" className="color-in" value={f.shadow} onChange={(e) => set('shadow')(e.target.value)} /></label>}
            {'color1' in f && <label className="prow"><span>Verlauf</span><input type="color" className="color-in" value={f.color1} onChange={(e) => set('color1')(e.target.value)} /><input type="color" className="color-in" value={f.color2} onChange={(e) => set('color2')(e.target.value)} /></label>}
            {'name' in f && <label className="prow"><span>Muster</span><Sel value={f.name} onChange={set('name')} options={PATTERNS.map((p) => [p, p])} width={160} /></label>}
            <Num label="Deckkraft" value={Math.round(f.opacity * 100)} onChange={(v) => set('opacity')(v / 100)} unit="%" />
            {'depth' in f && <Num label="Tiefe" value={f.depth} min={1} max={1000} onChange={set('depth')} unit="%" />}
            {'scale' in f && <Num label="Skalieren" value={Math.round(f.scale * 100)} min={10} max={1000} onChange={(v) => set('scale')(v / 100)} unit="%" />}
            {usesLight && <Check label="Globalen Lichteinfall verwenden" value={f.useGlobal !== false} onChange={set('useGlobal')} />}
            {'angle' in f && <Num label="Winkel" value={usesLight && f.useGlobal !== false ? light.angle : f.angle} min={-180} max={180} onChange={usesLight && f.useGlobal !== false ? setLight('angle') : set('angle')} unit="°" />}
            {'altitude' in f && <Num label="Höhe" value={f.useGlobal !== false ? light.altitude : f.altitude} min={0} max={90} onChange={f.useGlobal !== false ? setLight('altitude') : set('altitude')} unit="°" />}
            {'distance' in f && <Num label="Distanz" value={f.distance} min={0} max={300} onChange={set('distance')} unit=" Px" />}
            {'size' in f && <Num label="Größe" value={f.size} min={0} max={250} onChange={set('size')} unit=" Px" />}
            {'reverse' in f && <Check label="Umkehren" value={f.reverse} onChange={set('reverse')} />}
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

function AiModelPicker() {
  useStore();
  const [exists, setExists] = useState({});
  const [prog, setProg] = useState(null);
  const [AI, setAI] = useState(null);
  useEffect(() => {
    import('../engine/ai.js').then(async (m) => {
      setAI(m.AI_MODELS);
      const ex = {};
      for (const [k, v] of Object.entries(m.AI_MODELS)) ex[k] = v.url ? (window.native && window.native.aiModelExists ? await window.native.aiModelExists(v.file) : false) : true;
      setExists(ex);
    });
    if (window.native) window.native.on('ai-progress', (pp) => setProg(pp.done ? null : pp));
  }, []);
  if (!AI) return null;
  const download = async (k) => {
    if (!window.native) { toast('Download nur in der Desktop-App'); return; }
    try { setProg({ got: 0, total: AI[k].mb * 1048576 }); await window.native.aiModelDownload(AI[k].file, AI[k].url); setExists((e) => ({ ...e, [k]: true })); S.prefs.aiModel = k; savePrefs(); toast('KI-Modell installiert'); }
    catch (e) { toast('Download fehlgeschlagen: ' + e.message); }
    setProg(null);
  };
  return (
    <div className="col" style={{ width: '100%' }}>
      {Object.entries(AI).map(([k, v]) => (
        <label key={k} className="chk">
          <input type="radio" name="aimodel" disabled={!exists[k]} checked={S.prefs.aiModel === k} onChange={() => { S.prefs.aiModel = k; savePrefs(); }} />
          <span>{v.label} · {v.mb} MB</span>
          {!exists[k] && v.url && <button className="btn small" disabled={!!prog} onClick={() => download(k)}>Herunterladen</button>}
        </label>
      ))}
      {prog && <div className="hint">Lade herunter … {Math.round(prog.got / 1048576)} / {Math.round((prog.total || 1) / 1048576)} MB</div>}
    </div>
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
            <Row label="Updates"><Check label="Beim Start nach Updates suchen" value={p.autoUpdate !== false} onChange={set('autoUpdate')} /></Row>
            <Row label="Update-Adresse"><input className="path-in" style={{ width: 300 }} placeholder="https://…/lumora-update.json" value={p.updateUrl || ''} onChange={(e) => set('updateUrl')(e.target.value)} /></Row>
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
                {[['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'Wie System'], ['anime', 'Anime']].map(([k, n]) => (
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
            <Row label="Aktionsleiste"><Check label="Schwebende Aktionsleiste auf der Arbeitsfläche anzeigen" value={p.quickBar !== false} onChange={set('quickBar')} /></Row>
            <Row label="QuickInfos"><Check label="QuickInfos (Tooltips) anzeigen" value={p.tooltips} onChange={set('tooltips')} /></Row>
          </>}
          {cat === 'tools' && <>
            <h4>Werkzeuge</h4>
            <Row label="Mausrad"><Sel value={p.wheelZoom ? 'zoom' : 'scroll'} onChange={(v) => set('wheelZoom')(v === 'zoom')} options={[['scroll', 'Scrollen (Strg/Alt + Rad = Zoom)'], ['zoom', 'Zoomen (Umschalt + Rad = Scrollen)']]} width={300} /></Row>
            <Row label="Zoom"><Check label="Animiertes Zoomen" value={p.animatedZoom} onChange={set('animatedZoom')} /></Row>
            <Row label="Malwerkzeug-Cursor"><Sel value={p.brushCursor} onChange={set('brushCursor')} options={[['normal', 'Pinselspitze (Kreis)'], ['both', 'Pinselspitze + Fadenkreuz'], ['cross', 'Präzise (Fadenkreuz)']]} width={240} /></Row>
            <Row label="Grafiktablett"><Check label="Stiftdruck steuert Größe" value={p.pressureSize} onChange={set('pressureSize')} /><Check label="Stiftdruck steuert Deckkraft" value={p.pressureOpacity} onChange={set('pressureOpacity')} /></Row>
            <Row label="Farbe"><Check label="ICC-Farbprofil beim Export einbetten" value={p.embedProfile !== false} onChange={set('embedProfile')} /></Row>
            <Row label="Text"><Check label="Rechtschreibprüfung beim Schreiben (Rechtsklick zeigt Vorschläge)" value={p.spellcheck !== false} onChange={set('spellcheck')} /></Row>
            <Row label="Markierungen"><Check label="Zählungen immer anzeigen" value={p.showCounts !== false} onChange={set('showCounts')} /></Row>
            <Row label="Transformieren" hint="Umschalttaste kehrt das Verhalten jeweils um."><Check label="Ecken proportional skalieren" value={p.proportionalTransform} onChange={set('proportionalTransform')} /></Row>
            <Row label="Pfeiltasten"><Num label="Umschalt + Pfeil:" value={p.nudgeStep} min={2} max={200} onChange={set('nudgeStep')} unit=" Px" width={56} /></Row>
            <Row label="Einrasten"><Num label="Abstand:" value={p.snapDistance} min={1} max={30} onChange={set('snapDistance')} unit=" Px" width={50} /></Row>
            <Row label="Werkzeugoptionen"><button className="btn small" onClick={() => resetToolOptions(true)}>Alle Werkzeuge zurücksetzen</button></Row>
          </>}
          {cat === 'perf' && <>
            <h4>Leistung</h4>
            <Row label="Filtervorschau" hint="Bei großen Bildern wird die Vorschau verkleinert berechnet – das Ergebnis wird immer in voller Auflösung angewendet."><Check label="Schnelle Vorschau bei großen Bildern" value={p.fastPreview} onChange={set('fastPreview')} /></Row>
            <Row label="Grafikprozessor" hint="Änderung wird nach einem Neustart wirksam. Nur bei Darstellungsfehlern deaktivieren."><Check label="Hardwarebeschleunigung verwenden" value={p.hardwareAcceleration} onChange={(v) => { set('hardwareAcceleration')(v); if (window.native && window.native.setMainSetting) window.native.setMainSetting('hardwareAcceleration', v); }} /></Row>
            <Row label="Rendering" hint={'Mischt Ebenen, Füllmethoden, Masken und Einstellungsebenen auf der Grafikkarte in 32-Bit-Gleitkomma – keine Rundungsfehler beim Stapeln von Korrekturen. Dithering verhindert Streifen in Verläufen. ' + (GPU.enabled ? 'Aktiv: ' + ((GPU.info && GPU.info.renderer) || 'GPU') : 'Nicht aktiv' + (GPU.error ? ' (' + GPU.error + ')' : ''))}>
              <Sel value={p.gpu === undefined ? 'auto' : p.gpu ? 'on' : 'off'} width={260} options={[['auto', 'GPU 32-Bit-Gleitkomma: Automatisch'], ['on', 'GPU 32-Bit-Gleitkomma: Immer'], ['off', 'Aus (klassisch, 8 Bit)']]}
                onChange={(v) => { const val = v === 'auto' ? undefined : v === 'on'; set('gpu')(val); import('../state.js').then((m) => m.setGpu(v === 'auto' ? 'auto' : v === 'on', p.dither !== false)); }} />
              {GPU.info && GPU.info.software && <div className="hint">Hinweis: Es wurde nur ein Software-Renderer gefunden ({GPU.info.renderer}). „Automatisch“ nutzt dann das klassische Rendering, weil es schneller ist.</div>}
              <Check label="Dithering (Ausgabe und Verläufe)" value={p.dither !== false} onChange={(v) => { set('dither')(v); set('ditherGradients')(v); import('../state.js').then((m) => m.setGpu(p.gpu === undefined ? 'auto' : p.gpu, v)); }} />
            </Row>
            <Row label="KI-Freistellung" hint="Für „Motiv auswählen“, „Objektauswahl“ und „Hintergrund entfernen“. Läuft komplett lokal auf deinem PC.">
              <AiModelPicker />
            </Row>
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
            <Row label="Standard-Speicherordner" hint={p.saveDir ? '' : 'Standard: Desktop\\Lumora\\Projekte'}>
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

// ---------------- Funktionslexikon ----------------
function HelpDialog() {
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    Promise.all([import('./tutorialData.js'), import('../commands.js')]).then(([T, C]) => {
      const out = [];
      Object.values(T.TOOL_HELP).forEach(([t, x]) => out.push({ cat: 'Werkzeug', title: t, text: x }));
      T.CHAPTERS.forEach((c) => c.steps.forEach((s) => { if (!s.tool && s.title !== 'Willkommen bei Lumora') out.push({ cat: c.name, title: s.title, text: s.text }); }));
      const walk = (items, path, menu) => items.forEach((it) => {
        if (!it || it === '-') return;
        const label = (typeof it.label === 'function' ? it.label() : it.label).replace(/^✓ /, '');
        if (Array.isArray(it.sub)) walk(it.sub, path + label + ' › ', menu);
        else if (it.run) out.push({ cat: 'Menü ' + menu, title: label, text: 'Zu finden unter: ' + menu + ' › ' + path + label + (it.key ? ' · Tastenkürzel: ' + it.key : ''), key: it.key, run: it.run, enabled: it.enabled });
      });
      C.MENUS.forEach((m) => walk(m.items, '', m.label));
      setEntries(out);
    });
  }, []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = entries.filter((e) => words.every((w) => (e.title + ' ' + e.text + ' ' + e.cat).toLowerCase().includes(w))).slice(0, 150);
  return (
    <Modal title="Funktionslexikon" onCancel={closeDialog} width={760}>
      <input className="path-in help-search" autoFocus placeholder="Suche, z. B. „Hintergrund entfernen“, „Maske“, „Kurven“, „Strg+J“ …" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="hint">{list.length} Treffer · Klick auf „Ausführen“ startet den Befehl direkt</div>
      <div className="help-list">
        {list.map((e, i) => (
          <div key={i} className="help-item">
            <h5>{e.title}<span className="muted">{e.cat}</span>{e.key && <kbd>{e.key}</kbd>}<span className="flex" />
              {e.run && <button className="btn small" disabled={e.enabled && !e.enabled()} onClick={() => { closeDialog(); setTimeout(() => e.run(), 0); }}>Ausführen</button>}</h5>
            <p>{e.text}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------- Generative Füllung ----------------
function GenFillDialog() {
  const [has, setHas] = useState(null), [key, setKey] = useState(''), [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  useEffect(() => { if (window.native) window.native.secretHas('openai').then(setHas); else setHas(false); }, []);
  const saveKey = async () => { if (!key.trim().startsWith('sk-')) { setErr('Der Schlüssel beginnt normalerweise mit „sk-“'); return; } await window.native.secretSet('openai', key.trim()); setKey(''); setHas(true); setErr(null); };
  const run = async () => {
    setBusy(true); setErr(null);
    try { const { generativeFill } = await import('../genfill.js'); await generativeFill(prompt.trim()); closeDialog(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  if (!window.native) return <Modal title="Generative Füllung" onCancel={closeDialog}><p>Nur in der Desktop-App verfügbar.</p></Modal>;
  return (
    <Modal title="Generative Füllung" onCancel={closeDialog} onOk={has && !busy ? run : null} okLabel="Erzeugen" width={500}>
      {has === false && <>
        <p>Die generative Füllung nutzt die Bild-KI von OpenAI mit <b>deinem eigenen API-Schlüssel</b>. Es fallen dort Kosten pro Bild an; der markierte Bildausschnitt wird dafür an OpenAI gesendet.</p>
        <label className="field col"><span>OpenAI-API-Schlüssel</span><input type="password" value={key} placeholder="sk-…" onChange={(e) => setKey(e.target.value)} /></label>
        <div className="row"><button className="btn primary" onClick={saveKey}>Schlüssel sicher speichern</button><span className="hint">verschlüsselt mit der Windows-Kontosicherung</span></div>
      </>}
      {has && <>
        <label className="field col"><span>Was soll im markierten Bereich entstehen? (leer = Bereich passend auffüllen)</span><textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="z. B. ein kleiner Steg mit Laternen" /></label>
        <div className="row"><span className="hint">Ergebnis kommt als neue Ebene mit Maske – das Original bleibt unverändert.</span><div className="flex" /><button className="btn small ghost" onClick={async () => { await window.native.secretSet('openai', ''); setHas(false); }}>Schlüssel entfernen</button></div>
      </>}
      {busy && <div className="hint"><span className="spin" /> Bild wird erzeugt (kann 10–40 s dauern) …</div>}
      {err && <div className="hint warn">{err}</div>}
    </Modal>
  );
}

// ---------------- Animation exportieren ----------------
function AnimExportDialog() {
  const [fmts, setFmts] = useState([]);
  const [fmt, setFmt] = useState('gif'), [scale, setScale] = useState(100), [loops, setLoops] = useState(1), [busy, setBusy] = useState(false);
  useEffect(() => { import('../animation.js').then((A) => setFmts(A.videoFormats())); }, []);
  const d = doc();
  const ok = async () => {
    setBusy(true);
    const A = await import('../animation.js');
    const base = d.name.replace(/\.[^.]+$/, '');
    try {
      if (fmt === 'gif') {
        const bytes = await A.exportGif({ scale: scale / 100 });
        closeDialog(); await import('../state.js').then((m) => m.saveBytesPublic(base + '.gif', bytes, [{ name: 'GIF', extensions: ['gif'] }]));
      } else {
        const f = fmts.find((x) => x[0] === fmt);
        const bytes = await A.exportVideo(fmt, { scale: scale / 100, loops });
        closeDialog(); await import('../state.js').then((m) => m.saveBytesPublic(base + '.' + f[2], bytes, [{ name: f[1], extensions: [f[2]] }]));
      }
    } catch (e) { toast('Export fehlgeschlagen: ' + e.message); setBusy(false); }
  };
  const total = (d.frames || []).reduce((a, f) => a + Math.max(34, f.delay), 0);
  return (
    <Modal title="Animation exportieren" onOk={busy ? null : ok} onCancel={closeDialog} okLabel="Exportieren…">
      <label className="prow"><span>Format</span><Sel value={fmt} onChange={setFmt} options={[['gif', 'GIF (animiert, Endlosschleife)'], ...fmts.map(([m, n]) => [m, n])]} width={240} /></label>
      <Num label="Skalierung" value={scale} min={5} max={200} onChange={setScale} unit=" %" />
      {fmt !== 'gif' && <Num label="Durchläufe" value={loops} min={1} max={20} onChange={setLoops} />}
      <div className="hint">{(d.frames || []).length} Frames · Dauer {((fmt === 'gif' ? 1 : loops) * total / 1000).toFixed(1)} s{fmt !== 'gif' ? ' · Video wird in Echtzeit aufgenommen' : ''}</div>
      {busy && <div className="hint"><span className="spin" /> Exportiere …</div>}
    </Modal>
  );
}

// ---------------- Zeichenfläche ----------------
function ArtboardDialog() {
  const [pi, setPi] = useState(0), [name, setName] = useState(''), [w, setW] = useState(1080), [h, setH] = useState(1080), [bg, setBgC] = useState('#ffffff'), [transp, setTransp] = useState(false);
  const ok = () => { closeDialog(); import('../state.js').then((m) => m.ARTBOARDS.add(name.trim() || null, w, h, transp ? 'transparent' : bg)); };
  return (
    <Modal title="Neue Zeichenfläche" onOk={ok} onCancel={closeDialog} okLabel="Erstellen">
      <label className="field col"><span>Name</span><input value={name} placeholder="z. B. Instagram-Beitrag" onChange={(e) => setName(e.target.value)} /></label>
      <label className="prow"><span>Vorgabe</span><Sel value={String(pi)} onChange={(v) => { const i = Number(v); setPi(i); import('../state.js').then((m) => { const p = m.ARTBOARD_PRESETS[i]; setW(p[1]); setH(p[2]); if (!name) setName(p[0]); }); }} options={[['0', 'Instagram-Beitrag 1080×1080'], ['1', 'Instagram-Story 1080×1920'], ['2', 'Full HD 1920×1080'], ['3', 'YouTube-Thumbnail 1280×720'], ['4', 'A4 1240×1754'], ['5', 'iPhone 1179×2556'], ['6', 'Web-Banner 728×90'], ['7', 'Eigene Größe']]} width={240} /></label>
      <div className="row"><Num label="Breite" value={w} min={1} max={16000} onChange={setW} unit=" Px" width={64} /><Num label="Höhe" value={h} min={1} max={16000} onChange={setH} unit=" Px" width={64} /></div>
      <div className="row"><Check label="Transparenter Hintergrund" value={transp} onChange={setTransp} />{!transp && <input type="color" className="color-in" value={bg} onChange={(e) => setBgC(e.target.value)} />}</div>
      <div className="hint">Zeichenflächen werden nebeneinander angelegt; die Arbeitsfläche wächst mit. Export: Datei › Exportieren › Zeichenflächen als Dateien. Tipp: Mit dem Zeichenflächen-Werkzeug (V-Gruppe) direkt aufziehen.</div>
    </Modal>
  );
}

// ---------------- Stapelverarbeitung ----------------
function BatchDialog() {
  const [ai, setAi] = useState(0), [inDir, setIn] = useState(''), [outDir, setOut] = useState(''), [fmt, setFmt] = useState('jpeg'), [q, setQ] = useState(90);
  const [prog, setProg] = useState(null), [result, setResult] = useState(null);
  const pick = async (set) => { const d = await window.native.chooseFolder({ title: 'Ordner wählen' }); if (d) set(d); };
  const run = async () => {
    if (!inDir || !outDir) { toast('Bitte Quell- und Zielordner wählen'); return; }
    const { runBatch } = await import('../actions.js');
    setResult(null);
    const r = await runBatch({ action: S.actions[ai], inDir, outDir, format: fmt, quality: q / 100, onProgress: (i, n, f) => setProg({ i, n, f }) });
    setProg(null); setResult(r);
  };
  return (
    <Modal title="Stapelverarbeitung" onCancel={closeDialog} onOk={prog ? null : run} okLabel="Starten" width={520}>
      <label className="prow"><span>Aktion</span><Sel value={String(ai)} onChange={(v) => setAi(Number(v))} options={S.actions.map((a, i) => [String(i), a.name])} width={240} /></label>
      <div className="prow"><span>Quellordner</span><input className="path-in" readOnly value={inDir} /><button className="btn small" onClick={() => pick(setIn)}>Wählen…</button></div>
      <div className="prow"><span>Zielordner</span><input className="path-in" readOnly value={outDir} /><button className="btn small" onClick={() => pick(setOut)}>Wählen…</button></div>
      <label className="prow"><span>Format</span><Sel value={fmt} onChange={setFmt} options={[['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']]} width={120} /></label>
      {fmt !== 'png' && <Num label="Qualität" value={q} min={1} max={100} onChange={setQ} unit="%" />}
      {prog && <div className="hint">Bearbeite {prog.i} / {prog.n}: {prog.f}</div>}
      {result && <div className="hint">Fertig: {result.ok} von {result.total} Dateien gespeichert.</div>}
    </Modal>
  );
}

// ---------------- Wiederherstellung ----------------
function RecoveryDialog({ dg }) {
  const items = dg.items || [];
  return (
    <Modal title="Dokumente wiederherstellen" onCancel={async () => { if (window.native) await window.native.recoveryClear(); closeDialog(); }} onOk={() => { closeDialog(); restoreRecovery(items); }} okLabel="Wiederherstellen">
      <p>Lumora wurde nicht ordnungsgemäß beendet. Folgende ungespeicherte Dokumente können wiederhergestellt werden:</p>
      <ul className="rec-list">{items.map((it) => { let n = it.name; try { n = JSON.parse(new TextDecoder().decode(new Uint8Array(it.data))).name; } catch (e) { /* */ } return <li key={it.name}>{n}</li>; })}</ul>
      <div className="hint">„Abbrechen“ verwirft die Sicherungen.</div>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title="Über Lumora" onCancel={closeDialog} width={480}>
      <div className="about">
        <Logo size={64} />
        <h2>Lumora</h2>
        <div>Version 5.1.0 · Bildbearbeitung für Windows</div>
        <p>Ebenen, Masken, Auswahlen, Pinsel, Retusche, Text, Formen, Pfade, über 50 Korrekturen & Filter, PSD-Import/-Export und mehr.</p>
        <p className="muted">Arbeitsordner: Desktop\Lumora\Projekte · Einstellungen: Bearbeiten › Voreinstellungen (Strg+K)</p>
        <details className="licenses"><summary>Open-Source-Komponenten</summary>
          <ul>
            <li>Electron – MIT-Lizenz</li><li>Chromium – BSD-Lizenz u. a. (siehe LICENSES.chromium.html im Programmordner)</li>
            <li>React, React DOM – MIT-Lizenz</li><li>ag-psd – MIT-Lizenz</li><li>ONNX Runtime Web – MIT-Lizenz</li><li>LibRaw (libraw-wasm) – LGPL-2.1/CDDL bzw. ISC</li><li>LaMa-Inpainting (OpenCV Model Zoo) – Apache-2.0</li><li>gifenc, UTIF – MIT-Lizenz</li><li>KI-Modelle silueta / isnet-anime / isnet-general-use (U²-Net / IS-Net, über rembg) – Apache-2.0</li><li>Vite – MIT-Lizenz (nur Entwicklung)</li>
          </ul>
        </details>
      </div>
    </Modal>
  );
}

function FeaturesDialog() {
  const groups = [
    ['Datei', 'Neu (Vorlagen), Öffnen (PNG, JPG, WebP, GIF, BMP, SVG, PSD, .lumora), Zuletzt geöffnet, Speichern als Projekt, PSD mit Ebenen speichern, Export PNG/JPG/WebP mit Qualität & Skalierung, Ebenen als Dateien exportieren, Platzieren, Drag & Drop, Drucken'],
    ['Entfernen & Freistellen', 'Markierte Bereiche mit KI entfernen (LaMa-Modell, lokal), Entfernen-Werkzeug zum Übermalen, Hintergrund entfernen als Maske, Motiv/Auswahl in neue Ebene ausschneiden oder kopieren, schwebende Aktionsleiste'],
    ['Neu in 5.1 – Qualität', 'GPU-Rendering (WebGL2) mit 32-Bit-Gleitkomma-Puffern für Ebenen, alle 27 Füllmethoden, Masken, Schnittmasken, Gruppen, Fülloptionen und Einstellungsebenen (Korrekturen über 65³-Farbtabellen in Gleitkomma); Ausgabe mit Dithering; Verläufe in Gleitkomma mit Dithering; Export als PNG und TIFF mit 16 Bit pro Kanal'],
    ['Neu in 5.0', 'Camera-Raw-Filter (auch als Einstellungsebene), Objektivkorrektur (Verzeichnung, Farbsäume, Vignette), Haut glätten, Rundungszeichenstift, Ansicht drehen, Glyphen-Bedienfeld, Kerning/Kapitälchen/Schriftbreite, Silbentrennung, PDF-Import, PSB-Export, Skripte ausführen, Airbrush und Stiftneigung, Farbprofile (sRGB, Display P3, Adobe RGB) zuweisen, umwandeln und als ICC einbetten, Update-Prüfung, lokales Fehlerprotokoll, KI-Modelle bei Bedarf laden (Kompakt-Installer)'],
    ['Neu in 4.0', 'Pinsel-Engine (F5) mit Struktur, Dualem Pinsel, Farb- und Transfer-Jitter, Symmetrie/Mandala und Misch-Pinsel; Ebenenstile Abgeflachte Kante und Relief, Glanz, Schein nach innen, Musterüberlagerung, mehrere Konturen/Schatten, globaler Lichteinfall; Fülloptionen „Farbbereich“; 9 zusätzliche exakte Füllmethoden (Linear nachbelichten, Strahlendes/Lineares Licht, Lichtpunkt, Hart mischen, Subtrahieren, Dividieren, Hellere/Dunklere Farbe); Ausbessern-Werkzeug, Inhaltsbasiert verschieben und skalieren, Generativ erweitern (lokale KI), Himmel austauschen, Hochskalieren; Absatztext mit Blocksatz, Text verkrümmen, Zeichen-/Absatzformate, Rechtschreibprüfung, Suchen & Ersetzen; Vektormasken, Formen kombinieren, Eckradien einzeln; Photomerge, HDR-Zusammenfügung, Ebenen automatisch ausrichten/überblenden (Fokus-Stacking); Import von .pat, .asl, .grd, .aco; Export als SVG, PDF, mehrere Größen und Slices; Farbaufnahme-, Zählungs-, Anmerkungs-, Slice- und Rahmenwerkzeug; Ebenenkompositionen; Stile-Bedienfeld; Tutorial mit 61 Schritten'],
    ['Neu in 3.0', 'Echte RAW-Entwicklung (LibRaw: Weißabgleich, Belichtung, Lichter, Rauschreduzierung, Demosaicing), Photoshop-Pinsel (.abr), Zeichenflächen, CMYK-TIFF-Export und TIFF-Import, Zeitleiste mit GIF-/MP4-/WebM-Export, generative Füllung (OpenAI, eigener Schlüssel), Plugin-Schnittstelle, Funktionslexikon (F1)'],
    ['Nicht-destruktiv', 'Einstellungsebenen (15 Korrekturen, jederzeit änderbar, mit Maske und Schnittmaske), Ebenengruppen (verschachtelt, Hindurchwirken, Gruppenmaske, Ein-/Ausklappen, Drag & Drop), Vektor-Formebenen (Farbe, Kontur, Radius, Seiten nachträglich änderbar), Smart-Objekte (verlustfreies Skalieren/Drehen/Verformen, Smartfilter ein-/ausschaltbar, Inhalt bearbeiten/ersetzen)'],
    ['KI (lokal, offline)', 'Motiv auswählen, Objektauswahl und Hintergrund entfernen mit neuronalen Netzen (Anime-/Illustrationsmodell und Fotomodell enthalten, hochwertiges Fotomodell nachladbar)'],
    ['Verformen', 'Verzerren, Perspektive, Verformen (Bézier-Gitter), Formgitter mit Pins, Verflüssigen (Krümmen, Rekonstruieren, Glätten, Strudel, Zusammenziehen, Aufblasen)'],
    ['Automatisierung', 'Aktionen aufzeichnen/abspielen (Schritte ein-/ausschaltbar), Stapelverarbeitung ganzer Ordner, eigene Pinselspitzen aus Auswahl oder Bild, Text auf Pfad'],
    ['Druck & Formate', 'CMYK-Proof und Farbumfang-Warnung (Näherung), PSD mit Gruppen, Text und Einstellungsebenen lesen/schreiben, RAW-Dateien (eingebettete Kameravorschau), AVIF'],
    ['Ebenen', 'Neue Ebene, Ebene durch Kopie/Ausschneiden, Duplizieren, Löschen, 28 Füllmethoden, Deckkraft, Flächendeckkraft, 4 Fixierungen, Ebenenmasken (malen, umkehren, anwenden), Schnittmasken, Füllebenen (Farbe/Verlauf/Muster), Anordnen, Ausrichten, Reduzieren, Sichtbare stempeln, Ebenenstile (Schlagschatten, Schein, Kontur, Schatten innen, Farb- und Verlaufsüberlagerung)'],
    ['Auswahl', 'Rechteck, Ellipse, Zeile, Spalte, Lasso, Polygon-Lasso, Schnellauswahl, Zauberstab, Objektauswahl, Motiv, Farbbereich, Hinzufügen/Subtrahieren/Schnittmenge, Weiche Kante, Erweitern, Verkleinern, Abrunden, Umrandung, Umkehren, Erneut auswählen, Maskierungsmodus, Auswahl speichern/laden (Alphakanäle)'],
    ['Malen & Retusche', 'Pinsel (Größe, Härte, Winkel, Rundheit, Abstand, Streuung, Jitter, Glättung, Stifdruck), Buntstift, Farbe ersetzen, Radiergummi, Hintergrund-Radiergummi, Magischer Radiergummi, Verlauf (5 Arten), Füllwerkzeug, Kopierstempel, Musterstempel, Protokollpinsel, Bereichsreparatur, Reparatur-Pinsel, Rote Augen, Weichzeichner, Scharfzeichner, Wischfinger, Abwedler, Nachbelichter, Schwamm'],
    ['Transformieren', 'Frei transformieren (Skalieren, Drehen, Neigen, Spiegeln), 90°/180°, Bildgröße, Arbeitsfläche, Bilddrehung, Freistellen mit Seitenverhältnis, Zuschneiden, Gerade ausrichten mit Lineal'],
    ['Korrekturen', 'Helligkeit/Kontrast, Tonwertkorrektur, Gradationskurven (RGB & Kanäle), Belichtung, Dynamik, Farbton/Sättigung, Farbbalance, Schwarzweiß, Fotofilter, Kanalmixer, Umkehren, Tontrennung, Schwellenwert, Verlaufsumsetzung, Selektive Farbkorrektur, Tiefen/Lichter, HDR-Tonung, Sättigung verringern, Farbe ersetzen, Tonwertangleichung, Auto-Farbton/-Kontrast/-Farbe'],
    ['Filter', 'Gaußscher Weichzeichner, Bewegungsunschärfe, Radialer Weichzeichner, Tilt-Shift, Matter machen, Durchschnitt, Scharfzeichnen, Unscharf maskieren, Rauschen hinzufügen/entfernen, Median, Relief, Konturen finden, Leuchtende Konturen, Solarisation, Ölfarbe, Strudel, Wölben, Distorsion, Welle, Kräuseln, Polarkoordinaten, Verflüssigen, Mosaik, Kristallisieren, Farbraster, Wolken, Blendenflecke, Vignette, Hochpass, Verschiebungseffekt, Min/Max'],
    ['Text, Formen & Pfade', 'Horizontaler/vertikaler Text, Schriftart, Größe, Farbe, Fett/Kursiv/Unterstrichen/Durchgestrichen/Großbuchstaben, Zeilenabstand, Laufweite, Ausrichtung; Rechteck, abgerundetes Rechteck, Ellipse, Dreieck, Polygon, Stern, Herz, Kirschblüte, Pfeil, Sprechblase, Linie mit Pfeilspitze; Zeichenstift, Freiform-Zeichenstift, Direktauswahl, Pfad füllen/Kontur/als Auswahl'],
    ['Themes & Einstellungen', 'Dunkel, Hell, Wie System, Anime, 7 Akzentfarben, UI-Skalierung, reduzierte Bewegung; Voreinstellungen für Autosave/Wiederherstellung, Protokolltiefe, Mausrad-Zoom, Pinselcursor, Stiftdruck, Transformieren, Leistung, Schachbrett, Raster, Hilfslinien, Einheiten (Px, cm, mm, Zoll, Pt, %), Speicherordner und Export'],
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
    <Modal title="Lumora beenden" onCancel={closeDialog} onOk={() => window.native && window.native.confirmClose()} okLabel="Ohne Speichern beenden">
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
