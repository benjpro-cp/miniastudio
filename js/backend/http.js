// Appels aux IA depuis le navigateur : délai max, nouvelles tentatives, messages d'erreur clairs.
import { sleep } from './util.js';

export class ApiError extends Error {
  constructor(status, message, raw) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

export function extractMessage(text) {
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    if (typeof e === 'string') return e;
    if (e && typeof e.message === 'string') return e.message;
    if (typeof j.message === 'string') return j.message;
    if (typeof j.detail === 'string') return j.detail;
  } catch (_) { /* texte brut */ }
  return String(text || '').slice(0, 400);
}

export function friendly(err, providerLabel = "l'IA") {
  const st = err.status;
  const msg = err.message || '';
  if (err.name === 'AbortError' || /aborted|timeout/i.test(msg)) return `${providerLabel} a mis trop de temps à répondre. Réessaie.`;
  if (err instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return `Impossible de joindre ${providerLabel}. Vérifie ta connexion internet (certains fournisseurs refusent aussi les appels venant d'une page web : Gemini, lui, les accepte).`;
  }
  if (st === 401 || st === 403) {
    if (/express|trial|free tier/i.test(msg) && /Google Cloud/i.test(providerLabel)) return `${providerLabel} : ton essai gratuit Google Cloud est terminé ou indisponible pour ce compte. Active la facturation dans la console Google Cloud, ou change de fournisseur. Détail : ${msg}`;
    if (/credit|billing|balance|payment|spend/i.test(msg)) return `${providerLabel} : plus de crédits sur ton compte (ajoute quelques dollars dans la console du fournisseur, ou active la facturation). Détail : ${msg}`;
    return `${providerLabel} refuse la clé API (clé invalide, ou pas d'accès à ce modèle). Détail : ${msg}`;
  }
  if (st === 402) return `${providerLabel} : crédits épuisés. Recharge ton compte. Détail : ${msg}`;
  if (st === 404) return `${providerLabel} : modèle introuvable. Choisis un autre modèle dans Réglages. Détail : ${msg}`;
  if (st === 429) {
    const raw = `${msg} ${err.raw || ''}`;
    if (/limit:\s*0\b/i.test(raw)) {
      const tip = /AI Studio/i.test(providerLabel) ? ' Astuce : dans Réglages, choisis « Gemini · Google Cloud (mode express) », gratuit pendant 90 jours.' : '';
      return `${providerLabel} : ce modèle n'est pas inclus dans l'offre gratuite. Active la facturation sur ton compte, ou choisis un autre modèle / fournisseur.${tip} Détail : ${msg}`;
    }
    if (/per.?day|perday|daily/i.test(raw)) return `${providerLabel} : quota gratuit du jour atteint. Réessaie demain, ou active la facturation. Détail : ${msg}`;
    return `${providerLabel} : trop de demandes d'un coup (limite par minute). Attends une minute et réessaie.`;
  }
  if (st === 400 && /image/i.test(msg) && /support|vision|multimodal/i.test(msg)) return `${providerLabel} : ce modèle ne sait pas lire les images. Choisis un modèle « vision » dans Réglages. Détail : ${msg}`;
  if (st === 400 && /safety|policy|moderat|blocked|refus/i.test(msg)) return `${providerLabel} a refusé la demande (filtre de sécurité). Reformule l'idée. Détail : ${msg}`;
  if (st >= 500) return `${providerLabel} a un souci de son côté (erreur ${st}). Réessaie dans un instant.`;
  return `${providerLabel} : ${msg || 'erreur inconnue'}`;
}

/** Requête vers une API d'IA. body objet → JSON ; FormData → multipart. expect : 'json' | 'text' | 'blob'. */
export async function request(url, { method = 'POST', headers = {}, body, timeoutMs = 180000, retries = 2, expect = 'json' } = {}) {
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      const h = { ...headers };
      let payload = body;
      if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      res = await fetch(url, { method, headers: h, body: method === 'GET' ? undefined : payload, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt < retries && e.name !== 'AbortError') {
        attempt++;
        await sleep(1500 * attempt);
        continue;
      }
      throw e;
    }
    clearTimeout(timer);

    if (res.ok) {
      if (expect === 'blob') return res.blob();
      if (expect === 'text') return res.text();
      const txt = await res.text();
      try { return txt ? JSON.parse(txt) : {}; } catch (_) { throw new ApiError(res.status, `Réponse illisible : ${txt.slice(0, 200)}`); }
    }

    const text = await res.text().catch(() => '');
    const message = extractMessage(text) || res.statusText;
    const retryable = res.status === 429 || res.status >= 500;
    const hopeless = res.status === 429 && /limit:\s*0\b|per.?day|perday|daily/i.test(text);
    if (retryable && !hopeless && attempt < retries) {
      attempt++;
      const ra = Number(res.headers.get('retry-after'));
      const hinted = /retry in ([\d.]+)\s*s/i.exec(text)?.[1] || /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(text)?.[1];
      let wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : hinted ? Number(hinted) * 1000 + 500 : 2500 * attempt * attempt;
      wait = Math.min(wait, 45000);
      await sleep(wait);
      continue;
    }
    throw new ApiError(res.status, message, text);
  }
}
