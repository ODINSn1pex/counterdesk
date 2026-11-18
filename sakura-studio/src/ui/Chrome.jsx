import { useEffect, useRef, useState } from 'react';
import { S, emit, useStore, useCursor, setTool, doc, closeDoc, view, EDIT, L, SELECT, openDialog, startTransform, isAnime, initCrop } from '../state.js';
import { fmtUnit } from './CanvasView.jsx';
import { MENUS } from '../commands.js';
import { Icon, Blossom, Logo } from './icons.jsx';

// ---------------- Titelleiste mit Menü ----------------
export function TitleBar() {
  useStore();
  const [max, setMax] = useState(true);
  useEffect(() => { if (window.native) window.native.on('win-state', setMax); }, []);
  const open = S.ui.menu;
  return (
    <div className="titlebar">
      <div className="tb-left">
        <Logo size={30} />
        <span className="app-name">Sakura Studio</span>
        <nav className="menubar" data-tut="menu">
          {MENUS.map((m) => (
            <div key={m.id} className={'menu-root' + (open === m.id ? ' open' : '')}
              onMouseDown={(e) => { e.stopPropagation(); S.ui.menu = open === m.id ? null : m.id; emit(); }}
              onMouseEnter={() => { if (open && open !== m.id) { S.ui.menu = m.id; emit(); } }}>
              {m.label}
              {open === m.id && <MenuList items={m.items} />}
            </div>
          ))}
        </nav>
      </div>
      <div className="tb-drag" />
      {isAnime() && <div className="tb-art" aria-hidden="true">
        <img src="./header-art.jpg" alt="" />
        <Blossom size={26} className="tb-b1" />
        <Blossom size={18} className="tb-b2" color="#ffc4e2" />
        <Blossom size={22} className="tb-b3" />
      </div>}
      <div className="win-ctl">
        <button title="Minimieren" onClick={() => window.native && window.native.win('min')}><Icon name="min" size={16} /></button>
        <button title={max ? 'Wiederherstellen' : 'Maximieren'} onClick={() => window.native && window.native.win('max')}><Icon name={max ? 'restore' : 'max'} size={14} /></button>
        <button className="close" title="Schließen" onClick={() => (window.native ? window.native.win('close') : null)}><Icon name="close" size={16} /></button>
      </div>
    </div>
  );
}

export function MenuList({ items, onPick, style }) {
  const list = typeof items === 'function' ? items() : items;
  return (
    <div className="menu-list" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {list.map((it, i) => {
        if (it === '-') return <div key={i} className="menu-sep" />;
        return <MenuItem key={i} it={it} onPick={onPick} />;
      })}
    </div>
  );
}

function MenuItem({ it, onPick }) {
  const [hover, setHover] = useState(false);
  const enabled = it.enabled ? it.enabled() : true;
  const label = typeof it.label === 'function' ? it.label() : it.label;
  const hasSub = !!it.sub;
  return (
    <div className={'menu-item' + (enabled ? '' : ' disabled') + (hasSub ? ' has-sub' : '')}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (!enabled || hasSub) return;
        S.ui.menu = null; S.ui.contextMenu = null; emit();
        if (onPick) onPick();
        setTimeout(() => it.run && it.run(), 0);
      }}>
      <span className="mi-label">{label}</span>
      {it.key && <span className="mi-key">{it.key}</span>}
      {hasSub && <span className="mi-arrow">›</span>}
      {hasSub && hover && enabled && <MenuList items={it.sub} onPick={onPick} />}
    </div>
  );
}

