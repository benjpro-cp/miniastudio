// Moteur de rendu des miniatures : image de fond + calques de texte (style YouTube).
// Tout est dessiné dans un repère 1280×720 (taille officielle d'une miniature YouTube).

export const W = 1280;
export const H = 720;

export const FONTS = [
  { name: 'Anton', weight: 400, desc: 'Condensée, ultra impactante' },
  { name: 'Bebas Neue', weight: 400, desc: 'Condensée élégante' },
  { name: 'Montserrat', weight: 900, desc: 'Moderne et massive' },
  { name: 'Archivo Black', weight: 400, desc: 'Large et lourde' },
  { name: 'Poppins', weight: 900, desc: 'Ronde moderne' },
  { name: 'Rubik', weight: 900, desc: 'Arrondie, sympa' },
  { name: 'Oswald', weight: 700, desc: 'Condensée classique' },
  { name: 'Luckiest Guy', weight: 400, desc: 'Fun / cartoon' },
  { name: 'Bangers', weight: 400, desc: 'Bande dessinée' },
  { name: 'Titan One', weight: 400, desc: 'Ronde, gaming' },
  { name: 'Permanent Marker', weight: 400, desc: 'Feutre manuscrit' },
];

export const DEFAULT_ADJUST = { brightness: 1, contrast: 1, saturate: 1, vignette: 0, zoom: 1, panX: 0, panY: 0 };
export const BOOST_ADJUST = { brightness: 1.04, contrast: 1.14, saturate: 1.28, vignette: 0.32 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : a));

export function fontSpec(name, size) {
  const f = FONTS.find((x) => x.name === name) || FONTS[0];
  return `${f.weight} ${Math.max(1, Math.round(size))}px "${f.name}"`;
}

export async function ensureFonts() {
  await Promise.all(FONTS.map((f) => document.fonts.load(fontSpec(f.name, 64), 'AÉé!').catch(() => null)));
}

const SUPPORTS_FILTER = (() => {
  try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch (_) { return false; }
})();
export const supportsFilter = SUPPORTS_FILTER;

let seq = 0;
export function newLayer(over = {}) {
  return {
    id: `l${Date.now().toString(36)}${seq++}`,
    text: 'TON TEXTE',
    font: 'Anton',
    size: 120,
    fill: '#FFFFFF',
    accent: '#FFD400',
    stroke: '#000000',
    strokeWidth: 10,
    shadow: true,
    uppercase: true,
    align: 'center',
    rotation: 0,
    box: false,
    boxColor: '#E10600',
    lineHeight: 0.98,
    maxWidth: 560,
    x: 330,
    y: 360,
    ...over,
  };
}

// Découpe le texte en lignes → mots → segments (un *mot* entre étoiles = couleur d'accent).
function tokenize(text, uppercase) {
  const src = uppercase ? String(text || '').toLocaleUpperCase('fr-FR') : String(text || '');
  return src.split('\n').map((line) => {
    const words = [];
    let glue = false;
    for (const part of line.split(/(\*[^*\n]+\*)/g)) {
      if (!part) continue;
      const accent = part.length > 2 && part.startsWith('*') && part.endsWith('*');
      const content = accent ? part.slice(1, -1) : part;
      for (const piece of content.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) { glue = false; continue; }
        if (glue && words.length) words[words.length - 1].push({ t: piece, accent });
        else words.push([{ t: piece, accent }]);
        glue = true;
      }
    }
    return words;
  });
}

