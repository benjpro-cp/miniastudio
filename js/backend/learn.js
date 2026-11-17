// L'apprentissage de ta DA, dossier par dossier (GTA, films, histoire…) :
//  1) analyse des miniatures de référence du dossier → DA de départ
//  2) à chaque série de notes (👍 ❤️ 👎 + commentaires), l'IA met à jour la DA du dossier
import * as store from './store.js';
import * as P from './prompts.js';
import * as providers from './providers.js';
import * as demo from './demo.js';

export const status = { running: false, kind: null, folderId: null, progress: '', startedAt: null, last: null };

const isDemoBrain = () => store.config.brain.provider === 'demo';

// Infos de chaîne + thème du dossier, pour que l'IA sache de quel type de vidéo on parle.
export function channelFor(folder) {
  const ch = store.db.channel || {};
  const series = folder ? `${folder.name}${folder.description ? ` — ${folder.description}` : ''}` : '';
  return { ...ch, series };
}

export const folderRefs = (folder) => store.db.refs.filter((r) => r.folderId === folder.id);
export const folderGens = (folder) => store.db.generations.filter((g) => g.folderId === folder.id);

async function refImage(ref, label) {
  const img = await store.readImage(ref.thumb ? 'thumbs' : 'refs', ref.thumb || ref.file);
  return { ...img, label };
}

async function genImage(g, label) {
  const img = await store.readImage(g.thumb ? 'thumbs' : 'gens', g.thumb || g.file);
  return { ...img, label };
}

export function commitDA(folder, da, reason, changelog = []) {
  const clean = P.normalizeDA(da, folder.da);
  folder.daVersion = (folder.daVersion || 0) + 1;
  folder.da = clean;
  folder.daHistory = folder.daHistory || [];
  folder.daHistory.push({ version: folder.daVersion, at: new Date().toISOString(), reason, changelog, da: clean });
  if (folder.daHistory.length > 40) folder.daHistory.splice(0, folder.daHistory.length - 40);
  store.saveDb();
  return { version: folder.daVersion, changelog, folderId: folder.id, folderName: folder.name };
}

export async function analyzeRefs(folder, force = false) {
  const todo = folderRefs(folder).filter((r) => force || !r.analysis);
  if (!todo.length) return;
  if (isDemoBrain()) {
    for (const r of todo) r.analysis = demo.analyzeRef(r);
    store.saveDb();
    return;
  }
  const batchSize = store.config.brain.provider === 'groq' ? 3 : 6;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    status.progress = `« ${folder.name} » : analyse des miniatures ${i + 1} à ${Math.min(i + batchSize, todo.length)} sur ${todo.length}…`;
    const images = await Promise.all(batch.map((r) => refImage(r, r.kind === 'mine' ? 'miniature de la chaîne' : 'inspiration')));
    const res = await providers.brainJson({ system: P.SYSTEM, user: P.analyzePrompt(batch, channelFor(folder)), images, temperature: 0.3 });
    const list = Array.isArray(res?.analyses) ? res.analyses : Array.isArray(res) ? res : [];
    batch.forEach((r, k) => {
      const a = list.find((x) => Number(x?.image) === k + 1) || list[k];
      if (a && typeof a === 'object') r.analysis = a;
    });
    store.saveDb();
  }
}

export async function synthesize(folder, reason) {
  const refs = folderRefs(folder);
  if (!refs.length) throw Object.assign(new Error(`Ajoute d'abord quelques miniatures de référence dans le dossier « ${folder.name} » (idéalement 5 à 15).`), { status: 400 });
  await analyzeRefs(folder, false);
  status.progress = `« ${folder.name} » : synthèse de la direction artistique…`;
  const channel = channelFor(folder);
  if (isDemoBrain()) return commitDA(folder, demo.synthesizeDA(refs, channel, folder.da), reason, ['DA créée en mode démo (à partir des couleurs).']);
  const sample = [...refs]
    .sort((a, b) => (b.pinned - a.pinned) || ((b.kind === 'mine') - (a.kind === 'mine')) || ((b.analysis?.note || 0) - (a.analysis?.note || 0)))
    .slice(0, 4);
  const images = await Promise.all(sample.map((r) => refImage(r, r.kind === 'mine' ? 'miniature de la chaîne' : 'inspiration')));
  const res = await providers.brainJson({ system: P.SYSTEM, user: P.synthesizePrompt(refs, channel, folder.da), images, temperature: 0.4 });
  return commitDA(folder, res, reason, Array.isArray(res?.changelog) ? res.changelog.map(String) : []);
}

