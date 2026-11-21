import { S, useStore, openDialog, openFile, openRecent, newDocument, addDoc, emit, isAnime, openBytes } from '../state.js';
import { docFromImage } from '../engine/doc.js';
import { loadImage } from '../engine/util.js';
import { Blossom, Icon, Logo } from './icons.jsx';

export function Welcome() {
  useStore();
  const openSample = async () => { const img = await loadImage('./sample.jpg'); addDoc(docFromImage(img, 'Beispiel.jpg')); };
  const petals = isAnime() && S.prefs.sakuraPetals !== false && !S.prefs.reduceMotion;
  return (
    <div className="welcome" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) await openBytes(f.name, new Uint8Array(await f.arrayBuffer()), (window.native && window.native.pathForFile && window.native.pathForFile(f)) || null); }}>
      {petals && <div className="petals" aria-hidden="true">{Array.from({ length: 16 }).map((_, i) => <Blossom key={i} size={10 + (i % 4) * 5} className="petal" style={{ left: `${(i * 61) % 100}%`, animationDelay: `${(i * 1.3) % 9}s`, animationDuration: `${9 + (i % 5) * 2}s` }} />)}</div>}
      <div className="welcome-card">
        <div className="wl-head"><Logo size={54} /><div><h1>Lumora</h1><div className="muted">Willkommen zurück – was möchtest du heute gestalten?</div></div></div>
        <div className="wl-actions">
          <button className="wl-btn primary" onClick={() => openDialog('new')}><Icon name="plus" size={22} /><span>Neue Datei</span><kbd>Strg+N</kbd></button>
          <button className="wl-btn" onClick={openFile}><Icon name="folderOpen" size={22} /><span>Öffnen…</span><kbd>Strg+O</kbd></button>
          <button className="wl-btn" onClick={openSample}><Icon name="image" size={22} /><span>Beispielbild</span></button>
          <button className="wl-btn" onClick={() => { S.ui.tutorial = true; emit(); }}><Icon name="help" size={22} /><span>Tutorial</span></button>
        </div>
        <h4>Schnellstart</h4>
        <div className="wl-presets">
          {[['Full HD', 1920, 1080], ['Quadrat', 1080, 1080], ['Story', 1080, 1920], ['A4 · 300 ppi', 2480, 3508], ['Wallpaper 1440p', 2560, 1440]].map(([n, w, h]) => (
            <button key={n} onClick={() => newDocument({ w, h, background: 'white' })}><span className="pv" style={{ aspectRatio: `${w}/${h}` }} /><b>{n}</b><small>{w} × {h}</small></button>
          ))}
        </div>
        {S.recent.length > 0 && <>
          <h4>Zuletzt verwendet</h4>
          <div className="wl-recent">{S.recent.map((p) => <button key={p} onClick={() => openRecent(p)} title={p}><Icon name="doc" size={15} /> {p.split(/[\\/]/).pop()}<span className="muted">{p}</span></button>)}</div>
        </>}
        <div className="wl-tip">{isAnime() && <Blossom size={16} />} Tipp: Ziehe Bilder oder PSD-Dateien direkt in dieses Fenster.</div>
      </div>
    </div>
  );
}
