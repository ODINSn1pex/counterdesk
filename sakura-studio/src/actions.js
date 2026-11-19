// Aktionen: Arbeitsschritte aufzeichnen, abspielen und als Stapel auf Ordner anwenden
import { S, emit, toast, LS, doc, closeDoc, openBytes, flattenToCanvas, IMAGE, L, SELECT, EDIT, REC } from './state.js';
import { canvasToBytes } from './engine/util.js';
import { ADJUSTMENTS, FILTERS } from './engine/filters.js';

const NS = { IMAGE, L, SELECT, EDIT };
const NAMES = {
  'IMAGE.resize': 'Bildgröße', 'IMAGE.canvasSize': 'Arbeitsfläche', 'IMAGE.rotate': 'Bilddrehung', 'IMAGE.flip': 'Spiegeln', 'IMAGE.crop': 'Freistellen', 'IMAGE.trim': 'Zuschneiden', 'IMAGE.grayscale': 'Graustufen', 'IMAGE.cropToSelection': 'Auf Auswahl freistellen',
  'L.add': 'Neue Ebene', 'L.duplicate': 'Ebene duplizieren', 'L.remove': 'Ebene löschen', 'L.mergeDown': 'Auf eine Ebene reduzieren', 'L.mergeVisible': 'Sichtbare reduzieren', 'L.flatten': 'Auf Hintergrund reduzieren',
  'L.adjustLayer': 'Einstellungsebene', 'L.addMask': 'Ebenenmaske', 'L.group': 'Gruppieren', 'L.newGroup': 'Neue Gruppe', 'L.toSmart': 'Smart-Objekt', 'L.removeBackground': 'Hintergrund entfernen (KI)', 'L.fillLayer': 'Füllebene', 'L.stampVisible': 'Sichtbare stempeln',
  'SELECT.all': 'Alles auswählen', 'SELECT.none': 'Auswahl aufheben', 'SELECT.invert': 'Auswahl umkehren', 'SELECT.subject': 'Motiv auswählen', 'SELECT.modify': 'Auswahl verändern', 'SELECT.colorRange': 'Farbbereich',
  'EDIT.fill': 'Fläche füllen', 'EDIT.stroke': 'Kontur füllen', 'EDIT.clear': 'Löschen',
};
export function stepLabel(st) {
  if (st.type === 'filter') { const def = (st.kind === 'adjust' ? ADJUSTMENTS : FILTERS)[st.id]; return (def ? def.name.replace('…', '') : st.id); }
  if (st.type === 'transform') return { r180: '180° drehen', r90: '90° drehen', 'r-90': '-90° drehen', fh: 'Horizontal spiegeln', fv: 'Vertikal spiegeln' }[st.kind] || 'Transformieren';
  const base = NAMES[st.ns + '.' + st.fn] || st.fn;
  const args = (st.args || []).filter((a) => a != null && typeof a !== 'object').join(', ');
  return args ? `${base} (${args})` : base;
}

const DEFAULT_ACTIONS = [
  { name: 'Schwarzweiß-Look', steps: [{ type: 'filter', kind: 'adjust', id: 'blackWhite', params: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#c9a27a' }, name: 'Schwarzweiß' }, { type: 'filter', kind: 'filter', id: 'vignette', params: { amount: 45, size: 60 }, name: 'Vignette' }] },
  { name: 'Für Web schärfen', steps: [{ type: 'filter', kind: 'filter', id: 'unsharp', params: { amount: 80, radius: 1, threshold: 2 }, name: 'Unscharf maskieren' }] },
  { name: 'Sakura-Farblook', steps: [{ type: 'filter', kind: 'adjust', id: 'gradientMap', params: { c1: '#2a1846', c2: '#c85fa0', c3: '#ffe6f4', reverse: false }, name: 'Verlaufsumsetzung' }] },
];
S.actions = LS.get('actions', null) || DEFAULT_ACTIONS;
export function saveActions() { LS.set('actions', S.actions); emit(); }

export function startRecording(name) {
  const a = { name: name || `Aktion ${S.actions.length + 1}`, steps: [] };
  S.actions.push(a);
  REC.on = true; REC.steps = a.steps; REC.action = a;
  toast('Aufnahme läuft ● – führe die gewünschten Schritte aus');
  saveActions();
}
export function stopRecording() {
  if (!REC.on) return;
  REC.on = false; const n = REC.steps.length; REC.steps = null; REC.action = null;
  toast(`Aufnahme beendet (${n} Schritte)`);
  saveActions();
}

export async function playAction(a, quiet) {
  if (!doc()) { toast('Kein Dokument geöffnet'); return false; }
  const wasRec = REC.on; REC.on = false;
  try {
    for (const st of a.steps) {
      if (st.off) continue;
      if (st.type === 'filter') {
        const { applyFilterToLayer } = await import('./ui/dialogs/applyFilter.js');
        await applyFilterToLayer(st.kind, st.id, st.params || {}, st.name || stepLabel(st));
      } else if (st.type === 'transform') {
        const { transformLayer } = await import('./state.js');
        transformLayer(st.kind);
      } else {
        const fn = NS[st.ns] && NS[st.ns][st.fn];
        if (!fn) throw new Error('Unbekannter Schritt: ' + st.fn);
        await fn(...(st.args || []));
      }
    }
    if (!quiet) toast(`Aktion „${a.name}“ ausgeführt`);
    return true;
  } catch (e) {
    console.error(e); toast('Aktion abgebrochen: ' + e.message); return false;
  } finally { REC.on = wasRec; }
}

// Stapelverarbeitung (nur Desktop-App)
export async function runBatch({ action, inDir, outDir, format, quality, onProgress }) {
  const files = await window.native.listDir(inDir);
  let ok = 0, i = 0;
  for (const f of files) {
    i++;
    onProgress && onProgress(i, files.length, f.name);
    try {
      const data = await window.native.readFile(f.path);
      await openBytes(f.name, new Uint8Array(data.data), null);
      const d = doc();
      await playAction(action, true);
      const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const bytes = await canvasToBytes(flattenToCanvas(d, format === 'jpeg' ? '#ffffff' : null), mime, quality);
      const ext = format === 'jpeg' ? 'jpg' : format;
      await window.native.writeFileIn(outDir, f.name.replace(/\.[^.]+$/, '') + '.' + ext, bytes);
      closeDoc(d.id, true);
      ok++;
    } catch (e) { console.error(e); }
  }
  return { ok, total: files.length };
}
