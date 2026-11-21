import { S, emit, useStore, doc, view, applyCrop, initCrop, applyTransform, cancelTransform, renderTransform, gradientStops, PATTERNS, patternCanvas, SELECT, openDialog, transformLayer } from '../state.js';
import { BLEND_MODES } from '../engine/doc.js';
import { Icon } from './icons.jsx';
import { alignLayer, PATHS, finishPath, updateTextLayer } from '../tools.js';
import { TOOLS } from './Chrome.jsx';
import { useEffect, useRef, useState } from 'react';

export const FONTS = ['Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS', 'Tahoma', 'Palatino Linotype', 'Garamond', 'Consolas', 'Lucida Console', 'Yu Gothic', 'Meiryo', 'MS Gothic', 'Segoe Script', 'Segoe Print', 'Calibri', 'Cambria', 'Candara', 'Constantia', 'Corbel', 'Franklin Gothic Medium', 'Gabriola', 'Ink Free', 'Bahnschrift'];

export function Num({ label, value, onChange, min = 0, max = 100, step = 1, unit = '', width = 46, scrub = true }) {
  const ref = useRef(null);
  const [txt, setTxt] = useState(null);
  const startScrub = (e) => {
    if (!scrub) return;
    const sx = e.clientX, v0 = value;
    const mv = (ev) => { const dv = (ev.clientX - sx) * step * (ev.shiftKey ? 10 : 1); onChange(Math.min(max, Math.max(min, round(v0 + dv, step)))); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  return (
    <label className="num">
      {label && <span className="num-label" onMouseDown={startScrub}>{label}</span>}
      <input ref={ref} style={{ width }} value={txt ?? (round(value, step) + unit)}
        onFocus={(e) => { setTxt(String(round(value, step))); setTimeout(() => e.target.select(), 0); }}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { const v = parseFloat(String(txt).replace(',', '.')); if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v))); setTxt(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1))); onChange(v); setTxt(String(round(v, step))); } }}
      />
      {scrub && <span className="num-pop">
        <input type="range" min={min} max={Math.min(max, Math.max(value * 2, min + 100, Math.min(max, 500)))} step={step} value={value} onMouseDown={(e) => e.preventDefault()} onChange={(e) => onChange(Number(e.target.value))} />
      </span>}
    </label>
  );
}
function round(v, step) { const p = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0; return Number(Number(v).toFixed(p)); }

export function Sel({ value, onChange, options, width }) {
  return (
    <select className="sel" style={{ width }} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o, i) => (o === null ? <option key={i} disabled>──────────</option> : <option key={o[0]} value={o[0]}>{o[1]}</option>))}
    </select>
  );
}

export function Check({ label, value, onChange }) {
  return <label className="chk"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> <span>{label}</span></label>;
}

const set = (obj, k) => (v) => { obj[k] = v; view.overlay(); emit(); };
const pct = (obj, k) => ({ value: Math.round(obj[k] * 100), onChange: (v) => { obj[k] = v / 100; emit(); }, unit: '%', min: 0, max: 100 });

function SelModes() {
  return (
    <div className="seg">
      {[['new', 'newSel', 'Neue Auswahl'], ['add', 'addSel', 'Der Auswahl hinzufügen (Umschalt)'], ['subtract', 'subSel', 'Von Auswahl subtrahieren (Alt)'], ['intersect', 'intSel', 'Schnittmenge (Umschalt+Alt)']].map(([m, ic, t]) => (
        <button key={m} title={t} className={S.sel.mode === m ? 'on' : ''} onClick={() => { S.sel.mode = m; emit(); }}><Icon name={ic} size={15} /></button>
      ))}
    </div>
  );
}

function BrushOpts({ o = S.brush, showMode = true, showFlow = true }) {
  return (
    <>
      <BrushPicker o={o} />
      {showMode && <><span className="lbl">Modus:</span><Sel value={o.mode} onChange={set(o, 'mode')} options={BLEND_MODES.map((b) => b)} width={120} /></>}
      <Num label="Deckkr.:" {...pct(o, 'opacity')} />
      {showFlow && <Num label="Fluss:" {...pct(o, 'flow')} />}
      {o === S.brush && <Num label="Glättung:" value={Math.round(o.smoothing * 100)} onChange={(v) => { o.smoothing = v / 100; emit(); }} unit="%" />}
    </>
  );
}

