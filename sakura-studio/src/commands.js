// Menüs & Tastaturbefehle
import {
  S, doc, emit, view, toast, openFile, placeFile, saveProject, exportPsd, exportImage, exportLayers, printDoc, closeDoc,
  EDIT, IMAGE, L, SELECT, VIEW, openDialog, transformLayer, startTransform, applyTransform, cancelTransform, setTool,
  newDocument, openRecent, applyCrop, finishTextEdit, PATTERNS,
} from './state.js';
import { ADJUSTMENTS, FILTERS } from './engine/filters.js';
import { PATHS, alignLayer, nudge, cancelOp, finishPoly, finishPath, textOnPath, definePresetFromSelection, makeTipFromCanvas } from './tools.js';
import { ADJ_LAYER_TYPES } from './state.js';

const hasDoc = () => !!doc();
const hasSel = () => !!(doc() && doc().selection);

export function runAdjustment(id) {
  const a = ADJUSTMENTS[id];
  if (!doc()) return;
  if (!a.params.length && !a.custom) return applyFilterToLayer('adjust', id, { fg: S.fg, bg: S.bg }, a.name.replace('…', ''));
  openDialog('filter', { kind: 'adjust', id });
}
export function runFilter(id) {
  const f = FILTERS[id];
  if (!doc()) return;
  S.lastFilter = id;
  if (!f.params.length) return applyFilterToLayer('filter', id, { fg: S.fg, bg: S.bg }, f.name.replace('…', ''));
  openDialog('filter', { kind: 'filter', id });
}

import { applyFilterToLayer } from './ui/dialogs/applyFilter.js';

const filterGroups = {};
Object.entries(FILTERS).forEach(([id, f]) => { (filterGroups[f.group] = filterGroups[f.group] || []).push({ label: f.name, run: () => runFilter(id), enabled: hasDoc }); });

