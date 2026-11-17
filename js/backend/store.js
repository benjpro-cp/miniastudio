// Stockage dans le navigateur (IndexedDB) : ta DA, tes notes, tes images et tes clés restent sur ton appareil.
import { uid, MIME_EXT, sniffBlob } from './util.js';

const DB_NAME = 'miniastudio';
export const DATA_DIR = 'ce navigateur (sur cet appareil)';
export const DIRS = ['refs', 'faces', 'gens', 'thumbs', 'exports'];

export const DEFAULT_CONFIG = {
  keys: { vertex: '', gemini: '', xai: '', groq: '', openai: '', custom: '' },
  customBaseUrl: '',
  brain: { provider: 'demo', model: '' },
  image: { provider: 'demo', model: '', resolution: '1k', quality: 'auto', maxRefs: 2 },
  autoLearn: true,
  learnEvery: 5,
};

const DEFAULT_DB = {
  schema: 1,
  channel: { name: '', niche: '', audience: '', tone: '' },
  da: null,
  daVersion: 0,
  daHistory: [],
  refs: [],
  faces: [],
  generations: [],
  stats: { feedbackSinceLearn: 0, totalFeedback: 0, imagesGenerated: 0, costUsd: 0, monthly: {}, lastLearnAt: null },
};

let idb = null;
export let db = null;
export let config = null;
const urls = new Map();

const clone = (o) => JSON.parse(JSON.stringify(o));

export function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('IndexedDB indisponible'));
    r.onblocked = () => reject(new Error('Ferme les autres onglets MiniaStudio puis recharge la page.'));
  });
}

function run(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = idb.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Stockage plein ?'));
  });
}

export async function init() {
  if (idb) return;
  try {
    idb = await openIdb();
  } catch (e) {
    throw new Error(`Ton navigateur bloque le stockage local (navigation privée ?). ${e.message || ''}`.trim());
  }
  const [savedDb, savedConfig] = await Promise.all([run('kv', 'readonly', (s) => s.get('db')), run('kv', 'readonly', (s) => s.get('config'))]);
  db = deepMerge(clone(DEFAULT_DB), savedDb || {});
  config = deepMerge(clone(DEFAULT_CONFIG), savedConfig || {});
  // Liens internes (blob:) vers toutes les images enregistrées.
  await new Promise((resolve, reject) => {
    const t = idb.transaction('files', 'readonly');
    const cur = t.objectStore('files').openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      urls.set(c.key, URL.createObjectURL(c.value));
      c.continue();
    };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  // Demande au navigateur de ne pas effacer les données en cas de manque de place.
  try { await navigator.storage?.persist?.(); } catch (_) { /* facultatif */ }
}

// --- Sauvegarde sérialisée ---
let saving = false;
let dirty = false;
export function saveDb() {
  dirty = true;
  if (saving) return;
  saving = true;
  (async () => {
    while (dirty) {
      dirty = false;
      try { await run('kv', 'readwrite', (s) => s.put(clone(db), 'db')); } catch (e) { console.error('Sauvegarde impossible :', e); }
    }
    saving = false;
  })();
}

export async function saveConfig() {
  await run('kv', 'readwrite', (s) => s.put(clone(config), 'config'));
}

export function setConfig(c) { config = c; }
export function setDb(d) { db = d; }

// --- Fichiers image ---
export async function writeFile(dirKey, name, blob) {
  const key = `${dirKey}/${name}`;
  await run('files', 'readwrite', (s) => s.put(blob, key));
  if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
  urls.set(key, URL.createObjectURL(blob));
  return name;
}

export async function saveImage(dirKey, blob, mime, prefix = '') {
  const real = MIME_EXT[mime] ? mime : await sniffBlob(blob);
  const typed = blob.type === real ? blob : new Blob([blob], { type: real });
  const name = `${uid(prefix)}.${MIME_EXT[real] || 'png'}`;
  return writeFile(dirKey, name, typed);
}

export async function readImage(dirKey, name) {
  const blob = await run('files', 'readonly', (s) => s.get(`${dirKey}/${name}`));
  if (!blob) throw new Error('Fichier introuvable');
  return { blob, mime: blob.type || await sniffBlob(blob) };
}

export async function removeFile(dirKey, name) {
  if (!name) return;
  const key = `${dirKey}/${name}`;
  await run('files', 'readwrite', (s) => s.delete(key)).catch(() => {});
  if (urls.has(key)) { URL.revokeObjectURL(urls.get(key)); urls.delete(key); }
}

export function fileUrl(dirKey, name) {
  return urls.get(`${dirKey}/${name}`) || '';
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function addUsage(costUsd) {
  const m = monthKey();
  db.stats.imagesGenerated = (db.stats.imagesGenerated || 0) + 1;
  db.stats.costUsd = (db.stats.costUsd || 0) + (costUsd || 0);
  const cur = db.stats.monthly[m] || { images: 0, costUsd: 0 };
  cur.images += 1;
  cur.costUsd += costUsd || 0;
  db.stats.monthly[m] = cur;
}

// --- Sauvegarde complète (pour changer d'appareil ou de navigateur) ---
export async function listFiles(prefixes) {
  const out = [];
  await new Promise((resolve, reject) => {
    const t = idb.transaction('files', 'readonly');
    const cur = t.objectStore('files').openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      if (prefixes.some((p) => String(c.key).startsWith(p))) out.push([c.key, c.value]);
      c.continue();
    };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return out;
}

export async function clearAll() {
  await run('files', 'readwrite', (s) => s.clear());
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}
