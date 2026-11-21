// RAW-Entwicklung (wie Camera Raw): Live-Vorschau, dann Entwicklung in voller Auflösung
import { useEffect, useRef, useState } from 'react';
import { S, closeDialog, addDoc, toast, emit } from '../../state.js';
import { docFromImage } from '../../engine/doc.js';
import { developRaw, rawMetadata, RAW_DEFAULTS } from '../../io/raw.js';
import { Icon } from '../icons.jsx';
import { Sel, Check } from '../OptionsBar.jsx';

function Slider({ label, value, min, max, step = 1, onChange, fmt }) {
  return (
    <label className="prow slider"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)} />
      <span className="pv-num ro">{fmt ? fmt(value) : value}</span>
    </label>
  );
}

export function RawDialog({ dg }) {
  const [o, setO] = useState({ ...RAW_DEFAULTS, ...(S.rawLast || {}) });
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const ref = useRef(null), gen = useRef(0), timer = useRef(null);
  const set = (k) => (v) => setO((x) => ({ ...x, [k]: v }));

  useEffect(() => { rawMetadata(dg.bytes).then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const g = ++gen.current; setBusy(true);
      try {
        const c = await developRaw(dg.bytes, o, true);
        if (g !== gen.current) return;
        const v = ref.current; v.width = c.width; v.height = c.height; v.getContext('2d').drawImage(c, 0, 0);
        setErr(null);
      } catch (e) { setErr(e.message); }
      if (g === gen.current) setBusy(false);
    }, 150);
  }, [o]);

  const open = async () => {
    setBusy(true);
    try {
      const c = await developRaw(dg.bytes, o, false);
      S.rawLast = o;
      const d = docFromImage(c, dg.name.replace(/\.[^.]+$/, '') + '.tif');
      closeDialog(); addDoc(d);
      toast(`RAW entwickelt: ${c.width} × ${c.height} Px`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const preview = async () => { closeDialog(); await dg.fallback(); };

  return (
    <div className="modal-back" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal liquify">
        <div className="modal-title">RAW-Entwicklung – {dg.name}{meta && <span className="muted" style={{ fontWeight: 400 }}> · {[meta.make, meta.model].filter(Boolean).join(' ')} {meta.iso_speed ? '· ISO ' + meta.iso_speed : ''}</span>}<div className="flex" /><button className="x" onClick={closeDialog}><Icon name="close" size={14} /></button></div>
        <div className="lq-body">
          <div className="lq-canvas">
            <canvas ref={ref} style={{ cursor: 'default' }} />
            {busy && <div className="busy-badge"><span className="spin" /> Entwickle …</div>}
            {err && <div className="hint warn" style={{ position: 'absolute' }}>{err}</div>}
          </div>
          <div className="lq-opts raw-opts">
            <h4>Grundeinstellungen</h4>
            <label className="prow"><span>Weißabgleich</span><Sel value={o.wb} onChange={set('wb')} options={[['camera', 'Wie Aufnahme'], ['auto', 'Automatisch'], ['daylight', 'Tageslicht (neutral)']]} width={130} /></label>
            <Slider label="Temperatur" value={o.temp} min={-100} max={100} onChange={set('temp')} />
            <Slider label="Tönung" value={o.tint} min={-100} max={100} onChange={set('tint')} />
            <Slider label="Belichtung" value={o.ev} min={-2} max={3} step={0.05} onChange={set('ev')} fmt={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} />
            <Slider label="Helligkeit" value={o.bright} min={0.25} max={3} step={0.05} onChange={set('bright')} fmt={(v) => v.toFixed(2)} />
            <Slider label="Kontrast" value={o.contrast} min={-100} max={100} onChange={set('contrast')} />
            <Slider label="Tiefen" value={o.shadows} min={0} max={100} onChange={set('shadows')} />
            <Slider label="Dynamik" value={o.vibrance} min={-100} max={100} onChange={set('vibrance')} />
            <h4>Details</h4>
            <label className="prow"><span>Lichter</span><Sel value={String(o.highlight)} onChange={(v) => set('highlight')(Number(v))} options={[['0', 'Abschneiden'], ['1', 'Unbeschnitten'], ['2', 'Mischen'], ['5', 'Rekonstruieren']]} width={130} /></label>
            <Slider label="Rauschreduz." value={o.noise} min={0} max={1000} step={10} onChange={set('noise')} />
            <label className="prow"><span>Demosaicing</span><Sel value={String(o.quality)} onChange={(v) => set('quality')(Number(v))} options={[['0', 'Linear (schnell)'], ['1', 'VNG'], ['2', 'PPG'], ['3', 'AHD (beste)'], ['11', 'DHT'], ['12', 'AAHD']]} width={130} /></label>
            <Check label="Automatische Helligkeit" value={o.autoBright} onChange={set('autoBright')} />
            <button className="btn small" onClick={() => setO({ ...RAW_DEFAULTS })}>Zurücksetzen</button>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={preview}>Nur eingebettete Vorschau</button>
          <div className="flex" />
          <button className="btn" onClick={closeDialog}>Abbrechen</button>
          <button className="btn primary" disabled={busy && !ref.current?.width} onClick={open}>Bild öffnen</button>
        </div>
      </div>
    </div>
  );
}
