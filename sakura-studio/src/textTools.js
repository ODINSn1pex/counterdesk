// Text: Verkrümmen, Absatz-/Zeichenformate, Suchen & Ersetzen, Rahmen umwandeln
import { S, LS, doc, emit, view, commit, toast, askForm, finishTextEdit } from './state.js';
import { renderTextLayer, textBounds, TEXT_WARPS } from './engine/doc.js';

const CHAR_KEYS = ['font', 'size', 'color', 'bold', 'italic', 'underline', 'strike', 'caps', 'tracking'];
const PARA_KEYS = ['align', 'leading'];

function activeText() {
  const d = doc(); if (!d) return null;
  const l = S.ui.textEdit ? d.layers.find((x) => x.id === S.ui.textEdit.layerId) : d.layer;
  return l && l.type === 'text' && l.text ? l : null;
}
function rerender(l, name) { const d = doc(); renderTextLayer(l, d.w, d.h); view.request(); commit(name); }

export async function warpText() {
  const l = activeText(); if (!l) { toast('Zuerst eine Textebene auswählen'); return; }
  const w = l.text.warp || { style: 'arc', bend: 50 };
  const before = l.text.warp ? { ...l.text.warp } : null;
  const v = await askForm('Text verkrümmen', [
    { key: 'style', type: 'select', label: 'Stil', options: TEXT_WARPS, value: w.style },
    { key: 'bend', type: 'num', label: 'Biegung', min: -100, max: 100, unit: '%', value: w.bend },
  ], { hint: 'Der Text bleibt bearbeitbar – die Verkrümmung wird bei jeder Änderung neu berechnet.' });
  if (!v) { l.text.warp = before; return; }
  l.text.warp = v.style === 'none' ? null : { style: v.style, bend: v.bend };
  rerender(l, 'Text verkrümmen');
}

export function toggleBox() {
  const l = activeText(); if (!l) { toast('Zuerst eine Textebene auswählen'); return; }
  const t = l.text;
  if (t.box) { t.box = null; rerender(l, 'In Punkttext konvertieren'); return; }
  const b = textBounds(l);
  t.x = b.x; t.box = { w: Math.ceil(b.w + t.size), h: Math.ceil(b.h + t.size) };
  rerender(l, 'In Absatztext konvertieren');
}

export async function resizeBox() {
  const l = activeText(); if (!l || !l.text.box) { toast('Nur für Absatztext (Textrahmen)'); return; }
  const v = await askForm('Textrahmen', [
    { key: 'w', type: 'num', label: 'Breite', min: 10, max: 20000, unit: ' Px', value: l.text.box.w },
    { key: 'h', type: 'num', label: 'Höhe', min: 10, max: 20000, unit: ' Px', value: l.text.box.h },
  ]);
  if (!v) return;
  l.text.box = { w: v.w, h: v.h }; rerender(l, 'Textrahmen ändern');
}

// ---------- Formate ----------
export function textStyles() { if (!S.textStyles) S.textStyles = LS.get('textStyles', []) || []; return S.textStyles; }
const saveStyles = () => { LS.set('textStyles', S.textStyles); emit(); };
export async function saveTextStyle(kind) {
  const l = activeText(); const src = l ? l.text : S.text;
  const v = await askForm(kind === 'para' ? 'Absatzformat speichern' : 'Zeichenformat speichern', [{ key: 'name', label: 'Name', value: kind === 'para' ? 'Absatzformat' : 'Zeichenformat' }]);
  if (!v || !v.name) return;
  const keys = kind === 'para' ? [...PARA_KEYS, ...CHAR_KEYS] : CHAR_KEYS;
  textStyles().push({ name: v.name, kind, props: Object.fromEntries(keys.map((k) => [k, src[k]])) });
  saveStyles(); toast('Format gespeichert');
}
export function applyTextStyle(i) {
  const st = textStyles()[i]; if (!st) return;
  const l = activeText();
  Object.assign(S.text, st.props);
  if (l) { Object.assign(l.text, st.props); rerender(l, `Format „${st.name}“`); }
  emit();
}
export function removeTextStyle(i) { textStyles().splice(i, 1); saveStyles(); }

// ---------- Suchen & Ersetzen ----------
export async function findReplace() {
  const d = doc(); if (!d) return;
  const texts = d.layers.filter((l) => l.type === 'text' && l.text);
  if (!texts.length) { toast('Keine Textebenen im Dokument'); return; }
  finishTextEdit();
  const v = await askForm('Text suchen und ersetzen', [
    { key: 'find', label: 'Suchen', value: '' },
    { key: 'repl', label: 'Ersetzen durch', value: '' },
    { key: 'cs', type: 'check', label: 'Groß-/Kleinschreibung beachten', value: false },
    { key: 'word', type: 'check', label: 'Nur ganzes Wort', value: false },
    { key: 'hidden', type: 'check', label: 'Ausgeblendete Ebenen einschließen', value: true },
  ], { okLabel: 'Alle ersetzen' });
  if (!v || !v.find) return;
  const esc = v.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(v.word ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc, 'gu' + (v.cs ? '' : 'i'));
  let n = 0;
  for (const l of texts) {
    if (!l.visible && !v.hidden) continue;
    const m = l.text.content.match(re); if (!m) continue;
    n += m.length; l.text.content = l.text.content.replace(re, v.repl);
    if (/^Text/.test(l.name) || l.name === l.text.content) l.name = l.text.content.slice(0, 30) || l.name;
    renderTextLayer(l, d.w, d.h);
  }
  if (!n) { toast(`„${v.find}“ wurde nicht gefunden`); return; }
  view.request(); commit('Suchen und ersetzen');
  toast(`${n} Fundstelle(n) ersetzt`);
}
