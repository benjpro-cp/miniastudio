// Le « serveur » de MiniaStudio, qui tourne directement dans ton navigateur.
// Mêmes routes que la version locale : l'interface ne voit pas la différence.
import * as store from './store.js';
import * as providers from './providers.js';
import * as learn from './learn.js';
import * as P from './prompts.js';
import * as demo from './demo.js';
import * as youtube from './youtube.js';
import { uid, parseDataUrl, httpError, clamp, slugify, normHex, blobToDataUrl, base64ToBlob } from './util.js';

const now = () => new Date().toISOString();
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const db = () => store.db;

export const init = () => store.init();
export const fileUrl = (dir, name) => store.fileUrl(dir, name);

// ---------------- Petit routeur ----------------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

export async function handle(method, path, body = {}) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler(body || {}, params);
  }
  throw httpError(404, 'Route inconnue.');
}

// ---------------- Données pour l'interface ----------------
function maskedConfig() {
  const c = store.config;
  const keys = {};
  for (const [k, v] of Object.entries(c.keys)) keys[k] = v ? { set: true, hint: '…' + String(v).slice(-4) } : { set: false, hint: '' };
  return { ...c, keys };
}

function publicState() {
  const d = db();
  return {
    channel: d.channel,
    da: d.da,
    daVersion: d.daVersion,
    daHistory: d.daHistory.map(({ version, at, reason, changelog }) => ({ version, at, reason, changelog })),
    refs: d.refs,
    faces: d.faces,
    generations: d.generations,
    stats: d.stats,
    config: maskedConfig(),
    info: providers.publicInfo(),
    status: learn.status,
    dataDir: store.DATA_DIR,
    month: store.monthKey(),
    web: true,
  };
}

function findGen(id) {
  const g = db().generations.find((x) => x.id === id);
  if (!g) throw httpError(404, 'Miniature introuvable.');
  return g;
}

function normInput(b = {}) {
  return {
    title: str(b.title, 200),
    idea: str(b.idea, 1500),
    constraints: str(b.constraints, 500),
    count: clamp(Math.round(Number(b.count) || 3), 1, 4),
    useFace: !!b.useFace,
    textMode: b.textMode === 'image' ? 'image' : 'overlay',
  };
}

function normConcept(c = {}) {
  const pos = ['left', 'right', 'top', 'bottom', 'center'];
  return {
    id: str(c.id, 40) || uid('c'),
    angle: str(c.angle, 80) || 'Idée',
    why: str(c.why, 300),
    text: str(c.text, 80),
    textPosition: pos.includes(c.textPosition) ? c.textPosition : 'left',
    subjectPosition: ['left', 'right', 'center'].includes(c.subjectPosition) ? c.subjectPosition : 'right',
    emotion: str(c.emotion, 60),
    scene: str(c.scene, 400),
    imagePrompt: str(c.imagePrompt, 1500),
  };
}

async function gatherRefs(useFace) {
  const d = db();
  const out = [];
  if (useFace) {
    for (const f of d.faces.slice(0, 2)) {
      try { out.push({ role: 'face', label: 'photo of the YouTuber', ...(await store.readImage('faces', f.file)) }); } catch (_) { /* fichier manquant */ }
    }
  }
  const maxStyle = clamp(store.config.image.maxRefs, 0, 4);
  if (maxStyle > 0) {
    const ordered = [...d.refs].sort((a, b) => (b.pinned - a.pinned)
      || ((b.kind === 'mine') - (a.kind === 'mine'))
      || ((b.analysis?.note || 0) - (a.analysis?.note || 0)));
    for (const r of ordered.slice(0, maxStyle)) {
      try { out.push({ role: 'style', label: 'style reference thumbnail', ...(await store.readImage('refs', r.file)) }); } catch (_) { /* fichier manquant */ }
    }
  }
  return out;
}

function countFeedback(g) {
  if (g.counted) return;
  g.counted = true;
  db().stats.totalFeedback = (db().stats.totalFeedback || 0) + 1;
  db().stats.feedbackSinceLearn = (db().stats.feedbackSinceLearn || 0) + 1;
}

