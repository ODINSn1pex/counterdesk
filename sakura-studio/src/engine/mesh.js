// Gitter-Verformung: Bild über Dreiecke auf beliebige Abbildungen zeichnen
// (für Verzerren, Perspektive, Verformen und Smart-Objekte)

function drawTri(ctx, img, s0, s1, s2, d0, d1, d2) {
  const x0 = s0.x, y0 = s0.y, x1 = s1.x, y1 = s1.y, x2 = s2.x, y2 = s2.y;
  const u0 = d0.x, v0 = d0.y, u1 = d1.x, v1 = d1.y, u2 = d2.x, v2 = d2.y;
  const delta = x0 * y1 + y0 * x2 + x1 * y2 - y1 * x2 - y0 * x1 - x0 * y2;
  if (Math.abs(delta) < 1e-9) return;
  const a = (u0 * y1 + y0 * u2 + u1 * y2 - y1 * u2 - y0 * u1 - u0 * y2) / delta;
  const b = (v0 * y1 + y0 * v2 + v1 * y2 - y1 * v2 - y0 * v1 - v0 * y2) / delta;
  const c = (x0 * u1 + u0 * x2 + x1 * u2 - u1 * x2 - u0 * x1 - x0 * u2) / delta;
  const d = (x0 * v1 + v0 * x2 + x1 * v2 - v1 * x2 - v0 * x1 - x0 * v2) / delta;
  const e = (x0 * y1 * u2 + y0 * u1 * x2 + u0 * x1 * y2 - u0 * y1 * x2 - y0 * x1 * u2 - x0 * u1 * y2) / delta;
  const f = (x0 * y1 * v2 + y0 * v1 * x2 + v0 * x1 * y2 - v0 * y1 * x2 - y0 * x1 * v2 - x0 * v1 * y2) / delta;
  // Dreieck minimal vergrößern, damit keine Nähte entstehen
  const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3;
  const ex = (px, py) => { const dx = px - cx, dy = py - cy, l = Math.hypot(dx, dy) || 1; return [px + dx / l * 0.7, py + dy / l * 0.7]; };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...ex(u0, v0)); ctx.lineTo(...ex(u1, v1)); ctx.lineTo(...ex(u2, v2)); ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// map(u, v) → {x, y} mit u, v ∈ [0, 1]
export function drawMesh(ctx, img, map, n = 20) {
  const W = img.width, H = img.height;
  const pts = [];
  for (let j = 0; j <= n; j++) { pts[j] = []; for (let i = 0; i <= n; i++) pts[j][i] = map(i / n, j / n); }
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s00 = { x: (i / n) * W, y: (j / n) * H }, s10 = { x: ((i + 1) / n) * W, y: (j / n) * H };
    const s11 = { x: ((i + 1) / n) * W, y: ((j + 1) / n) * H }, s01 = { x: (i / n) * W, y: ((j + 1) / n) * H };
    drawTri(ctx, img, s00, s10, s11, pts[j][i], pts[j][i + 1], pts[j + 1][i + 1]);
    drawTri(ctx, img, s00, s11, s01, pts[j][i], pts[j + 1][i + 1], pts[j + 1][i]);
  }
  ctx.restore();
}

// Ecken: [oben links, oben rechts, unten rechts, unten links]
export function bilinearMap(c) {
  return (u, v) => ({
    x: (1 - u) * (1 - v) * c[0].x + u * (1 - v) * c[1].x + u * v * c[2].x + (1 - u) * v * c[3].x,
    y: (1 - u) * (1 - v) * c[0].y + u * (1 - v) * c[1].y + u * v * c[2].y + (1 - u) * v * c[3].y,
  });
}

export function perspectiveMap(c) {
  const [p0, p1, p2, p3] = c;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a, b, cc, d, e, f, g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if ((Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) || Math.abs(den) < 1e-9) {
    a = p1.x - p0.x; b = p3.x - p0.x; cc = p0.x; d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y;
  } else {
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; cc = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
  }
  return (u, v) => { const w = g * u + h * v + 1; return { x: (a * u + b * v + cc) / w, y: (d * u + e * v + f) / w }; };
}

const B = (i, t) => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3][i];
// grid: 4×4 Kontrollpunkte (Zeilen = v), bikubisches Bézier-Feld wie beim Verformen in Photoshop
export function warpMap(grid) {
  return (u, v) => {
    let x = 0, y = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const k = B(i, u) * B(j, v); x += grid[j][i].x * k; y += grid[j][i].y * k; }
    return { x, y };
  };
}

export function gridFromCorners(c) {
  const m = bilinearMap(c);
  return [0, 1, 2, 3].map((j) => [0, 1, 2, 3].map((i) => m(i / 3, j / 3)));
}

export function meshMapFor(t) {
  if (t.mesh === 'warp') return warpMap(t.grid);
  if (t.mesh === 'perspective') return perspectiveMap(t.corners);
  return bilinearMap(t.corners);
}