export const MENUS = [
  {
    id: 'file', label: 'Datei', items: [
      { label: 'Neu…', key: 'Strg+N', run: () => openDialog('new') },
      { label: 'Öffnen…', key: 'Strg+O', run: openFile },
      { label: 'Zuletzt verwendete Dateien öffnen', sub: () => (S.recent.length ? S.recent.map((p) => ({ label: p.split(/[\\/]/).pop(), run: () => openRecent(p) })) : [{ label: '(leer)', enabled: () => false }]) },
      '-',
      { label: 'Schließen', key: 'Strg+W', run: () => doc() && closeDoc(doc().id), enabled: hasDoc },
      { label: 'Alle schließen', key: 'Alt+Strg+W', run: () => [...S.docs].forEach((d) => closeDoc(d.id)), enabled: hasDoc },
      '-',
      { label: 'Speichern', key: 'Strg+S', run: () => saveProject(false), enabled: hasDoc },
      { label: 'Speichern unter…', key: 'Umschalt+Strg+S', run: () => saveProject(true), enabled: hasDoc },
      { label: 'Als Photoshop-Datei (PSD) speichern…', run: () => exportPsd(), enabled: hasDoc },
      '-',
      { label: 'Exportieren', sub: [
        { label: () => `Schnell-Export als ${({ png: 'PNG', jpeg: 'JPG', webp: 'WebP' })[S.prefs.exportFormat] || 'PNG'}`, key: 'Umschalt+Strg+Alt+W', run: () => exportImage(S.prefs.exportFormat || 'png', (S.prefs.jpgQuality || 90) / 100), enabled: hasDoc },
        { label: 'Exportieren als…', key: 'Alt+Strg+Umschalt+E', run: () => openDialog('export'), enabled: hasDoc },
        { label: 'Ebenen in Dateien exportieren…', run: exportLayers, enabled: hasDoc },
      ] },
      { label: 'Platzieren…', run: placeFile, enabled: hasDoc },
      '-',
      { label: 'Arbeitsordner öffnen', run: () => window.native ? window.native.openWorkFolder() : toast('Nur in der Desktop-App') },
      { label: 'Drucken…', key: 'Strg+P', run: printDoc, enabled: hasDoc },
      '-',
      { label: 'Beenden', key: 'Strg+Q', run: () => (window.native ? window.native.win('close') : window.close()) },
    ],
  },
  {
    id: 'edit', label: 'Bearbeiten', items: [
      { label: () => `Rückgängig: ${doc() && doc().history[doc().histIdx] ? doc().history[doc().histIdx].name : ''}`, key: 'Strg+Z', run: EDIT.undo, enabled: () => doc() && doc().histIdx > 0 },
      { label: 'Wiederholen', key: 'Umschalt+Strg+Z', run: EDIT.redo, enabled: () => doc() && doc().histIdx < doc().history.length - 1 },
      '-',
      { label: 'Ausschneiden', key: 'Strg+X', run: EDIT.cut, enabled: hasDoc },
      { label: 'Kopieren', key: 'Strg+C', run: () => EDIT.copy(false), enabled: hasDoc },
      { label: 'Auf eine Ebene reduziert kopieren', key: 'Umschalt+Strg+C', run: () => EDIT.copy(true), enabled: hasDoc },
      { label: 'Einfügen', key: 'Strg+V', run: () => EDIT.paste(false), enabled: hasDoc },
      { label: 'An Originalposition einfügen', key: 'Umschalt+Strg+V', run: () => EDIT.paste(true), enabled: hasDoc },
      { label: 'Löschen', key: 'Entf', run: EDIT.clear, enabled: hasDoc },
      '-',
      { label: 'Fläche füllen…', key: 'Umschalt+F5', run: () => openDialog('fill'), enabled: hasDoc },
      { label: 'Kontur füllen…', run: () => openDialog('stroke'), enabled: hasSel },
      { label: 'Inhaltsbasierte Füllung', run: () => EDIT.fill('content'), enabled: hasSel },
      '-',
      { label: 'Frei transformieren', key: 'Strg+T', run: () => startTransform(), enabled: hasDoc },
      { label: 'Transformieren', sub: [
        { label: 'Verzerren', run: () => startTransform('distort'), enabled: hasDoc },
        { label: 'Perspektivisch', run: () => startTransform('perspective'), enabled: hasDoc },
        { label: 'Verformen', run: () => startTransform('warp'), enabled: hasDoc },
        { label: 'Formgitter', run: () => startTransform('puppet'), enabled: hasDoc },
        '-',
        { label: '180° drehen', run: () => transformLayer('r180'), enabled: hasDoc },
        { label: '90° im UZS drehen', run: () => transformLayer('r90'), enabled: hasDoc },
        { label: '90° gegen UZS drehen', run: () => transformLayer('r-90'), enabled: hasDoc },
        '-',
        { label: 'Horizontal spiegeln', run: () => transformLayer('fh'), enabled: hasDoc },
        { label: 'Vertikal spiegeln', run: () => transformLayer('fv'), enabled: hasDoc },
      ] },
      { label: 'Ebenen automatisch ausrichten', sub: [
        { label: 'Linke Kanten', run: () => alignLayer('left') }, { label: 'Horizontale Mitte', run: () => alignLayer('hcenter') }, { label: 'Rechte Kanten', run: () => alignLayer('right') },
        { label: 'Oberkanten', run: () => alignLayer('top') }, { label: 'Vertikale Mitte', run: () => alignLayer('vcenter') }, { label: 'Unterkanten', run: () => alignLayer('bottom') },
      ] },
      '-',
      { label: 'Pinselvorgabe festlegen (aus Auswahl)…', run: definePresetFromSelection, enabled: hasDoc },
      { label: 'Pinselspitze aus Bild importieren…', run: importBrushImage },
      { label: 'Farbfelder & Verläufe zurücksetzen', run: () => { localStorage.removeItem('sakura.swatches'); localStorage.removeItem('sakura.gradients'); toast('Wird beim nächsten Start zurückgesetzt'); } },
      { label: 'Tastaturbefehle…', key: 'Alt+Umschalt+Strg+K', run: () => openDialog('shortcuts') },
      { label: 'Voreinstellungen…', key: 'Strg+K', run: () => openDialog('prefs') },
    ],
  },
  {
    id: 'image', label: 'Bild', items: [
      { label: 'Modus', sub: [
        { label: 'Graustufen', run: IMAGE.grayscale, enabled: hasDoc },
        { label: 'RGB-Farbe ✓', enabled: () => false },
      ] },
      '-',
      { label: 'Korrekturen', sub: [
        ...['brightness', 'levels', 'curves', 'exposure'].map((id) => ({ label: ADJUSTMENTS[id].name, key: { levels: 'Strg+L', curves: 'Strg+M' }[id], run: () => runAdjustment(id), enabled: hasDoc })),
        '-',
        ...['vibrance', 'hueSat', 'colorBalance', 'blackWhite', 'photoFilter', 'channelMixer'].map((id) => ({ label: ADJUSTMENTS[id].name, key: { hueSat: 'Strg+U', colorBalance: 'Strg+B', blackWhite: 'Alt+Umschalt+Strg+B' }[id], run: () => runAdjustment(id), enabled: hasDoc })),
        '-',
        ...['invert', 'posterize', 'threshold', 'gradientMap', 'selectiveColor'].map((id) => ({ label: ADJUSTMENTS[id].name, key: { invert: 'Strg+I' }[id], run: () => runAdjustment(id), enabled: hasDoc })),
        '-',
        ...['shadowsHighlights', 'hdrToning', 'desaturate', 'matchColor', 'equalize'].map((id) => ({ label: ADJUSTMENTS[id].name, key: { desaturate: 'Umschalt+Strg+U' }[id], run: () => runAdjustment(id), enabled: hasDoc })),
      ] },
      '-',
      { label: 'Auto-Farbton', key: 'Umschalt+Strg+L', run: () => runAdjustment('autoTone'), enabled: hasDoc },
      { label: 'Auto-Kontrast', key: 'Alt+Umschalt+Strg+L', run: () => runAdjustment('autoContrast'), enabled: hasDoc },
      { label: 'Auto-Farbe', key: 'Umschalt+Strg+B', run: () => runAdjustment('autoColor'), enabled: hasDoc },
      '-',
      { label: 'Bildgröße…', key: 'Alt+Strg+I', run: () => openDialog('imageSize'), enabled: hasDoc },
      { label: 'Arbeitsfläche…', key: 'Alt+Strg+C', run: () => openDialog('canvasSize'), enabled: hasDoc },
      { label: 'Bilddrehung', sub: [
        { label: '180°', run: () => IMAGE.rotate(180), enabled: hasDoc },
        { label: '90° im UZS', run: () => IMAGE.rotate(90), enabled: hasDoc },
        { label: '90° gegen UZS', run: () => IMAGE.rotate(-90), enabled: hasDoc },
        '-',
        { label: 'Arbeitsfläche horizontal spiegeln', run: () => IMAGE.flip(true), enabled: hasDoc },
        { label: 'Arbeitsfläche vertikal spiegeln', run: () => IMAGE.flip(false), enabled: hasDoc },
      ] },
      { label: 'Freistellen', run: IMAGE.cropToSelection, enabled: hasSel },
      { label: 'Zuschneiden (Transparenz)', run: IMAGE.trim, enabled: hasDoc },
      '-',
      { label: 'Duplizieren…', run: IMAGE.duplicate, enabled: hasDoc },
      { label: 'Aktion ausführen', sub: () => S.actions.map((a) => ({ label: a.name, run: () => import('./actions.js').then((m) => m.playAction(a)), enabled: hasDoc })) },
      { label: 'Histogramm…', run: () => openDialog('histogram'), enabled: hasDoc },
    ],
  },
  {
    id: 'layer', label: 'Ebene', items: [
      { label: 'Neu', sub: [
        { label: 'Ebene…', key: 'Umschalt+Strg+N', run: L.add, enabled: hasDoc },
        { label: 'Gruppe', run: L.newGroup, enabled: hasDoc },
        { label: 'Ebene aus Hintergrund', run: L.fromBackground, enabled: () => doc() && doc().layer.isBackground },
        '-',
        { label: 'Ebene durch Kopie', key: 'Strg+J', run: () => L.viaCopy(false), enabled: hasDoc },
        { label: 'Ebene durch Ausschneiden', key: 'Umschalt+Strg+J', run: () => L.viaCopy(true), enabled: hasDoc },
      ] },
      { label: 'Ebene duplizieren', run: L.duplicate, enabled: hasDoc },
      { label: 'Ebene löschen', run: L.remove, enabled: hasDoc },
      '-',
      { label: 'Ebenenstil', sub: [
        { label: 'Fülloptionen…', run: () => openDialog('layerStyle', { tab: 'blend' }), enabled: hasDoc },
        '-',
        { label: 'Kontur…', run: () => openDialog('layerStyle', { tab: 'stroke' }), enabled: hasDoc },
        { label: 'Schatten nach innen…', run: () => openDialog('layerStyle', { tab: 'inner' }), enabled: hasDoc },
        { label: 'Farbüberlagerung…', run: () => openDialog('layerStyle', { tab: 'overlay' }), enabled: hasDoc },
        { label: 'Verlaufsüberlagerung…', run: () => openDialog('layerStyle', { tab: 'gradient' }), enabled: hasDoc },
        { label: 'Schein nach außen…', run: () => openDialog('layerStyle', { tab: 'glow' }), enabled: hasDoc },
        { label: 'Schlagschatten…', run: () => openDialog('layerStyle', { tab: 'shadow' }), enabled: hasDoc },
        '-',
        { label: 'Ebenenstil löschen', run: () => { const d = doc(); d.layer.fx = {}; d.layer.touch(); view.request(); import('./state.js').then((m) => m.commit('Ebenenstil löschen')); }, enabled: hasDoc },
      ] },
      { label: 'Neue Einstellungsebene', sub: ADJ_LAYER_TYPES.map((id) => ({ label: ADJUSTMENTS[id].name, run: () => L.adjustLayer(id), enabled: hasDoc })) },
      { label: 'Neue Füllebene', sub: [
        { label: 'Volltonfarbe', run: () => L.fillLayer(), enabled: hasDoc },
        { label: 'Verlauf', run: L.gradientLayer, enabled: hasDoc },
        { label: 'Muster', run: L.patternLayer, enabled: hasDoc },
      ] },
      { label: 'Ebenenmaske', sub: [
        { label: 'Alles einblenden', run: () => L.addMask(false, false), enabled: hasDoc },
        { label: 'Alles ausblenden', run: () => L.addMask(false, true), enabled: hasDoc },
        { label: 'Auswahl einblenden', run: () => L.addMask(true), enabled: hasSel },
        '-',
        { label: 'Löschen', run: L.deleteMask, enabled: () => doc() && !!doc().layer.mask },
        { label: 'Anwenden', run: L.applyMask, enabled: () => doc() && !!doc().layer.mask },
        { label: 'Umkehren', run: L.invertMask, enabled: () => doc() && !!doc().layer.mask },
      ] },
      { label: 'Schnittmaske erstellen', key: 'Alt+Strg+G', run: L.toggleClip, enabled: hasDoc },
      { label: 'Hintergrund entfernen (KI)', run: L.removeBackground, enabled: hasDoc },
      '-',
      { label: 'Ebenen gruppieren', key: 'Strg+G', run: L.group, enabled: hasDoc },
      { label: 'Ebenengruppierung aufheben', key: 'Umschalt+Strg+G', run: L.ungroup, enabled: () => doc() && doc().layer.type === 'group' },
      { label: 'Smart-Objekte', sub: [
        { label: 'In Smart-Objekt konvertieren', run: L.toSmart, enabled: hasDoc },
        { label: 'Inhalt bearbeiten', run: L.editSmart, enabled: () => doc() && doc().layer.type === 'smart' },
        { label: 'Inhalt übernehmen (zurück ins Smart-Objekt)', run: L.commitSmart, enabled: () => doc() && !!doc().smartLink },
        { label: 'Inhalt ersetzen…', run: L.replaceSmart, enabled: () => doc() && doc().layer.type === 'smart' },
        { label: 'Rastern', run: L.rasterize, enabled: () => doc() && doc().layer.type === 'smart' },
      ] },
      '-',
      { label: 'Rastern', sub: [
        { label: 'Ebene', run: L.rasterize, enabled: () => doc() && ['text', 'shape', 'smart'].includes(doc().layer.type) },
        { label: 'Text', run: L.rasterize, enabled: () => doc() && doc().layer.type === 'text' },
        { label: 'Form', run: L.rasterize, enabled: () => doc() && doc().layer.type === 'shape' },
        { label: 'Smart-Objekt', run: L.rasterize, enabled: () => doc() && doc().layer.type === 'smart' },
      ] },
      '-',
      { label: 'Anordnen', sub: [
        { label: 'In den Vordergrund', key: 'Umschalt+Strg+]', run: L.toTop, enabled: hasDoc },
        { label: 'Schrittweise vorwärts', key: 'Strg+]', run: L.moveUp, enabled: hasDoc },
        { label: 'Schrittweise rückwärts', key: 'Strg+[', run: L.moveDown, enabled: hasDoc },
        { label: 'In den Hintergrund', key: 'Umschalt+Strg+[', run: L.toBottom, enabled: hasDoc },
      ] },
      { label: 'Ausrichten', sub: [
        { label: 'Oberkanten', run: () => alignLayer('top') }, { label: 'Vertikale Mitte', run: () => alignLayer('vcenter') }, { label: 'Unterkanten', run: () => alignLayer('bottom') },
        { label: 'Linke Kanten', run: () => alignLayer('left') }, { label: 'Horizontale Mitte', run: () => alignLayer('hcenter') }, { label: 'Rechte Kanten', run: () => alignLayer('right') },
      ] },
      '-',
      { label: () => (doc() && doc().layer.type === 'group' ? 'Gruppe zusammenfügen' : 'Auf eine Ebene reduzieren'), key: 'Strg+E', run: L.mergeDown, enabled: hasDoc },
      { label: 'Sichtbare auf eine Ebene reduzieren', key: 'Umschalt+Strg+E', run: L.mergeVisible, enabled: hasDoc },
      { label: 'Sichtbare stempeln', key: 'Umschalt+Strg+Alt+E', run: L.stampVisible, enabled: hasDoc },
      { label: 'Auf Hintergrundebene reduzieren', run: L.flatten, enabled: hasDoc },
    ],
  },
  {
    id: 'type', label: 'Schrift', items: [
      { label: 'Textwerkzeug', key: 'T', run: () => setTool('type', 'h') },
      { label: 'Vertikales Textwerkzeug', run: () => setTool('type', 'v') },
      { label: 'Text auf Pfad erstellen', run: textOnPath, enabled: () => doc() && doc().paths.some((p) => p.points.length > 1) },
      '-',
      { label: 'Zeichen-Bedienfeld', run: () => { S.ui.flyout = 'character'; emit(); } },
      { label: 'Textebene rastern', run: L.rasterize, enabled: () => doc() && doc().layer.type === 'text' },
      { label: 'Textbearbeitung abschließen', run: finishTextEdit, enabled: () => !!S.ui.textEdit },
    ],
  },
  {
    id: 'select', label: 'Auswahl', items: [
      { label: 'Alles auswählen', key: 'Strg+A', run: SELECT.all, enabled: hasDoc },
      { label: 'Auswahl aufheben', key: 'Strg+D', run: SELECT.none, enabled: hasSel },
      { label: 'Erneut auswählen', key: 'Umschalt+Strg+D', run: SELECT.reselect, enabled: hasDoc },
      { label: 'Auswahl umkehren', key: 'Umschalt+Strg+I', run: SELECT.invert, enabled: hasDoc },
      '-',
      { label: 'Ebenentransparenz als Auswahl', run: SELECT.allLayersOpaque, enabled: hasDoc },
      { label: 'Farbbereich…', run: () => openDialog('colorRange'), enabled: hasDoc },
      { label: 'Motiv (KI)', run: SELECT.subject, enabled: hasDoc },
      { label: 'Motiv (klassisch, schnell)', run: SELECT.subjectClassic, enabled: hasDoc },
      '-',
      { label: 'Auswählen und maskieren…', key: 'Alt+Strg+R', run: () => openDialog('selectMask'), enabled: hasSel },
      { label: 'Auswahl verändern', sub: [
        { label: 'Umrandung…', run: () => openDialog('modifySel', { kind: 'border' }), enabled: hasSel },
        { label: 'Abrunden…', run: () => openDialog('modifySel', { kind: 'smooth' }), enabled: hasSel },
        { label: 'Erweitern…', run: () => openDialog('modifySel', { kind: 'expand' }), enabled: hasSel },
        { label: 'Verkleinern…', run: () => openDialog('modifySel', { kind: 'contract' }), enabled: hasSel },
        { label: 'Weiche Kante…', key: 'Umschalt+F6', run: () => openDialog('modifySel', { kind: 'feather' }), enabled: hasSel },
      ] },
      { label: 'Auswahl transformieren / Inhalt', key: 'Strg+T', run: startTransform, enabled: hasSel },
      '-',
      { label: 'Im Maskierungsmodus bearbeiten', key: 'Q', run: SELECT.toggleQuickMask, enabled: hasDoc },
      { label: 'Pfad aus Auswahl erstellen', run: PATHS.fromSelection, enabled: hasSel },
      '-',
      { label: 'Auswahl speichern…', run: () => SELECT.save(), enabled: hasSel },
      { label: 'Auswahl laden', sub: () => (doc() && doc().alphaChannels.length ? doc().alphaChannels.map((a, i) => ({ label: a.name, run: () => SELECT.load(i) })) : [{ label: '(keine Alphakanäle)', enabled: () => false }]) },
    ],
  },
  {
    id: 'filter', label: 'Filter', items: [
      { label: () => `Letzter Filter${S.lastFilter ? ': ' + FILTERS[S.lastFilter].name.replace('…', '') : ''}`, key: 'Alt+Strg+F', run: () => S.lastFilter && runFilter(S.lastFilter), enabled: () => hasDoc() && !!S.lastFilter },
      '-',
      { label: 'Verflüssigen…', key: 'Umschalt+Strg+X', run: () => openDialog('liquify'), enabled: hasDoc },
      '-',
      ...Object.entries(filterGroups).map(([g, items]) => ({ label: g, sub: items })),
    ],
  },
  {
    id: 'view', label: 'Ansicht', items: [
      { label: 'Einzoomen', key: 'Strg++', run: () => VIEW.zoomBy(1.25), enabled: hasDoc },
      { label: 'Auszoomen', key: 'Strg+-', run: () => VIEW.zoomBy(0.8), enabled: hasDoc },
      { label: 'Ganzes Bild', key: 'Strg+0', run: VIEW.fit, enabled: hasDoc },
      { label: '100 %', key: 'Strg+1', run: VIEW.actual, enabled: hasDoc },
      '-',
      { label: 'Bildschirmmodus wechseln', key: 'F', run: cycleScreenMode },
      { label: 'Kanäle', sub: [
        { label: 'RGB', key: 'Strg+2', run: () => setChannels({ r: true, g: true, b: true }), enabled: hasDoc },
        { label: 'Rot', key: 'Strg+3', run: () => setChannels({ r: true, g: false, b: false }), enabled: hasDoc },
        { label: 'Grün', key: 'Strg+4', run: () => setChannels({ r: false, g: true, b: false }), enabled: hasDoc },
        { label: 'Blau', key: 'Strg+5', run: () => setChannels({ r: false, g: false, b: true }), enabled: hasDoc },
      ] },
      '-',
      { label: () => (S.ui.proof ? '✓ ' : '') + 'Proof-Farben (CMYK-Näherung)', key: 'Strg+Y', run: () => VIEW.toggle('proof'), enabled: hasDoc },
      { label: () => (S.ui.gamut ? '✓ ' : '') + 'Farbumfang-Warnung', key: 'Umschalt+Strg+Y', run: () => VIEW.toggle('gamut'), enabled: hasDoc },
      '-',
      { label: () => (S.ui.showRulers ? '✓ ' : '') + 'Lineale', key: 'Strg+R', run: () => VIEW.toggle('showRulers') },
      { label: () => (S.ui.showGrid ? '✓ ' : '') + 'Raster', key: "Strg+'", run: () => VIEW.toggle('showGrid') },
      { label: () => (S.ui.showGuides ? '✓ ' : '') + 'Hilfslinien', key: 'Strg+,', run: () => VIEW.toggle('showGuides') },
      { label: () => (S.ui.snap ? '✓ ' : '') + 'Ausrichten (Einrasten)', key: 'Umschalt+Strg+,', run: () => VIEW.toggle('snap') },
      '-',
      { label: 'Neue Hilfslinie…', run: () => openDialog('guide'), enabled: hasDoc },
      { label: 'Hilfslinien löschen', run: VIEW.clearGuides, enabled: hasDoc },
    ],
  },
  {
    id: 'window', label: 'Fenster', items: [
      ...[['color', 'Farbe'], ['swatches', 'Farbfelder'], ['gradients', 'Verläufe'], ['patterns', 'Muster']].map(([k, n]) => ({ label: n, run: () => showPanel('color', k) })),
      '-',
      ...[['props', 'Eigenschaften'], ['adjust', 'Korrekturen'], ['libs', 'Bibliotheken']].map(([k, n]) => ({ label: n, run: () => showPanel('props', k) })),
      '-',
      ...[['layers', 'Ebenen'], ['channels', 'Kanäle'], ['paths', 'Pfade']].map(([k, n]) => ({ label: n, key: k === 'layers' ? 'F7' : undefined, run: () => showPanel('layers', k) })),
      '-',
      ...[['history', 'Protokoll'], ['actions', 'Aktionen'], ['navigator', 'Navigator'], ['info', 'Info'], ['brushes', 'Pinsel'], ['character', 'Zeichen'], ['paragraph', 'Absatz']].map(([k, n]) => ({ label: n, run: () => { S.ui.flyout = S.ui.flyout === k ? null : k; emit(); } })),
      '-',
      { label: 'Arbeitsbereich zurücksetzen', run: () => { S.ui.hiddenPanels = {}; S.ui.flyout = null; localStorage.removeItem('sakura.hiddenPanels'); emit(); } },
    ],
  },
  {
    id: 'help', label: 'Hilfe', items: [
      { label: 'Tutorial starten', run: () => { S.ui.tutorial = true; S.ui.menu = null; emit(); } },
      { label: 'Tastaturbefehle', run: () => openDialog('shortcuts') },
      { label: 'Funktionsübersicht', run: () => openDialog('features') },
      '-',
      { label: 'Über Sakura Studio', run: () => openDialog('about') },
    ],
  },
];

