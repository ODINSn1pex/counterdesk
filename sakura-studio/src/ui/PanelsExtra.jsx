// Zusätzliche Bedienfelder: Stile, Ebenenkompositionen, Anmerkungen
import { useState } from 'react';
import { S, useStore, doc, view, emit, commit, applyStylePreset, removeStylePreset, defineStylePreset, COMPS, askForm } from '../state.js';

const FX_SWATCH = (fx) => {
  const ov = fx.overlay && fx.overlay.enabled ? fx.overlay.color : fx.gradient && fx.gradient.enabled ? `linear-gradient(${fx.gradient.color1}, ${fx.gradient.color2})` : 'var(--panel-2)';
  const st = fx.stroke && fx.stroke.enabled ? `2px solid ${fx.stroke.color}` : '1px solid var(--line)';
  const sh = fx.shadow && fx.shadow.enabled ? `2px 2px ${Math.min(8, fx.shadow.size || 4)}px ${fx.shadow.color}` : 'none';
  const gl = fx.glow && fx.glow.enabled ? `0 0 ${Math.min(10, fx.glow.size || 6)}px ${fx.glow.color}` : '';
  return { background: ov, border: st, boxShadow: [sh !== 'none' ? sh : '', gl].filter(Boolean).join(',') || 'none' };
};

export function StylesPanel() {
  useStore();
  const d = doc();
  return (
    <div className="styles-panel">
      <div className="style-grid">
        {S.stylePresets.map((p, i) => (
          <button key={i} title={`${p.name} – Klick: anwenden, Rechtsklick: löschen`} className="style-sw" style={FX_SWATCH(p.fx)}
            onClick={() => applyStylePreset(i)} onContextMenu={(e) => { e.preventDefault(); removeStylePreset(i); }}>
            <span>{p.name.slice(0, 2)}</span>
          </button>
        ))}
      </div>
      {!S.stylePresets.length && <div className="hint">Noch keine Stile. Speichere den Stil der aktiven Ebene oder importiere eine .asl-Datei (Bearbeiten › Vorgaben importieren).</div>}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" disabled={!d} onClick={async () => { const v = await askForm('Ebenenstil speichern', [{ key: 'name', label: 'Name', value: 'Mein Stil' }]); if (v && v.name) defineStylePreset(v.name); }}>Stil speichern</button>
        <button className="btn small" disabled={!d} onClick={() => { const l = doc().layer; l.fx = {}; l.touch(); view.request(); commit('Ebenenstil löschen'); }}>Stil entfernen</button>
      </div>
    </div>
  );
}

export function CompsPanel() {
  useStore();
  const d = doc();
  const [edit, setEdit] = useState(-1);
  if (!d) return <div className="hint">Kein Dokument geöffnet.</div>;
  return (
    <div className="comps-panel">
      <div className="hint">Speichert Sichtbarkeit, Deckkraft, Füllmethode und Ebenenstile aller Ebenen als umschaltbare Variante.</div>
      <div className="comp-list">
        {d.comps.map((c, i) => (
          <div key={i} className={'comp-row' + (d.compIndex === i ? ' on' : '')} onClick={() => COMPS.apply(i)}>
            <span className="comp-mark">{d.compIndex === i ? '▶' : ''}</span>
            {edit === i
              ? <input autoFocus defaultValue={c.name} onClick={(e) => e.stopPropagation()} onBlur={(e) => { COMPS.rename(i, e.target.value || c.name); setEdit(-1); }} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
              : <span className="comp-name" onDoubleClick={(e) => { e.stopPropagation(); setEdit(i); }}>{c.name}</span>}
            <button title="Mit aktuellem Zustand aktualisieren" onClick={(e) => { e.stopPropagation(); COMPS.update(i); }}>⟳</button>
            <button title="Löschen" onClick={(e) => { e.stopPropagation(); COMPS.remove(i); }}>✕</button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" onClick={() => COMPS.add()}>Neue Komposition</button>
        <button className="btn small" disabled={!d.comps.length} onClick={() => COMPS.step(-1)}>◀</button>
        <button className="btn small" disabled={!d.comps.length} onClick={() => COMPS.step(1)}>▶</button>
        <button className="btn small" disabled={!d.comps.length} onClick={() => COMPS.exportAll()}>Alle exportieren</button>
      </div>
    </div>
  );
}

export function NotesPanel() {
  useStore();
  const d = doc();
  if (!d) return <div className="hint">Kein Dokument geöffnet.</div>;
  return (
    <div className="notes-panel">
      {!d.notes.length && <div className="hint">Mit dem Anmerkungswerkzeug (bei der Pipette) auf das Bild klicken, um eine Notiz anzulegen.</div>}
      {d.notes.map((n, i) => (
        <div key={i} className={'note-row' + (S.ui.noteSel === i ? ' on' : '')} onClick={() => { S.ui.noteSel = i; emit(); }}>
          <div className="note-head"><span>Notiz {i + 1} · {Math.round(n.x)}, {Math.round(n.y)}</span><button onClick={(e) => { e.stopPropagation(); d.notes.splice(i, 1); S.ui.noteSel = null; commit('Anmerkung löschen'); view.request(); }}>✕</button></div>
          <textarea rows={2} value={n.text} placeholder="Text der Anmerkung…" onChange={(e) => { n.text = e.target.value; d.dirty = true; emit(); }} onBlur={() => commit('Anmerkung bearbeiten')} />
        </div>
      ))}
    </div>
  );
}
