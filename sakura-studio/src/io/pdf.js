// PDF importieren (pdf.js): gewählte Seite in gewählter Auflösung rastern
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { makeCanvas } from '../engine/util.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfInfo(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const p1 = await doc.getPage(1); const vp = p1.getViewport({ scale: 1 });
  return { doc, pages: doc.numPages, w: vp.width, h: vp.height };
}
export async function renderPdfPage(doc, n, ppi = 150) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: ppi / 72 });
  const c = makeCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
  return c;
}