async function importBrushImage() {
  let files;
  if (window.native) files = await window.native.openDialog({ title: 'Pinselspitze importieren (PNG/JPG, dunkel = Farbe)', filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  else files = await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => res([{ name: i.files[0].name, data: new Uint8Array(await i.files[0].arrayBuffer()) }]); i.click(); });
  const f = files && files[0]; if (!f) return;
  const img = new Image(); img.src = URL.createObjectURL(new Blob([f.data])); await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0);
  makeTipFromCanvas(c, f.name.replace(/\.[^.]+$/, ''));
  setTool('brush', 'brush');
  toast('Pinselspitze importiert');
}

function setChannels(o) { const d = doc(); if (!d) return; d.channelView = o; view.request(); emit(); }
function cycleScreenMode() {
  const prev = S.ui.screenMode;
  S.ui.screenMode = (S.ui.screenMode + 1) % 3;
  if (window.native && (S.ui.screenMode === 2 || prev === 2)) window.native.win('fullscreen');
  toast(['Standardmodus', 'Ohne Bedienfelder', 'Vollbildmodus (F zum Verlassen)'][S.ui.screenMode]);
  view.request(); emit();
}

function showPanel(group, tab) {
  S.ui.panelTabs[group] = tab;
  delete S.ui.hiddenPanels[group];
  S.ui.menu = null;
  emit();
}

