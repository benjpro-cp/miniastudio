// Mode « Démo » : permet de tester tout le site sans clé API (fausses images + idées basiques).
import { normHex } from './util.js';

// ---------- Couleurs ----------
function hexToRgb(hex) {
  const h = normHex(hex) || '#808080';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function saturation([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
function luminance([r, g, b]) { return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}


// ---------- Fausse image de miniature (dessinée avec un canvas) ----------
export async function makeImage({ seedText = '', palette = [], subjectPosition = 'right', width = 1280, height = 720 } = {}) {
  const rand = rng(hashStr(seedText + Date.now()));
  const cols = palette.map(hexToRgb).filter(Boolean);
  const hue = rand() * 360;
  const c1 = cols[0] || hslToRgb(hue, 0.85, 0.5);
  const c2 = cols[1] || hslToRgb((hue + 40 + rand() * 60) % 360, 0.9, 0.25);
  const subj = cols[2] || [25, 25, 30];
  const css = (rgb, a = 1) => `rgba(${rgb.map((v) => Math.round(v)).join(',')},${a})`;
  const W = width, H = height;
  const sx = subjectPosition === 'left' ? W * 0.28 : subjectPosition === 'center' ? W * 0.5 : W * 0.72;
  const hy = H * 0.42, hr = H * 0.17;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, css(c1));
  g.addColorStop(1, css(c2));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Rayons derrière le sujet
  const rays = 18 + Math.floor(rand() * 10);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * Math.PI * 2, a1 = ((i + 1) / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(sx, hy);
    ctx.arc(sx, hy, W * 1.5, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  // Halo
  const glow = ctx.createRadialGradient(sx, hy, 0, sx, hy, H * 0.9);
  glow.addColorStop(0, 'rgba(255,240,200,0.45)');
  glow.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Silhouette avec lumière de contour
  const shape = (grow) => {
    ctx.beginPath();
    ctx.arc(sx, hy, hr + grow, 0, Math.PI * 2);
    ctx.ellipse(sx, hy + hr * 2.45, hr * 1.75 + grow, hr * 1.7 + grow, 0, 0, Math.PI * 2);
  };
  ctx.fillStyle = 'rgba(255,245,220,0.95)';
  shape(6);
  ctx.fill();
  ctx.fillStyle = css(subj);
  shape(0);
  ctx.fill();
  // Vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

// ---------- « Cerveau » de démo ----------
export function aggregatePalette(refs) {
  const counts = new Map();
  for (const r of refs) {
    (r.palette || []).forEach((hex, i) => {
      const h = normHex(hex);
      if (!h) return;
      // On regroupe les couleurs proches
      const rgb = hexToRgb(h);
      let key = null;
      for (const k of counts.keys()) {
        const o = hexToRgb(k);
        if (Math.hypot(o[0] - rgb[0], o[1] - rgb[1], o[2] - rgb[2]) < 60) { key = k; break; }
      }
      key = key || h;
      counts.set(key, (counts.get(key) || 0) + (5 - Math.min(i, 4)) * (r.kind === 'mine' ? 2 : 1));
    });
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export function analyzeRef(ref) {
  const pal = (ref.palette || []).slice(0, 5);
  const vivid = pal.map(hexToRgb).sort((a, b) => saturation(b) - saturation(a))[0];
  return {
    description: `Miniature ${ref.kind === 'mine' ? 'de la chaîne' : "d'inspiration"}${ref.title ? ` (« ${ref.title} »)` : ''} — analyse simplifiée (mode démo, sans IA).`,
    couleurs: pal,
    pointsForts: vivid ? `Couleur la plus vive : ${rgbToHex(vivid)}` : '',
    note: 6,
  };
}

export function synthesizeDA(refs, channel, prev) {
  const pal = aggregatePalette(refs);
  const rgbs = pal.map(hexToRgb);
  const accent = [...rgbs].sort((a, b) => saturation(b) * (0.4 + luminance(b)) - saturation(a) * (0.4 + luminance(a)))[0];
  const dark = [...rgbs].sort((a, b) => luminance(a) - luminance(b))[0];
  const palette = pal.slice(0, 5).map((hex, i) => ({ hex, role: i === 0 ? 'dominante' : 'secondaire' }));
  if (!palette.length) palette.push({ hex: '#E10600', role: 'accent' }, { hex: '#111111', role: 'fond' }, { hex: '#FFFFFF', role: 'texte' });
  return {
    summary: `DA générée en mode démo à partir des couleurs de tes ${refs.length} référence(s). Branche une IA (Réglages) pour une vraie analyse de ton style.`,
    mood: 'Énergique, contrasté',
    palette,
    composition: 'Sujet principal sur un tiers, texte de l\'autre côté, fond simple.',
    subject: channel?.niche ? `En lien avec : ${channel.niche}` : 'Visage expressif ou objet principal en gros plan.',
    background: 'Fond simple, légèrement flou, couleurs de la palette.',
    lighting: 'Lumière contrastée, contour lumineux autour du sujet.',
    textStyle: '2 à 4 mots en majuscules, gros et épais, avec contour noir.',
    recurring: '',
    avoid: 'Trop d\'éléments, texte trop long, couleurs ternes.',
    typography: {
      font: prev?.typography?.font || 'Anton',
      fill: '#FFFFFF',
      stroke: dark && luminance(dark) < 0.35 ? rgbToHex(dark) : '#000000',
      strokeWidth: 10,
      accent: accent && saturation(accent) > 0.35 ? rgbToHex(accent) : '#FFD400',
      uppercase: true,
      maxWords: 4,
      position: 'left',
      box: false,
      boxColor: '#E10600',
    },
    imageStyle: `vibrant high-contrast YouTube thumbnail photo, saturated colors (${pal.slice(0, 3).join(', ') || 'red, yellow, black'}), strong rim light, shallow depth of field, clean simple background, dramatic lighting`,
    learned: prev?.learned || [],
  };
}

const HOOKS = ['INCROYABLE', 'LA VÉRITÉ', 'JAMAIS ÇA', 'ÇA A MAL TOURNÉ', 'JE NE M\'ATTENDAIS PAS À ÇA', 'LE PIRE', 'ENFIN !', 'NON...'];
const EMOTIONS = ['choqué', 'enthousiaste', 'inquiet', 'mystérieux'];

export function concepts(input, da, count = 3, assets = []) {
  const words = String(input.title || '').toUpperCase().split(/\s+/).filter((w) => w.length > 2);
  const maxW = da?.typography?.maxWords || 4;
  const out = [];
  for (let i = 0; i < count; i++) {
    const hook = i === 0 && words.length ? words.slice(0, Math.min(maxW, 3)).join(' ') : HOOKS[(i * 3 + words.length) % HOOKS.length];
    const parts = hook.split(' ');
    const li = parts.length - 1;
    if (li > 0 && /\p{L}/u.test(parts[li])) parts[li] = `*${parts[li]}*`;
    const subj = i % 2 === 0 ? 'right' : 'left';
    out.push({
      angle: ['Émotion forte', 'Le résultat', 'Avant / après', 'Mystère'][i % 4],
      why: 'Idée générée en mode démo (sans IA).',
      text: parts.join(' '),
      textPosition: subj === 'right' ? 'left' : 'right',
      subjectPosition: subj,
      emotion: EMOTIONS[i % EMOTIONS.length],
      scene: `Le créateur ${EMOTIONS[i % EMOTIONS.length]} en gros plan, en lien avec « ${input.title} ».`,
      imagePrompt: `Close-up of a YouTuber with a ${EMOTIONS[i % EMOTIONS.length]} expression, related to: ${input.title}. ${input.idea || ''}`.trim(),
      // Démo : les éléments ★ + un élément de la banque différent pour chaque idée
      assets: [...new Set([...assets.filter((a) => a.pinned).map((a) => a.code), ...(assets.length ? [assets[i % assets.length].code] : [])])].slice(0, 3),
    });
  }
  return out;
}

export function learn(da, liked, disliked) {
  const learned = [...(da?.learned || [])];
  const changelog = [];
  const comments = [...liked, ...disliked].map((g) => (g.comment || '').toLowerCase()).join(' ');
  const add = (rule, why) => { if (!learned.includes(rule)) { learned.push(rule); changelog.push(why); } };
  if (/long/.test(comments)) add('Texte très court : 3 mots maximum.', 'Tu as trouvé des textes trop longs.');
  if (/sombre/.test(comments)) add('Images plus lumineuses, éviter les fonds trop sombres.', 'Tu as trouvé des images trop sombres.');
  if (/charg/.test(comments)) add('Moins d\'éléments : un sujet, un objet, un texte.', 'Tu as trouvé des miniatures trop chargées.');
  if (/contrast/.test(comments)) add('Plus de contraste entre le sujet et le fond.', 'Tu as demandé plus de contraste.');
  const angles = liked.map((g) => g.concept?.angle).filter(Boolean);
  if (angles.length) add(`Angles qui te plaisent : ${[...new Set(angles)].slice(0, 3).join(', ')}.`, 'Basé sur tes miniatures préférées.');
  if (!changelog.length) changelog.push(`Mode démo : ${liked.length} like(s) et ${disliked.length} rejet(s) pris en compte.`);
  return { da: { ...da, learned: learned.slice(-12) }, changelog };
}


