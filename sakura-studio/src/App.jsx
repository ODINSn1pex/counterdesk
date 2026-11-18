import { useEffect } from 'react';
import { S, emit, useStore, doc, LS, openBytes, openDialog, view } from './state.js';
import { onKeyDown, onKeyUp } from './commands.js';
import { TitleBar, Toolbar, DocTabs, StatusBar, ContextMenu, Toast } from './ui/Chrome.jsx';
import { OptionsBar } from './ui/OptionsBar.jsx';
import { CanvasView } from './ui/CanvasView.jsx';
import { RightPanels, SideStrip, Flyout } from './ui/Panels.jsx';
import { Dialogs } from './ui/Dialogs.jsx';
import { Tutorial } from './ui/Tutorial.jsx';
import { Welcome } from './ui/Welcome.jsx';
import { Blossom } from './ui/icons.jsx';

export default function App() {
  useStore();
  useEffect(() => {
    document.documentElement.dataset.theme = S.prefs.theme || 'sakura';
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const closeMenus = () => { if (S.ui.menu) { S.ui.menu = null; emit(); } };
    window.addEventListener('mousedown', closeMenus);
    const blur = () => import('./tools.js').then((m) => { m.SPACE.held = false; });
    window.addEventListener('blur', blur);
    // Einfügen aus der System-Zwischenablage (Strg+V ohne Dokument → neues Dokument)
    const paste = async (e) => {
      if (doc() || !e.clipboardData) return;
      const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
      if (f) openBytes('Eingefügt.png', new Uint8Array(await f.arrayBuffer()), null);
    };
    window.addEventListener('paste', paste);
    // Erster Start → Tutorial
    if (!LS.get('tutorialDone', false)) setTimeout(() => { S.ui.tutorial = true; emit(); }, 600);
    if (window.native) {
      window.native.on('close-request', () => {
        if (S.docs.some((d) => d.dirty)) openDialog('appClose');
        else window.native.confirmClose();
      });
      window.native.on('open-path', async (p) => { const f = await window.native.readFile(p); if (f) openBytes(f.name, new Uint8Array(f.data), f.path); });
      window.native.pendingOpen().then(async (p) => { if (p) { const f = await window.native.readFile(p); if (f) openBytes(f.name, new Uint8Array(f.data), f.path); } });
    }
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', closeMenus);
      window.removeEventListener('blur', blur);
      window.removeEventListener('paste', paste);
    };
  }, []);
  useEffect(() => { view.request(); }, [S.ui.hidePanels, S.ui.flyout, S.ui.screenMode]);

  const hasDoc = !!doc();
  const hide = S.ui.hidePanels || S.ui.screenMode === 2;
  return (
    <div className={'app' + (hide ? ' hide-panels' : '') + (S.ui.screenMode === 2 ? ' full' : '')}>
      <TitleBar />
      <OptionsBar />
      <div className="main">
        {!hide && <Toolbar />}
        <div className="center">
          <DocTabs />
          {hasDoc ? <CanvasView /> : <Welcome />}
          <StatusBar />
        </div>
        {!hide && <>
          <div className="flyout-wrap"><Flyout /></div>
          <SideStrip />
          <RightPanels />
        </>}
      </div>
      <Blossom size={30} className="corner-blossom" />
      <Dialogs />
      <ContextMenu />
      <Tutorial />
      <Toast />
    </div>
  );
}