// ---------------- Tastatur ----------------
const TOOL_KEYS = {
  v: ['move'], m: ['marquee', ['rect', 'ellipse']], l: ['lasso', ['lasso', 'polygon']], w: ['wand', ['quick', 'wand', 'object']], c: ['crop'],
  i: ['eyedropper', ['eyedropper', 'ruler']], j: ['heal', ['spot', 'healing', 'redeye']], b: ['brush', ['brush', 'pencil', 'replace']], s: ['stamp', ['clone', 'pattern']],
  y: ['history'], e: ['eraser', ['eraser', 'background', 'magic']], g: ['gradient', ['gradient', 'bucket']], o: ['dodge', ['dodge', 'burn', 'sponge']], r: ['blur', ['blur', 'sharpen', 'smudge']],
  p: ['pen', ['pen', 'freeform']], t: ['type', ['h', 'v']], a: ['select'], u: ['shape', ['rect', 'rounded', 'ellipse', 'triangle', 'polygon', 'line', 'star', 'heart', 'blossom']], h: ['view', 'hand'], z: ['view', 'zoom'],
};

function matchKey(e, combo) {
  const parts = combo.split('+');
  const key = parts.pop();
  const need = { ctrl: parts.includes('Strg'), shift: parts.includes('Umschalt'), alt: parts.includes('Alt') };
  if (need.ctrl !== (e.ctrlKey || e.metaKey) || need.shift !== e.shiftKey || need.alt !== e.altKey) return false;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const map = { Entf: 'Delete', '+': ['+', '='], '-': ['-', '_'], "'": ["'", '#'] };
  const want = map[key] || key.toUpperCase();
  if (Array.isArray(want)) return want.includes(e.key);
  if (key === ']') return e.key === ']' || e.code === 'BracketRight';
  if (key === '[') return e.key === '[' || e.code === 'BracketLeft';
  if (key === ',') return e.key === ',' || e.code === 'Comma';
  if (/^\d$/.test(key)) return e.code === 'Digit' + key || e.key === key;
  if (/^[A-Z]$/.test(want)) return e.code === 'Key' + want || k === want;
  return k === want || e.key === key;
}

