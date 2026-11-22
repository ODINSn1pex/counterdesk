import { StylesPanel, CompsPanel, NotesPanel } from './PanelsExtra.jsx';
import { useEffect, useRef, useState } from 'react';
import { S, emit, useStore, useCursor, doc, view, commit, setFg, setBg, L, SELECT, openDialog, saveSwatches, setLayerProp, commitLater, PATTERNS, patternCanvas, toast, IMAGE, EDIT, ADJ_LAYER_TYPES, renderShapeLayer, startTransform } from '../state.js';
import { ADJUSTMENTS, FILTERS } from '../engine/filters.js';
import { childrenOf, descendants, effectiveVisible } from '../engine/doc.js';
import { ParamRow, CurvesEditor, LevelsHisto } from './Dialogs.jsx';
import { playAction, saveActions, startRecording, stopRecording, stepLabel } from '../actions.js';
import { REC, ARTBOARDS } from '../state.js';
import { fmtUnit } from './CanvasView.jsx';
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
      <PanelGroup id="color" tut="panel-color" tabs={[['color', 'Farbe'], ['swatches', 'Farbfelder'], ['gradients', 'Verläufe'], ['patterns', 'Muster'], ['styles', 'Stile']]}>
        {(t) => t === 'color' ? <ColorPanel /> : t === 'swatches' ? <SwatchesPanel /> : t === 'gradients' ? <GradientsPanel /> : t === 'styles' ? <StylesPanel /> : <PatternsPanel />}
      </PanelGroup>
      <PanelGroup id="props" tut="panel-props" tabs={[['props', 'Eigenschaften'], ['adjust', 'Korrekturen'], ['comps', 'Komp.'], ['notes', 'Notizen'], ['libs', 'Bibliotheken']]}>
        {(t) => t === 'props' ? <PropertiesPanel /> : t === 'adjust' ? <AdjustPanel /> : t === 'comps' ? <CompsPanel /> : t === 'notes' ? <NotesPanel /> : <LibrariesPanel />}
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
function AdjustLayerProps({ l }) {
  const def = ADJUSTMENTS[l.adjust.id];
  const p = l.adjust.params;
  const setP = (np) => { l.adjust.params = typeof np === 'function' ? np(l.adjust.params) : np; l.touch(); view.request(); emit(); commitLater('Einstellungsebene'); };
  return (
    <div className="props">
      <div className="prop-head"><Icon name="adjust" size={16} /> {def.name.replace('…', '')}</div>
      {def.custom === 'curves' && <CurvesEditor p={p} setP={setP} />}
      {def.custom === 'levels' && <LevelsHisto p={p} />}
      <div className="params compact">
        {def.params.map((x) => <ParamRow key={x.key} x={x} value={p[x.key]} onChange={(v) => setP({ ...l.adjust.params, [x.key]: v })} />)}
      </div>
      <div className="row wrap">
        <button className="btn small" onClick={() => setP(Object.fromEntries(def.params.map((x) => [x.key, x.def])))}>Zurücksetzen</button>
        <button className="btn small" title="Wirkt nur auf die Ebene direkt darunter" onClick={L.toggleClip}>{l.clip ? 'Schnittmaske lösen' : 'Nur auf Ebene darunter'}</button>
      </div>
      <div className="hint">Nicht-destruktiv: Die Werte lassen sich jederzeit ändern. Male in die Maske, um die Wirkung zu begrenzen.</div>
    </div>
  );
}

