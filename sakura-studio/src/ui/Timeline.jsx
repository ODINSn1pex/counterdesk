import { useEffect, useRef, useState } from 'react';
import { S, doc, emit, useStore, toast, openDialog } from '../state.js';
import * as A from '../animation.js';
import { Icon } from './icons.jsx';
import { flattenToCanvas } from '../engine/doc.js';

function FrameThumb({ d, i }) {
  const ref = useRef(null);
  const f = d.frames[i];
  const key = JSON.stringify(f.vis) + d.layers.map((l) => l.id + ':' + l.rev).join(',');
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const keep = d.layers.map((l) => [l.visible, l.opacity]);
    d.layers.forEach((l) => { if (l.id in f.vis) { l.visible = f.vis[l.id] > 0; if (f.vis[l.id] > 0) l.opacity = f.vis[l.id]; } });
    const img = flattenToCanvas(d, '#ffffff');
    d.layers.forEach((l, k) => { l.visible = keep[k][0]; l.opacity = keep[k][1]; });
    const x = c.getContext('2d'); const k = Math.min(c.width / d.w, c.height / d.h);
    x.clearRect(0, 0, c.width, c.height); x.drawImage(img, (c.width - d.w * k) / 2, (c.height - d.h * k) / 2, d.w * k, d.h * k);
  }, [key]);
  return <canvas ref={ref} width={96} height={64} />;
}

export function Timeline() {
  useStore();
  const d = doc();
  if (!S.ui.timeline || !d) return null;
  const frames = d.frames || [];
  return (
    <div className="timeline">
      <div className="tl-head">
        <b>Zeitleiste</b>
        <button className="icon-btn small" title={A.isPlaying() ? 'Stopp' : 'Abspielen'} onClick={A.togglePlay}>{A.isPlaying() ? '■' : <Icon name="play" size={13} />}</button>
        <button className="btn small" onClick={A.addFrame}>+ Frame</button>
        <button className="btn small" onClick={A.framesFromLayers} title="Ein Frame pro Ebene">Frames aus Ebenen</button>
        {d.curFrame != null && frames[d.curFrame] && <button className="btn small" onClick={() => A.captureFrame(d.curFrame)} title="Aktuelle Sichtbarkeit der Ebenen in diesen Frame übernehmen">Frame aktualisieren</button>}
        <div className="flex" />
        <button className="btn small" disabled={!frames.length} onClick={() => openDialog('animExport')}>Exportieren…</button>
        <button className="icon-btn small" title="Zeitleiste schließen" onClick={() => { S.ui.timeline = false; emit(); }}><Icon name="close" size={12} /></button>
      </div>
      <div className="tl-frames">
        {!frames.length && <div className="hint pad">Noch keine Frames. Blende Ebenen ein/aus und klicke „+ Frame“ – oder „Frames aus Ebenen“.</div>}
        {frames.map((f, i) => (
          <div key={i} className={'tl-frame' + (d.curFrame === i ? ' on' : '')} onClick={() => A.applyFrame(i)}>
            <span className="tl-num">{i + 1}</span>
            <FrameThumb d={d} i={i} />
            <select value={f.delay} onClick={(e) => e.stopPropagation()} onChange={(e) => A.setDelay(i, Number(e.target.value))}>
              {[0, 50, 100, 150, 200, 300, 500, 1000, 2000, 5000].map((v) => <option key={v} value={v}>{v >= 1000 ? v / 1000 + ' s' : v + ' ms'}</option>)}
            </select>
            <button className="tl-del" title="Frame löschen" onClick={(e) => { e.stopPropagation(); A.removeFrame(i); }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