function BrushPicker({ o }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const c = () => setOpen(false); window.addEventListener('mousedown', c); return () => window.removeEventListener('mousedown', c); }, []);
  return (
    <div className="brush-pick" onMouseDown={(e) => e.stopPropagation()}>
      <button className="brush-btn" onClick={() => setOpen(!open)} title="Pinselvorgaben">
        <span className="brush-dot" style={{ width: Math.min(22, 4 + o.size / 8), height: Math.min(22, 4 + o.size / 8), filter: `blur(${(1 - (o.hardness ?? 1)) * 3}px)` }} />
        <span className="brush-size">{Math.round(o.size)}</span>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="brush-pop">
          <Num label="Größe:" value={o.size} min={1} max={2500} onChange={(v) => { o.size = v; view.overlay(); emit(); }} unit=" Px" width={60} />
          {o.hardness != null && <Num label="Härte:" value={Math.round(o.hardness * 100)} onChange={(v) => { o.hardness = v / 100; emit(); }} unit="%" />}
          {o === S.brush && <>
            <Num label="Winkel:" value={o.angle} min={-180} max={180} onChange={(v) => { o.angle = v; emit(); }} unit="°" />
            <Num label="Rundheit:" value={Math.round(o.roundness * 100)} min={5} max={100} onChange={(v) => { o.roundness = v / 100; emit(); }} unit="%" />
            <Num label="Abstand:" value={Math.round(o.spacing * 100)} min={1} max={300} onChange={(v) => { o.spacing = v / 100; emit(); }} unit="%" />
            <Num label="Streuung:" value={Math.round(o.scatter * 100)} min={0} max={200} onChange={(v) => { o.scatter = v / 100; emit(); }} unit="%" />
            <Num label="Größen-Jitter:" value={Math.round(o.jitter * 100)} min={0} max={100} onChange={(v) => { o.jitter = v / 100; emit(); }} unit="%" />
            {(S.customBrushes || []).length > 0 && <div className="brush-presets">
              {S.customBrushes.map((b) => (
                <button key={b.id} title={b.name + ' (Rechtsklick: löschen)'} className={'tipbtn' + (o.shape === 'custom:' + b.id ? ' on' : '')} onClick={() => { o.shape = 'custom:' + b.id; o.spacing = Math.max(o.spacing, 0.25); emit(); }}
                  onContextMenu={(e) => { e.preventDefault(); S.customBrushes = S.customBrushes.filter((x) => x.id !== b.id); try { localStorage.setItem('sakura.customBrushes', JSON.stringify(S.customBrushes)); } catch (er) { /* */ } if (o.shape === 'custom:' + b.id) o.shape = 'round'; emit(); }}>
                  <img src={b.data} alt="" />
                </button>
              ))}
            </div>}
            <div className="brush-presets">
              {[['round', 'Rund'], ['square', 'Quadrat'], ['blossom', 'Blüte'], ['star', 'Stern']].map(([k, n]) => (
                <button key={k} className={o.shape === k ? 'on' : ''} onClick={() => { o.shape = k; if (k !== 'round') { o.spacing = Math.max(o.spacing, 0.9); } emit(); }}>{n}</button>
              ))}
            </div>
            <div className="brush-presets">
              {[[5, 1], [13, 1], [30, 0.8], [60, 0], [120, 0], [300, 0]].map(([s, h]) => (
                <button key={s + '-' + h} onClick={() => { o.size = s; o.hardness = h; emit(); }} title={`${s} Px, Härte ${h * 100}%`}>
                  <span className="brush-dot" style={{ width: Math.min(22, 4 + s / 10), height: Math.min(22, 4 + s / 10), filter: `blur(${(1 - h) * 3}px)` }} />{s}
                </button>
              ))}
            </div>
          </>}
        </div>
      )}
    </div>
  );
}