function ShapeLayerProps({ l }) {
  const d = doc();
  const s = l.shape;
  const set = (k, v, live) => { l.shape = { ...l.shape, [k]: v }; renderShapeLayer(l, d.w, d.h); view.request(); emit(); if (!live) commitLater('Form ändern'); else commitLater('Form ändern', 600); };
  return (
    <div className="props">
      <div className="prop-head"><Icon name={s.kind === 'line' ? 'line' : s.kind === 'ellipse' ? 'ellipse' : s.kind} size={16} /> Formebene</div>
      <div className="row wrap">
        <Num label="X" value={Math.round(Math.min(s.x, s.x + s.w))} min={-30000} max={30000} scrub={false} width={56} onChange={(v) => set('x', s.w < 0 ? v - s.w : v)} />
        <Num label="Y" value={Math.round(Math.min(s.y, s.y + s.h))} min={-30000} max={30000} scrub={false} width={56} onChange={(v) => set('y', s.h < 0 ? v - s.h : v)} />
        <Num label="B" value={Math.round(Math.abs(s.w))} min={1} max={30000} scrub={false} width={56} onChange={(v) => set('w', Math.sign(s.w || 1) * v)} />
        <Num label="H" value={Math.round(Math.abs(s.h))} min={1} max={30000} scrub={false} width={56} onChange={(v) => set('h', Math.sign(s.h || 1) * v)} />
        <Num label="∡" value={Math.round((s.rot || 0) * 180 / Math.PI)} min={-360} max={360} onChange={(v) => set('rot', v * Math.PI / 180)} unit="°" width={44} />
      </div>
      {s.kind !== 'line' && <div className="row wrap">
        <Check label="Fläche" value={s.fillOn !== false} onChange={(v) => set('fillOn', v)} />
        <input type="color" className="color-in" value={s.fillColor} onChange={(e) => set('fillColor', e.target.value, true)} />
        <Check label="Kontur" value={!!s.strokeOn} onChange={(v) => set('strokeOn', v)} />
        <input type="color" className="color-in" value={s.strokeColor} onChange={(e) => set('strokeColor', e.target.value, true)} />
        <Num value={s.strokeWidth} min={1} max={500} onChange={(v) => set('strokeWidth', v)} unit=" Px" width={44} />
      </div>}
      {s.kind === 'line' && <div className="row wrap">
        <input type="color" className="color-in" value={s.fillColor} onChange={(e) => set('fillColor', e.target.value, true)} />
        <Num label="Stärke" value={s.lineWidth} min={1} max={500} onChange={(v) => set('lineWidth', v)} unit=" Px" width={44} />
        <Check label="Pfeilspitze" value={!!s.arrow} onChange={(v) => set('arrow', v)} />
      </div>}
      {(s.kind === 'rounded' || s.kind === 'rect') && !s.radii && <div className="row"><Num label="Eckenradius" value={s.radius || 0} min={0} max={2000} onChange={(v) => { if (s.kind === 'rect') set('kind', 'rounded'); set('radius', v); }} unit=" Px" width={50} />
        <button className="btn small" title="Jede Ecke einzeln" onClick={() => { const r = s.radius || 0; set('kind', 'rounded'); set('radii', [r, r, r, r]); }}>Einzeln</button></div>}
      {s.radii && <div className="row">{['↖', '↗', '↘', '↙'].map((n, i) => <Num key={i} label={n} value={s.radii[i] || 0} min={0} max={2000} onChange={(v) => { const r = [...s.radii]; r[i] = v; set('radii', r); }} width={38} />)}
        <button className="btn small" title="Gemeinsamer Radius" onClick={() => set('radii', null)}>⛓</button></div>}
      {(s.kind === 'polygon' || s.kind === 'star') && <Num label="Seiten" value={s.sides} min={3} max={64} onChange={(v) => set('sides', v)} width={40} />}
      {s.kind === 'star' && <Num label="Einzug" value={Math.round(s.starInner * 100)} min={5} max={95} onChange={(v) => set('starInner', v / 100)} unit="%" width={40} />}
      <button className="btn small" onClick={() => L.rasterize()}>Form rastern</button>
    </div>
  );
}

function SmartLayerProps({ l }) {
  const t = l.smart.t;
  return (
    <div className="props">
      <div className="prop-head"><Icon name="image" size={16} /> Smart-Objekt</div>
      <div className="hint">Quelle: {l.smart.src.width} × {l.smart.src.height} Px · Skalierung {Math.round(Math.abs(t.sx) * 100)} % × {Math.round(Math.abs(t.sy) * 100)} %{t.mesh ? ' · verformt' : ''}</div>
      <div className="row wrap">
        <button className="btn small" onClick={() => startTransform()}>Transformieren</button>
        <button className="btn small" onClick={L.editSmart}>Inhalt bearbeiten</button>
        <button className="btn small" onClick={L.replaceSmart}>Inhalt ersetzen…</button>
        <button className="btn small" onClick={() => L.rasterize()}>Rastern</button>
      </div>
      {(l.smart.filters || []).length > 0 && <div className="hint">Smartfilter: {l.smart.filters.length} (siehe Ebenen-Bedienfeld)</div>}
      <div className="hint">Transformationen sind verlustfrei. Filter werden als Smartfilter gespeichert und bleiben abschaltbar.</div>
    </div>
  );
}