// ---------------- Routes ----------------
route('GET', '/api/state', async () => publicState());
route('GET', '/api/status', async () => learn.status);

route('POST', '/api/settings', async (b) => {
  const c = store.config;
  if (b.keys && typeof b.keys === 'object') {
    for (const [k, v] of Object.entries(b.keys)) {
      if (!(k in c.keys) || typeof v !== 'string') continue;
      if (v === '__delete__') c.keys[k] = '';
      else if (v.trim()) c.keys[k] = v.trim();
    }
  }
  for (const kind of ['brain', 'image']) {
    const x = b[kind];
    if (!x || typeof x !== 'object') continue;
    if (x.provider && providers.PROVIDERS[x.provider]?.[kind] && x.provider !== c[kind].provider) {
      c[kind].provider = x.provider;
      c[kind].model = '';
    }
    if (typeof x.model === 'string') c[kind].model = x.model.trim().slice(0, 200);
  }
  if (b.image && typeof b.image === 'object') {
    const i = b.image;
    if (['1k', '2k'].includes(i.resolution)) c.image.resolution = i.resolution;
    if (['auto', 'low', 'medium', 'high'].includes(i.quality)) c.image.quality = i.quality;
    if (i.maxRefs != null) c.image.maxRefs = clamp(Math.round(i.maxRefs), 0, 4);
  }
  if (typeof b.customBaseUrl === 'string') c.customBaseUrl = b.customBaseUrl.trim().slice(0, 300);
  if (typeof b.autoLearn === 'boolean') c.autoLearn = b.autoLearn;
  if (b.learnEvery != null) c.learnEvery = clamp(Math.round(b.learnEvery), 2, 50);
  await store.saveConfig();
  return { config: maskedConfig() };
});

route('POST', '/api/models', async (b) => {
  const kind = b.kind === 'image' ? 'image' : 'brain';
  return { models: await providers.listModels(b.provider || store.config[kind].provider, kind) };
});

route('POST', '/api/test', async (b) => providers.test(b.kind === 'image' ? 'image' : 'brain'));

route('POST', '/api/channel', async (b) => {
  db().channel = { name: str(b.name, 120), niche: str(b.niche, 400), audience: str(b.audience, 400), tone: str(b.tone, 400) };
  store.saveDb();
  return { channel: db().channel };
});

// --- Références ---
route('POST', '/api/refs', async (b) => {
  const source = str(b.source, 300);
  if (source) {
    const dup = db().refs.find((r) => r.source === source);
    if (dup) return { ref: dup, duplicate: true };
  }
  const img = parseDataUrl(b.dataUrl);
  const th = b.thumbDataUrl ? parseDataUrl(b.thumbDataUrl) : null;
  const ref = {
    id: uid('r'),
    file: await store.saveImage('refs', img.blob, img.mime, 'r'),
    thumb: th ? await store.saveImage('thumbs', th.blob, th.mime, 'rt') : null,
    kind: b.kind === 'inspiration' ? 'inspiration' : 'mine',
    title: str(b.title, 200),
    palette: (Array.isArray(b.palette) ? b.palette : []).map(normHex).filter(Boolean).slice(0, 6),
    source,
    pinned: false,
    addedAt: now(),
    analysis: null,
  };
  db().refs.push(ref);
  store.saveDb();
  return { ref };
});

route('PATCH', '/api/refs/:id', async (b, { id }) => {
  const r = db().refs.find((x) => x.id === id);
  if (!r) throw httpError(404, 'Référence introuvable.');
  if (typeof b.pinned === 'boolean') r.pinned = b.pinned;
  if (b.kind === 'mine' || b.kind === 'inspiration') r.kind = b.kind;
  if (typeof b.title === 'string') r.title = str(b.title, 200);
  store.saveDb();
  return { ref: r };
});

route('DELETE', '/api/refs/:id', async (b, { id }) => {
  const d = db();
  const r = d.refs.find((x) => x.id === id);
  if (!r) throw httpError(404, 'Référence introuvable.');
  d.refs = d.refs.filter((x) => x.id !== id);
  await store.removeFile('refs', r.file);
  if (r.thumb) await store.removeFile('thumbs', r.thumb);
  store.saveDb();
  return { ok: true };
});