function ToolLabel() {
  const t = TOOLS.find((x) => x.id === S.tool);
  const sub = t && (t.subs.find((s) => s[0] === S.sub[t.id]) || t.subs[0]);
  return <div className="opt-tool" title={sub ? sub[1] : ''}><Icon name={sub ? sub[2] : 'move'} size={18} /><Icon name="chevron" size={10} /></div>;
}

export function OptionsBar() {
  useStore();
  const d = doc();
  const t = S.tool, sub = S.sub[t];
  let body = null;

  if (t === 'move') {
    if (S.transform) {
      const tr = S.transform;
      const upd = (k, f) => (v) => { tr[k] = f ? f(v) : v; renderTransform(); emit(); };
      const modes = <div className="seg" title="Transformationsmodus">
        {[['free', 'Frei'], ['distort', 'Verzerren'], ['perspective', 'Perspektive'], ['warp', 'Verformen'], ['puppet', 'Formgitter']].map(([k, n]) => (
          <button key={k} className={(tr.mesh || 'free') === k ? 'on' : ''} onClick={() => import('../state.js').then((m) => m.setTransformMode(k))}>{n}</button>
        ))}
      </div>;
      if (tr.mesh) body = <>
        {modes}
        <span className="hint">{tr.mesh === 'puppet' ? `${(tr.pins || []).length} Pins · Klick = Pin setzen · Ziehen = verbiegen · Alt+Klick = Pin löschen` : tr.mesh === 'warp' ? 'Gitterpunkte & Griffe ziehen · in die Fläche klicken = verschieben' : tr.mesh === 'perspective' ? 'Ecken ziehen · Umschalt = symmetrisch' : 'Ecken frei ziehen'}</span>
        <div className="opt-sep" />
        <button className="btn" onClick={cancelTransform} title="Abbrechen (Esc)">⊘</button>
        <button className="btn primary" onClick={applyTransform} title="Bestätigen (Enter)"><Icon name="check" size={14} /></button>
      </>;
      else body = <>
        {modes}
        <Num label="X:" value={Math.round(tr.cx)} min={-99999} max={99999} onChange={upd('cx')} unit=" Px" width={64} />
        <Num label="Y:" value={Math.round(tr.cy)} min={-99999} max={99999} onChange={upd('cy')} unit=" Px" width={64} />
        <Num label="B:" value={Math.round(tr.sx * 1000) / 10} min={-10000} max={10000} step={0.1} onChange={upd('sx', (v) => v / 100)} unit="%" width={60} />
        <Num label="H:" value={Math.round(tr.sy * 1000) / 10} min={-10000} max={10000} step={0.1} onChange={upd('sy', (v) => v / 100)} unit="%" width={60} />
        <Num label="∡" value={Math.round(tr.rot * 180 / Math.PI * 10) / 10} min={-360} max={360} step={0.1} onChange={upd('rot', (v) => v * Math.PI / 180)} unit="°" width={56} />
        <Num label="Neigen H:" value={Math.round((tr.skx || 0) * 180 / Math.PI)} min={-80} max={80} onChange={upd('skx', (v) => v * Math.PI / 180)} unit="°" width={50} />
        <div className="opt-sep" />
        <button className="btn" onClick={cancelTransform} title="Abbrechen (Esc)">⊘</button>
        <button className="btn primary" onClick={applyTransform} title="Bestätigen (Enter)"><Icon name="check" size={14} /></button>
      </>;
    } else body = <>
      <Check label="Autom. ausw.:" value={S.move.autoSelect} onChange={(v) => { S.move.autoSelect = v; emit(); }} />
      <Sel value="layer" onChange={() => {}} options={[['layer', 'Ebene']]} width={90} />
      <Check label="Transformationsstrg." value={!!S.transform} onChange={(v) => { if (v) import('../state.js').then((m) => m.startTransform()); }} />
      <div className="opt-sep" />
      {[['left', 'alignL'], ['hcenter', 'alignHC'], ['right', 'alignR']].map(([a, ic]) => <button key={a} className="icon-btn" title={'Ausrichten: ' + a} onClick={() => alignLayer(a)}><Icon name={ic} size={18} /></button>)}
      <div className="opt-sep" />
      {[['top', 'alignT'], ['vcenter', 'alignVC'], ['bottom', 'alignB']].map(([a, ic]) => <button key={a} className="icon-btn" title={'Ausrichten: ' + a} onClick={() => alignLayer(a)}><Icon name={ic} size={18} /></button>)}
      <div className="opt-sep" />
      <button className="icon-btn" title="Horizontal spiegeln" onClick={() => transformLayer('fh')}><Icon name="flipH" size={18} /></button>
      <button className="icon-btn" title="90° drehen" onClick={() => transformLayer('r90')}><Icon name="rotate" size={18} /></button>
    </>;
  } else if (t === 'marquee' || t === 'lasso') {
    body = <>
      <SelModes />
      <Num label="Weiche Kante:" value={S.sel.feather} min={0} max={250} onChange={set(S.sel, 'feather')} unit=" Px" />
      <Check label="Glätten" value={S.sel.aa} onChange={set(S.sel, 'aa')} />
      {t === 'marquee' && <><span className="lbl">Art:</span><Sel value={S.sel.ratio} onChange={set(S.sel, 'ratio')} options={[['free', 'Normal'], ['1', 'Festes Verhältnis 1:1'], ['1.5', '3:2'], ['1.3333', '4:3'], ['1.7778', '16:9']]} width={150} /></>}
      <div className="opt-sep" />
      <button className="btn" onClick={() => SELECT.subject()}>Motiv auswählen</button>
      <button className="btn" onClick={() => openDialog('selectMask')}>Auswählen und maskieren…</button>
    </>;
  } else if (t === 'wand') {
    body = <>
      <SelModes />
      {sub === 'quick' && <BrushPicker o={S.brush} />}
      {sub === 'wand' && <><Num label="Toleranz:" value={S.sel.tolerance} min={0} max={255} onChange={set(S.sel, 'tolerance')} /><Check label="Benachbart" value={S.sel.contiguous} onChange={set(S.sel, 'contiguous')} /></>}
      <Check label="Alle Ebenen aufnehmen" value={S.sel.sampleAll} onChange={set(S.sel, 'sampleAll')} />
      <div className="opt-sep" />
      <button className="btn" onClick={() => SELECT.subject()}><Icon name="sparkle" size={13} /> Motiv auswählen</button>
    </>;
  } else if (t === 'crop') {
    body = <>
      <Sel value={S.crop.ratio} onChange={(v) => { S.crop.ratio = v; emit(); }} options={[['free', 'Verhältnis'], ['orig', 'Original'], ['1', '1 : 1 (Quadrat)'], ['0.8', '4 : 5 (8 : 10)'], ['1.3333', '4 : 3'], ['1.5', '3 : 2'], ['1.7778', '16 : 9'], ['0.5625', '9 : 16']]} width={140} />
      {S.cropState && <span className="lbl">{Math.round(Math.abs(S.cropState.w))} × {Math.round(Math.abs(S.cropState.h))} Px</span>}
      <div className="opt-sep" />
      <button className="btn" onClick={initCrop}>Zurücksetzen</button>
      <button className="btn primary" onClick={applyCrop}><Icon name="check" size={14} /> Freistellen</button>
    </>;
  } else if (t === 'eyedropper') {
    if (sub === 'ruler') {
      const m = S.measure;
      const len = m ? Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) : 0;
      const ang = m ? -Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180 / Math.PI : 0;
      body = <>
        <span className="lbl">X: {m ? Math.round(m.a.x) : 0}</span><span className="lbl">Y: {m ? Math.round(m.a.y) : 0}</span>
        <span className="lbl">B: {m ? Math.round(m.b.x - m.a.x) : 0}</span><span className="lbl">H: {m ? Math.round(m.b.y - m.a.y) : 0}</span>
        <span className="lbl">W: {ang.toFixed(1)}°</span><span className="lbl">L1: {len.toFixed(1)}</span>
        <button className="btn" disabled={!m} onClick={() => straighten(ang)}>Ebene gerade ausrichten</button>
        <button className="btn" onClick={() => { S.measure = null; view.overlay(); emit(); }}>Löschen</button>
      </>;
    } else body = <>
      <span className="lbl">Aufnahmebereich:</span>
      <Sel value={String(S.eyedrop.sample)} onChange={(v) => { S.eyedrop.sample = Number(v); emit(); }} options={[['1', '1 Pixel'], ['3', '3 × 3 Durchschnitt'], ['5', '5 × 5 Durchschnitt'], ['11', '11 × 11 Durchschnitt'], ['31', '31 × 31 Durchschnitt']]} width={150} />
      <span className="lbl">Aufnehmen:</span>
      <Sel value={S.eyedrop.allLayers ? 'all' : 'cur'} onChange={(v) => { S.eyedrop.allLayers = v === 'all'; emit(); }} options={[['all', 'Alle Ebenen'], ['cur', 'Aktuelle Ebene']]} width={120} />
      <span className="swatch-inline" style={{ background: S.fg }} /> <span className="lbl mono">{S.fg.toUpperCase()}</span>
    </>;
  } else if (t === 'heal') {
    body = sub === 'redeye' ? <><Num label="Pupillengröße:" value={S.brush.size} min={2} max={500} onChange={set(S.brush, 'size')} unit=" Px" /><span className="hint">Auf rotes Auge klicken</span></> : <>
      <BrushPicker o={S.heal} />
      <span className="hint">{sub === 'spot' ? 'Inhaltsbasiert: einfach über Makel malen' : sub === 'remove' ? 'Objekt übermalen – beim Loslassen entfernt die KI es und ergänzt den Hintergrund' : 'Alt + Klick: Quelle festlegen, dann malen'}</span>
      {sub === 'healing' && <Check label="Ausger." value={S.stampOpts.aligned} onChange={set(S.stampOpts, 'aligned')} />}
    </>;
  } else if (t === 'brush') {
    if (sub === 'pencil') body = <><BrushPicker o={S.pencil} /><Num label="Deckkr.:" {...pct(S.pencil, 'opacity')} /></>;
    else body = <><BrushOpts />{sub === 'replace' && <span className="hint">Ersetzt Farbe, erhält Helligkeit</span>}</>;
  } else if (t === 'stamp') {
    body = <>
      <BrushOpts showMode={false} />
      {sub === 'pattern' && <PatternPick value={S.stampOpts.pattern} onChange={set(S.stampOpts, 'pattern')} />}
      <Check label="Ausger." value={S.stampOpts.aligned} onChange={set(S.stampOpts, 'aligned')} />
      {sub === 'clone' && <><Check label="Alle Ebenen" value={S.stampOpts.sampleAll} onChange={set(S.stampOpts, 'sampleAll')} /><span className="hint">Alt + Klick: Quelle</span></>}
    </>;
  } else if (t === 'history') {
    body = <><BrushOpts showMode={false} /><span className="hint">Malt aus dem gewählten Protokollzustand (Protokoll-Bedienfeld)</span></>;
  } else if (t === 'eraser') {
    if (sub === 'magic') body = <><Num label="Toleranz:" value={S.eraser.tolerance} min={0} max={255} onChange={set(S.eraser, 'tolerance')} /><Check label="Benachbart" value={S.sel.contiguous} onChange={set(S.sel, 'contiguous')} /><Check label="Alle Ebenen aufnehmen" value={S.sel.sampleAll} onChange={set(S.sel, 'sampleAll')} /></>;
    else if (sub === 'background') body = <><BrushPicker o={S.eraser} /><span className="lbl">Grenzen:</span><Sel value={S.eraser.sampling || 'cont'} onChange={set(S.eraser, 'sampling')} options={[['cont', 'Kontinuierlich'], ['once', 'Einmal']]} width={120} /><Num label="Toleranz:" value={S.eraser.tolerance} min={1} max={100} onChange={set(S.eraser, 'tolerance')} unit="%" /></>;
    else body = <><BrushPicker o={S.eraser} /><Num label="Deckkr.:" {...pct(S.eraser, 'opacity')} /><Num label="Fluss:" {...pct(S.eraser, 'flow')} /></>;
  } else if (t === 'gradient') {
    if (sub === 'bucket') body = <>
      <Sel value={S.fill.source} onChange={set(S.fill, 'source')} options={[['fg', 'Vordergrund'], ['pattern', 'Muster']]} width={110} />
      {S.fill.source === 'pattern' && <PatternPick value={S.fill.pattern} onChange={set(S.fill, 'pattern')} />}
      <span className="lbl">Modus:</span><Sel value={S.fill.mode} onChange={set(S.fill, 'mode')} options={BLEND_MODES} width={120} />
      <Num label="Deckkr.:" {...pct(S.fill, 'opacity')} />
      <Num label="Toleranz:" value={S.fill.tolerance} min={0} max={255} onChange={set(S.fill, 'tolerance')} />
      <Check label="Benachbart" value={S.fill.contiguous} onChange={set(S.fill, 'contiguous')} />
      <Check label="Alle Ebenen" value={S.fill.sampleAll} onChange={set(S.fill, 'sampleAll')} />
    </>;
    else body = <>
      <GradientPick />
      <div className="seg">
        {[['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Winkel'], ['reflected', 'Reflektiert'], ['diamond', 'Raute']].map(([k, n]) => (
          <button key={k} title={n + 'er Verlauf'} className={S.gradient.type === k ? 'on' : ''} onClick={() => { S.gradient.type = k; emit(); }}><GradIcon type={k} /></button>
        ))}
      </div>
      <span className="lbl">Modus:</span><Sel value={S.gradient.mode} onChange={set(S.gradient, 'mode')} options={BLEND_MODES} width={120} />
      <Num label="Deckkr.:" {...pct(S.gradient, 'opacity')} />
      <Check label="Umkehren" value={S.gradient.reverse} onChange={set(S.gradient, 'reverse')} />
    </>;
  } else if (t === 'blur' || t === 'dodge') {
    body = <>
      <BrushPicker o={S.retouch} />
      {t === 'dodge' && sub !== 'sponge' && <><span className="lbl">Bereich:</span><Sel value={S.retouch.range} onChange={set(S.retouch, 'range')} options={[['shadows', 'Tiefen'], ['midtones', 'Mitteltöne'], ['highlights', 'Lichter']]} width={110} /></>}
      {t === 'dodge' && sub === 'sponge' && <><span className="lbl">Modus:</span><Sel value={S.retouch.sponge} onChange={set(S.retouch, 'sponge')} options={[['desaturate', 'Sättigung verringern'], ['saturate', 'Sättigung erhöhen']]} width={160} /></>}
      {t === 'dodge' ? <Num label={sub === 'sponge' ? 'Fluss:' : 'Belichtung:'} {...pct(S.retouch, 'exposure')} /> : <Num label="Stärke:" {...pct(S.retouch, 'strength')} />}
    </>;
  } else if (t === 'pen' || t === 'select') {
    body = <>
      <span className="lbl">{t === 'pen' ? (sub === 'freeform' ? 'Freiform: ziehen' : 'Klicken = Ecke · Ziehen = Kurve · Doppelklick = Ende') : 'Ankerpunkte & Griffe ziehen'}</span>
      <div className="opt-sep" />
      <span className="lbl">Erstellen:</span>
      <button className="btn" onClick={PATHS.toSelection}>Auswahl…</button>
      <button className="btn" onClick={PATHS.fill}>Pfad füllen</button>
      <button className="btn" onClick={PATHS.stroke}>Kontur</button>
      {t === 'pen' && <button className="btn" onClick={finishPath}>Pfad beenden</button>}
    </>;
  } else if (t === 'type') {
    const te = S.ui.textEdit && d && d.layers.find((l) => l.id === S.ui.textEdit.layerId);
    const tl = te || (d && d.layer && d.layer.type === 'text' ? d.layer : null);
    const upd = (k) => (v) => { S.text[k] = v; if (tl) updateTextLayer(tl, { [k]: v }); emit(); };
    const tv = (k) => (tl ? tl.text[k] : S.text[k]);
    body = <>
      <Sel value={tv('font')} onChange={upd('font')} options={FONTS.map((f) => [f, f])} width={150} />
      <Sel value={(tv('bold') ? 'b' : '') + (tv('italic') ? 'i' : '')} onChange={(v) => { upd('bold')(v.includes('b')); upd('italic')(v.includes('i')); }} options={[['', 'Regular'], ['b', 'Bold'], ['i', 'Italic'], ['bi', 'Bold Italic']]} width={100} />
      <Num label="" value={tv('size')} min={1} max={2000} onChange={upd('size')} unit=" Pt" width={56} />
      <div className="seg">
        {[['left', 'alignL'], ['center', 'alignHC'], ['right', 'alignR']].map(([a, ic]) => <button key={a} className={tv('align') === a ? 'on' : ''} onClick={() => upd('align')(a)} title={'Text ' + a}><Icon name={ic} size={15} /></button>)}
      </div>
      <input type="color" className="color-in" value={tv('color') || S.fg} onChange={(e) => upd('color')(e.target.value)} title="Textfarbe" />
      <button className="btn" onClick={() => { S.ui.flyout = 'character'; emit(); }}>Zeichen…</button>
      {S.ui.textEdit && <button className="btn primary" onClick={() => import('../state.js').then((m) => m.finishTextEdit())}><Icon name="check" size={14} /> Fertig</button>}
    </>;
  } else if (t === 'shape') {
    const o = S.shape;
    const sl = d && d.layer && d.layer.type === 'shape' ? d.layer : null;
    body = <>
      <Sel value={o.mode} onChange={(v) => { o.mode = v; emit(); }} options={[['shape', 'Form (Vektor)'], ['pixel', 'Pixel']]} width={130} />
      {sl && <span className="hint">„{sl.name}“ bearbeiten: Eigenschaften-Bedienfeld</span>}
      {sub === 'line' ? <Num label="Stärke:" value={o.lineWidth} min={1} max={500} onChange={set(o, 'lineWidth')} unit=" Px" /> : <>
        <Check label="Fläche" value={o.fill} onChange={set(o, 'fill')} /><span className="swatch-inline" style={{ background: S.fg }} title="Vordergrundfarbe" />
        <Check label="Kontur" value={o.stroke} onChange={set(o, 'stroke')} />
        <input type="color" className="color-in" value={o.strokeColor} onChange={(e) => { o.strokeColor = e.target.value; emit(); }} />
        <Num label="" value={o.strokeWidth} min={1} max={200} onChange={set(o, 'strokeWidth')} unit=" Px" />
      </>}
      {sub === 'rounded' && <Num label="Radius:" value={o.radius} min={0} max={1000} onChange={set(o, 'radius')} unit=" Px" />}
      {(sub === 'polygon' || sub === 'star') && <Num label="Seiten:" value={o.sides} min={3} max={64} onChange={set(o, 'sides')} />}
      {sub === 'star' && <Num label="Einzug:" value={Math.round(o.starInner * 100)} min={5} max={95} onChange={(v) => { o.starInner = v / 100; emit(); }} unit="%" />}
      {sub === 'line' && <Check label="Pfeilspitze" value={o.arrow} onChange={set(o, 'arrow')} />}
      <span className="hint">Umschalt = Proportional · Alt = vom Mittelpunkt</span>
    </>;
  } else if (t === 'view') {
    body = sub === 'zoom' ? <>
      <button className="icon-btn" onClick={() => import('../state.js').then((m) => m.VIEW.zoomBy(1.25))}><Icon name="plus" /></button>
      <button className="icon-btn" onClick={() => import('../state.js').then((m) => m.VIEW.zoomBy(0.8))}><Icon name="min" /></button>
      <button className="btn" onClick={() => import('../state.js').then((m) => m.VIEW.actual())}>100 %</button>
      <button className="btn" onClick={() => import('../state.js').then((m) => m.VIEW.fit())}>Ganzes Bild</button>
      <span className="hint">Klick = Einzoomen · Alt+Klick = Auszoomen</span>
    </> : <>
      <button className="btn" onClick={() => import('../state.js').then((m) => m.VIEW.actual())}>100 %</button>
      <button className="btn" onClick={() => import('../state.js').then((m) => m.VIEW.fit())}>Ganzes Bild</button>
      <span className="hint">Tipp: Leertaste gedrückt halten = Hand-Werkzeug in jedem Werkzeug</span>
    </>;
  }

  return (
    <div className="optionsbar" data-tut="options">
      <div className="ob-grip" />
      <ToolLabel />
      <div className="opt-sep" />
      {body}
      <div className="ob-flex" />
      <button className="icon-btn" title="Werkzeugeinstellungen zurücksetzen" onClick={() => import('../state.js').then((m) => m.resetToolOptions())}><Icon name="undo" size={16} /></button>
    </div>
  );
}