export async function learnFromFeedback(folder) {
  const since = folder.stats?.lastLearnAt || '';
  const rated = folderGens(folder).filter((g) => (g.rating || g.final) && (g.ratedAt || g.createdAt) > since);
  if (!rated.length) throw Object.assign(new Error(`Pas encore de nouvelles notes dans « ${folder.name} ». Note quelques miniatures (👍 ❤️ 👎) puis réessaie.`), { status: 400 });
  const score = (g) => (g.final ? 2.5 : 0) + (g.rating || 0);
  const loved = rated.filter((g) => score(g) >= 2).slice(0, 10);
  const liked = rated.filter((g) => score(g) > 0 && score(g) < 2).slice(0, 6);
  const hated = rated.filter((g) => g.rating < 0).slice(0, 10);
  const channel = channelFor(folder);
  let result;
  if (isDemoBrain()) {
    if (!folder.da) folder.da = P.normalizeDA(demo.synthesizeDA(folderRefs(folder), channel, null), null);
    const r = demo.learn(folder.da, loved.concat(liked), hated);
    result = commitDA(folder, r.da, `Apprentissage (${rated.length} retour(s))`, r.changelog);
  } else {
    status.progress = `« ${folder.name} » : j'apprends de tes ${rated.length} dernier(s) retour(s)…`;
    const pics = [...loved.slice(0, 3).map((g) => [g, `adorée : « ${g.input?.title || ''} »`]), ...hated.slice(0, 2).map((g) => [g, `rejetée : « ${g.input?.title || ''} »${g.comment ? ` (${g.comment})` : ''}`])];
    const images = [];
    const imageLabels = [];
    for (const [g, label] of pics) {
      try { images.push(await genImage(g, label)); imageLabels.push(label); } catch (_) { /* image supprimée */ }
    }
    const res = await providers.brainJson({ system: P.SYSTEM, user: P.learnPrompt({ da: folder.da, channel, loved, liked, hated, imageLabels }), images, temperature: 0.4 });
    result = commitDA(folder, res, `Apprentissage (${rated.length} retour(s))`, Array.isArray(res?.changelog) ? res.changelog.map(String).slice(0, 8) : []);
  }
  folder.stats = { ...(folder.stats || {}), feedbackSinceLearn: 0, lastLearnAt: new Date().toISOString() };
  store.saveDb();
  return result;
}

// Lance une tâche longue en arrière-plan (l'interface suit l'avancement).
export function runInBackground(kind, folder, fn) {
  if (status.running) return false;
  Object.assign(status, { running: true, kind, folderId: folder?.id || null, progress: 'Démarrage…', startedAt: Date.now() });
  Promise.resolve()
    .then(fn)
    .then((res) => { status.last = { ok: true, kind, at: Date.now(), ...(res || {}) }; })
    .catch((e) => { status.last = { ok: false, kind, at: Date.now(), error: e.message || String(e), folderName: folder?.name }; console.error(`[${kind}]`, e.message); })
    .finally(() => { Object.assign(status, { running: false, kind: null, folderId: null, progress: '' }); });
  return true;
}

export function maybeAutoLearn(folder) {
  const c = store.config;
  if (!folder || !c.autoLearn || status.running) return false;
  if ((folder.stats?.feedbackSinceLearn || 0) < Math.max(2, Number(c.learnEvery) || 5)) return false;
  return runInBackground('learn', folder, () => learnFromFeedback(folder));
}

export function restore(folder, version) {
  const h = (folder.daHistory || []).find((x) => x.version === Number(version));
  if (!h) throw Object.assign(new Error('Version introuvable'), { status: 404 });
  return commitDA(folder, h.da, `Retour à la version ${version}`, [`Restauration de la version ${version}`]);
}
