// Tutorial beim ersten Start: Schnelltour oder komplette Tour durch alle Funktionen (Kapitel)
import { useEffect, useLayoutEffect, useState } from 'react';
import { S, emit, useStore, LS, doc, addDoc, setTool, isAnime, savePrefs } from '../state.js';
import { docFromImage } from '../engine/doc.js';
import { loadImage } from '../engine/util.js';
import { Blossom, Logo } from './icons.jsx';
import { CHAPTERS, QUICK } from './tutorialData.js';

async function prepare(kind) {
  if (kind === 'sample' && !S.docs.length) {
    try { const img = await loadImage('./sample.jpg'); addDoc(docFromImage(img, 'Beispiel.jpg')); } catch (e) { /* ignore */ }
  }
  if (kind === 'brush') setTool('brush', 'brush');
  if (kind === 'adjust') { S.ui.panelTabs.props = 'adjust'; emit(); }
  if (kind === 'layer') { const d = doc(); if (d && d.layers.length === 1) { const m = await import('../state.js'); m.L.add(); } setTool('brush', 'brush'); }
}

const FULL = CHAPTERS.flatMap((c, ci) => c.steps.map((s) => ({ ...s, chapter: ci })));

export function Tutorial() {
  useStore();
  const [mode, setMode] = useState(null); // null = Auswahl, 'quick', 'full'
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const steps = mode === 'quick' ? QUICK : FULL;
  const step = mode ? steps[i] : null;
  useEffect(() => { if (S.ui.tutorial) { setMode(S.ui.tutorialMode || null); setI(0); S.ui.tutorialMode = null; } }, [S.ui.tutorial]);
  useEffect(() => {
    if (!S.ui.tutorial || !step) return;
    if (step.prep) prepare(step.prep);
    if (step.tool) setTool(step.tool);
  }, [i, mode, S.ui.tutorial]);
  useLayoutEffect(() => {
    if (!S.ui.tutorial) return;
    const upd = () => {
      const el = step && step.target && document.querySelector(`[data-tut="${step.target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 });
    };
    upd(); const t = setTimeout(upd, 150);
    window.addEventListener('resize', upd);
    return () => { clearTimeout(t); window.removeEventListener('resize', upd); };
  }, [i, mode, S.ui.tutorial, S.version]);
  useEffect(() => {
    const k = (e) => {
      if (!S.ui.tutorial || !mode) { if (S.ui.tutorial && e.key === 'Escape') done(); return; }
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'Escape') done();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  if (!S.ui.tutorial) return null;
  function done() { S.ui.tutorial = false; LS.set('tutorialDone', true); emit(); }
  function next() { if (i < steps.length - 1) setI(i + 1); else done(); }

  // Startauswahl
  if (!mode) {
    return (
      <div className="tut">
        <svg className="tut-shade" width="100%" height="100%"><rect width="100%" height="100%" fill="rgba(10,10,20,0.72)" /></svg>
        <div className="tut-card center" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 560 }}>
          <div className="tut-logo"><Logo size={56} /></div>
          <h3>Willkommen bei Lumora</h3>
          <p>Wähle zuerst deinen Look und dann, wie du starten möchtest.</p>
          <div className="tut-themes">
            <div className="tut-step">Theme</div>
            <div className="theme-grid">
              {[['dark', 'Dunkel'], ['light', 'Hell'], ['anime', 'Anime']].map(([k, n]) => (
                <button key={k} className={'theme-card t-' + k + (S.prefs.theme === k ? ' on' : '')} onClick={() => { S.prefs.theme = k; savePrefs(); }}><span className="tc-prev"><i /><i /><i /></span>{n}</button>
              ))}
            </div>
          </div>
          <div className="tut-modes">
            <button className="tut-mode" onClick={() => { setMode('quick'); setI(0); }}><b>Schnelltour</b><span>{QUICK.length} Schritte · ca. 2 Minuten · die wichtigsten Bereiche</span></button>
            <button className="tut-mode primary" onClick={() => { setMode('full'); setI(0); }}><b>Komplette Tour</b><span>{FULL.length} Schritte in {CHAPTERS.length} Kapiteln · jedes Werkzeug und jede Funktion erklärt</span></button>
          </div>
          <div className="tut-foot"><button className="btn ghost" onClick={done}>Später (Hilfe › Tutorial starten)</button><div className="flex" /><span className="hint">F1: Funktionslexikon</span></div>
        </div>
      </div>
    );
  }

  const W = 400;
  let style;
  if (!rect) style = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' };
  else {
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.x + rect.w + 16, top = rect.y;
    if (left + W > vw - 10) left = rect.x - W - 16;
    if (left < 10) { left = Math.min(vw - W - 10, Math.max(10, rect.x)); top = rect.y + rect.h + 14; }
    if (top + 300 > vh) top = Math.max(10, vh - 320);
    if (rect.h > vh * 0.6 && rect.w > vw * 0.4) { left = rect.x + rect.w / 2 - W / 2; top = rect.y + 40; }
    if (rect.y > vh * 0.75) { top = rect.y - 280; left = Math.min(vw - W - 10, Math.max(10, rect.x + rect.w / 2 - W / 2)); }
    style = { left, top };
  }
  const ch = mode === 'full' ? CHAPTERS[step.chapter] : null;
  const chStart = (ci) => FULL.findIndex((s) => s.chapter === ci);
  return (
    <div className="tut">
      <svg className="tut-shade" width="100%" height="100%">
        <defs><mask id="tutmask"><rect width="100%" height="100%" fill="#fff" />{rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="10" fill="#000" />}</mask></defs>
        <rect width="100%" height="100%" fill="rgba(10,10,20,0.66)" mask="url(#tutmask)" />
        {rect && <rect className="tut-ring" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="10" />}
      </svg>
      <div className={'tut-card' + (!rect ? ' center' : '')} style={{ ...style, width: W }}>
        {mode === 'full' && (
          <div className="tut-chapters">
            {CHAPTERS.map((c, ci) => <button key={ci} title={c.name} className={ci === step.chapter ? 'on' : ci < step.chapter ? 'done' : ''} onClick={() => setI(chStart(ci))} />)}
          </div>
        )}
        <div className="tut-step">{ch ? `Kapitel ${step.chapter + 1}: ${ch.name} · ` : ''}Schritt {i + 1} von {steps.length}</div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tut-progress"><span style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
        <div className="tut-foot">
          <button className="btn ghost" onClick={done}>Beenden</button>
          {ch && step.chapter < CHAPTERS.length - 1 && <button className="btn ghost" onClick={() => setI(chStart(step.chapter + 1))}>Kapitel überspringen</button>}
          <div className="flex" />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Zurück</button>}
          <button className="btn primary" onClick={next}>{i === steps.length - 1 ? 'Fertig' : 'Weiter'}</button>
        </div>
        {isAnime() && <><Blossom size={34} className="tut-b1" /><Blossom size={20} className="tut-b2" color="#ffd6ec" /></>}
      </div>
    </div>
  );
}