function GroupProps({ l }) {
  const d = doc();
  return (
    <div className="props">
      <div className="prop-head"><Icon name="folder" size={16} /> Gruppe</div>
      <div className="hint">{descendants(d.layers, l).length} Ebenen · Füllmethode „{l.blend === 'pass' ? 'Hindurchwirken' : l.blend}“</div>
      <div className="row wrap">
        <button className="btn small" onClick={L.ungroup}>Gruppierung aufheben</button>
        <button className="btn small" onClick={L.mergeDown}>Gruppe zusammenfügen</button>
        <button className="btn small" onClick={L.toSmart}>In Smart-Objekt</button>
      </div>
    </div>
  );
}

function PropertiesPanel() {
  useStore();
  const [lockRatio, setLock] = useState(true);
  const d = doc();
  if (!d) return <div className="empty-panel">Kein Dokument geöffnet</div>;
  const l = d.layer;
  let layerPart = null;
  if (l && l.type === 'adjust') layerPart = <AdjustLayerProps l={l} key={l.id} />;
  else if (l && l.type === 'shape' && l.shape) layerPart = <ShapeLayerProps l={l} key={l.id} />;
  else if (l && l.type === 'smart' && l.smart) layerPart = <SmartLayerProps l={l} key={l.id} />;
  else if (l && l.type === 'group') layerPart = <GroupProps l={l} key={l.id} />;
  else if (l && l.type === 'text') layerPart = (
    <div className="props">
      <div className="prop-head"><Icon name="type" size={16} /> Textebene</div>
      <Sel value={l.text.font} onChange={(v) => { updateTextLayer(l, { font: v }); commit('Schrift'); }} options={FONTS.map((f) => [f, f])} width="100%" />
      <div className="row">
        <Num label="Größe" value={l.text.size} min={1} max={2000} onChange={(v) => { updateTextLayer(l, { size: v }); commitLater('Schriftgröße'); }} unit=" Pt" width={50} />
        <input type="color" className="color-in" value={l.text.color} onChange={(e) => { updateTextLayer(l, { color: e.target.value }); commitLater('Textfarbe'); }} />
      </div>
      <div className="row wrap">
        <button className="btn small" onClick={() => { S.ui.flyout = 'character'; emit(); }}>Zeichen…</button>
        <button className="btn small" onClick={() => L.rasterize()}>Text rastern</button>
      </div>
    </div>
  );
  if (layerPart) return <div className="props-scroll">{layerPart}{l.mask && <MaskProps l={l} />}</div>;
  return (
    <div className="props">
      <div className="prop-head"><Icon name="doc" size={16} /> Dokument</div>
      <div className="prop-sub"><Icon name="chevron" size={12} /> Leinwand</div>
      <div className="row canvas-size">
        <div className="col">
          <Num label="B" value={d.w} min={1} max={30000} scrub={false} width={96} unit=" Px" onChange={(v) => { v = Math.round(v); if (v === d.w) return; IMAGE.canvasSize(v, lockRatio ? Math.max(1, Math.round(d.h * v / d.w)) : d.h); }} />
          <Num label="H" value={d.h} min={1} max={30000} scrub={false} width={96} unit=" Px" onChange={(v) => { v = Math.round(v); if (v === d.h) return; IMAGE.canvasSize(lockRatio ? Math.max(1, Math.round(d.w * v / d.h)) : d.w, v); }} />
        </div>
        <button className={'link-btn' + (lockRatio ? ' on' : '')} onClick={() => setLock(!lockRatio)} title={lockRatio ? 'Seitenverhältnis beibehalten (an)' : 'Seitenverhältnis beibehalten (aus)'}><Icon name="link" size={16} /></button>
      </div>
      <div className="hint">Ändert die Arbeitsfläche (zentriert). Für Skalieren: Bildgröße.</div>
      <div className="row wrap">
        <button className="btn small" onClick={() => openDialog('imageSize')}>Bildgröße…</button>
        <button className="btn small" onClick={IMAGE.trim}>Zuschneiden</button>
        <button className="btn small" onClick={() => IMAGE.rotate(90)}>↻ 90°</button>
      </div>
      {(d.artboards || []).length > 0 && <>
        <div className="prop-sub"><Icon name="navigator" size={12} /> Zeichenflächen</div>
        {d.artboards.map((ab, i) => (
          <div key={i} className="row ab-row">
            <input className="rename" defaultValue={ab.name} key={ab.name + i} onBlur={(e) => { if (e.target.value && e.target.value !== ab.name) ARTBOARDS.rename(i, e.target.value); }} />
            <span className="muted">{ab.w}×{ab.h}</span>
            <button className="icon-btn small" title="Zeichenfläche entfernen (Ebenen bleiben erhalten)" onClick={() => ARTBOARDS.remove(i)}><Icon name="trash" size={12} /></button>
          </div>
        ))}
        <button className="btn small" onClick={() => ARTBOARDS.exportAll('png')}>Alle exportieren…</button>
      </>}
      {l && l.mask && <MaskProps l={l} />}
    </div>
  );
}

