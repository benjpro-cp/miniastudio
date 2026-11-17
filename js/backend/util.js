// Petits utilitaires partagés (version navigateur).

export function uid(prefix = '') {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return prefix + Date.now().toString(36) + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slugify(str, max = 40) {
  return String(str || 'miniature')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max) || 'miniature';
}

export const MIME_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sniffBytes(u8) {
  if (!u8 || u8.length < 12) return 'application/octet-stream';
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif';
  return 'application/octet-stream';
}

export function base64ToBlob(b64, mime) {
  const bytes = base64ToBytes(b64);
  return new Blob([bytes], { type: MIME_EXT[mime] ? mime : sniffBytes(bytes) });
}

export async function sniffBlob(blob) {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return sniffBytes(head);
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob) {
  const url = await blobToDataUrl(blob);
  return url.slice(url.indexOf(',') + 1);
}

export function parseDataUrl(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw httpError(400, 'Image invalide.');
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  if (!MIME_EXT[mime]) throw httpError(400, `Format d'image non supporté : ${mime}`);
  return { mime, blob: base64ToBlob(m[2], mime), ext: MIME_EXT[mime] };
}

// Extrait un objet JSON d'une réponse de LLM (même entourée de texte ou de ```json).
export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '').trim();
  if (!s) throw new Error("Réponse vide de l'IA.");
  try { return JSON.parse(s); } catch (_) { /* on continue */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch (_) { /* on continue */ } }
  const first = s.search(/[[{]/);
  if (first >= 0) {
    const close = s[first] === '{' ? '}' : ']';
    const last = s.lastIndexOf(close);
    if (last > first) {
      const candidate = s.slice(first, last + 1);
      try { return JSON.parse(candidate); } catch (_) {
        try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch (_) { /* rien */ }
      }
    }
  }
  throw new Error("L'IA n'a pas renvoyé de JSON lisible. Réessaie.");
}

export function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function normHex(c) {
  if (typeof c !== 'string') return null;
  let s = c.trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s.slice(1).split('').map((x) => x + x).join('');
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : null;
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await fn(items[idx], idx) }; } catch (e) { results[idx] = { ok: false, error: e }; }
    }
  }));
  return results;
}
