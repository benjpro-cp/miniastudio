// Import de miniatures depuis des liens de vidéos YouTube (version en ligne).
// Le navigateur ne peut pas lire les pages YouTube : on récupère la miniature HD et le titre
// via des services publics compatibles (images YouTube, wsrv.nl, noembed.com).
import { mapLimit, blobToDataUrl } from './util.js';

export function parseLinks(text) {
  const videos = new Set();
  let channels = 0;
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const s = raw.trim();
    if (!s) continue;
    const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i.exec(s);
    if (m) { videos.add(m[1]); continue; }
    if (/youtube\.com\/(channel\/|@|c\/|user\/)|^@[\w.-]{2,}$/i.test(s)) { channels++; continue; }
    if (/^[\w-]{11}$/.test(s)) videos.add(s);
  }
  return { videos: [...videos], channels };
}

async function fetchImage(url) {
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = await r.blob();
  if (b.size < 3000) throw new Error('image indisponible');
  return b;
}

async function thumbnail(id) {
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    const direct = `https://i.ytimg.com/vi/${id}/${name}.jpg`;
    for (const url of [direct, `https://wsrv.nl/?url=${encodeURIComponent(direct)}`]) {
      try { return await fetchImage(url); } catch (_) { /* on essaie la suivante */ }
    }
  }
  throw new Error('miniature introuvable (ou bloquée par le navigateur)');
}

async function videoTitle(id) {
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    const j = await r.json();
    return j.title || '';
  } catch (_) {
    return '';
  }
}

export async function importLinks(text, max = 20) {
  const { videos, channels } = parseLinks(text);
  const errors = [];
  if (channels) errors.push('Les liens de chaîne ne marchent pas dans la version en ligne : colle plutôt les liens de tes vidéos (un par ligne).');
  if (!videos.length && !channels) errors.push('Aucun lien YouTube reconnu. Colle des liens de vidéos, un par ligne.');
  const list = videos.slice(0, max);
  const results = await mapLimit(list, 4, async (id) => {
    const [blob, title] = await Promise.all([thumbnail(id), videoTitle(id)]);
    return { videoId: id, title, dataUrl: await blobToDataUrl(blob) };
  });
  const items = [];
  results.forEach((r, i) => {
    if (r.ok) items.push(r.value);
    else errors.push(`Vidéo ${list[i]} : ${r.error.message || 'erreur'} — enregistre la miniature et glisse-la ici à la place.`);
  });
  return { items, errors };
}