function straighten(angDeg) {
  import('../state.js').then((m) => {
    const d = m.doc(); if (!d) return;
    const l = d.layer; if (!m.canEditPixels(l)) return;
    let a = angDeg; while (a > 45) a -= 90; while (a < -45) a += 90;
    const c = l.canvas; const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const tx = tmp.getContext('2d'); tx.drawImage(c, 0, 0);
    const x = l.ctx; x.clearRect(0, 0, c.width, c.height); x.save(); x.translate(c.width / 2, c.height / 2); x.rotate(a * Math.PI / 180); x.drawImage(tmp, -c.width / 2, -c.height / 2); x.restore();
    l.touch(); S.measure = null; m.commit('Gerade ausrichten');
  });
}

function GradIcon({ type }) {
  const bg = { linear: 'linear-gradient(90deg,#fff,#222)', radial: 'radial-gradient(circle,#fff,#222)', angle: 'conic-gradient(#fff,#222)', reflected: 'linear-gradient(90deg,#222,#fff,#222)', diamond: 'radial-gradient(#fff,#222)' }[type];
  return <span className="grad-ico" style={{ background: bg, transform: type === 'diamond' ? 'rotate(45deg) scale(.8)' : '' }} />;
}

export function gradientCss(g) {
  const st = gradientStops(g);
  return `linear-gradient(90deg, ${st.map((s) => `${s.c} ${Math.round(s.p * 100)}%`).join(', ')})`;
}