route('POST', '/api/youtube', async (b) => youtube.importLinks(str(b.links, 20000)));

// --- Photos du créateur ---
route('POST', '/api/faces', async (b) => {
  const img = parseDataUrl(b.dataUrl);
  const th = b.thumbDataUrl ? parseDataUrl(b.thumbDataUrl) : null;
  const face = {
    id: uid('f'),
    file: await store.saveImage('faces', img.blob, img.mime, 'f'),
    thumb: th ? await store.saveImage('thumbs', th.blob, th.mime, 'ft') : null,
    addedAt: now(),
  };
  db().faces.push(face);
  store.saveDb();
  return { face };
});

route('DELETE', '/api/faces/:id', async (b, { id }) => {
  const d = db();
  const f = d.faces.find((x) => x.id === id);
  if (!f) throw httpError(404, 'Photo introuvable.');
  d.faces = d.faces.filter((x) => x.id !== id);
  await store.removeFile('faces', f.file);
  if (f.thumb) await store.removeFile('thumbs', f.thumb);
  store.saveDb();
  return { ok: true };
});

// --- Direction artistique ---
route('POST', '/api/da/analyze', async (b) => {
  if (!db().refs.length) throw httpError(400, 'Ajoute d\'abord quelques miniatures de référence (idéalement 5 à 15 de ta chaîne).');
  const started = learn.runInBackground('analyze', async () => {
    if (b.force) await learn.analyzeRefs(true);
    return learn.synthesize('Analyse de tes références');
  });
  if (!started) throw httpError(409, 'Une analyse est déjà en cours, patiente quelques secondes.');
  return { started };
});

route('POST', '/api/da', async (b) => {
  if (!b.da || typeof b.da !== 'object') throw httpError(400, 'DA invalide.');
  return learn.commitDA(b.da, 'Modifiée à la main', ['Modifications manuelles']);
});

route('POST', '/api/da/restore', async (b) => learn.restore(b.version));

route('POST', '/api/learn', async () => {
  const started = learn.runInBackground('learn', learn.learnFromFeedback);
  if (!started) throw httpError(409, 'Un apprentissage est déjà en cours.');
  return { started };
});

// --- Création ---
route('POST', '/api/concepts', async (b) => {
  const input = normInput(b);
  if (!input.title) throw httpError(400, 'Donne au moins le titre de ta vidéo.');
  const d = db();
  const hasFace = input.useFace && d.faces.length > 0;
  let concepts;
  if (store.config.brain.provider === 'demo') {
    concepts = demo.concepts(input, d.da, input.count);
  } else {
    const res = await providers.brainJson({
      system: P.SYSTEM,
      user: P.conceptsPrompt({ input, da: d.da, channel: d.channel, examples: P.pickExamples(d.generations), hasFace, count: input.count }),
      temperature: 0.95,
    });
    concepts = P.normalizeConcepts(res, input.count, input);
  }
  return { concepts: concepts.map((c) => normConcept({ ...c, id: uid('c') })) };
});

route('POST', '/api/generate', async (b) => {
  const input = normInput(b.input);
  const concept = normConcept(b.concept);
  const d = db();
  const refs = await gatherRefs(input.useFace && d.faces.length > 0);
  const out = await providers.makeImage({
    buildPrompt: (used, tag) => P.buildImagePrompt({ concept, da: d.da, textMode: input.textMode, refs: used, tag }),
    refs,
    demoHint: { seedText: concept.angle + input.title, palette: (d.da?.palette || []).map((p) => p.hex), subjectPosition: concept.subjectPosition },
  });
  const gen = {
    id: uid('g'),
    createdAt: now(),
    input,
    concept,
    file: await store.saveImage('gens', out.blob, out.mime, 'g'),
    thumb: null,
    provider: out.provider,
    model: out.model,
    costUsd: out.costUsd || 0,
    prompt: out.prompt,
    usedRefs: out.usedRefs || 0,
    rating: 0,
    comment: '',
    final: false,
    exportFile: null,
    layers: null,
    adjust: null,
    parentId: str(b.parentId, 40) || null,
    daVersion: d.daVersion,
  };
  d.generations.unshift(gen);
  store.addUsage(gen.costUsd);
  store.saveDb();
  return { generation: gen };
});

