import { useEffect, useRef } from 'react';
import { S, doc, finishTextEdit, useStore } from '../state.js';
import { updateTextLayer } from '../tools.js';

export function TextEditor({ geom }) {
  useStore();
  const ref = useRef(null);
  const d = doc();
  const te = S.ui.textEdit;
  const l = d && te && d.layers.find((x) => x.id === te.layerId);
  useEffect(() => { const f = () => { if (ref.current) { ref.current.focus(); const v = ref.current.value; ref.current.setSelectionRange(v.length, v.length); } }; f(); const t = setTimeout(f, 30); return () => clearTimeout(t); }, [te && te.layerId]);
  if (!l || !l.text) return null;
  const g = geom();
  if (!g) return null;
  const t = l.text;
  const fs = t.size * g.z;
  const lines = (t.content || '').split('\n');
  const width = t.box ? t.box.w * g.z : Math.max(120, ...lines.map((s) => s.length * fs * 0.62)) + 30;
  let left = g.ox + t.x * g.z;
  if (!t.box) { if (t.align === 'center') left -= width / 2; else if (t.align === 'right') left -= width; }
  const style = {
    left, top: g.oy + t.y * g.z, width, height: t.box ? t.box.h * g.z : Math.max(fs * 1.4, lines.length * fs * (t.leading || 1.2) + 8),
    font: `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${fs}px "${t.font}"`,
    lineHeight: (t.leading || 1.2), textAlign: t.align, textTransform: t.caps ? 'uppercase' : undefined, whiteSpace: t.box ? 'pre-wrap' : 'pre', letterSpacing: (t.tracking || 0) * g.z + 'px',
    writingMode: t.vertical ? 'vertical-rl' : undefined,
  };
  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={style}
      value={t.content}
      placeholder="Text eingeben…"
      spellCheck={S.prefs.spellcheck !== false}
      lang={S.prefs.spellLang || 'de-DE'}
      onChange={(e) => updateTextLayer(l, { content: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.key === 'Escape') { e.preventDefault(); finishTextEdit(); }
      }}
    />
  );
}