function layout(ctx, L) {
  ctx.font = fontSpec(L.font, L.size);
  const space = ctx.measureText(' ').width;
  const lines = [];
  let widest = 0;
  for (const words of tokenize(L.text, L.uppercase)) {
    let cur = [];
    let curW = 0;
    for (const segs of words) {
      const w = segs.reduce((s, sg) => s + ctx.measureText(sg.t).width, 0);
      widest = Math.max(widest, w);
      if (cur.length && curW + space + w > L.maxWidth) {
        lines.push({ words: cur, width: curW });
        cur = [];
        curW = 0;
      }
      curW += (cur.length ? space : 0) + w;
      cur.push({ segs, w });
    }
    lines.push({ words: cur, width: curW });
  }
  const capH = ctx.measureText('H').actualBoundingBoxAscent || L.size * 0.7;
  return { lines, space, widest, capH };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawLayer(ctx, L) {
  const { lines, space, capH } = layout(ctx, L);
  const lh = L.size * (L.lineHeight || 1);
  const blockW = Math.max(1, ...lines.map((l) => l.width));
  const blockH = lines.length * lh;
  const sw = Math.max(0, L.strokeWidth || 0);
  const padX = L.box ? L.size * 0.3 : sw + 4;
  const padY = L.box ? L.size * 0.2 : sw + 4;
  ctx.save();
  ctx.translate(L.x, L.y);
  ctx.rotate(((L.rotation || 0) * Math.PI) / 180);
  ctx.font = fontSpec(L.font, L.size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (L.box) {
    ctx.fillStyle = L.boxColor || '#E10600';
    roundRect(ctx, -blockW / 2 - padX, -blockH / 2 - padY, blockW + 2 * padX, blockH + 2 * padY, L.size * 0.14);
    ctx.fill();
  }
  const startX = (line) => (L.align === 'left' ? -blockW / 2 : L.align === 'right' ? blockW / 2 - line.width : -line.width / 2);
  const each = (fn) => lines.forEach((line, i) => {
    let x = startX(line);
    const y = -blockH / 2 + lh * (i + 0.5) + capH / 2;
    for (const word of line.words) {
      for (const sg of word.segs) {
        fn(sg, x, y);
        x += ctx.measureText(sg.t).width;
      }
      x += space;
    }
  });
  const shadowOn = () => {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = L.size * 0.16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = L.size * 0.06;
  };
  const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
  if (sw > 0) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = sw * 2;
    ctx.strokeStyle = L.stroke || '#000';
    if (L.shadow) shadowOn();
    each((sg, x, y) => ctx.strokeText(sg.t, x, y));
    shadowOff();
  } else if (L.shadow) shadowOn();
  each((sg, x, y) => {
    ctx.fillStyle = sg.accent ? (L.accent || '#FFD400') : (L.fill || '#FFF');
    ctx.fillText(sg.t, x, y);
  });
  shadowOff();
  ctx.restore();
  L._bounds = { w: blockW + 2 * padX, h: blockH + 2 * padY };
  return L._bounds;
}

export function imageRect(img, adjust = {}) {
  const a = { ...DEFAULT_ADJUST, ...adjust };
  const s = Math.max(W / img.width, H / img.height) * clamp(a.zoom, 1, 4);
  const dw = img.width * s;
  const dh = img.height * s;
  const mx = Math.max(0, (dw - W) / 2);
  const my = Math.max(0, (dh - H) / 2);
  return { dw, dh, mx, my, dx: (W - dw) / 2 + clamp(a.panX, -1, 1) * mx, dy: (H - dh) / 2 + clamp(a.panY, -1, 1) * my };
}

export function drawBackground(ctx, img, adjust = {}) {
  const a = { ...DEFAULT_ADJUST, ...adjust };
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (img) {
    const r = imageRect(img, a);
    if (SUPPORTS_FILTER) ctx.filter = `brightness(${clamp(a.brightness, 0.3, 2)}) contrast(${clamp(a.contrast, 0.3, 2.5)}) saturate(${clamp(a.saturate, 0, 3)})`;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
    if (SUPPORTS_FILTER) ctx.filter = 'none';
  }
  const v = clamp(a.vignette, 0, 0.9);
  if (v > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${v})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Dessine la miniature complète dans n'importe quel canvas (mis à l'échelle automatiquement). */
export function renderThumbnail(ctx, { img, layers = [], adjust = {}, bgCache = null }) {
  const scale = ctx.canvas.width / W;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (bgCache) ctx.drawImage(bgCache, 0, 0, W, H);
  else drawBackground(ctx, img, adjust);
  for (const L of layers) if (!L.hidden && String(L.text || '').trim()) drawLayer(ctx, L);
  ctx.restore();
}

export function hitTest(L, p) {
  if (!L._bounds) return false;
  const a = (-(L.rotation || 0) * Math.PI) / 180;
  const dx = p.x - L.x;
  const dy = p.y - L.y;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(rx) <= L._bounds.w / 2 + 6 && Math.abs(ry) <= L._bounds.h / 2 + 6;
}

let measureCtx = null;
// Trouve la plus grande taille de police qui tient dans la zone voulue.
export function autoFit(L, { maxLines = 3, maxHeight = 520, min = 48, max = 190 } = {}) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  for (let size = max; size >= min; size -= 4) {
    L.size = size;
    const { lines, widest } = layout(measureCtx, L);
    if (widest <= L.maxWidth && lines.length <= maxLines && lines.length * size * (L.lineHeight || 1) <= maxHeight) return L;
  }
  L.size = min;
  return L;
}

const SPOTS = { left: [330, 360], right: [950, 360], top: [640, 140], bottom: [600, 585], center: [640, 360] };

/** Calques de texte par défaut d'une génération : texte de l'idée + typo de la DA. */
export function defaultLayers(gen, da) {
  if (gen?.input?.textMode === 'image') return [];
  const text = String(gen?.concept?.text || '').trim();
  if (!text) return [];
  const t = da?.typography || {};
  const pos = SPOTS[gen.concept.textPosition] ? gen.concept.textPosition : (t.position || 'left');
  const side = pos === 'left' || pos === 'right';
  const L = newLayer({
    text,
    font: t.font || 'Anton',
    fill: t.fill || '#FFFFFF',
    accent: t.accent || '#FFD400',
    stroke: t.stroke || '#000000',
    strokeWidth: Number.isFinite(+t.strokeWidth) ? +t.strokeWidth : 10,
    uppercase: t.uppercase !== false,
    box: !!t.box,
    boxColor: t.boxColor || '#E10600',
    maxWidth: side ? 560 : 1040,
    x: SPOTS[pos][0],
    y: SPOTS[pos][1],
  });
  autoFit(L, side ? { maxLines: 3, maxHeight: 540 } : { maxLines: 2, maxHeight: 230 });
  return [L];
}

export function layersFor(gen, da) {
  if (Array.isArray(gen?.layers)) return gen.layers;
  return defaultLayers(gen, da);
}

export function cleanLayers(layers) {
  return layers.map(({ _bounds, ...rest }) => rest);
}