// ---------------- Werkzeugleiste ----------------
export const TOOLS = [
  { id: 'move', name: 'Verschieben-Werkzeug', key: 'V', subs: [['move', 'Verschieben-Werkzeug', 'move']] },
  { id: 'marquee', name: 'Auswahlrechteck', key: 'M', subs: [['rect', 'Auswahlrechteck-Werkzeug', 'marquee'], ['ellipse', 'Auswahlellipse-Werkzeug', 'ellipse'], ['row', 'Einzelne-Zeile-Werkzeug', 'row'], ['col', 'Einzelne-Spalte-Werkzeug', 'col']] },
  { id: 'lasso', name: 'Lasso', key: 'L', subs: [['lasso', 'Lasso-Werkzeug', 'lasso'], ['polygon', 'Polygon-Lasso-Werkzeug', 'polygon']] },
  { id: 'wand', name: 'Schnellauswahl', key: 'W', subs: [['quick', 'Schnellauswahlwerkzeug', 'quick'], ['wand', 'Zauberstab-Werkzeug', 'wand'], ['object', 'Objektauswahlwerkzeug', 'object']] },
  { id: 'crop', name: 'Freistellungswerkzeug', key: 'C', subs: [['crop', 'Freistellungswerkzeug', 'crop']] },
  { id: 'eyedropper', name: 'Pipette', key: 'I', subs: [['eyedropper', 'Pipette-Werkzeug', 'eyedropper'], ['ruler', 'Linealwerkzeug', 'ruler']] },
  { id: 'heal', name: 'Bereichsreparatur-Pinsel', key: 'J', subs: [['spot', 'Bereichsreparatur-Pinsel', 'heal'], ['healing', 'Reparatur-Pinsel', 'heal'], ['redeye', 'Rote-Augen-Werkzeug', 'redeye']] },
  { id: 'brush', name: 'Pinsel', key: 'B', subs: [['brush', 'Pinsel-Werkzeug', 'brush'], ['pencil', 'Buntstift-Werkzeug', 'pencil'], ['replace', 'Farbe-ersetzen-Werkzeug', 'replace']] },
  { id: 'stamp', name: 'Kopierstempel', key: 'S', subs: [['clone', 'Kopierstempel-Werkzeug', 'stamp'], ['pattern', 'Musterstempel-Werkzeug', 'pattern']] },
  { id: 'history', name: 'Protokollpinsel', key: 'Y', subs: [['history', 'Protokollpinsel-Werkzeug', 'history']] },
  { id: 'eraser', name: 'Radiergummi', key: 'E', subs: [['eraser', 'Radiergummi-Werkzeug', 'eraser'], ['background', 'Hintergrund-Radiergummi', 'eraser'], ['magic', 'Magischer Radiergummi', 'magicEraser']] },
  { id: 'gradient', name: 'Verlaufswerkzeug', key: 'G', subs: [['gradient', 'Verlaufswerkzeug', 'gradient'], ['bucket', 'Füllwerkzeug', 'bucket']] },
  { id: 'blur', name: 'Weichzeichner', key: 'R', subs: [['blur', 'Weichzeichner-Werkzeug', 'blur'], ['sharpen', 'Scharfzeichner-Werkzeug', 'sharpen'], ['smudge', 'Wischfinger-Werkzeug', 'smudge']] },
  { id: 'dodge', name: 'Abwedler', key: 'O', subs: [['dodge', 'Abwedler-Werkzeug', 'dodge'], ['burn', 'Nachbelichter-Werkzeug', 'burn'], ['sponge', 'Schwamm-Werkzeug', 'sponge']] },
  { id: 'pen', name: 'Zeichenstift', key: 'P', subs: [['pen', 'Zeichenstift-Werkzeug', 'pen'], ['freeform', 'Freiform-Zeichenstift', 'freeform']] },
  { id: 'type', name: 'Horizontales Textwerkzeug', key: 'T', subs: [['h', 'Horizontales Textwerkzeug', 'type'], ['v', 'Vertikales Textwerkzeug', 'typeV']] },
  { id: 'select', name: 'Direktauswahl', key: 'A', subs: [['direct', 'Direktauswahl-Werkzeug (Pfade)', 'select']] },
  { id: 'shape', name: 'Formwerkzeug', key: 'U', subs: [['rect', 'Rechteck-Werkzeug', 'rect'], ['rounded', 'Abgerundetes Rechteck', 'rounded'], ['ellipse', 'Ellipse-Werkzeug', 'ellipse'], ['triangle', 'Dreieck-Werkzeug', 'triangle'], ['polygon', 'Polygon-Werkzeug', 'polygon'], ['line', 'Linienzeichner', 'line'], ['star', 'Stern', 'star'], ['heart', 'Herz', 'heart'], ['blossom', 'Kirschblüte', 'blossom'], ['arrow', 'Pfeil', 'arrow'], ['speech', 'Sprechblase', 'speech']] },
  { id: 'view', name: 'Hand', key: 'H', subs: [['hand', 'Hand-Werkzeug (H)', 'hand'], ['zoom', 'Zoom-Werkzeug (Z)', 'zoom']] },
];

