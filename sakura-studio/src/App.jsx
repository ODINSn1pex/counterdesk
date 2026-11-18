import { Component, useEffect } from 'react';
import { S, emit, useStore, doc, LS, openBytes, openDialog, view, applyTheme, autosaveAll, isAnime } from './state.js';
import { onKeyDown, onKeyUp } from './commands.js';
import { TitleBar, Toolbar, DocTabs, StatusBar, ContextMenu, Toast } from './ui/Chrome.jsx';
import { OptionsBar } from './ui/OptionsBar.jsx';
import { CanvasView } from './ui/CanvasView.jsx';
import { RightPanels, SideStrip, Flyout } from './ui/Panels.jsx';
import { Dialogs } from './ui/Dialogs.jsx';
import { Tutorial } from './ui/Tutorial.jsx';
import { Welcome } from './ui/Welcome.jsx';

// Fängt Darstellungsfehler ab, damit nie ein leeres Fenster bleibt
class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('Darstellungsfehler', err, info); autosaveAll(); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="crash">
        <h2>Hoppla – da ist etwas schiefgelaufen.</h2>
        <p>Deine offenen Dokumente wurden zur Sicherheit gesichert. Du kannst die Oberfläche neu laden und weiterarbeiten.</p>
        <pre>{String(this.state.err && this.state.err.message)}</pre>
        <div className="row">
          <button className="btn primary" onClick={() => this.setState({ err: null })}>Weiterarbeiten</button>
          <button className="btn" onClick={() => window.location.reload()}>Oberfläche neu laden</button>
        </div>
      </div>
    );
  }
}

// QuickInfos global abschaltbar
function tooltipGuard(e) {
  if (S.prefs.tooltips !== false) return;
  const el = e.target && e.target.closest && e.target.closest('[title]');
  if (el) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
}

function Shell() {
  useStore();
  useEffect(() => { view.request(); }, [S.ui.hidePanels, S.ui.flyout, S.ui.screenMode]);
  const hasDoc = !!doc();
  const hide = S.ui.hidePanels || S.ui.screenMode >= 1;
  return (
    <div className={'app' + (hide ? ' hide-panels' : '') + (S.ui.screenMode === 2 ? ' full' : '') + (isAnime() ? ' anime' : '')}>
      <TitleBar />
      <OptionsBar />
      <div className="main">
        {!hide && <Toolbar />}
        <div className="center">
          <DocTabs />
          {hasDoc ? <CanvasView /> : (S.prefs.showWelcome !== false ? <Welcome /> : <div className="empty-center"><p>Kein Dokument geöffnet</p><p className="muted">Strg+N: Neu · Strg+O: Öffnen · oder Datei hierher ziehen</p></div>)}
          <StatusBar />
        </div>
        {!hide && <>
          <div className="flyout-wrap"><Flyout /></div>
          <SideStrip />
          <RightPanels />
        </>}
      </div>
      <Dialogs />
      <ContextMenu />
      <Tutorial />
      <Toast />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    applyTheme();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const closeMenus = () => { if (S.ui.menu) { S.ui.menu = null; emit(); } };
    window.addEventListener('mousedown', closeMenus);
    window.addEventListener('mouseover', tooltipGuard, true);
    const blur = () => import('./tools.js').then((m) => { m.SPACE.held = false; });
    window.addEventListener('blur', blur);
    const paste = async (e) => {
      if (doc() || !e.clipboardData) return;
      const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
      if (f) openBytes('Eingefügt.png', new Uint8Array(await f.arrayBuffer()), null);
    };
    window.addEventListener('paste', paste);
    const onErr = (e) => { console.error(e.error || e.reason || e); };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);

    // Autosave für die Wiederherstellung
    let lastAuto = Date.now();
    const autoTimer = setInterval(() => {
      const m = S.prefs.autoSaveMin || 0;
      if (m > 0 && Date.now() - lastAuto >= m * 60000) { lastAuto = Date.now(); autosaveAll(); }
    }, 15000);

    const firstRun = !LS.get('tutorialDone', false);
    if (window.native) {
      window.native.on('close-request', () => {
        if (S.prefs.confirmClose !== false && S.docs.some((d) => d.dirty)) openDialog('appClose');
        else window.native.confirmClose();
      });
      window.native.on('open-path', async (p) => { const f = await window.native.readFile(p); if (f) openBytes(f.name, new Uint8Array(f.data), f.path); });
      window.native.pendingOpen().then(async (p) => { if (p) { const f = await window.native.readFile(p); if (f) openBytes(f.name, new Uint8Array(f.data), f.path); } });
      if (window.native.recoveryList) window.native.recoveryList().then((items) => { if (items && items.length) openDialog('recovery', { items }); });
    }
    if (firstRun) setTimeout(() => { if (!S.ui.dialog) { S.ui.tutorial = true; emit(); } }, 600);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', closeMenus);
      window.removeEventListener('mouseover', tooltipGuard, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('paste', paste);
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onErr);
      clearInterval(autoTimer);
    };
  }, []);
  return <ErrorBoundary><Shell /></ErrorBoundary>;
}
