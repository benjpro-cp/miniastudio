// L'apprentissage de ta DA :
//  1) analyse de tes miniatures de référence → DA de départ
//  2) à chaque série de notes (👍 ❤️ 👎 + commentaires), l'IA met à jour la DA et ses « préférences apprises »
import * as store from './store.js';
import * as P from './prompts.js';
import * as providers from './providers.js';
import * as demo from './demo.js';

export const status = { running: false, kind: null, progress: '', startedAt: null, last: null };

function isDemoBrain() { return store.config.brain.provider === 'demo'; }

async function refImage(ref, label) {
  // On envoie l'aperçu (640 px) : largement suffisant pour analyser, et bien plus léger.
  const img = await store.readImage(ref.thumb ? 'thumbs' : 'refs', ref.thumb || ref.file);
  return { ...img, label };
}

async function genImage(g, label) {
  const img = await store.readImage(g.thumb ? 'thumbs' : 'gens', g.thumb || g.file);
  return { ...img, label };
}

export function commitDA(da, reason, changelog = []) {
  const db = store.db;
  const clean = P.normalizeDA(da, db.da);
  db.daVersion = (db.daVersion || 0) + 1;
  db.da = clean;
  db.daHistory.push({ version: db.daVersion, at: new Date().toISOString(), reason, changelog, da: clean });
  if (db.daHistory.length > 40) db.daHistory.splice(0, db.daHistory.length - 40);
  store.saveDb();
  return { version: db.daVersion, changelog };
}

export async function analyzeRefs(force = false) {
  const db = store.db;
  const todo = db.refs.filter((r) => force || !r.analysis);
  if (!todo.length) return;
  if (isDemoBrain()) {
    for (const r of todo) r.analysis = demo.analyzeRef(r);
    store.saveDb();
    return;
  }
  const batchSize = store.config.brain.provider === 'groq' ? 3 : 6;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    status.progress = `Analyse des miniatures ${i + 1} à ${Math.min(i + batchSize, todo.length)} sur ${todo.length}…`;
    const images = await Promise.all(batch.map((r) => refImage(r, r.kind === 'mine' ? 'miniature de la chaîne' : 'inspiration')));
    const res = await providers.brainJson({ system: P.SYSTEM, user: P.analyzePrompt(batch, db.channel), images, temperature: 0.3 });
    const list = Array.isArray(res?.analyses) ? res.analyses : Array.isArray(res) ? res : [];
    batch.forEach((r, k) => {
      const a = list.find((x) => Number(x?.image) === k + 1) || list[k];
      if (a && typeof a === 'object') r.analysis = a;
    });
    store.saveDb();
  }
}

export async function synthesize(reason) {
  const db = store.db;
  if (!db.refs.length) throw Object.assign(new Error('Ajoute d\'abord quelques miniatures de référence (idéalement 5 à 15 de ta chaîne).'), { status: 400 });
  await analyzeRefs(false);
  status.progress = 'Synthèse de ta direction artistique…';
  if (isDemoBrain()) return commitDA(demo.synthesizeDA(db.refs, db.channel, db.da), reason, ['DA créée en mode démo (à partir des couleurs).']);
  // Quelques images en direct pour que l'IA « voie » le style (préférées d'abord).
  const sample = [...db.refs]
    .sort((a, b) => (b.pinned - a.pinned) || ((b.kind === 'mine') - (a.kind === 'mine')) || ((b.analysis?.note || 0) - (a.analysis?.note || 0)))
    .slice(0, 4);
  const images = await Promise.all(sample.map((r) => refImage(r, r.kind === 'mine' ? 'miniature de la chaîne' : 'inspiration')));
  const res = await providers.brainJson({ system: P.SYSTEM, user: P.synthesizePrompt(db.refs, db.channel, db.da), images, temperature: 0.4 });
  return commitDA(res, reason, Array.isArray(res?.changelog) ? res.changelog.map(String) : []);
}

export async function learnFromFeedback() {
  const db = store.db;
  const since = db.stats.lastLearnAt || '';
  const rated = db.generations.filter((g) => (g.rating || g.final) && (g.ratedAt || g.createdAt) > since);
  if (!rated.length) throw Object.assign(new Error('Pas encore de nouvelles notes. Note quelques miniatures (👍 ❤️ 👎) puis réessaie.'), { status: 400 });
  const score = (g) => (g.final ? 2.5 : 0) + (g.rating || 0);
  const loved = rated.filter((g) => score(g) >= 2).slice(0, 10);
  const liked = rated.filter((g) => score(g) > 0 && score(g) < 2).slice(0, 6);
  const hated = rated.filter((g) => g.rating < 0).slice(0, 10);
  let result;
  if (isDemoBrain()) {
    if (!db.da) db.da = P.normalizeDA(demo.synthesizeDA(db.refs, db.channel, null), null);
    const r = demo.learn(db.da, loved.concat(liked), hated);
    result = commitDA(r.da, `Apprentissage (${rated.length} retour(s))`, r.changelog);
  } else {
    status.progress = `J'apprends de tes ${rated.length} dernier(s) retour(s)…`;
    const pics = [...loved.slice(0, 3).map((g) => [g, `adorée : « ${g.input?.title || ''} »`]), ...hated.slice(0, 2).map((g) => [g, `rejetée : « ${g.input?.title || ''} »${g.comment ? ` (${g.comment})` : ''}`])];
    const images = [];
    const imageLabels = [];
    for (const [g, label] of pics) {
      try { images.push(await genImage(g, label)); imageLabels.push(label); } catch (_) { /* image supprimée */ }
    }
    const res = await providers.brainJson({ system: P.SYSTEM, user: P.learnPrompt({ da: db.da, channel: db.channel, loved, liked, hated, imageLabels }), images, temperature: 0.4 });
    result = commitDA(res, `Apprentissage (${rated.length} retour(s))`, Array.isArray(res?.changelog) ? res.changelog.map(String).slice(0, 8) : []);
  }
  db.stats.feedbackSinceLearn = 0;
  db.stats.lastLearnAt = new Date().toISOString();
  store.saveDb();
  return result;
}

// Lance une tâche longue en arrière-plan (le navigateur suit l'avancement).
export function runInBackground(kind, fn) {
  if (status.running) return false;
  Object.assign(status, { running: true, kind, progress: 'Démarrage…', startedAt: Date.now() });
  Promise.resolve()
    .then(fn)
    .then((res) => { status.last = { ok: true, kind, at: Date.now(), ...(res || {}) }; })
    .catch((e) => { status.last = { ok: false, kind, at: Date.now(), error: e.message || String(e) }; console.error(`[${kind}]`, e.message); })
    .finally(() => { Object.assign(status, { running: false, kind: null, progress: '' }); });
  return true;
}

export function maybeAutoLearn() {
  const c = store.config;
  const db = store.db;
  if (!c.autoLearn || status.running) return false;
  if ((db.stats.feedbackSinceLearn || 0) < Math.max(2, Number(c.learnEvery) || 5)) return false;
  return runInBackground('learn', learnFromFeedback);
}

export function restore(version) {
  const db = store.db;
  const h = db.daHistory.find((x) => x.version === Number(version));
  if (!h) throw Object.assign(new Error('Version introuvable'), { status: 404 });
  return commitDA(h.da, `Retour à la version ${version}`, [`Restauration de la version ${version}`]);
}

