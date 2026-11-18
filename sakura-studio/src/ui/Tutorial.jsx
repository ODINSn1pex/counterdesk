import { useEffect, useLayoutEffect, useState } from 'react';
import { S, emit, useStore, LS, doc, addDoc, setTool } from '../state.js';
import { docFromImage } from '../engine/doc.js';
import { loadImage } from '../engine/util.js';
import { Blossom, Logo } from './icons.jsx';

const STEPS = [
  { title: 'Willkommen bei Sakura Studio 🌸', text: 'Schön, dass du da bist! Diese kurze Tour zeigt dir in 12 Schritten, wo alles ist. Du kannst sie jederzeit über „Hilfe › Tutorial starten“ wiederholen.', target: null, prep: 'sample' },
  { title: 'Die Menüleiste', text: 'Hier findest du alle Befehle: Datei (Öffnen, Speichern, PSD, Export), Bearbeiten, Bild (Korrekturen, Bildgröße), Ebene, Schrift, Auswahl, Filter, Ansicht, Fenster und Hilfe. Fast jeder Befehl hat ein Tastenkürzel – es steht rechts im Menü.', target: 'menu' },
  { title: 'Die Werkzeugleiste', text: 'Links liegen alle Werkzeuge. Ein kleines Dreieck in der Ecke bedeutet: hier gibt es mehr! Halte die Maustaste gedrückt oder klicke mit rechts, um z. B. vom Pinsel zum Buntstift zu wechseln. Jedes Werkzeug hat einen Buchstaben (B = Pinsel, V = Verschieben …).', target: 'tools' },
  { title: 'Vorder- & Hintergrundfarbe', text: 'Die zwei Farbfelder unten in der Werkzeugleiste. Klicke darauf für den Farbwähler. X tauscht beide Farben, D setzt Schwarz/Weiß. Mit Alt + Klick im Bild nimmst du beim Malen eine Farbe auf.', target: 'colors' },
  { title: 'Die Optionsleiste', text: 'Sie passt sich dem aktiven Werkzeug an: Pinselgröße & Härte, Deckkraft, Toleranz, Schriftart usw. Tipp: Auf die Beschriftung (z. B. „Deckkr.:“) klicken und nach links/rechts ziehen ändert den Wert stufenlos.', target: 'options', prep: 'brush' },
  { title: 'Die Arbeitsfläche', text: 'Hier entsteht dein Bild. Mausrad = scrollen, Strg + Mausrad = zoomen, Leertaste halten = Bild verschieben. Ziehe Hilfslinien aus den Linealen heraus. Bilder kannst du einfach per Drag & Drop hineinziehen.', target: 'canvas' },
  { title: 'Ebenen', text: 'Ebenen liegen wie Folien übereinander. Mit dem Auge blendest du sie aus, per Ziehen ordnest du sie neu, Doppelklick auf den Namen = umbenennen, Doppelklick daneben = Ebenenstil (Schatten, Kontur, Glow …). Unten: fx, Maske, Füllebene, Neue Ebene, Löschen.', target: 'panel-layers' },
  { title: 'Farbe, Farbfelder, Verläufe & Muster', text: 'Im oberen Bedienfeld mischst du Farben, wählst gespeicherte Farbfelder, Verläufe für das Verlaufswerkzeug (G) und Muster für Füllungen.', target: 'panel-color' },
  { title: 'Eigenschaften & Korrekturen', text: 'Hier siehst du die Leinwandgröße deines Dokuments. Im Reiter „Korrekturen“ wendest du per Klick Helligkeit/Kontrast, Gradationskurven, Farbton/Sättigung u. v. m. an – mit Live-Vorschau.', target: 'panel-props' },
  { title: 'Protokoll, Navigator & mehr', text: 'Diese schmale Leiste öffnet weitere Bedienfelder: Protokoll (jeden Schritt zurückspringen), Navigator, Info mit Histogramm, Pinselvorgaben, Zeichen und Absatz.', target: 'side' },
  { title: 'Rückgängig & Speichern', text: 'Strg + Z macht rückgängig, Umschalt + Strg + Z wiederholt. Strg + S speichert dein Projekt mit allen Ebenen (.sakura) – standardmäßig im Ordner „Desktop › Sakura Studio › Projekte“. Unter Datei kannst du auch als PSD speichern oder als PNG/JPG exportieren.', target: 'menu' },
  { title: 'Los geht\'s! ✨', text: 'Probier es gleich aus: Der Pinsel (B) ist aktiv – male etwas auf eine neue Ebene, wähle mit W einen Bereich aus oder öffne „Filter“. Alle Tastenkürzel findest du unter „Hilfe › Tastaturbefehle“. Viel Spaß beim Gestalten!', target: null, prep: 'layer' },
];