function MaskProps({ l }) {
  return (
    <>
      <div className="prop-sub"><Icon name="mask" size={12} /> Ebenenmaske</div>
      <div className="row wrap">
        <button className="btn small" onClick={L.invertMask}>Umkehren</button>
        {l.hasPixels && <button className="btn small" onClick={L.applyMask}>Anwenden</button>}
        <button className="btn small" onClick={() => setLayerProp(l, 'maskEnabled', !l.maskEnabled, 'Maske aktivieren')}>{l.maskEnabled ? 'Deaktivieren' : 'Aktivieren'}</button>
        <button className="btn small" onClick={L.deleteMask}>Löschen</button>
      </div>
    </>
  );
}

function AdjustPanel() {
  const items = [['brightness', '☀', 'Helligkeit/Kontrast'], ['levels', '▥', 'Tonwertkorrektur'], ['curves', '∿', 'Gradationskurven'], ['exposure', '±', 'Belichtung'], ['vibrance', '▽', 'Dynamik'], ['hueSat', '◐', 'Farbton/Sättigung'], ['colorBalance', '⚖', 'Farbbalance'], ['blackWhite', '◑', 'Schwarzweiß'], ['photoFilter', '◎', 'Fotofilter'], ['channelMixer', '⊕', 'Kanalmixer'], ['invert', '◩', 'Umkehren'], ['posterize', '▤', 'Tontrennung'], ['threshold', '◧', 'Schwellenwert'], ['gradientMap', '▭', 'Verlaufsumsetzung'], ['selectiveColor', '✦', 'Selektive Farbkorrektur']];
  return (
    <div className="adj-grid">
      {items.map(([id, ic, n]) => <button key={id} title={n + ' – als Einstellungsebene (Alt+Klick: direkt auf Ebene anwenden)'} onClick={(e) => (e.altKey ? runAdjustment(id) : L.adjustLayer(id))}><span>{ic}</span></button>)}
      <div className="hint">Klick: neue Einstellungsebene (nicht-destruktiv) · Alt+Klick: direkt auf die Ebene anwenden</div>
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
    const key = rev + ':' + w + 'x' + h;
    if (c.dataset.key === key) return;
    c.dataset.key = key;
    const x = c.getContext('2d');
    const k = Math.min(w / canvas.width, h / canvas.height);
    const tw = canvas.width * k, th = canvas.height * k;
    x.clearRect(0, 0, w, h);
    if (mask) { x.fillStyle = '#000'; x.fillRect((w - tw) / 2, (h - th) / 2, tw, th); const t = makeCanvas(tw, th); const tx = ctx2d(t); tx.drawImage(canvas, 0, 0, tw, th); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, tw, th); x.drawImage(t, (w - tw) / 2, (h - th) / 2); }
    else {
      for (let yy = 0; yy < th; yy += 4) for (let xx = 0; xx < tw; xx += 4) { x.fillStyle = ((xx + yy) / 4) % 2 ? '#ddd' : '#fff'; x.fillRect((w - tw) / 2 + xx, (h - th) / 2 + yy, 4, 4); }
      x.drawImage(canvas, (w - tw) / 2, (h - th) / 2, tw, th);
    }
  });
  return <canvas ref={ref} width={w} height={h} className="thumb" />;
}