function GradientPick() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const c = () => setOpen(false); window.addEventListener('mousedown', c); return () => window.removeEventListener('mousedown', c); }, []);
  const g = S.gradients[S.gradient.index];
  return (
    <div className="brush-pick" onMouseDown={(e) => e.stopPropagation()}>
      <button className="grad-btn" onClick={() => setOpen(!open)} title="Verlauf wählen"><span style={{ background: gradientCss(g) }} /><Icon name="chevron" size={12} /></button>
      {open && <div className="brush-pop grads">
        {S.gradients.map((gg, i) => <button key={i} title={gg.name} className={'grad-cell' + (i === S.gradient.index ? ' on' : '')} style={{ background: gradientCss(gg) }} onClick={() => { S.gradient.index = i; setOpen(false); emit(); }} />)}
        <button className="btn" onClick={() => { setOpen(false); openDialog('gradientEditor'); }}>Verlaufseditor…</button>
      </div>}
    </div>
  );
}

export function PatternPick({ value, onChange }) {
  return (
    <div className="pat-pick">
      {PATTERNS.map((p) => <button key={p} title={p} className={value === p ? 'on' : ''} style={{ backgroundImage: `url(${patternCanvas(p).toDataURL()})`, backgroundSize: '24px' }} onClick={() => onChange(p)} />)}
    </div>
  );
}