async function prepare(kind) {
  if (kind === 'sample' && !S.docs.length) {
    try { const img = await loadImage('./sample.jpg'); const d = docFromImage(img, 'Sakura-Beispiel.jpg'); addDoc(d); } catch (e) { /* ignore */ }
  }
  if (kind === 'brush') setTool('brush', 'brush');
  if (kind === 'layer') { const d = doc(); if (d && d.layers.length === 1) { const m = await import('../state.js'); m.L.add(); } setTool('brush', 'brush'); }
}

export function Tutorial() {
  useStore();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const step = STEPS[i];
  useEffect(() => { if (S.ui.tutorial) setI(0); }, [S.ui.tutorial]);
  useEffect(() => { if (S.ui.tutorial && step.prep) prepare(step.prep); }, [i, S.ui.tutorial]);
  useLayoutEffect(() => {
    if (!S.ui.tutorial) return;
    const upd = () => {
      const el = step.target && document.querySelector(`[data-tut="${step.target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 });
    };
    upd();
    const t = setTimeout(upd, 120);
    window.addEventListener('resize', upd);
    return () => { clearTimeout(t); window.removeEventListener('resize', upd); };
  }, [i, S.ui.tutorial, S.version]);
  useEffect(() => {
    const k = (e) => {
      if (!S.ui.tutorial) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'Escape') done();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  if (!S.ui.tutorial) return null;
  function done() { S.ui.tutorial = false; LS.set('tutorialDone', true); emit(); }
  function next() { if (i < STEPS.length - 1) setI(i + 1); else done(); }

  // Position der Sprechblase
  const W = 380;
  let style;
  if (!rect) style = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' };
  else {
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.x + rect.w + 16, top = rect.y;
    if (left + W > vw - 10) left = rect.x - W - 16;
    if (left < 10) { left = Math.min(vw - W - 10, Math.max(10, rect.x)); top = rect.y + rect.h + 14; }
    if (top + 260 > vh) top = Math.max(10, vh - 280);
    if (rect.h > vh * 0.6 && rect.w > vw * 0.4) { left = rect.x + rect.w / 2 - W / 2; top = rect.y + 40; }
    style = { left, top };
  }
  return (
    <div className="tut">
      <svg className="tut-shade" width="100%" height="100%">
        <defs><mask id="tutmask"><rect width="100%" height="100%" fill="#fff" />{rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="10" fill="#000" />}</mask></defs>
        <rect width="100%" height="100%" fill="rgba(12,8,28,0.72)" mask="url(#tutmask)" />
        {rect && <rect className="tut-ring" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="10" />}
      </svg>
      <div className={'tut-card' + (!rect ? ' center' : '')} style={{ ...style, width: W }}>
        {!rect && <div className="tut-logo"><Logo size={56} /></div>}
        <div className="tut-step">Schritt {i + 1} von {STEPS.length}</div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tut-dots">{STEPS.map((_, j) => <span key={j} className={j === i ? 'on' : j < i ? 'done' : ''} onClick={() => setI(j)} />)}</div>
        <div className="tut-foot">
          <button className="btn ghost" onClick={done}>Überspringen</button>
          <div className="flex" />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Zurück</button>}
          <button className="btn primary" onClick={next}>{i === STEPS.length - 1 ? 'Loslegen' : 'Weiter'}</button>
        </div>
        <Blossom size={34} className="tut-b1" />
        <Blossom size={20} className="tut-b2" color="#ffd6ec" />
      </div>
    </div>
  );
}