function allShortcutItems(items, out = []) {
  for (const it of items) {
    if (it === '-' || !it) continue;
    if (it.key && it.run) out.push(it);
    if (Array.isArray(it.sub)) allShortcutItems(it.sub, out);
  }
  return out;
}
let SHORT = null;

export function onKeyDown(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (S.ui.tutorial) return;
  if (S.ui.dialog) return; // Dialoge behandeln ihre Tasten selbst
  const d = doc();

  if (e.key === ' ' && !e.repeat) { import('./tools.js').then((m) => { m.SPACE.held = true; }); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (cancelOp()) return;
    if (S.transform) { cancelTransform(); return; }
    if (S.ui.menu) { S.ui.menu = null; emit(); return; }
    if (S.tool === 'pen') { finishPath(); return; }
    if (S.tool === 'crop') { S.cropState = null; import('./state.js').then((m) => m.initCrop()); view.overlay(); emit(); return; }
    return;
  }
  if (e.key === 'Enter') {
    if (finishPoly()) return;
    if (S.transform) { applyTransform(); return; }
    if (S.tool === 'crop' && S.cropState) { applyCrop(); return; }
    if (S.tool === 'pen') { if (e.ctrlKey) PATHS.toSelection(); else finishPath(); return; }
  }
  if (!SHORT) SHORT = MENUS.flatMap((m) => allShortcutItems(m.items));
  for (const it of SHORT) {
    if (it.key.split(' / ').some((k) => matchKey(e, k))) {
      if (it.enabled && !it.enabled()) return;
      e.preventDefault();
      it.run();
      return;
    }
  }
  // Pfeiltasten
  if (d && S.tool === 'move' && e.key.startsWith('Arrow')) {
    const s = e.shiftKey ? (S.prefs.nudgeStep || 10) : 1;
    const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
    e.preventDefault(); nudge(dx, dy); return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && d && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.shiftKey) { openDialog('fill'); return; }
    e.preventDefault(); EDIT.clear(); return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && d) { e.preventDefault(); EDIT.fill('bg'); return; }
    if (e.altKey && e.key === 'Backspace' && d) { e.preventDefault(); EDIT.fill('fg'); return; }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'x') { const t = S.fg; S.fg = S.bg; S.bg = t; emit(); return; }
  if (k === 'd') { S.fg = '#000000'; S.bg = '#ffffff'; emit(); return; }
  if (k === 'q' && d) { SELECT.toggleQuickMask(); return; }
  if (k === 'f') { cycleScreenMode(); return; }
  if (k === 'tab') { e.preventDefault(); S.ui.hidePanels = !S.ui.hidePanels; view.request(); emit(); return; }
  if (k === '[' || k === ']') {
    const f = k === ']' ? 1.15 : 1 / 1.15;
    if (S.tool === 'eraser') S.eraser.size = Math.max(1, Math.round(S.eraser.size * f));
    else if (S.tool === 'blur' || S.tool === 'dodge') S.retouch.size = Math.max(1, Math.round(S.retouch.size * f));
    else if (S.tool === 'brush' && S.sub.brush === 'pencil') S.pencil.size = Math.max(1, Math.round(S.pencil.size * f));
    else if (S.tool === 'heal') S.heal.size = Math.max(1, Math.round(S.heal.size * f));
    else S.brush.size = Math.max(1, Math.round(S.brush.size * f));
    view.overlay(); emit(); return;
  }
  if (/^[0-9]$/.test(k) && d) {
    const v = k === '0' ? 1 : Number(k) / 10;
    if (S.tool === 'brush') S.brush.opacity = v; else if (S.tool === 'eraser') S.eraser.opacity = v;
    else if (d.layer) { d.layer.opacity = v; view.request(); import('./state.js').then((m) => m.commit('Deckkraft')); }
    emit(); return;
  }
  const tk = TOOL_KEYS[k];
  if (tk) {
    const [tool, subs] = tk;
    if (Array.isArray(subs) && e.shiftKey) {
      const i = subs.indexOf(S.sub[tool]); setTool(tool, subs[(i + 1) % subs.length]);
    } else if (typeof subs === 'string') setTool(tool, subs);
    else setTool(tool);
  }
}

export function onKeyUp(e) {
  if (e.key === ' ') import('./tools.js').then((m) => { m.SPACE.held = false; });
}

export function allShortcuts() {
  const rows = [];
  MENUS.forEach((m) => {
    const walk = (items, prefix) => items.forEach((it) => {
      if (!it || it === '-') return;
      const label = typeof it.label === 'function' ? it.label() : it.label;
      if (it.key) rows.push([m.label, prefix + label.replace(/^✓ /, ''), it.key]);
      if (Array.isArray(it.sub)) walk(it.sub, prefix + label + ' › ');
    });
    walk(m.items, '');
  });
  return rows;
}

export { PATTERNS, newDocument };
