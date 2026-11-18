// Führt Filter im Worker aus (Fallback: Hauptthread)
import { ADJUSTMENTS, FILTERS } from './filters.js';
import FilterWorker from './filterWorker.js?worker&inline';

let worker = null, broken = false, seq = 1;
const pending = new Map();

function getWorker() {
  if (broken) return null;
  if (worker) return worker;
  try {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('kein OffscreenCanvas');
    worker = new FilterWorker();
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.bmp);
    };
    worker.onerror = (e) => { console.warn('Filter-Worker-Fehler', e); broken = true; pending.forEach((p) => p.fallback()); pending.clear(); worker = null; };
  } catch (e) { broken = true; worker = null; }
  return worker;
}

function runLocal(kind, fid, params, src) {
  const def = (kind === 'adjust' ? ADJUSTMENTS : FILTERS)[fid];
  return def.apply(src, params);
}

// Liefert ein Canvas/ImageBitmap mit dem Ergebnis
export async function runFilter(kind, fid, params, src, tag = 'apply') {
  const w = getWorker();
  if (!w) return runLocal(kind, fid, params, src);
  const bitmap = await createImageBitmap(src);
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { tag, resolve, reject, fallback: () => { try { resolve(runLocal(kind, fid, params, src)); } catch (e) { reject(e); } } });
    w.postMessage({ id, kind, fid, params, bitmap }, [bitmap]);
  });
}

// Bricht laufende Vorschau-Berechnungen ab (Worker neu starten).
// Endgültige Anwendungen werden nie abgebrochen – dann wird nur eingereiht.
export function cancelFilters() {
  if (!worker || !pending.size) return;
  for (const p of pending.values()) if (p.tag === 'apply') return;
  worker.terminate(); worker = null;
  pending.forEach((p) => p.reject(new Error('abgebrochen')));
  pending.clear();
}
