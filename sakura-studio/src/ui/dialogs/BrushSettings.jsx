// Pinseleinstellungen (F5): Form, Streuung, Struktur, Dualer Pinsel, Farbe, Transfer, Symmetrie, Misch-Pinsel
import { useState } from 'react';
import { S, emit, closeDialog, PATTERNS } from '../../state.js';
import { Modal } from '../Dialogs.jsx';
import { Num, Sel, Check } from '../OptionsBar.jsx';

const TABS = [['shape', 'Pinselform'], ['scatter', 'Formeigenschaften & Streuung'], ['texture', 'Struktur'], ['dual', 'Dualer Pinsel'], ['color', 'Farbeinstellungen'], ['transfer', 'Transfer'], ['sym', 'Symmetrie'], ['mixer', 'Misch-Pinsel']];
const SHAPES = [['round', 'Rund'], ['square', 'Quadrat'], ['blossom', 'Blüte'], ['star', 'Stern']];

export function BrushSettingsDialog() {
  const o = S.brush;
  const [tab, setTab] = useState('shape');
  const [, force] = useState(0);
  const set = (k, f = (v) => v) => (v) => { o[k] = f(v); emit(); force((x) => x + 1); };
  const pct = (k, max = 100) => ({ value: Math.round((o[k] || 0) * 100), max, unit: '%', onChange: set(k, (v) => v / 100) });
  const shapeOpts = [...SHAPES, ...(S.customBrushes || []).map((b) => ['custom:' + b.id, b.name])];
  return (
    <Modal title="Pinseleinstellungen" onOk={closeDialog} onCancel={closeDialog} okLabel="Fertig" width={620}>
      <div className="ls">
        <div className="ls-list">
          {TABS.map(([k, n]) => {
            const active = { texture: !!o.texture, dual: !!o.dual, color: !!(o.hueJitter || o.satJitter || o.briJitter || o.fgbgJitter), transfer: !!(o.opacityJitter || o.flowJitter), sym: o.symmetry !== 'none', scatter: !!(o.scatter || o.jitter || o.angleJitter) }[k];
            return <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}{active ? ' ●' : ''}</button>;
          })}
        </div>
        <div className="ls-body">
          {tab === 'shape' && <>
            <label className="prow"><span>Spitze</span><Sel value={o.shape} options={shapeOpts} onChange={set('shape')} width={200} /></label>
            <Num label="Größe" value={o.size} min={1} max={2500} unit=" Px" onChange={set('size')} />
            <Num label="Härte" {...pct('hardness')} />
            <Num label="Winkel" value={o.angle} min={-180} max={180} unit="°" onChange={set('angle')} />
            <Num label="Rundheit" value={Math.round(o.roundness * 100)} min={5} max={100} unit="%" onChange={set('roundness', (v) => v / 100)} />
            <Num label="Abstand" value={Math.round(o.spacing * 100)} min={1} max={1000} unit="%" onChange={set('spacing', (v) => v / 100)} />
          </>}
          {tab === 'scatter' && <>
            <Num label="Größen-Jitter" {...pct('jitter')} />
            <Num label="Winkel-Jitter" {...pct('angleJitter')} />
            <Check label="Winkel folgt der Strichrichtung" value={o.angleFollow} onChange={set('angleFollow')} />
            <Num label="Streuung" {...pct('scatter', 1000)} />
            <div className="hint">Größe und Deckkraft können zusätzlich über den Stiftdruck gesteuert werden (Voreinstellungen › Eingabe).</div>
          </>}
          {tab === 'texture' && <>
            <label className="prow"><span>Muster</span><Sel value={o.texture} options={[['', 'Aus'], ...PATTERNS.map((p) => [p, p])]} onChange={set('texture')} width={180} /></label>
            <Num label="Skalieren" value={Math.round(o.textureScale * 100)} min={10} max={1000} unit="%" onChange={set('textureScale', (v) => v / 100)} />
            <Num label="Tiefe" {...pct('textureDepth')} />
            <Check label="Umkehren" value={o.textureInvert} onChange={set('textureInvert')} />
            <div className="hint">Die Struktur wird fest auf der Leinwand ausgerichtet – wie Papierkorn.</div>
          </>}
          {tab === 'dual' && <>
            <label className="prow"><span>Zweite Spitze</span><Sel value={o.dual} options={[['', 'Aus'], ...shapeOpts]} onChange={set('dual')} width={200} /></label>
            <Num label="Größe" value={o.dualSize} min={1} max={1000} unit=" Px" onChange={set('dualSize')} />
            <Num label="Streuung" {...pct('dualScatter', 500)} />
            <div className="hint">Nur dort, wo beide Spitzen malen, wird Farbe aufgetragen.</div>
          </>}
          {tab === 'color' && <>
            <Num label="VG/HG-Jitter" {...pct('fgbgJitter')} />
            <Num label="Farbton-Jitter" {...pct('hueJitter')} />
            <Num label="Sättigungs-Jitter" {...pct('satJitter')} />
            <Num label="Helligkeits-Jitter" {...pct('briJitter')} />
            <div className="hint">Jeder Pinselabdruck erhält eine leicht abweichende Farbe.</div>
          </>}
          {tab === 'transfer' && <>
            <Num label="Deckkraft-Jitter" {...pct('opacityJitter')} />
            <Num label="Fluss-Jitter" {...pct('flowJitter')} />
          </>}
          {tab === 'sym' && <>
            <label className="prow"><span>Symmetrie</span><Sel value={o.symmetry} options={[['none', 'Aus'], ['vertical', 'Vertikal'], ['horizontal', 'Horizontal'], ['both', 'Doppelachse'], ['radial', 'Radial'], ['mandala', 'Mandala']]} onChange={set('symmetry')} width={160} /></label>
            {(o.symmetry === 'radial' || o.symmetry === 'mandala') && <Num label="Segmente" value={o.symSegments} min={2} max={36} onChange={set('symSegments')} />}
            <Check label="Mittelpunkt: Bildmitte" value={!S.symCenter} onChange={(v) => { if (v) S.symCenter = null; emit(); force((x) => x + 1); }} />
            <div className="hint">Mit Alt + Umschalt + Klick (Pinsel-Werkzeug) legst du einen eigenen Symmetrie-Mittelpunkt fest. Die Achsen werden als Hilfslinien angezeigt.</div>
          </>}
          {tab === 'mixer' && <>
            <div className="hint">Gilt für das Misch-Pinsel-Werkzeug (Pinsel-Gruppe). Es vermischt die Pinselfarbe mit den Farben auf der Leinwand.</div>
            <Num label="Nass" {...pct('wet')} />
            <Num label="Aufnahme" {...pct('load')} />
            <Num label="Mischung" {...pct('mix')} />
            <Check label="Pinsel nach jedem Strich neu laden" value={o.reload} onChange={set('reload')} />
          </>}
        </div>
      </div>
    </Modal>
  );
}
