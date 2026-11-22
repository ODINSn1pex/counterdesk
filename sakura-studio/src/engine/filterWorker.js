// Läuft in einem Web Worker: Filter/Korrekturen berechnen, ohne die Oberfläche zu blockieren
import { ADJUSTMENTS, FILTERS } from './filters.js';
import { HEAVY } from './heavy.js';

self.onmessage = async (e) => {
  const { id, kind, fid, params, bitmap } = e.data;
  try {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const def = (kind === 'adjust' ? ADJUSTMENTS : kind === 'heavy' ? HEAVY : FILTERS)[fid];
    const out = def.apply(c, params);
    const bmp = out.transferToImageBitmap ? out.transferToImageBitmap() : await createImageBitmap(out);
    self.postMessage({ id, bmp }, [bmp]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
