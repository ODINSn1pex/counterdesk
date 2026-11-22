// Allgemeiner Eingabedialog für Funktionen mit wenigen Parametern
import { useState } from 'react';
import { closeDialog } from '../../state.js';
import { Modal } from '../Dialogs.jsx';
import { Num, Sel, Check } from '../OptionsBar.jsx';

export function FormDialog({ dg }) {
  const [v, setV] = useState(() => Object.fromEntries(dg.fields.map((f) => [f.key, f.value])));
  const set = (k) => (x) => setV((o) => ({ ...o, [k]: x }));
  const done = (val) => { closeDialog(); dg.resolve && dg.resolve(val); };
  return (
    <Modal title={dg.title} onOk={() => done(v)} onCancel={() => done(null)} okLabel={dg.okLabel || 'OK'} width={dg.width || 440}>
      {dg.hint && <div className="hint" style={{ marginBottom: 8 }}>{dg.hint}</div>}
      {dg.fields.map((f) => {
        if (f.show && !f.show(v)) return null;
        const val = v[f.key];
        if (f.type === 'num') return <Num key={f.key} label={f.label} value={val} min={f.min ?? 0} max={f.max ?? 100} step={f.step || 1} unit={f.unit || ''} onChange={set(f.key)} width={f.width || 56} />;
        if (f.type === 'select') return <label key={f.key} className="prow"><span>{f.label}</span><Sel value={val} options={f.options} onChange={set(f.key)} width={f.width || 200} /></label>;
        if (f.type === 'check') return <Check key={f.key} label={f.label} value={!!val} onChange={set(f.key)} />;
        if (f.type === 'color') return <label key={f.key} className="prow"><span>{f.label}</span><input type="color" className="color-in" value={val} onChange={(e) => set(f.key)(e.target.value)} /></label>;
        if (f.type === 'textarea') return <label key={f.key} className="field col"><span>{f.label}</span><textarea rows={f.rows || 4} value={val} onChange={(e) => set(f.key)(e.target.value)} /></label>;
        if (f.type === 'info') return <div key={f.key} className="hint">{f.label}</div>;
        return <label key={f.key} className="field col"><span>{f.label}</span><input value={val} spellCheck={f.spell !== false} onChange={(e) => set(f.key)(e.target.value)} /></label>;
      })}
    </Modal>
  );
}