route('POST', '/api/generations/:id/edit', async (b, { id }) => {
  const src = findGen(id);
  const instruction = str(b.instruction, 600);
  if (!instruction) throw httpError(400, 'Dis ce que tu veux changer.');
  const d = db();
  const refs = [{ role: 'source', label: 'thumbnail to edit', ...(await store.readImage('gens', src.file)) }];
  if (src.input?.useFace && d.faces[0]) {
    try { refs.push({ role: 'face', label: 'photo of the YouTuber', ...(await store.readImage('faces', d.faces[0].file)) }); } catch (_) { /* rien */ }
  }
  const out = await providers.makeImage({
    buildPrompt: (used, tag) => P.buildEditPrompt({ instruction, textMode: src.input?.textMode, refs: used, tag }),
    refs,
    demoHint: { seedText: instruction, palette: (d.da?.palette || []).map((p) => p.hex), subjectPosition: src.concept?.subjectPosition },
  });
  const gen = {
    ...JSON.parse(JSON.stringify(src)),
    id: uid('g'),
    createdAt: now(),
    concept: { ...src.concept, instruction },
    file: await store.saveImage('gens', out.blob, out.mime, 'g'),
    thumb: null,
    provider: out.provider,
    model: out.model,
    costUsd: out.costUsd || 0,
    prompt: out.prompt,
    usedRefs: out.usedRefs || 0,
    rating: 0,
    comment: '',
    ratedAt: undefined,
    counted: false,
    final: false,
    exportFile: null,
    parentId: src.id,
    daVersion: d.daVersion,
  };
  d.generations.unshift(gen);
  store.addUsage(gen.costUsd);
  store.saveDb();
  return { generation: gen };
});

route('POST', '/api/generations/:id/rate', async (b, { id }) => {
  const g = findGen(id);
  if (b.rating != null) g.rating = clamp(Math.round(Number(b.rating)), -1, 3);
  if (typeof b.comment === 'string') g.comment = str(b.comment, 400);
  g.ratedAt = now();
  if (g.rating !== 0 || g.comment) countFeedback(g);
  store.saveDb();
  const learningStarted = learn.maybeAutoLearn();
  return { generation: g, learningStarted, stats: db().stats };
});

route('PATCH', '/api/generations/:id', async (b, { id }) => {
  const g = findGen(id);
  if (Array.isArray(b.layers)) g.layers = b.layers.slice(0, 12);
  if (b.adjust && typeof b.adjust === 'object') g.adjust = b.adjust;
  store.saveDb();
  return { ok: true };
});

route('POST', '/api/generations/:id/thumb', async (b, { id }) => {
  const g = findGen(id);
  const img = parseDataUrl(b.dataUrl);
  const old = g.thumb;
  g.thumb = await store.saveImage('thumbs', img.blob, img.mime, 'gt');
  if (old) await store.removeFile('thumbs', old);
  store.saveDb();
  return { thumb: g.thumb };
});

route('POST', '/api/generations/:id/export', async (b, { id }) => {
  const g = findGen(id);
  const img = parseDataUrl(b.dataUrl);
  const name = `${slugify(g.input?.title)}-${g.id}.${img.ext}`;
  await store.writeFile('exports', name, img.blob);
  g.exportFile = name;
  g.final = true;
  if (Array.isArray(b.layers)) g.layers = b.layers.slice(0, 12);
  if (b.adjust && typeof b.adjust === 'object') g.adjust = b.adjust;
  if ((g.rating || 0) < 2) g.rating = 2;
  g.ratedAt = now();
  countFeedback(g);
  store.saveDb();
  const learningStarted = learn.maybeAutoLearn();
  return { generation: g, path: 'Galerie → filtre « ✅ Finales »', learningStarted };
});

