// PSD-Import/Export über ag-psd
import { readPsd as agRead, writePsd as agWrite } from 'ag-psd';
import { Doc, Layer, flattenToCanvas } from '../engine/doc.js';
import { makeCanvas, ctx2d, alphaBounds } from '../engine/util.js';

const toAg = {
  normal: 'normal', dissolve: 'dissolve', darken: 'darken', multiply: 'multiply', 'color-burn': 'color burn', 'darker-color': 'darker color',
  lighten: 'lighten', screen: 'screen', 'color-dodge': 'color dodge', lighter: 'linear dodge', overlay: 'overlay', 'soft-light': 'soft light',
  'hard-light': 'hard light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};
const fromAg = Object.fromEntries(Object.entries(toAg).map(([a, b]) => [b, a]));
fromAg['linear burn'] = 'multiply'; fromAg['lighter color'] = 'lighten'; fromAg['vivid light'] = 'hard-light'; fromAg['linear light'] = 'hard-light';
fromAg['pin light'] = 'hard-light'; fromAg['hard mix'] = 'hard-light'; fromAg['subtract'] = 'difference'; fromAg['divide'] = 'color-dodge';
fromAg['pass through'] = 'normal';

export function readPsd(bytes, name) {
  const psd = agRead(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { skipThumbnail: true });
  const d = new Doc(psd.width, psd.height, name + '.psd');
  const flat = [];
  const walk = (nodes, hiddenParent) => {
    (nodes || []).forEach((n) => {
      if (n.children) walk(n.children, hiddenParent || n.hidden);
      else flat.push({ n, hidden: hiddenParent || n.hidden });
    });
  };
  walk(psd.children, false);
  if (!flat.length && psd.canvas) flat.push({ n: { name: 'Hintergrund', canvas: psd.canvas, left: 0, top: 0 }, hidden: false });
  flat.forEach(({ n, hidden }) => {
    const l = new Layer(psd.width, psd.height, n.name || 'Ebene');
    if (n.canvas) l.ctx.drawImage(n.canvas, n.left || 0, n.top || 0);
    l.visible = !hidden;
    l.opacity = n.opacity ?? 1;
    l.fill = n.fillOpacity ?? 1;
    l.blend = fromAg[n.blendMode] || 'normal';
    l.clip = !!n.clipping;
    if (n.mask && n.mask.canvas) {
      const m = makeCanvas(psd.width, psd.height); const mx = ctx2d(m);
      mx.fillStyle = (n.mask.defaultColor ?? 0) > 127 ? '#fff' : 'rgba(0,0,0,0)';
      mx.fillRect(0, 0, psd.width, psd.height);
      // Graustufen → Alpha
      const t = makeCanvas(n.mask.canvas.width, n.mask.canvas.height); const tx = ctx2d(t);
      tx.drawImage(n.mask.canvas, 0, 0);
      const id = tx.getImageData(0, 0, t.width, t.height);
      for (let i = 0; i < id.data.length; i += 4) { const v = id.data[i]; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = v; }
      tx.putImageData(id, 0, 0);
      mx.clearRect(n.mask.left || 0, n.mask.top || 0, t.width, t.height);
      mx.drawImage(t, n.mask.left || 0, n.mask.top || 0);
      l.mask = m;
    }
    if (n.text && n.text.text) {
      l.name = n.name || n.text.text.slice(0, 30);
    }
    d.layers.push(l);
  });
  if (d.layers.length && /hintergrund|background/i.test(d.layers[0].name)) { d.layers[0].isBackground = true; d.layers[0].lockPosition = true; }
  d.active = d.layers.length - 1;
  d.commit('Öffnen');
  d.dirty = false;
  return d;
}

export function writePsd(d) {
  const children = d.layers.map((l) => {
    const b = alphaBounds(l.canvas) || { x: 0, y: 0, w: 1, h: 1 };
    const c = makeCanvas(b.w, b.h); ctx2d(c).drawImage(l.canvas, -b.x, -b.y);
    const o = {
      name: l.name, left: b.x, top: b.y, canvas: c, opacity: l.opacity, fillOpacity: l.fill,
      blendMode: toAg[l.blend] || 'normal', hidden: !l.visible, clipping: l.clip,
    };
    if (l.mask) {
      const m = makeCanvas(d.w, d.h); const mx = ctx2d(m);
      mx.fillStyle = '#000'; mx.fillRect(0, 0, d.w, d.h);
      const t = makeCanvas(d.w, d.h); const tx = ctx2d(t); tx.drawImage(l.mask, 0, 0);
      tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, d.w, d.h);
      mx.drawImage(t, 0, 0);
      o.mask = { left: 0, top: 0, canvas: m, defaultColor: 0 };
    }
    return o;
  });
  const flat = flattenToCanvas(d);
  const buf = agWrite({ width: d.w, height: d.h, children, canvas: flat }, { generateThumbnail: false, noBackground: true });
  return new Uint8Array(buf);
}
