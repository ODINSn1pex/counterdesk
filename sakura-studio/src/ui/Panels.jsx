import { useEffect, useRef, useState } from 'react';
import { S, emit, useStore, doc, view, commit, setFg, setBg, L, SELECT, openDialog, saveSwatches, setLayerProp, commitLater, PATTERNS, patternCanvas, toast, IMAGE, EDIT } from '../state.js';
import { BLEND_MODES } from '../engine/doc.js';
import { makeCanvas, ctx2d, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../engine/util.js';
import { histogram } from '../engine/filters.js';
import { Icon, Blossom } from './icons.jsx';
import { Num, Sel, Check, FONTS, gradientCss } from './OptionsBar.jsx';
import { runAdjustment } from '../commands.js';
import { PATHS, updateTextLayer } from '../tools.js';

function PanelGroup({ id, tabs, children, grow, tut }) {
  useStore();
  const cur = S.ui.panelTabs[id];
  const [collapsed, setCollapsed] = useState(false);
  if (S.ui.hiddenPanels[id]) return null;
  return (
    <div className={'panel' + (grow ? ' grow' : '') + (collapsed ? ' collapsed' : '')} data-tut={tut}>
      <div className="panel-tabs" onDoubleClick={() => setCollapsed(!collapsed)}>
        {tabs.map(([k, n]) => (
          <button key={k} className={cur === k ? 'on' : ''} onClick={() => { S.ui.panelTabs[id] = k; setCollapsed(false); emit(); }}>{n}</button>
        ))}
        <div className="flex" />
        <button className="panel-menu" title="Bedienfeld schließen" onClick={() => { S.ui.hiddenPanels[id] = true; emit(); }}><Icon name="menu" size={14} /></button>
      </div>
      {!collapsed && <div className="panel-body">{children(cur)}</div>}
    </div>
  );
}

export function RightPanels() {
  useStore();
  return (
    <div className="right-col">
      <PanelGroup id="color" tut="panel-color" tabs={[['color', 'Farbe'], ['swatches', 'Farbfelder'], ['gradients', 'Verläufe'], ['patterns', 'Muster']]}>
        {(t) => t === 'color' ? <ColorPanel /> : t === 'swatches' ? <SwatchesPanel /> : t === 'gradients' ? <GradientsPanel /> : <PatternsPanel />}
      </PanelGroup>
      <PanelGroup id="props" tut="panel-props" tabs={[['props', 'Eigenschaften'], ['adjust', 'Korrekturen'], ['libs', 'Bibliotheken']]}>
        {(t) => t === 'props' ? <PropertiesPanel /> : t === 'adjust' ? <AdjustPanel /> : <LibrariesPanel />}
      </PanelGroup>
      <PanelGroup id="layers" grow tut="panel-layers" tabs={[['layers', 'Ebenen'], ['channels', 'Kanäle'], ['paths', 'Pfade']]}>
        {(t) => t === 'layers' ? <LayersPanel /> : t === 'channels' ? <ChannelsPanel /> : <PathsPanel />}
      </PanelGroup>
    </div>
  );
}

// ---------------- Farbe ----------------
export function ColorField({ color, onChange, height = 118 }) {
  const { r, g, b } = hexToRgb(color);
  const hsv = rgbToHsv(r, g, b);
  const [hue, setHue] = useState(hsv.h);
  useEffect(() => { if (hsv.s > 0.01 && hsv.v > 0.01) setHue(hsv.h); }, [color]);
  const svRef = useRef(null), hRef = useRef(null);
  const drag = (ref, fn) => (e) => {
    const move = (ev) => { const rc = ref.current.getBoundingClientRect(); fn(Math.min(1, Math.max(0, (ev.clientX - rc.left) / rc.width)), Math.min(1, Math.max(0, (ev.clientY - rc.top) / rc.height))); };
    move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const setSV = (x, y) => { const c = hsvToRgb(hue, x, 1 - y); onChange(rgbToHex(c.r, c.g, c.b)); };
  const setH = (x, y) => { const h = y * 360; setHue(h); const c = hsvToRgb(h % 360, hsv.s, hsv.v); onChange(rgbToHex(c.r, c.g, c.b)); };
  return (
    <div className="color-field" style={{ height }}>
      <div className="sv" ref={svRef} style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${hue},100%,50%))` }} onPointerDown={drag(svRef, setSV)}>
        <span className="sv-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="hue" ref={hRef} onPointerDown={drag(hRef, setH)}>
        <span className="hue-dot" style={{ top: `${(hue / 360) * 100}%` }} />
      </div>
    </div>
  );
}

function ColorPanel() {
  useStore();
  const [target, setTarget] = useState('fg');
  const col = target === 'fg' ? S.fg : S.bg;
  const set = target === 'fg' ? setFg : setBg;
  const { r, g, b } = hexToRgb(col);
  return (
    <div className="color-panel">
      <div className="cp-row">
        <div className="cp-chips">
          <button className={'chip bg' + (target === 'bg' ? ' sel' : '')} style={{ background: S.bg }} onClick={() => setTarget('bg')} title="Hintergrundfarbe" />
          <button className={'chip fg' + (target === 'fg' ? ' sel' : '')} style={{ background: S.fg }} onClick={() => setTarget('fg')} title="Vordergrundfarbe" />
        </div>
        <ColorField color={col} onChange={set} />
      </div>
      <div className="cp-inputs">
        {[['R', r], ['G', g], ['B', b]].map(([k, v], i) => (
          <Num key={k} label={k} value={v} min={0} max={255} width={42} onChange={(nv) => { const a = [r, g, b]; a[i] = nv; set(rgbToHex(...a)); }} />
        ))}
        <label className="num"><span className="num-label">#</span><input style={{ width: 62 }} value={col.slice(1).toUpperCase()} onChange={(e) => { const v = e.target.value.replace(/[^0-9a-f]/gi, ''); if (v.length === 6) set('#' + v.toLowerCase()); }} /></label>
      </div>
      {S.recentColors.length > 0 && <div className="recent">{S.recentColors.map((c) => <button key={c} style={{ background: c }} title={c} onClick={() => set(c)} />)}</div>}
    </div>
  );
}

function SwatchesPanel() {
  useStore();
  return (
    <div className="swatches">
      {S.swatches.map((c, i) => (
        <button key={i} style={{ background: c }} title={`${c} – Klick: Vordergrund, Alt+Klick: Löschen, Rechtsklick: Hintergrund`}
          onClick={(e) => { if (e.altKey) { S.swatches.splice(i, 1); saveSwatches(); } else setFg(c); }}
          onContextMenu={(e) => { e.preventDefault(); setBg(c); }} />
      ))}
      <button className="add" title="Vordergrundfarbe als Farbfeld hinzufügen" onClick={() => { S.swatches.push(S.fg); saveSwatches(); }}><Icon name="plus" size={14} /></button>
    </div>
  );
}

function GradientsPanel() {
  useStore();
  return (
    <div className="grad-list">
      {S.gradients.map((g, i) => (
        <button key={i} className={'grad-row' + (S.gradient.index === i ? ' on' : '')} onClick={() => { S.gradient.index = i; emit(); }} onDoubleClick={() => openDialog('gradientEditor')}>
          <span className="gr-sw" style={{ background: gradientCss(g) }} /><span>{g.name}</span>
        </button>
      ))}
      <button className="btn small" onClick={() => openDialog('gradientEditor')}>Neuer Verlauf…</button>
    </div>
  );
}

function PatternsPanel() {
  useStore();
  return (
    <div className="pat-grid">
      {PATTERNS.map((p) => (
        <button key={p} title={p} className={S.fill.pattern === p ? 'on' : ''} style={{ backgroundImage: `url(${patternCanvas(p).toDataURL()})` }}
          onClick={() => { S.fill.pattern = p; S.stampOpts.pattern = p; emit(); }} onDoubleClick={() => EDIT.fill('pattern')} />
      ))}
      <div className="hint">Doppelklick füllt Auswahl/Ebene</div>
    </div>
  );
}

// ---------------- Eigenschaften ----------------
function PropertiesPanel() {
  useStore();
  const [lockRatio, setLock] = useState(true);
  const d = doc();
  if (!d) return <div className="empty-panel">Kein Dokument geöffnet</div>;
  const l = d.layer;
  if (l && l.type === 'text') {
    return (
      <div className="props">
        <div className="prop-head"><Icon name="type" size={16} /> Textebene</div>
        <Sel value={l.text.font} onChange={(v) => { updateTextLayer(l, { font: v }); commit('Schrift'); }} options={FONTS.map((f) => [f, f])} width="100%" />
        <div className="row">
          <Num label="Größe" value={l.text.size} min={1} max={2000} onChange={(v) => updateTextLayer(l, { size: v })} unit=" Pt" width={50} />
          <input type="color" className="color-in" value={l.text.color} onChange={(e) => updateTextLayer(l, { color: e.target.value })} />
        </div>
        <button className="btn small" onClick={() => L.rasterize()}>Text rastern</button>
      </div>
    );
  }
  return (
    <div className="props">
      <div className="prop-head"><Icon name="doc" size={16} /> Dokument</div>
      <div className="prop-sub"><Icon name="chevron" size={12} /> Leinwand</div>
      <div className="row canvas-size">
        <div className="col">
          <label className="field"><span>B</span><input value={d.w + ' Px'} readOnly onClick={() => openDialog('canvasSize')} /></label>
          <label className="field"><span>H</span><input value={d.h + ' Px'} readOnly onClick={() => openDialog('canvasSize')} /></label>
        </div>
        <button className={'link-btn' + (lockRatio ? ' on' : '')} onClick={() => setLock(!lockRatio)} title="Seitenverhältnis"><Icon name="link" size={16} /></button>
      </div>
      <div className="row wrap">
        <button className="btn small" onClick={() => openDialog('imageSize')}>Bildgröße…</button>
        <button className="btn small" onClick={IMAGE.trim}>Zuschneiden</button>
        <button className="btn small" onClick={() => IMAGE.rotate(90)}>↻ 90°</button>
      </div>
      {l && l.mask && (
        <>
          <div className="prop-sub"><Icon name="mask" size={12} /> Ebenenmaske</div>
          <div className="row wrap">
            <button className="btn small" onClick={L.invertMask}>Umkehren</button>
            <button className="btn small" onClick={L.applyMask}>Anwenden</button>
            <button className="btn small" onClick={() => setLayerProp(l, 'maskEnabled', !l.maskEnabled, 'Maske aktivieren')}>{l.maskEnabled ? 'Deaktivieren' : 'Aktivieren'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function AdjustPanel() {
  const items = [['brightness', '☀', 'Helligkeit/Kontrast'], ['levels', '▥', 'Tonwertkorrektur'], ['curves', '∿', 'Gradationskurven'], ['exposure', '±', 'Belichtung'], ['vibrance', '▽', 'Dynamik'], ['hueSat', '◐', 'Farbton/Sättigung'], ['colorBalance', '⚖', 'Farbbalance'], ['blackWhite', '◑', 'Schwarzweiß'], ['photoFilter', '◎', 'Fotofilter'], ['channelMixer', '⊕', 'Kanalmixer'], ['invert', '◩', 'Umkehren'], ['posterize', '▤', 'Tontrennung'], ['threshold', '◧', 'Schwellenwert'], ['gradientMap', '▭', 'Verlaufsumsetzung'], ['selectiveColor', '✦', 'Selektive Farbkorrektur']];
  return (
    <div className="adj-grid">
      {items.map(([id, ic, n]) => <button key={id} title={n} onClick={() => runAdjustment(id)}><span>{ic}</span></button>)}
      <div className="hint">Korrektur auf aktive Ebene/Auswahl anwenden</div>
    </div>
  );
}

function LibrariesPanel() {
  useStore();
  const [items, setItems] = useState(() => { try { return JSON.parse(localStorage.getItem('sakura.library') || '[]'); } catch (e) { return []; } });
  const save = (v) => { setItems(v); try { localStorage.setItem('sakura.library', JSON.stringify(v)); } catch (e) { toast('Bibliothek ist voll'); } };
  const addLayer = () => {
    const d = doc(); if (!d) return;
    const c = makeCanvas(160, 160 * d.h / d.w); ctx2d(c).drawImage(d.layer.canvas, 0, 0, c.width, c.height);
    const full = d.layer.canvas.toDataURL('image/png');
    if (full.length > 3_000_000) { toast('Ebene zu groß für die Bibliothek'); return; }
    save([...items, { type: 'img', name: d.layer.name, thumb: c.toDataURL(), data: full }]);
  };
  return (
    <div className="lib">
      <div className="row wrap">
        <button className="btn small" onClick={() => save([...items, { type: 'color', c: S.fg }])}>+ Farbe</button>
        <button className="btn small" onClick={addLayer}>+ Ebene als Grafik</button>
      </div>
      <div className="lib-items">
        {items.map((it, i) => it.type === 'color'
          ? <button key={i} className="lib-color" style={{ background: it.c }} title={it.c} onClick={() => setFg(it.c)} onContextMenu={(e) => { e.preventDefault(); save(items.filter((_, j) => j !== i)); }} />
          : <button key={i} className="lib-img" title={it.name + ' – Klick: platzieren · Rechtsklick: entfernen'} onClick={() => { const img = new Image(); img.onload = () => import('../state.js').then((m) => m.placeImage(img, it.name)); img.src = it.data; }} onContextMenu={(e) => { e.preventDefault(); save(items.filter((_, j) => j !== i)); }}><img src={it.thumb} alt="" /></button>)}
        {!items.length && <div className="hint">Speichere Farben und Grafiken für spätere Projekte.</div>}
      </div>
    </div>
  );
}

// ---------------- Ebenen ----------------
const thumbCache = new WeakMap();
function Thumb({ canvas, rev, w = 52, h = 32, mask }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || !canvas) return;
    const prev = thumbCache.get(canvas);
    if (prev === rev && c.dataset.drawn === '1') return;
    thumbCache.set(canvas, rev);
    const x = c.getContext('2d');
    const k = Math.min(w / canvas.width, h / canvas.height);
    const tw = canvas.width * k, th = canvas.height * k;
    x.clearRect(0, 0, w, h);
    if (mask) { x.fillStyle = '#000'; x.fillRect((w - tw) / 2, (h - th) / 2, tw, th); const t = makeCanvas(tw, th); const tx = ctx2d(t); tx.drawImage(canvas, 0, 0, tw, th); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, tw, th); x.drawImage(t, (w - tw) / 2, (h - th) / 2); }
    else {
      for (let yy = 0; yy < th; yy += 4) for (let xx = 0; xx < tw; xx += 4) { x.fillStyle = ((xx + yy) / 4) % 2 ? '#ddd' : '#fff'; x.fillRect((w - tw) / 2 + xx, (h - th) / 2 + yy, 4, 4); }
      x.drawImage(canvas, (w - tw) / 2, (h - th) / 2, tw, th);
    }
    c.dataset.drawn = '1';
  });
  return <canvas ref={ref} width={w} height={h} className="thumb" />;
}

function LayersPanel() {
  useStore();
  const d = doc();
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [fxMenu, setFxMenu] = useState(false);
  const [adjMenu, setAdjMenu] = useState(false);
  if (!d) return <div className="empty-panel"><Blossom size={36} /><br />Öffne oder erstelle ein Bild</div>;
  const l = d.layer;
  const list = d.layers.map((x, i) => ({ x, i })).reverse().filter(({ x }) => !filter || x.name.toLowerCase().includes(filter.toLowerCase()));
  const lockBtn = (k, ic, title) => (
    <button className={'icon-btn small' + (l[k] ? ' on' : '')} title={title} onClick={() => setLayerProp(l, k, !l[k], 'Fixierung')}><Icon name={ic} size={14} /></button>
  );
  return (
    <div className="layers">
      <div className="layers-top">
        <div className="search"><Icon name="zoom" size={13} /><input placeholder="Art" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <button className="icon-btn small" title="Pixelebenen" onClick={() => setFilter('')}><Icon name="image" size={14} /></button>
        <button className="icon-btn small" title="Korrekturen" onClick={() => runAdjustment('levels')}><Icon name="adjust" size={14} /></button>
        <button className="icon-btn small" title="Textebenen" onClick={() => setFilter('text')}><Icon name="type" size={14} /></button>
        <button className="icon-btn small" title="Formebenen" onClick={() => setFilter('form')}><Icon name="rect" size={14} /></button>
      </div>
      <div className="layers-row">
        <Sel value={l.blend} onChange={(v) => setLayerProp(l, 'blend', v, 'Füllmethode')} options={BLEND_MODES} width={150} />
        <Num label="Deckkraft:" value={Math.round(l.opacity * 100)} onChange={(v) => { l.opacity = v / 100; view.request(); emit(); commitLater('Deckkraft'); }} unit="%" width={50} />
      </div>
      <div className="layers-row">
        <span className="lbl">Fixieren:</span>
        {lockBtn('lockAlpha', 'pattern', 'Transparente Pixel fixieren')}
        {lockBtn('lockPixels', 'brush', 'Bildpixel fixieren')}
        {lockBtn('lockPosition', 'move', 'Position fixieren')}
        {lockBtn('lockAll', 'lock', 'Alles fixieren')}
        <Num label="Fläche:" value={Math.round(l.fill * 100)} onChange={(v) => { l.fill = v / 100; view.request(); emit(); commitLater('Fläche'); }} unit="%" width={50} />
      </div>
      <div className="layer-list">
        {list.map(({ x, i }) => (
          <div key={x.id} className={'layer-item' + (i === d.active ? ' active' : '') + (dragFrom === i ? ' dragging' : '')}
            draggable={renaming !== x.id}
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragFrom != null && dragFrom !== i) L.reorder(dragFrom, i); setDragFrom(null); }}
            onMouseDown={() => { if (d.active !== i) { d.active = i; emit(); } }}
            onDoubleClick={(e) => { if (e.target.classList.contains('lname')) return; openDialog('layerStyle', { tab: 'blend' }); }}>
            <button className={'eye' + (x.visible ? '' : ' off')} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => {
              if (e.altKey) { const solo = d.layers.every((y) => y === x || !y.visible); d.layers.forEach((y) => { y.visible = solo ? true : y === x; }); }
              else x.visible = !x.visible;
              view.request(); commit('Sichtbarkeit');
            }}><Icon name="eye" size={15} /></button>
            {x.clip && <span className="clip-arrow">↳</span>}
            <span className={'tw' + (!x.editMask ? ' sel' : '')} onMouseDown={() => { x.editMask = false; emit(); }}>
              {x.type === 'text' ? <span className="text-thumb">T</span> : <Thumb canvas={x.canvas} rev={x.rev} />}
            </span>
            {x.mask && <span className={'tw mask' + (x.editMask ? ' sel' : '')} onMouseDown={(e) => { e.stopPropagation(); d.active = i; x.editMask = true; emit(); }} onClick={(e) => { if (e.shiftKey) { setLayerProp(x, 'maskEnabled', !x.maskEnabled, 'Maske'); } }}>
              <Thumb canvas={x.mask} rev={x.rev} mask w={32} h={32} />{!x.maskEnabled && <span className="mask-off">✕</span>}
            </span>}
            {renaming === x.id
              ? <input className="rename" autoFocus defaultValue={x.name} onBlur={(e) => { x.name = e.target.value || x.name; setRenaming(null); commit('Ebene umbenennen'); }} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }} />
              : <span className={'lname' + (x.isBackground ? ' bg' : '')} onDoubleClick={() => setRenaming(x.id)}>{x.name}</span>}
            {Object.values(x.fx || {}).some((f) => f && f.enabled) && <span className="fx-badge" title="Ebenenstil">fx</span>}
            {(x.lockAll || x.isBackground || x.lockPosition || x.lockPixels) && <span className="lock"><Icon name="lock" size={13} /></span>}
          </div>
        ))}
      </div>
      <div className="layers-bottom">
        <button className="icon-btn" title="Schnittmaske (Alt+Strg+G)" onClick={L.toggleClip}><Icon name="link" size={16} /></button>
        <div className="popwrap">
          <button className="icon-btn" title="Ebenenstil hinzufügen" onClick={() => setFxMenu(!fxMenu)}><span className="fx-txt">fx</span></button>
          {fxMenu && <div className="pop-menu up" onMouseLeave={() => setFxMenu(false)}>
            {[['blend', 'Fülloptionen…'], ['shadow', 'Schlagschatten…'], ['glow', 'Schein nach außen…'], ['stroke', 'Kontur…'], ['inner', 'Schatten nach innen…'], ['overlay', 'Farbüberlagerung…'], ['gradient', 'Verlaufsüberlagerung…']].map(([k, n]) => <div key={k} className="menu-item" onClick={() => { setFxMenu(false); openDialog('layerStyle', { tab: k }); }}>{n}</div>)}
          </div>}
        </div>
        <button className="icon-btn" title="Ebenenmaske hinzufügen" onClick={() => L.addMask(true)}><Icon name="mask" size={16} /></button>
        <div className="popwrap">
          <button className="icon-btn" title="Neue Füll- oder Einstellungsebene" onClick={() => setAdjMenu(!adjMenu)}><Icon name="adjust" size={16} /></button>
          {adjMenu && <div className="pop-menu up" onMouseLeave={() => setAdjMenu(false)}>
            <div className="menu-item" onClick={() => { setAdjMenu(false); L.fillLayer(); }}>Volltonfarbe</div>
            <div className="menu-item" onClick={() => { setAdjMenu(false); L.gradientLayer(); }}>Verlauf</div>
            <div className="menu-item" onClick={() => { setAdjMenu(false); L.patternLayer(); }}>Muster</div>
            <div className="menu-sep" />
            {['brightness', 'levels', 'curves', 'hueSat', 'colorBalance', 'blackWhite', 'gradientMap', 'invert'].map((id) => <div key={id} className="menu-item" onClick={() => { setAdjMenu(false); runAdjustment(id); }}>{id === 'invert' ? 'Umkehren' : ({ brightness: 'Helligkeit/Kontrast…', levels: 'Tonwertkorrektur…', curves: 'Gradationskurven…', hueSat: 'Farbton/Sättigung…', colorBalance: 'Farbbalance…', blackWhite: 'Schwarzweiß…', gradientMap: 'Verlaufsumsetzung…' })[id]}</div>)}
          </div>}
        </div>
        <button className="icon-btn" title="Ebene duplizieren" onClick={L.duplicate}><Icon name="folder" size={16} /></button>
        <button className="icon-btn" title="Neue Ebene (Umschalt+Strg+N)" onClick={L.add}><Icon name="newLayer" size={16} /></button>
        <button className="icon-btn" title="Ebene löschen" onClick={L.remove}><Icon name="trash" size={16} /></button>
      </div>
    </div>
  );
}

function ChannelsPanel() {
  useStore();
  const d = doc();
  if (!d) return <div className="empty-panel">Kein Dokument</div>;
  const cv = d.channelView;
  const all = cv.r && cv.g && cv.b;
  const setCh = (o) => { d.channelView = o; view.request(); emit(); };
  const row = (key, name, active, onClick, sc) => (
    <div className={'layer-item' + (active ? ' active' : '')} onClick={onClick} key={key}>
      <span className="eye"><Icon name="eye" size={14} /></span>
      <span className="lname">{name}</span><span className="mi-key">{sc}</span>
    </div>
  );
  return (
    <div className="layers">
      <div className="layer-list">
        {row('rgb', 'RGB', all, () => setCh({ r: true, g: true, b: true }), 'Strg+2')}
        {row('r', 'Rot', cv.r && !cv.g && !cv.b, () => setCh({ r: true, g: false, b: false }), 'Strg+3')}
        {row('g', 'Grün', !cv.r && cv.g && !cv.b, () => setCh({ r: false, g: true, b: false }), 'Strg+4')}
        {row('b', 'Blau', !cv.r && !cv.g && cv.b, () => setCh({ r: false, g: false, b: true }), 'Strg+5')}
        {d.alphaChannels.map((a, i) => (
          <div key={'a' + i} className="layer-item" onClick={() => SELECT.load(i)} title="Klick: als Auswahl laden">
            <Thumb canvas={a.canvas} rev={i} mask w={32} h={24} /><span className="lname">{a.name}</span>
            <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); d.alphaChannels.splice(i, 1); commit('Kanal löschen'); }}><Icon name="trash" size={13} /></button>
          </div>
        ))}
      </div>
      <div className="layers-bottom">
        <button className="icon-btn" title="Kanal als Auswahl laden" onClick={() => d.alphaChannels.length && SELECT.load(d.alphaChannels.length - 1)}><Icon name="marquee" size={16} /></button>
        <button className="icon-btn" title="Auswahl als Kanal speichern" onClick={() => SELECT.save()}><Icon name="mask" size={16} /></button>
      </div>
    </div>
  );
}

function PathsPanel() {
  useStore();
  const d = doc();
  if (!d) return <div className="empty-panel">Kein Dokument</div>;
  return (
    <div className="layers">
      <div className="layer-list">
        {d.paths.map((p, i) => (
          <div key={i} className={'layer-item' + (i === d.activePath ? ' active' : '')} onClick={() => { d.activePath = i; view.overlay(); emit(); }}>
            <Icon name="pen" size={14} /><span className="lname">{p.name}</span>
          </div>
        ))}
        {!d.paths.length && <div className="hint pad">Mit dem Zeichenstift (P) Pfade erstellen</div>}
      </div>
      <div className="layers-bottom">
        <button className="icon-btn" title="Pfad mit Vordergrundfarbe füllen" onClick={PATHS.fill}><Icon name="bucket" size={16} /></button>
        <button className="icon-btn" title="Pfadkontur mit Pinsel füllen" onClick={PATHS.stroke}><Icon name="brush" size={16} /></button>
        <button className="icon-btn" title="Pfad als Auswahl laden" onClick={PATHS.toSelection}><Icon name="marquee" size={16} /></button>
        <button className="icon-btn" title="Arbeitspfad aus Auswahl" onClick={PATHS.fromSelection}><Icon name="pen" size={16} /></button>
        <button className="icon-btn" title="Pfad löschen" onClick={() => d.activePath >= 0 && PATHS.remove(d.activePath)}><Icon name="trash" size={16} /></button>
      </div>
    </div>
  );
}

// ---------------- Seitenleiste (Protokoll, Navigator, Info …) ----------------
export function SideStrip() {
  useStore();
  const items = [['history', 'history', 'Protokoll'], ['navigator', 'navigator', 'Navigator'], ['info', 'info', 'Info'], ['brushes', 'brushes', 'Pinsel'], ['character', 'character', 'Zeichen'], ['paragraph', 'paragraph', 'Absatz']];
  return (
    <div className="side-strip" data-tut="side">
      <div className="tb-grip" />
      {items.map(([k, ic, n]) => (
        <button key={k} className={'tool' + (S.ui.flyout === k ? ' active' : '')} title={n} onClick={() => { S.ui.flyout = S.ui.flyout === k ? null : k; emit(); }}><Icon name={ic} size={20} /></button>
      ))}
    </div>
  );
}

export function Flyout() {
  useStore();
  const f = S.ui.flyout;
  if (!f) return null;
  const title = { history: 'Protokoll', navigator: 'Navigator', info: 'Info', brushes: 'Pinsel', character: 'Zeichen', paragraph: 'Absatz' }[f];
  return (
    <div className="flyout">
      <div className="panel-tabs"><button className="on">{title}</button><div className="flex" /><button className="panel-menu" onClick={() => { S.ui.flyout = null; emit(); }}><Icon name="close" size={13} /></button></div>
      <div className="panel-body">
        {f === 'history' && <HistoryPanel />}
        {f === 'navigator' && <NavigatorPanel />}
        {f === 'info' && <InfoPanel />}
        {f === 'brushes' && <BrushesPanel />}
        {f === 'character' && <CharacterPanel />}
        {f === 'paragraph' && <ParagraphPanel />}
      </div>
    </div>
  );
}

function HistoryPanel() {
  useStore();
  const d = doc();
  if (!d) return <div className="empty-panel">Kein Dokument</div>;
  return (
    <div className="history">
      {d.history.map((h, i) => (
        <div key={i} className={'hist-item' + (i === d.histIdx ? ' active' : '') + (i > d.histIdx ? ' future' : '')} onClick={() => { d.restore(i); view.request(); emit(); }}>
          <button className={'hsrc' + ((d.historySource ?? 0) === i ? ' on' : '')} title="Quelle für Protokollpinsel" onClick={(e) => { e.stopPropagation(); d.historySource = i; emit(); }}>✎</button>
          <span>{h.name}</span>
        </div>
      ))}
    </div>
  );
}

function NavigatorPanel() {
  useStore();
  const d = doc();
  const ref = useRef(null);
  useEffect(() => {
    if (!d || !ref.current) return;
    const c = ref.current; const x = c.getContext('2d');
    const k = Math.min(c.width / d.w, c.height / d.h);
    x.clearRect(0, 0, c.width, c.height);
    const tmp = makeCanvas(d.w, d.h); import('../engine/doc.js').then((m) => { m.composite(d, tmp); x.drawImage(tmp, (c.width - d.w * k) / 2, (c.height - d.h * k) / 2, d.w * k, d.h * k); });
  });
  if (!d) return <div className="empty-panel">Kein Dokument</div>;
  return (
    <div className="nav">
      <canvas ref={ref} width={240} height={150} />
      <Num label="Zoom" value={Math.round(d.zoom * 100)} min={2} max={6400} onChange={(v) => { d.zoom = v / 100; view.request(); emit(); }} unit="%" width={56} />
    </div>
  );
}

function InfoPanel() {
  useStore();
  const d = doc();
  if (!d) return <div className="empty-panel">Kein Dokument</div>;
  const c = S.cursor;
  let rgb = '—';
  if (c.inside && c.x >= 0 && c.y >= 0 && c.x < d.w && c.y < d.h) {
    const p = ctx2d(d.layer.canvas).getImageData(Math.floor(c.x), Math.floor(c.y), 1, 1).data;
    rgb = `R ${p[0]}  G ${p[1]}  B ${p[2]}  A ${p[3]}`;
  }
  const h = histogram(d.layer.canvas);
  const max = Math.max(...h.l, 1);
  return (
    <div className="info">
      <div className="info-row"><b>RGB</b> {rgb}</div>
      <div className="info-row"><b>X/Y</b> {c.inside ? `${Math.floor(c.x)}, ${Math.floor(c.y)} Px` : '—'}</div>
      <div className="info-row"><b>Dok</b> {d.w} × {d.h} Px · {d.layers.length} Ebenen · {d.history.length} Schritte</div>
      <svg className="histo" viewBox="0 0 256 80" preserveAspectRatio="none">
        <path d={'M0 80 ' + Array.from(h.l).map((v, i) => `L${i} ${80 - (v / max) * 78}`).join(' ') + ' L255 80Z'} fill="rgba(255,154,213,0.65)" />
      </svg>
    </div>
  );
}

function BrushesPanel() {
  useStore();
  const presets = [['Hart rund 5', 5, 1, 'round'], ['Hart rund 19', 19, 1, 'round'], ['Weich rund 45', 45, 0, 'round'], ['Weich rund 100', 100, 0, 'round'], ['Airbrush 200', 200, 0, 'round'], ['Kirschblüte', 40, 1, 'blossom'], ['Sterne', 30, 1, 'star'], ['Quadrat', 20, 1, 'square']];
  return (
    <div className="brushes">
      {presets.map(([n, s, h, sh]) => (
        <button key={n} className={'grad-row' + (S.brush.size === s && S.brush.shape === sh ? ' on' : '')} onClick={() => { Object.assign(S.brush, { size: s, hardness: h, shape: sh, spacing: sh === 'round' ? 0.12 : 1.1, scatter: sh === 'round' ? 0 : 0.6, jitter: sh === 'round' ? 0 : 0.5 }); S.tool = 'brush'; S.sub.brush = 'brush'; emit(); }}>
          <span className="brush-dot" style={{ width: Math.min(24, 4 + s / 8), height: Math.min(24, 4 + s / 8), filter: `blur(${(1 - h) * 3}px)`, borderRadius: sh === 'square' ? 0 : '50%' }} />{n}
        </button>
      ))}
      <Num label="Größe" value={S.brush.size} min={1} max={2500} onChange={(v) => { S.brush.size = v; emit(); }} unit=" Px" width={56} />
      <Num label="Härte" value={Math.round(S.brush.hardness * 100)} onChange={(v) => { S.brush.hardness = v / 100; emit(); }} unit="%" />
      <Num label="Abstand" value={Math.round(S.brush.spacing * 100)} min={1} max={300} onChange={(v) => { S.brush.spacing = v / 100; emit(); }} unit="%" />
      <Num label="Streuung" value={Math.round(S.brush.scatter * 100)} min={0} max={200} onChange={(v) => { S.brush.scatter = v / 100; emit(); }} unit="%" />
    </div>
  );
}

function CharacterPanel() {
  useStore();
  const d = doc();
  const tl = d && (S.ui.textEdit ? d.layers.find((l) => l.id === S.ui.textEdit.layerId) : (d.layer.type === 'text' ? d.layer : null));
  const v = (k) => (tl ? tl.text[k] : S.text[k]);
  const upd = (k) => (val) => { S.text[k] = val; if (tl) updateTextLayer(tl, { [k]: val }); emit(); };
  return (
    <div className="props">
      <Sel value={v('font')} onChange={upd('font')} options={FONTS.map((f) => [f, f])} width="100%" />
      <div className="row"><Num label="Größe" value={v('size')} min={1} max={2000} onChange={upd('size')} unit=" Pt" width={50} /><Num label="Zeilenabst." value={Math.round(v('leading') * 100)} min={50} max={400} onChange={(x) => upd('leading')(x / 100)} unit="%" /></div>
      <div className="row"><Num label="Laufweite" value={v('tracking')} min={-50} max={200} onChange={upd('tracking')} unit=" Px" /><input type="color" className="color-in" value={v('color') || S.fg} onChange={(e) => upd('color')(e.target.value)} /></div>
      <div className="seg wide">
        {[['bold', 'F', 'Fett'], ['italic', 'K', 'Kursiv'], ['caps', 'TT', 'Großbuchstaben'], ['underline', 'U', 'Unterstrichen'], ['strike', 'S', 'Durchgestrichen']].map(([k, n, t]) => (
          <button key={k} title={t} className={v(k) ? 'on' : ''} style={{ fontWeight: k === 'bold' ? 700 : 400, fontStyle: k === 'italic' ? 'italic' : 'normal', textDecoration: k === 'underline' ? 'underline' : k === 'strike' ? 'line-through' : 'none' }} onClick={() => upd(k)(!v(k))}>{n}</button>
        ))}
      </div>
      {!tl && <div className="hint">Einstellungen gelten für den nächsten Text (T).</div>}
    </div>
  );
}

function ParagraphPanel() {
  useStore();
  const d = doc();
  const tl = d && (d.layer.type === 'text' ? d.layer : null);
  const v = tl ? tl.text.align : S.text.align;
  return (
    <div className="props">
      <div className="seg wide">
        {[['left', 'alignL', 'Linksbündig'], ['center', 'alignHC', 'Zentriert'], ['right', 'alignR', 'Rechtsbündig']].map(([a, ic, t]) => (
          <button key={a} title={t} className={v === a ? 'on' : ''} onClick={() => { S.text.align = a; if (tl) updateTextLayer(tl, { align: a }); emit(); }}><Icon name={ic} size={16} /></button>
        ))}
      </div>
      <Check label="Glätten" value={S.text.aa} onChange={(x) => { S.text.aa = x; emit(); }} />
    </div>
  );
}