route('POST', '/api/generations/:id/to-ref', async (b, { id }) => {
  const g = findGen(id);
  const source = `gen:${g.id}`;
  const dup = db().refs.find((r) => r.source === source);
  if (dup) return { ref: dup, duplicate: true };
  const src = g.exportFile ? await store.readImage('exports', g.exportFile) : await store.readImage('gens', g.file);
  const ref = {
    id: uid('r'),
    file: await store.saveImage('refs', src.blob, src.mime, 'r'),
    thumb: null,
    kind: 'mine',
    title: g.input?.title || '',
    palette: (Array.isArray(b.palette) ? b.palette : []).map(normHex).filter(Boolean).slice(0, 6),
    source,
    pinned: false,
    addedAt: now(),
    analysis: null,
  };
  if (b.thumbDataUrl) {
    const th = parseDataUrl(b.thumbDataUrl);
    ref.thumb = await store.saveImage('thumbs', th.blob, th.mime, 'rt');
  }
  db().refs.push(ref);
  store.saveDb();
  return { ref };
});

route('DELETE', '/api/generations/:id', async (b, { id }) => {
  const d = db();
  const g = findGen(id);
  d.generations = d.generations.filter((x) => x.id !== id);
  await store.removeFile('gens', g.file);
  if (g.thumb) await store.removeFile('thumbs', g.thumb);
  store.saveDb();
  return { ok: true };
});

// --- Sauvegarde / restauration (changer d'appareil ou de navigateur) ---
route('GET', '/api/backup', async () => {
  const d = db();
  const finals = d.generations.filter((g) => g.final && g.exportFile);
  const wanted = new Set([
    ...d.refs.flatMap((r) => [`refs/${r.file}`, r.thumb ? `thumbs/${r.thumb}` : null]),
    ...d.faces.flatMap((f) => [`faces/${f.file}`, f.thumb ? `thumbs/${f.thumb}` : null]),
    ...finals.map((g) => `exports/${g.exportFile}`),
  ].filter(Boolean));
  const files = {};
  for (const [key, blob] of await store.listFiles(['refs/', 'faces/', 'thumbs/', 'exports/'])) {
    if (wanted.has(key)) files[key] = await blobToDataUrl(blob);
  }
  const { keys, ...configWithoutKeys } = store.config;
  return { app: 'MiniaStudio', version: 1, savedAt: now(), config: configWithoutKeys, db: { ...d, generations: finals }, files };
});

route('POST', '/api/restore', async (b) => {
  const bk = b.backup;
  if (!bk || bk.app !== 'MiniaStudio' || !bk.db) throw httpError(400, 'Ce fichier n\'est pas une sauvegarde MiniaStudio.');
  await store.clearAll();
  const blobs = new Map();
  for (const [key, dataUrl] of Object.entries(bk.files || {})) {
    const [dir, name] = String(key).split('/');
    if (!store.DIRS.includes(dir) || !/^[\w.-]+$/.test(name || '')) continue;
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl));
    if (!m) continue;
    const blob = base64ToBlob(m[2], m[1]);
    await store.writeFile(dir, name, blob);
    blobs.set(key, blob);
  }
  const restored = store.deepMerge(JSON.parse(JSON.stringify({
    schema: 1, channel: {}, da: null, daVersion: 0, daHistory: [], refs: [], faces: [], generations: [],
    stats: { feedbackSinceLearn: 0, totalFeedback: 0, imagesGenerated: 0, costUsd: 0, monthly: {}, lastLearnAt: null },
  })), bk.db);
  // Les miniatures finales reviennent avec leur texte déjà incrusté.
  const gens = [];
  for (const g of restored.generations || []) {
    const blob = blobs.get(`exports/${g.exportFile}`);
    if (!blob || !g.file) continue;
    await store.writeFile('gens', g.file, blob);
    gens.push({ ...g, thumb: null, layers: [], adjust: null });
  }
  restored.generations = gens;
  store.setDb(restored);
  store.setConfig(store.deepMerge(store.config, { ...(bk.config || {}), keys: store.config.keys }));
  await store.saveConfig();
  store.saveDb();
  return { ok: true, files: blobs.size };
});
