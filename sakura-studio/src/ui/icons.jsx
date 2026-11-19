// Eigene Linien-Icons (24×24)
const P = {
  move: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  marquee: 'M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4',
  ellipse: 'M12 4a8 7 0 1 0 0.01 0',
  lasso: 'M7 15c-3-2-3-6 0-8.5S16 3 19 6s0 8-6 8.5c-2 .2-4 .5-5 1.5-1 1 0 3 1 4',
  polygon: 'M4 18l3-13 9 3 4 9-9 3z',
  wand: 'M4 20L15 9M15 9l2-2M17 3v2M21 7h-2M19.5 4.5l-1.4 1.4M13 3l.7 1.6M21 11l-1.6-.7',
  quick: 'M5 19c3 0 3-4 6-4s3-4 6-4M17 11a3 3 0 1 0 0.01 0M5 5l2 2M9 3v2M3 9h2',
  crop: 'M6 2v16h16M2 6h16v16',
  eyedropper: 'M19 5a2.1 2.1 0 0 0-3-3l-3 3-1-1-2 2 1 1-7 7v3h3l7-7 1 1 2-2-1-1z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  heal: 'M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z',
  brush: 'M18.4 2.6a2 2 0 0 1 3 3L12 15l-3-3zM9 12c-2 0-4 1.5-4 4 0 1.5-1 2.5-3 3 4 2 9 1 10-4',
  pencil: 'M16 3l5 5L8 21H3v-5zM13 6l5 5',
  replace: 'M18.4 2.6a2 2 0 0 1 3 3L12 15l-3-3zM4 20a3 3 0 1 0 0.01 0',
  stamp: 'M9 3h6v5l2 3H7l2-3zM5 13h14v4H5zM4 21h16',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 3',
  eraser: 'M3 17l9-9 7 7-5 5H7zM10 10l7 7M14 20h7',
  magicEraser: 'M3 17l9-9 7 7-5 5H7zM18 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  gradient: 'M3 5h18v14H3zM7 5v14M11 5v14M15 5v14',
  bucket: 'M5 11l7-7 8 8-7 7zM5 11l8 0M20 15s2 3 2 4a2 2 0 0 1-4 0c0-1 2-4 2-4',
  blur: 'M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z',
  sharpen: 'M12 2l6 18H6z',
  smudge: 'M8 21V11a2 2 0 0 1 4 0v-1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v4a5 5 0 0 1-5 5zM8 13H6a2 2 0 0 0 0 4h2',
  dodge: 'M12 13a5 5 0 1 0 0.01 0M12 18v4',
  burn: 'M6 4h12M8 4c0 6 8 6 8 0M12 10v12',
  sponge: 'M4 8c2-3 14-3 16 0v9c-2 3-14 3-16 0zM8 11v.01M12 13v.01M16 11v.01M10 15v.01M14 16v.01',
  pen: 'M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6M11 11a2 2 0 1 0 0.01 0',
  freeform: 'M12 19l7-7 3 3-7 7zM3 20c4-1 2-8 6-9s3 4 6 2',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
  typeV: 'M17 4h3v16h-3M4 9v6M4 12h16',
  select: 'M5 3l14 8-6 2-3 6z',
  rect: 'M4 5h16v14H4z',
  rounded: 'M8 5h8a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z',
  triangle: 'M12 4l9 16H3z',
  line: 'M4 20L20 4',
  star: 'M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z',
  heart: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z',
  blossom: 'M12 9c-2-5 2-7 2-7s4 2 1 7M15 11c5-2 7 2 7 2s-2 4-7 1M14 15c2 5-2 7-2 7s-4-2-1-7M9 14c-5 2-7-2-7-2s2-4 7-1M12 12a1.5 1.5 0 1 0 0.01 0',
  arrow: 'M3 12h14M13 6l6 6-6 6',
  speech: 'M4 4h16v11H9l-5 5z',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V3.5a1.5 1.5 0 0 1 3 0V10M14 10V5a1.5 1.5 0 0 1 3 0v6M17 8.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.5-2.7L3 15.5a1.6 1.6 0 0 1 2.5-2L8 16',
  zoom: 'M10 3a7 7 0 1 0 0.01 0M21 21l-6-6',
  swap: 'M16 3l4 4-4 4M20 7H9M8 21l-4-4 4-4M4 17h11',
  quickmask: 'M3 3h18v18H3zM12 7a5 5 0 1 0 0.01 0',
  screen: 'M3 4h18v13H3zM8 21h8M12 17v4',
  layers: 'M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 9a3 3 0 1 0 0.01 0',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  fx: 'M5 20c3 0 3-16 6-16M4 10h7M13 10l7 10M20 10l-7 10',
  mask: 'M3 3h18v18H3zM12 7a5 5 0 1 0 0.01 0',
  adjust: 'M12 3a9 9 0 1 0 0.01 0M12 3v18',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  plus: 'M12 5v14M5 12h14',
  newLayer: 'M4 4h16v16H4zM12 8v8M8 12h8',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
  doc: 'M6 2h9l5 5v15H6zM14 2v6h6',
  chevron: 'M6 9l6 6 6-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  min: 'M5 12h14',
  max: 'M5 5h14v14H5z',
  restore: 'M8 8h11v11H8zM5 16V5h11',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  check: 'M5 12l5 5L20 7',
  info: 'M12 3a9 9 0 1 0 0.01 0M12 11v6M12 7v.01',
  navigator: 'M3 3h18v18H3zM8 8h8v8H8z',
  character: 'M4 20l6-16h1l6 16M7 14h8',
  paragraph: 'M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13',
  brushes: 'M18.4 2.6a2 2 0 0 1 3 3L12 15l-3-3zM6 15a3 3 0 0 0-3 3c0 2-1 3-1 3s5 0 6-3a3 3 0 0 0-2-3',
  alignL: 'M4 3v18M8 7h12v4H8zM8 14h7v4H8z',
  alignHC: 'M12 3v18M6 7h12v4H6zM8 14h8v4H8z',
  alignR: 'M20 3v18M4 7h12v4H4zM9 14h7v4H9z',
  alignT: 'M3 4h18M7 8h4v12H7zM14 8h4v7h-4z',
  alignVC: 'M3 12h18M7 6h4v12H7zM14 8h4v8h-4z',
  alignB: 'M3 20h18M7 4h4v12H7zM14 9h4v7h-4z',
  newSel: 'M4 4h16v16H4z',
  addSel: 'M3 3h11v11H3zM10 10h11v11H10z',
  subSel: 'M3 3h11v11H3zM14 14h7v7h-7z',
  intSel: 'M3 3h11v11H3zM10 10h11v11H10zM10 10h4v4h-4z',
  rotate: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  flipH: 'M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z',
  sparkle: 'M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  help: 'M12 3a9 9 0 1 0 0.01 0M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7M12 17v.01',
  folderOpen: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-3 9H3zM7 10h15l-3 9H4z',
  save: 'M5 3h11l4 4v14H4V3zM8 3v5h8V3M8 21v-7h8v7',
  image: 'M3 4h18v16H3zM8 9a1.5 1.5 0 1 0 0.01 0M21 16l-5-5-9 9',
  redeye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 9a3 3 0 1 0 0.01 0M12 11.5v1',
  pattern: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  object: 'M4 4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 8V4M9 9h6v6H9z',
  row: 'M3 11h18v2H3z',
  col: 'M11 3h2v18h-2z',
  clipboard: 'M9 2h6v4H9zM7 4H5v18h14V4h-2',
  play: 'M7 4l13 8-13 8z',
};

export function Icon({ name, size = 18, stroke = 1.6, className = '', style }) {
  const d = P[name] || P.doc;
  return (
    <svg className={'ico ' + className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Dekorative Kirschblüte
export function Blossom({ size = 22, color = '#f2a6cf', className = '', style }) {
  const petals = [0, 72, 144, 216, 288];
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      {petals.map((a) => (
        <path key={a} transform={`rotate(${a})`} d="M0 -1.5 C -4.2 -4 -4.8 -9 -1.4 -10.6 L 0 -9.2 L 1.4 -10.6 C 4.8 -9 4.2 -4 0 -1.5 Z" fill={color} opacity="0.95" />
      ))}
      {petals.map((a) => <path key={'v' + a} transform={`rotate(${a})`} d="M0 -1.5 L0 -6" stroke="#c24c8c" strokeWidth="0.5" opacity="0.5" />)}
      <circle r="1.6" fill="#ffe9a6" />
      <circle r="0.6" fill="#d9577f" />
    </svg>
  );
}

export function Logo({ size = 30 }) {
  return (
    <div className="logo" style={{ width: size, height: size }}>
      <Blossom size={size * 0.8} color="#fff" />
    </div>
  );
}