export function Toolbar() {
  useStore();
  const [fly, setFly] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    const close = () => setFly(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="toolbar" data-tut="tools">
      <div className="tb-grip" />
      {TOOLS.map((t, i) => {
        const sub = t.subs.find((s) => s[0] === S.sub[t.id]) || t.subs[0];
        const active = S.tool === t.id;
        const sep = [1, 4, 6, 11, 13, 15, 17].includes(i);
        return (
          <div key={t.id} className="tool-slot">
            {sep && <div className="tool-sep" />}
            <button
              className={'tool' + (active ? ' active' : '')}
              title={`${sub[1]} (${t.key})`}
              data-tut={'tool-' + t.id}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.button === 2) { setFly(t.id); return; }
                timer.current = setTimeout(() => setFly(t.id), 400);
              }}
              onMouseUp={() => { clearTimeout(timer.current); setTool(t.id); }}
              onContextMenu={(e) => { e.preventDefault(); setFly(t.id); }}
            >
              <Icon name={sub[2]} size={20} />
              {t.subs.length > 1 && <span className="tool-corner" />}
            </button>
            {fly === t.id && (
              <div className="tool-fly" onMouseDown={(e) => e.stopPropagation()}>
                {t.subs.map((s) => (
                  <div key={s[0]} className={'menu-item' + (S.sub[t.id] === s[0] ? ' checked' : '')} onClick={() => { setTool(t.id, s[0]); setFly(null); }}>
                    <Icon name={s[2]} size={16} /> <span className="mi-label">{s[1]}</span> <span className="mi-key">{t.key}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="tool-sep" />
      <div className="colors" data-tut="colors">
        <button className="swatch-bg" style={{ background: S.bg }} title="Hintergrundfarbe" onClick={() => openDialog('colorPicker', { target: 'bg' })} />
        <button className="swatch-fg" style={{ background: S.fg }} title="Vordergrundfarbe" onClick={() => openDialog('colorPicker', { target: 'fg' })} />
        <button className="mini swap" title="Farben tauschen (X)" onClick={() => { const t = S.fg; S.fg = S.bg; S.bg = t; emit(); }}><Icon name="swap" size={11} /></button>
        <button className="mini def" title="Standardfarben (D)" onClick={() => { S.fg = '#000000'; S.bg = '#ffffff'; emit(); }}>
          <span className="d1" /><span className="d2" />
        </button>
      </div>
      <button className={'tool' + (S.ui.quickMask ? ' active' : '')} title="Im Maskierungsmodus bearbeiten (Q)" onClick={() => SELECT.toggleQuickMask()}><Icon name="quickmask" size={20} /></button>
      {isAnime() && <div className="tb-blossom"><Blossom size={30} /></div>}
    </div>
  );
}

// ---------------- Dokument-Reiter ----------------
export function DocTabs() {
  useStore();
  if (!S.docs.length) return <div className="doc-tabs empty" />;
  return (
    <div className="doc-tabs">
      {S.docs.map((d) => (
        <div key={d.id} title={d.filePath || d.name} className={'doc-tab' + (d.id === S.activeId ? ' active' : '')} onMouseDown={(e) => { if (e.button === 1) { closeDoc(d.id); return; } S.activeId = d.id; if (S.tool === 'crop') initCrop(); view.request(); emit(); }}>
          <span>{d.name}{d.dirty ? ' *' : ''} bei {Math.round(d.zoom * 1000) / 10}% (RGB/8)</span>
          <button className="x" onMouseDown={(e) => { e.stopPropagation(); closeDoc(d.id); }}><Icon name="close" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

// ---------------- Statusleiste ----------------
function CursorPos() {
  const c = useCursor();
  const d = doc();
  return <span className="sb-pos">{c.inside && d ? `X: ${fmtUnit(c.x, d)}   Y: ${fmtUnit(c.y, d)}` : ''}</span>;
}

function ZoomInput({ d }) {
  const [txt, setTxt] = useState(null);
  const val = Math.round(d.zoom * 1000) / 10 + ' %';
  return (
    <input className="zoom-in" value={txt ?? val} title="Zoomstufe – Wert eingeben und Enter drücken"
      onFocus={(e) => { setTxt(String(Math.round(d.zoom * 1000) / 10)); setTimeout(() => e.target.select(), 0); }}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => setTxt(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { const v = parseFloat(String(e.target.value).replace(',', '.')); if (v > 0) import('../state.js').then((m) => m.VIEW.zoomTo(Math.min(64, Math.max(0.02, v / 100)), d.panX * (v / 100) / d.zoom, d.panY * (v / 100) / d.zoom)); e.target.blur(); }
        if (e.key === 'Escape') e.target.blur();
      }} />
  );
}

export function StatusBar() {
  useStore();
  const d = doc();
  if (!d) return <div className="statusbar"><span className="muted">Bereit</span></div>;
  const mem = d.layers.length * d.w * d.h * 4 / 1048576;
  return (
    <div className="statusbar">
      <ZoomInput d={d} />
      <span className="sb-dim">{fmtUnit(d.w, d)} × {fmtUnit(d.h, d)} ({d.ppi} ppi)</span>
      <CursorPos />
      <span className="sb-hist">{d.history[d.histIdx] ? 'Letzter Schritt: ' + d.history[d.histIdx].name : ''}</span>
      <span className="sb-mem" title="Arbeitsspeicher der Ebenen">{d.layers.length} Ebene{d.layers.length === 1 ? '' : 'n'} · {mem < 1024 ? mem.toFixed(0) + ' MB' : (mem / 1024).toFixed(1) + ' GB'}</span>
    </div>
  );
}

// ---------------- Kontextmenü ----------------
export function ContextMenu() {
  useStore();
  const cm = S.ui.contextMenu;
  useEffect(() => {
    const close = () => { if (S.ui.contextMenu) { S.ui.contextMenu = null; emit(); } };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  if (!cm) return null;
  const d = doc();
  const items = [
    { label: 'Rückgängig', key: 'Strg+Z', run: EDIT.undo },
    '-',
    ...(d && d.selection ? [
      { label: 'Auswahl aufheben', key: 'Strg+D', run: SELECT.none },
      { label: 'Auswahl umkehren', key: 'Umschalt+Strg+I', run: SELECT.invert },
      { label: 'Weiche Kante…', run: () => openDialog('modifySel', { kind: 'feather' }) },
      { label: 'Ebene durch Kopie', key: 'Strg+J', run: () => L.viaCopy(false) },
      { label: 'Ebene durch Ausschneiden', run: () => L.viaCopy(true) },
      { label: 'Fläche füllen…', run: () => openDialog('fill') },
      { label: 'Kontur füllen…', run: () => openDialog('stroke') },
      { label: 'Inhaltsbasierte Füllung', run: () => EDIT.fill('content') },
    ] : [
      { label: 'Alles auswählen', key: 'Strg+A', run: SELECT.all },
      { label: 'Motiv auswählen', run: SELECT.subject },
    ]),
    '-',
    { label: 'Frei transformieren', key: 'Strg+T', run: startTransform },
    { label: 'Kopieren', key: 'Strg+C', run: () => EDIT.copy(false) },
    { label: 'Einfügen', key: 'Strg+V', run: () => EDIT.paste(false) },
    '-',
    { label: 'Neue Ebene', run: L.add },
    { label: 'Ebenenstil…', run: () => openDialog('layerStyle', { tab: 'shadow' }) },
  ];
  return <MenuList items={items} style={{ position: 'fixed', left: cm.x, top: cm.y, zIndex: 400 }} />;
}

export function Toast() {
  useStore();
  if (!S.ui.toast) return null;
  return <div className="toast"><Blossom size={16} /> {S.ui.toast.msg}</div>;
}
