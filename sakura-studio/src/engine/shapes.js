// Geometrie & Zeichnen von Formen (für Formwerkzeug, Muster und Vektor-Formebenen)

export function drawStarPath(x, cx, cy, n, R, r) {
  x.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r : R;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
}

export function drawHeartPath(x, X, Y, W, H) {
  x.beginPath();
  x.moveTo(X + W / 2, Y + H * 0.3);
  x.bezierCurveTo(X + W / 2, Y, X, Y, X, Y + H * 0.3);
  x.bezierCurveTo(X, Y + H * 0.6, X + W / 2, Y + H * 0.8, X + W / 2, Y + H);
  x.bezierCurveTo(X + W / 2, Y + H * 0.8, X + W, Y + H * 0.6, X + W, Y + H * 0.3);
  x.bezierCurveTo(X + W, Y, X + W / 2, Y, X + W / 2, Y + H * 0.3);
  x.closePath();
}

export function drawBlossom(x, cx, cy, r, color) {
  x.save(); x.fillStyle = color; x.translate(cx, cy);
  for (let i = 0; i < 5; i++) {
    x.rotate((Math.PI * 2) / 5);
    x.beginPath(); x.ellipse(0, -r * 0.55, r * 0.38, r * 0.55, 0, 0, Math.PI * 2); x.fill();
  }
  x.fillStyle = '#fff3a8'; x.beginPath(); x.arc(0, 0, r * 0.16, 0, 7); x.fill();
  x.restore();
}

export function shapePath(x, kind, r, o) {
  const { x: X, y: Y, w: W, h: H } = r;
  x.beginPath();
  if (kind === 'rect') x.rect(X, Y, W, H);
  else if (kind === 'rounded') x.roundRect(X, Y, W, H, Math.min(o.radius, Math.abs(W) / 2, Math.abs(H) / 2));
  else if (kind === 'ellipse') x.ellipse(X + W / 2, Y + H / 2, Math.abs(W / 2), Math.abs(H / 2), 0, 0, Math.PI * 2);
  else if (kind === 'triangle') { x.moveTo(X + W / 2, Y); x.lineTo(X + W, Y + H); x.lineTo(X, Y + H); x.closePath(); }
  else if (kind === 'polygon') {
    for (let i = 0; i < o.sides; i++) { const a = (i / o.sides) * Math.PI * 2 - Math.PI / 2; x.lineTo(X + W / 2 + Math.cos(a) * W / 2, Y + H / 2 + Math.sin(a) * H / 2); }
    x.closePath();
  } else if (kind === 'star') {
    for (let i = 0; i < o.sides * 2; i++) { const a = (i / (o.sides * 2)) * Math.PI * 2 - Math.PI / 2, k = i % 2 ? o.starInner : 1; x.lineTo(X + W / 2 + Math.cos(a) * W / 2 * k, Y + H / 2 + Math.sin(a) * H / 2 * k); }
    x.closePath();
  } else if (kind === 'heart') { drawHeartPath(x, X, Y, W, H); }
  else if (kind === 'blossom') {
    const cx = X + W / 2, cy = Y + H / 2, rr = Math.min(Math.abs(W), Math.abs(H)) / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      x.moveTo(cx, cy);
      x.ellipse(cx + Math.cos(a) * rr * 0.5, cy + Math.sin(a) * rr * 0.5, rr * 0.5, rr * 0.32, a, 0, Math.PI * 2);
    }
  } else if (kind === 'arrow') {
    const hw = H * 0.5;
    x.moveTo(X, Y + H * 0.3); x.lineTo(X + W * 0.6, Y + H * 0.3); x.lineTo(X + W * 0.6, Y); x.lineTo(X + W, Y + hw); x.lineTo(X + W * 0.6, Y + H); x.lineTo(X + W * 0.6, Y + H * 0.7); x.lineTo(X, Y + H * 0.7); x.closePath();
  } else if (kind === 'speech') {
    x.roundRect(X, Y, W, H * 0.78, Math.min(Math.abs(W), Math.abs(H)) * 0.15);
    x.moveTo(X + W * 0.2, Y + H * 0.75); x.lineTo(X + W * 0.15, Y + H); x.lineTo(X + W * 0.4, Y + H * 0.75);
  }
}

export function drawLine(x, a, b, o, color) {
  x.save(); x.strokeStyle = color; x.fillStyle = color; x.lineWidth = o.lineWidth; x.lineCap = 'round';
  x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
  if (o.arrow) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), s = o.lineWidth * 4;
    x.beginPath(); x.moveTo(b.x, b.y); x.lineTo(b.x - Math.cos(ang - 0.45) * s, b.y - Math.sin(ang - 0.45) * s);
    x.lineTo(b.x - Math.cos(ang + 0.45) * s, b.y - Math.sin(ang + 0.45) * s); x.closePath(); x.fill();
  }
  x.restore();
}

// Vektor-Formebene neu zeichnen
export function renderShapeLayer(layer, w, h) {
  const s = layer.shape; if (!s) return;
  if (layer.canvas.width !== w || layer.canvas.height !== h) { layer.canvas.width = w; layer.canvas.height = h; }
  const x = layer.canvas.getContext('2d');
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  if (s.rot) { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; x.translate(cx, cy); x.rotate(s.rot); x.translate(-cx, -cy); }
  if (s.kind === 'line') drawLine(x, { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { lineWidth: s.lineWidth || 6, arrow: s.arrow }, s.fillColor);
  else {
    shapePath(x, s.kind, { x: s.x, y: s.y, w: s.w, h: s.h }, { radius: s.radius || 0, sides: s.sides || 5, starInner: s.starInner || 0.45 });
    if (s.fillOn !== false) { x.fillStyle = s.fillColor; x.fill(); }
    if (s.strokeOn) { x.strokeStyle = s.strokeColor; x.lineWidth = s.strokeWidth || 1; x.lineJoin = 'round'; x.stroke(); }
  }
  x.restore();
  layer.touch();
}

export function shapeBounds(s) {
  const pad = (s.strokeOn ? s.strokeWidth : 0) + (s.kind === 'line' ? (s.lineWidth || 6) * 2 : 0);
  return { x: Math.min(s.x, s.x + s.w) - pad, y: Math.min(s.y, s.y + s.h) - pad, w: Math.abs(s.w) + pad * 2, h: Math.abs(s.h) + pad * 2 };
}