function LayersPanel() {
  useStore();
  const d = doc();
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('all');
  const [renaming, setRenaming] = useState(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [dropHint, setDropHint] = useState(null);
  const [fxMenu, setFxMenu] = useState(false);
  const [adjMenu, setAdjMenu] = useState(false);
  if (!d) return <div className="empty-panel"><Blossom size={36} /><br />Öffne oder erstelle ein Bild</div>;
  const l = d.layer;
  const kindOk = (x) => kind === 'all' || (kind === 'text' && x.type === 'text') || (kind === 'pixel' && x.type === 'raster') || (kind === 'adjust' && x.type === 'adjust') || (kind === 'shape' && x.type === 'shape') || (kind === 'smart' && x.type === 'smart') || (kind === 'mask' && !!x.mask) || (kind === 'fx' && Object.values(x.fx || {}).some((f) => f && f.enabled));
  const filtering = kind !== 'all' || !!filter;
  const rows = [];
  if (filtering) d.layers.slice().reverse().forEach((x) => { if (kindOk(x) && (!filter || x.name.toLowerCase().includes(filter.toLowerCase()))) rows.push({ x, depth: 0 }); });
  else {
    const walk = (pid, depth) => childrenOf(d.layers, pid).slice().reverse().forEach((x) => { rows.push({ x, depth }); if (x.type === 'group' && !x.collapsed) walk(x.id, depth + 1); });
    walk(null, 0);
  }
  const tsz = { small: [36, 24], medium: [52, 32], large: [72, 46] }[S.prefs.thumbSize] || [52, 32];
  const lockBtn = (k, ic, title) => (
    <button className={'icon-btn small' + (l[k] ? ' on' : '')} title={title} onClick={() => setLayerProp(l, k, !l[k], 'Fixierung')}><Icon name={ic} size={14} /></button>
  );
  return (
    <div className="layers">
      <div className="layers-top">
        <div className="search"><Icon name="zoom" size={13} /><input placeholder="Ebenen suchen" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        {[['pixel', 'image', 'Nur Pixelebenen'], ['adjust', 'adjust', 'Nur Einstellungsebenen'], ['text', 'type', 'Nur Textebenen'], ['shape', 'rect', 'Nur Formebenen'], ['smart', 'object', 'Nur Smart-Objekte'], ['fx', 'fx', 'Nur Ebenen mit Stil']].map(([k, ic, t]) => (
          <button key={k} className={'icon-btn small' + (kind === k ? ' on' : '')} title={t} onClick={() => setKind(kind === k ? 'all' : k)}>{k === 'fx' ? <span className="fx-txt">fx</span> : <Icon name={ic} size={14} />}</button>
        ))}
      </div>
      <div className="layers-row">
        <Sel value={l.blend} onChange={(v) => setLayerProp(l, 'blend', v, 'Füllmethode')} options={l.type === 'group' ? [['pass', 'Hindurchwirken'], ...BLEND_MODES] : BLEND_MODES} width={150} />
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
      <div className="layer-list" onDragOver={(e) => e.preventDefault()}>
        {!rows.length && <div className="hint pad">Keine passenden Ebenen</div>}
        {rows.map(({ x, depth }) => {
          const i = d.layers.indexOf(x);
          const hidden = !x.visible || !effectiveVisible(d.layers, x);
          return (
            <div key={x.id}>
              <div className={'layer-item' + (i === d.active ? ' active' : '') + (dragFrom === x ? ' dragging' : '') + (hidden ? ' dim' : '') + (dropHint && dropHint.target === x ? ' drop-' + dropHint.where : '')}
                style={{ paddingLeft: 6 + depth * 18 }}
                draggable={renaming !== x.id}
                onDragStart={(e) => { setDragFrom(x); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDragFrom(null); setDropHint(null); }}
                onDragOver={(e) => {
                  e.preventDefault(); if (!dragFrom) return;
                  const r = e.currentTarget.getBoundingClientRect(); const f = (e.clientY - r.top) / r.height;
                  const where = x.type === 'group' && f > 0.25 && f < 0.75 ? 'into' : f < 0.5 ? 'above' : 'below';
                  if (!dropHint || dropHint.target !== x || dropHint.where !== where) setDropHint({ target: x, where });
                }}
                onDrop={(e) => { e.preventDefault(); if (dragFrom && dropHint) L.dropOn(dragFrom, dropHint.target, dropHint.where); setDragFrom(null); setDropHint(null); }}
                onMouseDown={() => { if (d.active !== i) { d.active = i; emit(); } }}
                onDoubleClick={(e) => { if (e.target.classList.contains('lname')) return; if (x.type === 'adjust' || x.type === 'shape' || x.type === 'smart') { S.ui.panelTabs.props = 'props'; delete S.ui.hiddenPanels.props; emit(); return; } if (x.type === 'group') { L.toggleCollapse(x); return; } openDialog('layerStyle', { tab: 'blend' }); }}>
                <button className={'eye' + (x.visible ? '' : ' off')} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => {
                  if (e.altKey) { const solo = d.layers.every((y) => y === x || !y.visible); d.layers.forEach((y) => { y.visible = solo ? true : y === x; }); }
                  else x.visible = !x.visible;
                  view.request(); commit('Sichtbarkeit');
                }}><Icon name="eye" size={15} /></button>
                {x.type === 'group' && <button className={'twisty' + (x.collapsed ? '' : ' open')} onMouseDown={(e) => e.stopPropagation()} onClick={() => L.toggleCollapse(x)}><Icon name="chevron" size={12} /></button>}
                {x.clip && <span className="clip-arrow">↳</span>}
                <span className={'tw' + (!x.editMask ? ' sel' : '')} onMouseDown={() => { x.editMask = false; emit(); }}>
                  {x.type === 'text' ? <span className="text-thumb" style={{ width: tsz[0], height: tsz[1] }}>T</span>
                    : x.type === 'group' ? <span className="text-thumb" style={{ width: tsz[1], height: tsz[1] }}><Icon name="folder" size={18} /></span>
                    : x.type === 'adjust' ? <span className="text-thumb adj" style={{ width: tsz[1], height: tsz[1] }}><Icon name="adjust" size={18} /></span>
                    : <span className="thumbwrap"><Thumb canvas={x.canvas} rev={x.rev} w={tsz[0]} h={tsz[1]} />{x.type === 'smart' && <span className="badge" title="Smart-Objekt">▣</span>}{x.type === 'shape' && <span className="badge" title="Formebene">◆</span>}</span>}
                </span>
                {x.mask && <span className={'tw mask' + (x.editMask ? ' sel' : '')} onMouseDown={(e) => { e.stopPropagation(); d.active = i; x.editMask = true; emit(); }} onClick={(e) => { if (e.shiftKey) { setLayerProp(x, 'maskEnabled', !x.maskEnabled, 'Maske'); } }}>
                  <Thumb canvas={x.mask} rev={x.rev} mask w={tsz[1]} h={tsz[1]} />{!x.maskEnabled && <span className="mask-off">✕</span>}
                </span>}
                {renaming === x.id
                  ? <input className="rename" autoFocus defaultValue={x.name} onBlur={(e) => { x.name = e.target.value || x.name; setRenaming(null); commit('Ebene umbenennen'); }} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }} />
                  : <span className={'lname' + (x.isBackground ? ' bg' : '')} onDoubleClick={() => setRenaming(x.id)}>{x.name}</span>}
                {Object.values(x.fx || {}).some((f) => f && f.enabled) && <span className="fx-badge" title="Ebenenstil">fx</span>}
                {(x.lockAll || x.isBackground || x.lockPosition || x.lockPixels) && <span className="lock"><Icon name="lock" size={13} /></span>}
              </div>
              {x.type === 'smart' && x.smart && (x.smart.filters || []).length > 0 && (
                <div className="smart-filters" style={{ paddingLeft: 40 + depth * 18 }}>
                  <div className="sf-head">Smartfilter</div>
                  {x.smart.filters.map((f, fi) => (
                    <div key={fi} className={'sf-row' + (f.on ? '' : ' off')}>
                      <button className="eye" onClick={() => L.toggleSmartFilter(x, fi)}><Icon name="eye" size={13} /></button>
                      <span className="lname">{((f.kind === 'adjust' ? ADJUSTMENTS : FILTERS)[f.id] || { name: f.id }).name.replace('…', '')}</span>
                      <button className="icon-btn small" title="Smartfilter löschen" onClick={() => L.removeSmartFilter(x, fi)}><Icon name="trash" size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
            {ADJ_LAYER_TYPES.map((id) => <div key={id} className="menu-item" onClick={() => { setAdjMenu(false); L.adjustLayer(id); }}>{ADJUSTMENTS[id].name.replace('…', '')}</div>)}
          </div>}
        </div>
        <button className="icon-btn" title="Neue Gruppe (Strg+G gruppiert die aktive Ebene)" onClick={L.newGroup}><Icon name="folder" size={16} /></button>
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
  const items = [['history', 'history', 'Protokoll'], ['actions', 'play', 'Aktionen'], ['navigator', 'navigator', 'Navigator'], ['info', 'info', 'Info'], ['brushes', 'brushes', 'Pinsel'], ['character', 'character', 'Zeichen'], ['paragraph', 'paragraph', 'Absatz']];
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
  const title = { history: 'Protokoll', actions: 'Aktionen', navigator: 'Navigator', info: 'Info', brushes: 'Pinsel', character: 'Zeichen', paragraph: 'Absatz' }[f];
  return (
    <div className="flyout">
      <div className="panel-tabs"><button className="on">{title}</button><div className="flex" /><button className="panel-menu" onClick={() => { S.ui.flyout = null; emit(); }}><Icon name="close" size={13} /></button></div>
      <div className="panel-body">
        {f === 'history' && <HistoryPanel />}
        {f === 'actions' && <ActionsPanel />}
        {f === 'navigator' && <NavigatorPanel />}
        {f === 'info' && <InfoPanel />}
        {f === 'brushes' && <BrushesPanel />}
        {f === 'character' && <CharacterPanel />}
        {f === 'paragraph' && <ParagraphPanel />}
      </div>
    </div>
  );
}

function ActionsPanel() {
  useStore();
  const [open, setOpen] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const rec = REC.on;
  return (
    <div className="actions">
      {S.actions.map((a, i) => (
        <div key={i} className={'act' + (REC.action === a ? ' rec' : '')}>
          <div className="act-row">
            <button className="twisty-btn" onClick={() => setOpen(open === i ? null : i)}><Icon name="chevron" size={12} style={{ transform: open === i ? 'none' : 'rotate(-90deg)' }} /></button>
            <span className="lname">{a.name}</span><span className="muted">{a.steps.length}</span>
            <button className="icon-btn small" title="Abspielen" disabled={busy || rec} onClick={async () => { setBusy(true); await playAction(a); setBusy(false); }}><Icon name="play" size={14} /></button>
            <button className="icon-btn small" title="Aktion löschen" onClick={() => { S.actions.splice(i, 1); saveActions(); }}><Icon name="trash" size={13} /></button>
          </div>
          {open === i && <div className="act-steps">
            {a.steps.map((st, j) => (
              <div key={j} className={'act-step' + (st.off ? ' off' : '')}>
                <input type="checkbox" checked={!st.off} onChange={() => { st.off = !st.off; saveActions(); }} />
                <span>{stepLabel(st)}</span>
                <button className="icon-btn small" title="Schritt löschen" onClick={() => { a.steps.splice(j, 1); saveActions(); }}><Icon name="close" size={11} /></button>
              </div>
            ))}
            {!a.steps.length && <div className="hint">Noch keine Schritte</div>}
          </div>}
        </div>
      ))}
      <div className="act-foot">
        {rec
          ? <button className="btn small rec-btn" onClick={stopRecording}>■ Aufnahme beenden ({(REC.steps || []).length})</button>
          : <><input className="path-in" placeholder="Name der neuen Aktion" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn small" onClick={() => { startRecording(name.trim()); setName(''); }}>● Aufnehmen</button></>}
      </div>
      <button className="btn small" disabled={!window.native} title={window.native ? '' : 'Nur in der Desktop-App'} onClick={() => openDialog('batch')}>Stapelverarbeitung…</button>
      <div className="hint">Aufgezeichnet werden Menübefehle, Filter, Korrekturen, Ebenen- und Auswahlbefehle (keine Pinselstriche).</div>
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
    let raf, last = -1, lastT = 0;
    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      const c = ref.current, dd = doc();
      if (!c || !dd || !view.comp) return;
      if (view.compRev === last || t - lastT < 200) return;
      last = view.compRev; lastT = t;
      const x = c.getContext('2d');
      const k = Math.min(c.width / dd.w, c.height / dd.h);
      x.clearRect(0, 0, c.width, c.height);
      x.imageSmoothingQuality = 'high';
      x.drawImage(view.comp, (c.width - dd.w * k) / 2, (c.height - dd.h * k) / 2, dd.w * k, dd.h * k);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!d) return <div className="empty-panel">Kein Dokument</div>;
  return (
    <div className="nav">
      <canvas ref={ref} width={240} height={150} />
      <div className="row">
        <button className="icon-btn" title="Auszoomen" onClick={() => import('../state.js').then((m) => m.VIEW.zoomBy(0.8))}><Icon name="min" size={14} /></button>
        <input type="range" min={-4.6} max={4.15} step={0.01} value={Math.log(d.zoom)} onChange={(e) => import('../state.js').then((m) => { const z = Math.exp(Number(e.target.value)); m.VIEW.zoomTo(z, d.panX * z / d.zoom, d.panY * z / d.zoom, 0); })} style={{ flex: 1 }} />
        <button className="icon-btn" title="Einzoomen" onClick={() => import('../state.js').then((m) => m.VIEW.zoomBy(1.25))}><Icon name="plus" size={14} /></button>
        <span className="lbl">{Math.round(d.zoom * 100)} %</span>
      </div>
    </div>
  );
}

const histoCache = { key: null, h: null };
function InfoPanel() {
  useStore();
  const c = useCursor();
  const d = doc();
  if (!d) return <div className="empty-panel">Kein Dokument</div>;
  let rgb = '—', hex = null;
  if (c.inside && c.x >= 0 && c.y >= 0 && c.x < d.w && c.y < d.h) {
    const src = view.comp && view.comp.width === d.w ? view.comp : d.layer.canvas;
    const p = src.getContext('2d').getImageData(Math.floor(c.x), Math.floor(c.y), 1, 1).data;
    rgb = `R ${p[0]}  G ${p[1]}  B ${p[2]}  A ${p[3]}`;
    hex = '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  const key = d.id + ':' + d.layer.id + ':' + d.layer.rev;
  if (histoCache.key !== key) { histoCache.key = key; histoCache.h = histogram(d.layer.canvas); }
  const h = histoCache.h;
  const max = Math.max(...h.l, 1);
  return (
    <div className="info">
      <div className="info-row"><b>RGB</b> {rgb} {hex && <span className="swatch-inline" style={{ background: hex, verticalAlign: 'middle' }} />}</div>
      <div className="info-row"><b>X/Y</b> {c.inside ? `${fmtUnit(c.x, d)}, ${fmtUnit(c.y, d)}` : '—'}</div>
      <div className="info-row"><b>Dok</b> {d.w} × {d.h} Px · {d.layers.length} Ebenen · {d.history.length} Schritte</div>
      {d.samplers.length > 0 && view.comp && view.comp.width === d.w && d.samplers.map((sp, i) => {
        const p = view.comp.getContext('2d').getImageData(Math.min(d.w - 1, Math.floor(sp.x)), Math.min(d.h - 1, Math.floor(sp.y)), 1, 1).data;
        const hx = '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        return <div key={i} className="info-row"><b>#{i + 1}</b> R {p[0]} G {p[1]} B {p[2]} <span className="swatch-inline" style={{ background: hx, verticalAlign: 'middle' }} /> <span className="hint">{hx}</span></div>;
      })}
      {d.counts.length > 0 && <div className="info-row"><b>Zählung</b> {d.counts.length}</div>}
      <div className="hint">Histogramm der aktiven Ebene</div>
      <svg className="histo" viewBox="0 0 256 80" preserveAspectRatio="none">
        <path d={'M0 80 ' + Array.from(h.l).map((v, i) => `L${i} ${80 - (v / max) * 78}`).join(' ') + ' L255 80Z'} fill="var(--accent)" opacity="0.65" />
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
      <TextStylesBlock kind="char" />
    </div>
  );
}

function TextStylesBlock({ kind }) {
  const [mod, setMod] = useState(null);
  useEffect(() => { import('../textTools.js').then(setMod); }, []);
  if (!mod) return null;
  const list = mod.textStyles().map((s, i) => [s, i]).filter(([s]) => s.kind === kind);
  return (
    <div className="tstyles">
      <div className="hint">{kind === 'para' ? 'Absatzformate' : 'Zeichenformate'}</div>
      {list.map(([s, i]) => (
        <div key={i} className="comp-row" onClick={() => mod.applyTextStyle(i)}>
          <span className="comp-name" style={{ fontFamily: s.props.font, fontWeight: s.props.bold ? 700 : 400, fontStyle: s.props.italic ? 'italic' : 'normal' }}>{s.name}</span>
          <button title="Löschen" onClick={(e) => { e.stopPropagation(); mod.removeTextStyle(i); }}>✕</button>
        </div>
      ))}
      <button className="btn small" onClick={() => mod.saveTextStyle(kind)}>+ {kind === 'para' ? 'Absatzformat' : 'Zeichenformat'} aus Auswahl</button>
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
        <button title="Blocksatz" className={v === 'justify' ? 'on' : ''} onClick={() => { S.text.align = 'justify'; if (tl) updateTextLayer(tl, { align: 'justify' }); emit(); }}>≡</button>
      </div>
      <Check label="Glätten" value={S.text.aa} onChange={(x) => { S.text.aa = x; emit(); }} />
      {tl && <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn small" onClick={() => import('../textTools.js').then((m) => m.toggleBox())}>{tl.text.box ? 'In Punkttext' : 'In Absatztext'}</button>
        {tl.text.box && <button className="btn small" onClick={() => import('../textTools.js').then((m) => m.resizeBox())}>Rahmengröße…</button>}
        <button className="btn small" onClick={() => import('../textTools.js').then((m) => m.warpText())}>Verkrümmen…</button>
      </div>}
      <TextStylesBlock kind="para" />
    </div>
  );
}
