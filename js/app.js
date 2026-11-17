// MiniaStudio — application principale (écrans Créer, Galerie, Ma DA, Réglages).
import { api, fileUrl } from './api.js';
import { loadImage, fileToImage, prepareThumbnail, preparePhoto, fitDataUrl, coverDataUrl, extractPalette, canvasToJpegUnder } from './img.js';
import { FONTS, ensureFonts, renderThumbnail, layersFor, drawLayer, newLayer, W } from './render.js';
import { Editor } from './editor.js';

// ---------------- Utilitaires ----------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s) => String(s || 'miniature').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'miniature';
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* navigation privée */ } },
};

const S = {
  data: null,
  view: 'create',
  results: [],
  concepts: [],
  busy: false,
  galleryFilter: 'all',
  gallerySearch: '',
  galleryLimit: 60,
  polling: null,
  models: {},
  resultsByFolder: {},
};
const D = () => S.data;
const genById = (id) => D().generations.find((g) => g.id === id);
const providerLabel = (p) => D().info.providers[p]?.label || p;

const currentFolder = () => (D().folders || []).find((f) => f.id === D().activeFolder) || null;
const folderName = (id) => (D().folders || []).find((f) => f.id === id)?.name || '';

function upsertGen(g) {
  // Une image créée pour un autre dossier n'apparaît pas dans le dossier ouvert.
  if (g.folderId && D().activeFolder && g.folderId !== D().activeFolder) return;
  const list = D().generations;
  const i = list.findIndex((x) => x.id === g.id);
  if (i >= 0) list[i] = g; else list.unshift(g);
}

function toast(msg, type = 'info', ms = 4500, action = null) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.style.marginTop = '10px';
    b.textContent = action.label;
    b.onclick = () => { el.remove(); action.fn(); };
    el.append(document.createElement('br'), b);
  }
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  const box = $('#toasts');
  box.appendChild(el);
  // Pas plus de 3 notifications à la fois (les plus anciennes disparaissent).
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), ms);
}

// Cache d'images (évite de recharger 10 fois la même).
const imgCache = new Map();
function getImg(src) {
  if (imgCache.has(src)) {
    const p = imgCache.get(src);
    imgCache.delete(src);
    imgCache.set(src, p);
    return p;
  }
  const p = loadImage(src).catch((e) => { imgCache.delete(src); throw e; });
  imgCache.set(src, p);
  if (imgCache.size > 60) imgCache.delete(imgCache.keys().next().value);
  return p;
}
const genFull = (g) => getImg(fileUrl('gens', g.file));
const genSmall = (g) => getImg(g.thumb ? fileUrl('thumbs', g.thumb) : fileUrl('gens', g.file));

async function paintGen(canvas, g, small = true) {
  if (!canvas || !g) return;
  try {
    const img = await (small ? genSmall(g) : genFull(g));
    renderThumbnail(canvas.getContext('2d'), { img, layers: layersFor(g, D().da), adjust: g.adjust || {} });
  } catch (_) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

async function composeGen(g, width = W) {
  const img = await genFull(g);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((width * 9) / 16);
  renderThumbnail(c.getContext('2d'), { img, layers: layersFor(g, D().da), adjust: g.adjust || {} });
  return c;
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const fileName = (g) => `miniature-${slug(g.input?.title)}.jpg`;

async function downloadGen(g) {
  try { saveBlob(await canvasToJpegUnder(await composeGen(g)), fileName(g)); } catch (e) { toast(e.message, 'err'); }
}

async function makeThumb(g) {
  try {
    const img = await genFull(g);
    const { thumb } = await api.post(`/api/generations/${g.id}/thumb`, { dataUrl: fitDataUrl(img, 640, 'image/jpeg', 0.85) });
    const gg = genById(g.id);
    if (gg) gg.thumb = thumb;
  } catch (_) { /* pas grave */ }
}

// ---------------- Niveau de connaissance de la DA ----------------
function knowledge(d) {
  const finals = d.generations.filter((g) => g.final).length;
  const score = Math.min(30, d.refs.length * 3) + Math.min(50, (d.stats.totalFeedback || 0) * 1.25) + Math.min(20, finals * 4);
  const level = !d.da && score < 10 ? 'Découverte' : score < 25 ? 'Débutant' : score < 50 ? 'Apprentissage' : score < 80 ? 'Bien calé' : 'Expert de ta DA';
  return { score: Math.round(score), level, finals };
}

function updateBadge() {
  const d = D();
  const k = knowledge(d);
  const st = d.status || {};
  const el = $('#da-badge');
  el.classList.toggle('learning', !!st.running);
  el.innerHTML = st.running
    ? `<span class="spinner"></span> ${esc(st.progress || 'J\'apprends ta DA…')}`
    : `🧠 ${d.da ? `DA v${d.daVersion}` : 'Pas encore de DA'} · ${esc(k.level)} <span class="meter"><i style="width:${k.score}%"></i></span>`;
}

// ---------------- Navigation ----------------
async function refresh() {
  S.data = await api.get('/api/state');
  updateBadge();
  renderFolderBar();
  renderView(S.view);
}

function showView(v) {
  S.view = v;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${v}`));
  renderView(v);
  window.scrollTo(0, 0);
}

function renderView(v) {
  if (v === 'create') renderCreate();
  else if (v === 'gallery') renderGallery();
  else if (v === 'da') renderDA();
  else if (v === 'settings') renderSettings();
}

// ---------------- Suivi des tâches longues (analyse / apprentissage) ----------------
function startPolling() {
  if (S.polling) return;
  const tick = async () => {
    try {
      const st = await api.get('/api/status');
      D().status = st;
      updateBadge();
      const pl = $('#da-progress');
      if (pl) pl.innerHTML = st.running ? `<div class="progress-line mt"><span class="spinner"></span> ${esc(st.progress || 'Travail en cours…')}</div>` : '';
      if (st.running) { S.polling = setTimeout(tick, 1500); return; }
      S.polling = null;
      await refresh();
      const last = st.last;
      if (last && last.at > (S.lastDone || 0)) {
        S.lastDone = last.at;
        if (last.ok) {
          const lines = (last.changelog || []).slice(0, 4).map((l) => `• ${l}`).join('\n');
          const fname = last.folderName ? ` « ${last.folderName} »` : '';
          toast(`${last.kind === 'learn' ? `🧠 J'ai mis à jour la DA${fname}` : `🎨 La DA${fname} est prête`} (v${last.version}) !${lines ? `\n${lines}` : ''}`, 'ok', 9000);
        } else toast(last.error, 'err', 10000);
      }
    } catch (_) {
      S.polling = setTimeout(tick, 3000);
    }
  };
  S.polling = setTimeout(tick, 900);
}

// ==================================================================
// ÉCRAN « CRÉER »
// ==================================================================
const FORM_KEY = 'minia-form';

function readForm() {
  const f = $('#create-form');
  return {
    title: f.title.value.trim(),
    idea: f.idea.value.trim(),
    constraints: f.constraints.value.trim(),
    useFace: f.useFace.checked,
    textMode: f.textMode.value,
    count: Number(f.count.value),
    review: f.review.checked,
  };
}

function renderCreate() {
  const root = $('#view-create');
  if (!root.dataset.ready) {
    root.innerHTML = `
      <div class="create-layout">
        <form class="panel" id="create-form" autocomplete="off">
          <h2>Nouvelle miniature</h2>
          <div class="field-label">Pour quel type de vidéo ?</div>
          <div class="folder-chips" id="folder-chips"></div>
          <label>Titre de la vidéo *
            <input name="title" maxlength="200" placeholder="Ex : J'ai testé le pire hôtel de Paris"></label>
          <label>Ce qui se passe dans la vidéo <span class="hint">(facultatif, mais ça aide beaucoup)</span>
            <textarea name="idea" rows="3" maxlength="1500" placeholder="Ex : je dors dans un hôtel à 15 €, il y a des cafards, je pars à 3 h du matin"></textarea></label>
          <label>Ce que tu veux absolument voir <span class="hint">(facultatif)</span>
            <input name="constraints" maxlength="500" placeholder="Ex : moi dégoûté, un lit sale, fond rouge"></label>
          <label class="toggle"><input type="checkbox" name="useFace" checked> <span>Me mettre dans la miniature <span class="hint" id="face-hint"></span></span></label>
          <p class="hint" id="asset-hint" hidden></p>
          <div class="row">
            <label>Texte
              <select name="textMode">
                <option value="overlay">Ajouté par le site (net, modifiable)</option>
                <option value="image">Dessiné par l'IA dans l'image</option>
              </select></label>
            <label>Propositions
              <select name="count"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select></label>
          </div>
          <label class="toggle"><input type="checkbox" name="review"> Voir et modifier les idées avant de créer les images</label>
          <button class="btn primary big" type="submit" id="create-btn">✨ Créer mes miniatures</button>
          <p class="cost-hint" id="cost-hint"></p>
        </form>
        <div>
          <div id="onboarding"></div>
          <div id="concepts"></div>
          <div id="results-head" class="toolbar" hidden>
            <h2 style="margin:0">Tes propositions</h2><span class="spacer"></span>
            <span class="hint">Note-les : c'est comme ça que j'apprends ta DA</span>
            <button class="btn small ghost" id="clear-results">Vider</button>
          </div>
          <div id="results" class="results"></div>
          <div id="results-empty"></div>
        </div>
      </div>`;
    root.dataset.ready = '1';
    const f = $('#create-form');
    const draft = store.get(FORM_KEY, null);
    if (draft) {
      for (const k of ['title', 'idea', 'constraints', 'textMode', 'count']) if (draft[k] != null && f[k]) f[k].value = draft[k];
      f.useFace.checked = draft.useFace !== false;
      f.review.checked = !!draft.review;
    }
    f.addEventListener('submit', onCreate);
    f.addEventListener('input', () => { store.set(FORM_KEY, readForm()); updateCostHint(); });
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) f.requestSubmit(); });
    $('#clear-results').onclick = () => { S.results = []; renderResults(); };
    const res = $('#results');
    res.addEventListener('click', onResultClick);
    res.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.matches('[data-comment]')) { e.preventDefault(); e.target.blur(); }
      if (e.target.matches('[data-retouch]')) { e.preventDefault(); e.target.closest('.card').querySelector('[data-act="retouch"]').click(); }
    });
    res.addEventListener('change', (e) => {
      if (!e.target.matches('[data-comment]')) return;
      const r = S.results.find((x) => x.key === e.target.closest('[data-key]').dataset.key);
      const g = r?.genId && genById(r.genId);
      if (g) saveComment(g, e.target.value.trim());
    });
    renderResults();
  }
  renderFolderChips();
  updateOnboarding();
  updateCostHint();
  const fh = $('#face-hint');
  if (fh) fh.textContent = D().faces.length ? `(${D().faces.length} photo(s) de toi)` : '(ajoute tes photos dans « Ma DA »)';
  syncFaceSetting();
}

function keyOk(p) {
  const c = D().config;
  return p === 'demo' || p === 'forge' || p === 'custom' || !!c.keys[p]?.set;
}

function updateOnboarding() {
  const el = $('#onboarding');
  if (!el) return;
  const d = D();
  const c = d.config;
  const steps = [
    { done: c.image.provider !== 'demo' && keyOk(c.image.provider), t: 'Branche tes IA (ou teste d\'abord en mode démo, sans clé)', btn: ['Réglages', 'settings'] },
    { done: !!(d.channel.name || d.channel.niche), t: 'Présente ta chaîne (nom, thème, public)', btn: ['Ma DA', 'da'] },
    { done: d.refs.length >= 5, t: `Ajoute au moins 5 miniatures de référence (${Math.min(d.refs.length, 5)}/5)`, btn: ['Ajouter', 'da'] },
    { done: d.faces.length > 0, t: 'Ajoute 2-3 photos de toi (facultatif, pour apparaître sur les miniatures)', btn: ['Ajouter', 'da'] },
    { done: !!d.da, t: 'Lance l\'analyse de ta DA', btn: ['Analyser', 'da'] },
    { done: (d.stats.totalFeedback || 0) >= 3, t: 'Crée et note tes premières miniatures (👎 👍 ❤️ 🏆) : c\'est comme ça que j\'apprends' },
  ];
  if (steps.every((s) => s.done) || store.get('minia-ob-hidden', false)) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="panel soft">
      <div class="row tight"><h2 style="margin:0">Pour bien démarrer</h2><span class="spacer"></span><button class="btn small ghost" id="ob-hide">Masquer</button></div>
      <p class="muted small" style="margin:6px 0 12px">Plus tu utilises le site, plus il comprend la DA de ta chaîne.</p>
      <ul class="checklist">${steps.map((s) => `
        <li class="${s.done ? 'done' : ''}"><span class="ck">${s.done ? '✓' : ''}</span><span class="t">${esc(s.t)}</span>
        ${!s.done && s.btn ? `<button class="btn small" data-view="${s.btn[1]}">${s.btn[0]}</button>` : ''}</li>`).join('')}
      </ul>
    </div>`;
  $('#ob-hide').onclick = () => { store.set('minia-ob-hidden', true); el.innerHTML = ''; };
}

function estimatePerImage() {
  const d = D();
  const c = d.config.image;
  const p = c.provider;
  const m = c.model || d.info.defaults.image[p] || '';
  const f = $('#create-form');
  const faces = f?.useFace.checked ? Math.min(2, d.faces.length) : 0;
  const refs = Math.min(c.maxRefs, d.refs.length);
  if (p === 'demo') return { txt: 'Mode démo : gratuit (images factices, juste pour tester le site)' };
  if (p === 'vertex') return { txt: 'Gemini (Google Cloud express) : gratuit pendant ton essai de 90 jours, ensuite ≈ 0,04 $ / image' };
  if (p === 'forge') return { txt: 'Images générées sur ton PC : gratuit' };
  let per = 0;
  if (p === 'xai') {
    const v2 = !m || /image-2|2\.0/.test(m);
    per = v2 ? (c.resolution === '2k' ? 0.06 : 0.04) + 0.01 * (faces + refs) : 0.02;
  } else if (p === 'gemini') per = /pro/.test(m) ? 0.134 : /2\.5/.test(m) ? 0.039 : c.resolution === '2k' ? 0.05 : 0.034;
  else if (p === 'openai') per = c.quality === 'low' ? 0.016 : c.quality === 'high' ? 0.25 : 0.063;
  return { per };
}

function updateCostHint() {
  const el = $('#cost-hint');
  if (!el) return;
  const n = Number($('#create-form').count.value) || 1;
  const e = estimatePerImage();
  el.textContent = e.txt || `≈ ${(e.per * n).toFixed(2)} $ pour ${n} image${n > 1 ? 's' : ''} (${e.per.toFixed(3)} $ / image)`;
}

async function onCreate(e) {
  e.preventDefault();
  if (S.busy) return;
  const form = readForm();
  store.set(FORM_KEY, form);
  if (!form.title) { toast('Donne au moins le titre de ta vidéo 🙂', 'err'); $('#create-form').title.focus(); return; }
  if (form.useFace && !D().faces.length) form.useFace = false;
  const btn = $('#create-btn');
  S.busy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> L\'IA cherche des idées…';
  try {
    const { concepts } = await api.post('/api/concepts', { ...form, folderId: D().activeFolder });
    if (form.review) {
      S.concepts = concepts.map((c) => ({ ...c, on: true }));
      S.conceptInput = form;
      renderConcepts();
      $('#concepts').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      generateFromConcepts(concepts, form);
    }
  } catch (err) {
    toast(err.message, 'err', 9000);
  } finally {
    S.busy = false;
    btn.disabled = false;
    btn.textContent = '✨ Créer mes miniatures';
  }
}

function renderConcepts() {
  const el = $('#concepts');
  if (!S.concepts.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="panel soft">
      <div class="row tight"><h2 style="margin:0">Les idées de l'IA</h2><span class="spacer"></span><button class="btn small ghost" data-c="cancel">Annuler</button></div>
      <p class="muted small">Modifie ce que tu veux, décoche ce qui ne te plaît pas, puis lance la création des images.</p>
      <div class="concepts">${S.concepts.map((c, i) => `
        <div class="concept" data-i="${i}">
          <label class="toggle"><input type="checkbox" data-k="on" ${c.on ? 'checked' : ''}> <strong>💡 ${esc(c.angle)}</strong></label>
          <p class="why">${esc(c.why)}</p>
          <label>Texte sur la miniature<input data-k="text" value="${esc(c.text)}"></label>
          <label>Ce qu'on voit sur l'image<textarea data-k="scene" rows="3">${esc(c.scene)}</textarea></label>
          ${conceptAssetsHtml(c)}
          <details><summary>Prompt exact envoyé au générateur</summary><textarea data-k="imagePrompt" rows="6">${esc(c.imagePrompt)}</textarea></details>
        </div>`).join('')}
      </div>
      <button class="btn primary" data-c="go">🎨 Créer les images</button>
    </div>`;
  el.oninput = (e) => {
    const box = e.target.closest('[data-i]');
    if (!box) return;
    const c = S.concepts[Number(box.dataset.i)];
    const k = e.target.dataset.k;
    if (k === 'on') c.on = e.target.checked;
    else c[k] = e.target.value;
    if (k === 'scene') {
      // La description en français remplace le prompt anglais (les IA d'images comprennent le français).
      c.imagePrompt = e.target.value;
      const ta = box.querySelector('[data-k="imagePrompt"]');
      if (ta) ta.value = c.imagePrompt;
    }
  };
  el.onchange = (e) => {
    if (!e.target.matches('[data-add-asset]') || !e.target.value) return;
    const c = S.concepts[Number(e.target.closest('[data-i]').dataset.i)];
    c.assetIds = [...new Set([...(c.assetIds || []), e.target.value])].slice(0, 4);
    renderConcepts();
  };
  el.onclick = (e) => {
    const rm = e.target.closest('[data-rm-asset]');
    if (rm) {
      const c = S.concepts[Number(rm.closest('[data-i]').dataset.i)];
      c.assetIds = (c.assetIds || []).filter((id) => id !== rm.dataset.rmAsset);
      renderConcepts();
      return;
    }
    const b = e.target.closest('[data-c]');
    if (!b) return;
    if (b.dataset.c === 'cancel') { S.concepts = []; renderConcepts(); return; }
    const chosen = S.concepts.filter((c) => c.on);
    if (!chosen.length) { toast('Garde au moins une idée 🙂', 'err'); return; }
    S.concepts = [];
    renderConcepts();
    generateFromConcepts(chosen, S.conceptInput);
  };
}

async function runLimited(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function generateFromConcepts(concepts, form) {
  const input = { title: form.title, idea: form.idea, constraints: form.constraints, useFace: form.useFace, textMode: form.textMode };
  const folderId = D().activeFolder;
  const batch = concepts.map((c) => ({ key: uid(), concept: c, input, status: 'pending', folderId }));
  S.results = [...batch, ...S.results].slice(0, 30);
  renderResults();
  $('#results-head').scrollIntoView({ behavior: 'smooth', block: 'start' });
  runLimited(batch, 3, runTask);
}

async function runTask(r) {
  r.status = 'pending';
  r.error = '';
  renderResultCard(r);
  try {
    const { generation } = r.editOf
      ? await api.post(`/api/generations/${r.editOf}/edit`, { instruction: r.concept.instruction })
      : await api.post('/api/generate', { input: r.input, concept: r.concept, parentId: r.parentId || null, folderId: r.folderId || D().activeFolder });
    upsertGen(generation);
    r.genId = generation.id;
    r.status = 'done';
    makeThumb(generation);
  } catch (e) {
    r.status = 'error';
    r.error = e.message;
  }
  renderResultCard(r);
  updateBadge();
  updateCostHint();
}

function renderResults() {
  const el = $('#results');
  if (!el) return;
  $('#results-head').hidden = !S.results.length;
  el.innerHTML = S.results.map((r) => `<div class="card" data-key="${r.key}"></div>`).join('');
  S.results.forEach(renderResultCard);
  $('#results-empty').innerHTML = S.results.length || S.concepts.length ? '' : `
    <div class="empty"><span class="big-emoji">🎬</span>Écris le titre de ta prochaine vidéo à gauche, et je te propose des miniatures dans ta DA.<br><span class="small">Astuce : Ctrl + Entrée pour lancer.</span></div>`;
}

function insertResultAfter(r, nr) {
  const i = S.results.indexOf(r);
  S.results.splice(i + 1, 0, nr);
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.key = nr.key;
  const prev = $(`#results [data-key="${r.key}"]`);
  if (prev) prev.after(el); else $('#results').prepend(el);
  renderResultCard(nr);
}

const CHIPS = ['Parfait', 'Trop chargé', 'Texte trop long', 'Pas assez contrasté', 'Trop sombre', 'Visage raté', 'Hors de ma DA', 'Pas lisible'];
const RATES = [[-1, '👎', 'Pas mon style'], [1, '👍', 'Pas mal'], [2, '❤️', 'J\'adore'], [3, '🏆', 'La meilleure !']];

function rateButtons(g) {
  return `<div class="rate">${RATES.map(([v, e, t]) => `<button data-act="rate" data-v="${v}" class="${g.rating === v ? 'on' : ''}" title="${t}">${e}</button>`).join('')}</div>`;
}

function rateBlock(g) {
  const comment = g.comment || '';
  return `${rateButtons(g)}
    <div class="chips">${CHIPS.map((ch) => `<span class="chip ${comment.includes(ch) ? 'on' : ''}" data-act="chip" data-chip="${esc(ch)}">${esc(ch)}</span>`).join('')}</div>
    <input data-comment value="${esc(comment)}" placeholder="Un commentaire pour l'IA ? (Entrée pour l'envoyer)">`;
}

function renderResultCard(r) {
  const el = $(`#results [data-key="${r.key}"]`);
  if (!el) return;
  const g = r.genId ? genById(r.genId) : null;
  if (r.genId && !g) { el.remove(); S.results = S.results.filter((x) => x !== r); return; }
  const c = g?.concept || r.concept || {};
  el.className = `card${g?.final ? ' final' : ''}`;
  el.innerHTML = `
    <div class="thumb" ${g ? 'data-act="edit" title="Ouvrir dans l\'éditeur"' : ''}>
      ${r.status === 'pending' ? `<div class="loading"><div><span class="spinner"></span><br>${esc(r.editOf ? 'Retouche en cours…' : 'Création de l\'image…')}<br><span class="small">(10 à 60 secondes)</span></div></div>` : ''}
      ${r.status === 'error' ? `<div class="error"><div>❌ ${esc(r.error)}<br><br><button class="btn small" data-act="retry">Réessayer</button></div></div>` : ''}
      ${g && r.status === 'done' ? `<canvas width="640" height="360"></canvas>${g.final ? '<span class="badge tag ok">✅ Finale</span>' : ''}` : ''}
    </div>
    <div class="card-body">
      <div class="card-title">💡 ${esc(c.angle || 'Idée')}${c.instruction ? `<span class="why">· retouche : ${esc(c.instruction)}</span>` : ''}</div>
      ${c.why ? `<div class="muted small">${esc(c.why)}</div>` : ''}
      ${g && r.status === 'done' ? `
        ${rateBlock(g)}
        <div class="card-actions">
          <button class="btn small" data-act="edit">✏️ Éditer</button>
          <button class="btn small" data-act="retouch-toggle">🪄 Retoucher</button>
          <button class="btn small" data-act="variant">🔁 Variante</button>
          <button class="btn small" data-act="download" title="Télécharger en JPG (1280×720)">⬇️</button>
        </div>
        <div class="retouch" hidden><input data-retouch placeholder="Ex : fond rouge, moi plus surpris…"><button class="btn small primary" data-act="retouch">OK</button></div>
        <div class="card-meta"><span>${esc(providerLabel(g.provider))}${g.model && g.model !== g.provider ? ` · ${esc(g.model)}` : ''}</span>${g.costUsd ? `<span>≈ ${g.costUsd.toFixed(3)} $</span>` : ''}${g.usedRefs ? `<span>${g.usedRefs} image(s) de référence</span>` : ''}${g.assetNames?.length ? `<span>🧩 ${esc(g.assetNames.join(', '))}</span>` : ''}</div>` : ''}
    </div>`;
  if (g && r.status === 'done') paintGen($('canvas', el), g, false);
}

function refreshGenViews(id) {
  S.results.filter((r) => r.genId === id).forEach(renderResultCard);
  const gc = $(`#g-grid [data-id="${id}"]`);
  if (gc) {
    const g = genById(id);
    if (g) {
      gc.className = `card${g.final ? ' final' : ''}`;
      const rate = gc.querySelector('.rate');
      if (rate) rate.outerHTML = rateButtons(g);
      paintGen(gc.querySelector('canvas'), g, true);
    }
  }
}

async function onResultClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const card = t.closest('[data-key]');
  const r = S.results.find((x) => x.key === card?.dataset.key);
  if (!r) return;
  const g = r.genId ? genById(r.genId) : null;
  const act = t.dataset.act;
  if (act === 'retry') return runTask(r);
  if (!g) return;
  if (act === 'edit') editor.show(g);
  else if (act === 'rate') rateGen(g, Number(t.dataset.v));
  else if (act === 'chip') toggleChip(g, t, card);
  else if (act === 'download') downloadGen(g);
  else if (act === 'retouch-toggle') {
    const box = $('.retouch', card);
    box.hidden = !box.hidden;
    if (!box.hidden) $('input', box).focus();
  } else if (act === 'retouch') {
    const input = $('[data-retouch]', card);
    const instruction = input.value.trim();
    if (!instruction) { input.focus(); return; }
    const nr = { key: uid(), concept: { ...g.concept, instruction }, input: g.input, status: 'pending', editOf: g.id, folderId: g.folderId };
    insertResultAfter(r, nr);
    runTask(nr);
  } else if (act === 'variant') {
    const { instruction, ...concept } = r.concept || g.concept;
    const nr = { key: uid(), concept, input: r.input || g.input, status: 'pending', parentId: g.id, folderId: g.folderId };
    insertResultAfter(r, nr);
    runTask(nr);
  }
}

async function rateGen(g, v) {
  const rating = g.rating === v ? 0 : v;
  try {
    const res = await api.post(`/api/generations/${g.id}/rate`, { rating });
    upsertGen(res.generation);
    D().stats = res.stats;
    refreshGenViews(g.id);
    updateBadge();
    updateOnboarding();
    if (res.learningStarted) {
      toast('🧠 Assez de retours : je mets à jour ta DA en arrière-plan…', 'info');
      startPolling();
    }
  } catch (err) { toast(err.message, 'err'); }
}

async function saveComment(g, comment) {
  if ((g.comment || '') === comment) return;
  try {
    const res = await api.post(`/api/generations/${g.id}/rate`, { comment });
    upsertGen(res.generation);
    D().stats = res.stats;
    updateBadge();
    if (comment) toast('💬 Noté, j\'en tiendrai compte pour les prochaines.', 'ok', 2500);
    if (res.learningStarted) startPolling();
  } catch (err) { toast(err.message, 'err'); }
}

function toggleChip(g, chipEl, card) {
  const input = $('[data-comment]', card);
  const chip = chipEl.dataset.chip;
  let parts = input.value.split(/\s*,\s*/).filter(Boolean);
  parts = parts.includes(chip) ? parts.filter((p) => p !== chip) : [...parts, chip];
  input.value = parts.join(', ');
  chipEl.classList.toggle('on');
  saveComment(g, input.value.trim());
}

// ==================================================================
// GALERIE
// ==================================================================
const FILTERS = [
  ['all', 'Toutes', () => true],
  ['loved', '❤️ Adorées', (g) => g.rating >= 2],
  ['final', '✅ Finales', (g) => g.final],
  ['liked', '👍 Bien', (g) => g.rating === 1],
  ['hated', '👎 Rejetées', (g) => g.rating < 0],
  ['unrated', 'Pas notées', (g) => !g.rating && !g.final],
];

function renderGallery() {
  const root = $('#view-gallery');
  const gens = D().generations;
  root.innerHTML = `
    <div class="toolbar">
      ${FILTERS.map(([k, label, fn]) => `<span class="chip ${S.galleryFilter === k ? 'on' : ''}" data-filter="${k}">${label} (${gens.filter(fn).length})</span>`).join('')}
      <span class="spacer"></span>
      <input id="g-search" placeholder="🔎 Rechercher un titre" value="${esc(S.gallerySearch)}" style="max-width:260px">
    </div>
    <div id="g-grid"></div>`;
  root.querySelector('.toolbar').onclick = (e) => {
    const c = e.target.closest('[data-filter]');
    if (!c) return;
    S.galleryFilter = c.dataset.filter;
    S.galleryLimit = 60;
    renderGallery();
  };
  $('#g-search').oninput = (e) => { S.gallerySearch = e.target.value; S.galleryLimit = 60; renderGalleryGrid(); };
  renderGalleryGrid();
}

let galleryObserver = null;
function renderGalleryGrid() {
  const el = $('#g-grid');
  const fn = (FILTERS.find((f) => f[0] === S.galleryFilter) || FILTERS[0])[2];
  const q = S.gallerySearch.trim().toLowerCase();
  const list = D().generations.filter((g) => fn(g) && (!q || (g.input?.title || '').toLowerCase().includes(q)));
  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="big-emoji">🖼️</span>Aucune miniature ici pour l\'instant.</div>';
    return;
  }
  const shown = list.slice(0, S.galleryLimit);
  el.innerHTML = `<div class="gallery">${shown.map((g) => `
    <div class="card${g.final ? ' final' : ''}" data-id="${g.id}">
      <div class="thumb" data-act="edit" title="Ouvrir dans l'éditeur"><canvas width="480" height="270"></canvas>${g.final ? '<span class="badge tag ok">✅ Finale</span>' : ''}</div>
      <div class="card-body">
        <div class="g-title" title="${esc(g.input?.title)}">${esc(g.input?.title || 'Sans titre')}</div>
        ${rateButtons(g)}
        <div class="row tight small muted g-actions">
          <span>${fmtDate(g.createdAt)}</span><span class="spacer"></span>
          <button class="btn small ghost icon" data-act="download" title="Télécharger (JPG 1280×720)">⬇️</button>
          <button class="btn small ghost icon" data-act="toref" title="Ajouter à mes références (pour apprendre ma DA)">➕</button>
          <button class="btn small ghost icon danger" data-act="delete" title="Supprimer">🗑️</button>
        </div>
      </div>
    </div>`).join('')}</div>
    ${list.length > shown.length ? `<div class="center mt"><button class="btn" id="g-more">Afficher plus (${list.length - shown.length})</button></div>` : ''}`;
  const more = $('#g-more');
  if (more) more.onclick = () => { S.galleryLimit += 60; renderGalleryGrid(); };
  if (galleryObserver) galleryObserver.disconnect();
  galleryObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      galleryObserver.unobserve(en.target);
      const g = genById(en.target.closest('[data-id]').dataset.id);
      if (g) paintGen(en.target, g, true);
    }
  }, { rootMargin: '300px' });
  $$('#g-grid canvas').forEach((c) => galleryObserver.observe(c));
  el.onclick = async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const g = genById(t.closest('[data-id]').dataset.id);
    if (!g) return;
    const act = t.dataset.act;
    if (act === 'edit') editor.show(g);
    else if (act === 'rate') rateGen(g, Number(t.dataset.v));
    else if (act === 'download') downloadGen(g);
    else if (act === 'toref') addGenToRefs(g);
    else if (act === 'delete') {
      if (!confirm('Supprimer cette miniature ? (les notes déjà données restent apprises)')) return;
      try {
        await api.del(`/api/generations/${g.id}`);
        D().generations = D().generations.filter((x) => x.id !== g.id);
        S.results = S.results.filter((r) => r.genId !== g.id);
        renderGallery();
      } catch (err) { toast(err.message, 'err'); }
    }
  };
}

async function addGenToRefs(g) {
  try {
    const c = await composeGen(g);
    const res = await api.post(`/api/generations/${g.id}/to-ref`, { thumbDataUrl: coverDataUrl(c, 640, 360, 'image/jpeg', 0.85), palette: extractPalette(c) });
    if (res.duplicate) toast('Elle est déjà dans tes références 🙂', 'info');
    else {
      D().refs.push(res.ref);
      toast('Ajoutée à tes références ✓ Relance l\'analyse dans « Ma DA » pour l\'intégrer.', 'ok', 6000);
    }
  } catch (err) { toast(err.message, 'err'); }
}

// ==================================================================
// MA DA
// ==================================================================
const POS_LABELS = { left: 'À gauche', right: 'À droite', top: 'En haut', bottom: 'En bas', center: 'Au centre' };
const DA_FIELDS = [
  ['mood', 'Ambiance / énergie'], ['composition', 'Composition'], ['subject', 'Sujet / visage'], ['background', 'Fonds'],
  ['lighting', 'Lumière & traitement'], ['textStyle', 'Règles du texte'], ['recurring', 'Éléments récurrents'], ['avoid', 'À éviter'],
];

function refThumb(r) { return r.thumb ? fileUrl('thumbs', r.thumb) : fileUrl('refs', r.file); }

function refCard(r) {
  return `<div class="ref ${r.pinned ? 'pinned' : ''}" data-ref="${r.id}">
    <img src="${refThumb(r)}" loading="lazy" alt="" title="${esc(r.title || '')}">
    <div class="ref-top"><span class="tag">${r.kind === 'mine' ? 'Ma chaîne' : 'Inspiration'}</span>${r.analysis ? '<span class="tag ok">✓ analysée</span>' : ''}</div>
    <div class="ref-bar">
      <button data-r="pin" title="${r.pinned ? 'Retirer des modèles prioritaires' : 'Modèle prioritaire : envoyé au générateur d\'images'}">${r.pinned ? '⭐' : '☆'}</button>
      <button data-r="kind" title="Passer en « ${r.kind === 'mine' ? 'Inspiration' : 'Ma chaîne'} »">⇄</button>
      <span class="spacer"></span>
      <button data-r="del" title="Supprimer">🗑️</button>
    </div>
  </div>`;
}

function renderDA() {
  const root = $('#view-da');
  const d = D();
  const st = d.status || {};
  const k = knowledge(d);
  const da = d.da;
  const t = da?.typography || {};
  const learned = da?.learned || [];
  const hist = [...d.daHistory].reverse().slice(0, 10);
  const refKind = S.refKind || 'mine';
  root.innerHTML = `
    <div class="panel">
      <div class="row tight">
        <div style="flex:1 1 360px">
          <h2 style="margin:0">🎨 DA du dossier « ${esc(currentFolder()?.name || '')} » <button class="btn small ghost" data-da="edit-folder" title="Renommer, décrire ou supprimer ce dossier">✏️</button></h2>
          <p class="muted" style="margin:4px 0 0">${currentFolder()?.description ? `${esc(currentFolder().description)}. ` : ''}Ce que le site a compris du style de ces vidéos. Chaque dossier a ses propres références, sa DA et son apprentissage ; ton visage est commun à tous.</p>
        </div>
        <button class="btn primary" data-da="analyze" ${st.running ? 'disabled' : ''}>🔍 ${da ? 'Ré-analyser mes références' : 'Analyser ma DA'}</button>
        <button class="btn" data-da="learn" ${st.running ? 'disabled' : ''}>🧠 Apprendre de mes notes</button>
      </div>
      <div class="meter-big"><i style="width:${k.score}%"></i></div>
      <div class="muted small">Niveau : <strong>${esc(k.level)}</strong> · ${d.refs.length} référence(s) · ${d.stats.totalFeedback || 0} note(s) · ${k.finals} finale(s) · prochain apprentissage auto dans ${Math.max(0, d.config.learnEvery - (d.stats.feedbackSinceLearn || 0))} note(s)${d.config.autoLearn ? '' : ' (désactivé)'}</div>
      <div id="da-progress">${st.running ? `<div class="progress-line mt"><span class="spinner"></span> ${esc(st.progress || 'Travail en cours…')}</div>` : ''}</div>
    </div>

    <div class="da-grid">
      <div>
        <div class="panel">
          <h2>📺 Ta chaîne</h2>
          <div class="row">
            <label>Nom de la chaîne<input data-ch="name" value="${esc(d.channel.name)}" placeholder="Ex : Les Aventures de Benji"></label>
            <label>Thème / niche<input data-ch="niche" value="${esc(d.channel.niche)}" placeholder="Ex : voyage, tech, gaming…"></label>
          </div>
          <label>Ton public<input data-ch="audience" value="${esc(d.channel.audience)}" placeholder="Ex : 18-30 ans, fans de bons plans"></label>
          <label>L'ambiance que tu veux<input data-ch="tone" value="${esc(d.channel.tone)}" placeholder="Ex : fun et énergique, sérieux et premium…"></label>
          <button class="btn small" data-da="save-channel">Enregistrer</button>
        </div>

        <div class="panel">
          <h2>🖼️ Miniatures de référence <span class="hint">${d.refs.length}</span></h2>
          <p class="muted small">Tes meilleures miniatures (et quelques-unes d'autres chaînes qui t'inspirent). ⭐ = modèle prioritaire, envoyé au générateur d'images à chaque création.</p>
          <div class="row tight" style="margin-bottom:10px">
            <label class="toggle"><input type="radio" name="refkind" value="mine" ${refKind === 'mine' ? 'checked' : ''}> De ma chaîne</label>
            <label class="toggle"><input type="radio" name="refkind" value="inspiration" ${refKind === 'inspiration' ? 'checked' : ''}> Inspiration (autres chaînes)</label>
          </div>
          <div class="drop" data-drop="refs">📥 Glisse tes miniatures ici, clique pour les choisir, ou colle une image (Ctrl+V)<input type="file" accept="image/*" multiple hidden></div>
          <details class="mt">
            <summary>▶️ Importer depuis YouTube (liens de tes vidéos)</summary>
            <textarea data-yt rows="3" class="mt" placeholder="https://www.youtube.com/watch?v=…&#10;https://youtu.be/…"></textarea>
            <button class="btn small mt" data-da="yt-import">Importer les miniatures</button>
            <p class="hint">Colle un lien de vidéo par ligne : je récupère la miniature HD et le titre. Si une vidéo ne passe pas, enregistre sa miniature et glisse-la au-dessus.</p>
          </details>
          <div class="refs" id="refs-grid">${d.refs.map(refCard).join('')}</div>
        </div>

        <div class="panel" id="assets-panel">
          <h2>🧩 Banque d'images <span class="hint">${(d.assets || []).length}</span></h2>
          <p class="muted small">Personnages, véhicules, logos, lieux, objets… L'IA choisit elle-même ceux qui collent à chaque miniature, et Gemini crée ce qui manque. ⭐ = toujours présent dans les miniatures de ce dossier (ex : ton perso GTA).</p>
          <div class="drop" data-drop="assets">🧩 Glisse tes images ici (personnages, voitures, logos…) ou clique<input type="file" accept="image/*" multiple hidden></div>
          <div class="row tight mt">
            <input data-asset-new maxlength="300" placeholder="Ou fais-le créer par Gemini : ex. « une Lamborghini dorée vue de 3/4 »" style="flex:1 1 220px">
            <button class="btn small" data-da="asset-create">✨ Créer l'élément</button>
          </div>
          <div id="assets-status"></div>
          <div class="assets-grid" id="assets-grid">${(d.assets || []).map(assetCard).join('')}</div>
        </div>

        <div class="panel">
          <h2>🙂 Ton visage <span class="hint">facultatif</span></h2>
          <p class="muted small">2 à 4 photos nettes de toi (face caméra, bonne lumière, sans lunettes de soleil). L'IA s'en sert pour te mettre dans les miniatures. Les 2 premières sont utilisées. Communes à tous les dossiers : pour un dossier sans ton visage (ex : GTA), décoche « Me mettre dans la miniature » dans Créer.</p>
          <div class="drop" data-drop="faces">📸 Glisse tes photos ici ou clique<input type="file" accept="image/*" multiple hidden></div>
          <div class="refs faces">${d.faces.map((f) => `
            <div class="ref" data-face="${f.id}"><img src="${f.thumb ? fileUrl('thumbs', f.thumb) : fileUrl('faces', f.file)}" alt="">
            <div class="ref-bar"><span class="spacer"></span><button data-f-del="${f.id}" title="Supprimer">🗑️</button></div></div>`).join('')}</div>
        </div>
      </div>

      <div>
        ${da ? `
        <div class="panel" id="da-form">
          <div class="row tight"><h2 style="margin:0">Ta DA <span class="hint">v${d.daVersion}</span></h2><span class="spacer"></span>
            <button class="btn small primary" data-da="save-da">💾 Enregistrer mes modifs</button></div>
          <p class="muted small">Tout est modifiable : corrige ce qui ne te ressemble pas.</p>
          <label>Résumé<textarea data-f="summary" rows="3">${esc(da.summary)}</textarea></label>
          <h3>Palette</h3>
          <div class="palette" id="palette">
            ${(da.palette || []).map((p) => `<div class="swatch"><input type="color" data-pal value="${esc(p.hex)}" data-role="${esc(p.role || '')}"><span>${esc(p.role || '')}</span><button data-da="del-color" title="Retirer">✕</button></div>`).join('')}
            <button class="btn small" data-da="add-color" title="Ajouter une couleur">＋</button>
          </div>
          <h3 class="mt">Typo des textes</h3>
          <canvas class="typo-preview" id="typo-preview" width="1280" height="300"></canvas>
          <div class="row mt">
            <label>Police<select data-t="font">${FONTS.map((f) => `<option ${t.font === f.name ? 'selected' : ''} value="${esc(f.name)}">${esc(f.name)}</option>`).join('')}</select></label>
            <label>Mots max<input type="number" data-t="maxWords" min="1" max="8" value="${esc(t.maxWords ?? 4)}"></label>
            <label>Position<select data-t="position">${Object.entries(POS_LABELS).map(([v, l]) => `<option value="${v}" ${t.position === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
          <div class="colors">
            <label>Texte<input type="color" data-t="fill" value="${esc(t.fill || '#FFFFFF')}"></label>
            <label>Accent<input type="color" data-t="accent" value="${esc(t.accent || '#FFD400')}"></label>
            <label>Contour<input type="color" data-t="stroke" value="${esc(t.stroke || '#000000')}"></label>
            <label>Fond<input type="color" data-t="boxColor" value="${esc(t.boxColor || '#E10600')}"></label>
          </div>
          <div class="row tight">
            <label>Contour <input type="number" data-t="strokeWidth" min="0" max="40" value="${esc(t.strokeWidth ?? 10)}" style="width:80px"></label>
            <label class="toggle"><input type="checkbox" data-t="uppercase" ${t.uppercase !== false ? 'checked' : ''}> Majuscules</label>
            <label class="toggle"><input type="checkbox" data-t="box" ${t.box ? 'checked' : ''}> Fond coloré derrière le texte</label>
          </div>
          <div class="da-fields mt">${DA_FIELDS.map(([f, l]) => `<label>${l}<textarea data-f="${f}" rows="3">${esc(da[f])}</textarea></label>`).join('')}</div>
          <label>Style envoyé au générateur d'images <span class="hint">(en anglais, ajouté à chaque création)</span><textarea data-f="imageStyle" rows="3">${esc(da.imageStyle)}</textarea></label>
        </div>` : `
        <div class="panel"><div class="empty"><span class="big-emoji">🎨</span>
          <strong>Pas encore de DA.</strong><br>Ajoute 5 à 15 miniatures de ta chaîne à gauche, puis clique sur « Analyser ma DA ».<br>
          <span class="small">Tu peux aussi créer directement : la DA se construira avec tes notes.</span></div></div>`}

        <div class="panel">
          <h2>🧠 Ce que j'ai appris de tes goûts</h2>
          ${learned.length ? `<ul class="learned">${learned.map((l, i) => `<li>✔︎ <span>${esc(l)}</span><button data-da="del-learned" data-i="${i}" title="Oublier cette règle">✕</button></li>`).join('')}</ul>`
            : '<p class="muted small">Rien encore : note tes miniatures (👎 👍 ❤️ 🏆) et ajoute des commentaires, j\'en tirerai des règles.</p>'}
          <div class="row tight mt"><input data-new-learned placeholder="Ajoute ta propre règle : ex. « Toujours un fond jaune »" style="flex:1"><button class="btn small" data-da="add-learned">Ajouter</button></div>
          ${hist.length ? `<h3 class="mt">Historique des versions</h3>
            ${hist.map((h) => `<div class="info-box" style="margin-bottom:8px">
              <div class="row tight"><strong>v${h.version}</strong><span>${esc(h.reason)}</span><span class="spacer"></span><span class="small">${fmtDate(h.at)}</span>
              ${h.version !== d.daVersion ? `<button class="btn small ghost" data-da="restore" data-v="${h.version}">Restaurer</button>` : '<span class="tag ok">actuelle</span>'}</div>
              ${(h.changelog || []).length ? `<ul class="changelog">${h.changelog.slice(0, 5).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
            </div>`).join('')}` : ''}
        </div>
      </div>
    </div>`;
  bindDA(root);
  drawTypoPreview();
}

function collectDA() {
  const root = $('#da-form');
  const da = JSON.parse(JSON.stringify(D().da));
  $$('[data-f]', root).forEach((el) => { da[el.dataset.f] = el.value; });
  da.typography = { ...da.typography };
  $$('[data-t]', root).forEach((el) => {
    da.typography[el.dataset.t] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  });
  da.palette = $$('[data-pal]', root).map((el) => ({ hex: el.value.toUpperCase(), role: el.dataset.role || '' }));
  return da;
}

function drawTypoPreview() {
  const c = $('#typo-preview');
  if (!c || !D().da) return;
  const da = collectDA();
  const t = da.typography;
  const ctx = c.getContext('2d');
  const pal = da.palette.map((p) => p.hex);
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, pal[0] || '#333');
  g.addColorStop(1, pal[1] || pal[0] || '#111');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const L = newLayer({
    text: 'TEXTE *EXEMPLE*', font: t.font, fill: t.fill, accent: t.accent, stroke: t.stroke, strokeWidth: t.strokeWidth,
    uppercase: t.uppercase, box: t.box, boxColor: t.boxColor, size: 130, maxWidth: 1200, x: c.width / 2, y: c.height / 2,
  });
  drawLayer(ctx, L);
}

async function saveDA(da, msg = 'DA enregistrée ✓') {
  try {
    await api.post('/api/da', { da, folderId: D().activeFolder });
    toast(msg, 'ok');
    await refresh();
  } catch (e) { toast(e.message, 'err'); }
}

function currentRefKind() {
  return $('input[name="refkind"]:checked')?.value || 'mine';
}

async function addRefFiles(files, kind) {
  const list = [...files].filter((f) => /^image\//.test(f.type));
  if (!list.length) return;
  let ok = 0;
  const folderId = D().activeFolder;
  toast(`Ajout de ${list.length} image(s) dans « ${folderName(folderId)} »…`, 'info', 2500);
  for (const f of list) {
    try {
      const img = await fileToImage(f);
      const { ref } = await api.post('/api/refs', { ...prepareThumbnail(img), kind, folderId });
      if (D().activeFolder === folderId) D().refs.push(ref);
      ok++;
    } catch (e) { toast(`${f.name} : ${e.message}`, 'err'); }
  }
  toast(`${ok} miniature(s) ajoutée(s) ✓${D().da ? '\nRelance l\'analyse pour mettre ta DA à jour.' : ''}`, 'ok', 5000);
  if (S.view === 'da') renderDA();
}

async function addFaceFiles(files) {
  const list = [...files].filter((f) => /^image\//.test(f.type));
  for (const f of list) {
    try {
      const img = await fileToImage(f);
      const { face } = await api.post('/api/faces', preparePhoto(img));
      D().faces.push(face);
    } catch (e) { toast(`${f.name} : ${e.message}`, 'err'); }
  }
  if (list.length) toast(`${list.length} photo(s) ajoutée(s) ✓`, 'ok');
  renderDA();
}

async function importYouTube(btn) {
  const links = $('[data-yt]').value.trim();
  if (!links) { toast('Colle au moins un lien YouTube', 'err'); return; }
  const kind = currentRefKind();
  const folderId = D().activeFolder;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Récupération…';
  try {
    const { items, errors } = await api.post('/api/youtube', { links });
    let added = 0;
    for (let i = 0; i < items.length; i++) {
      btn.innerHTML = `<span class="spinner"></span> Ajout ${i + 1}/${items.length}…`;
      const it = items[i];
      try {
        const img = await loadImage(it.dataUrl);
        const res = await api.post('/api/refs', { ...prepareThumbnail(img), kind, title: it.title, source: `yt:${it.videoId}`, folderId });
        if (!res.duplicate) { if (D().activeFolder === folderId) D().refs.push(res.ref); added++; }
      } catch (e) { errors.push(`${it.title || it.videoId} : ${e.message}`); }
    }
    toast(`${added} miniature(s) importée(s) ✓${errors.length ? `\n⚠️ ${errors.slice(0, 3).join('\n')}` : ''}`, errors.length && !added ? 'err' : 'ok', 8000);
    renderDA();
  } catch (e) {
    toast(e.message, 'err', 8000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importer les miniatures';
  }
}

function bindDA(root) {
  root.onclick = async (e) => {
    const drop = e.target.closest('[data-drop]');
    if (drop && !e.target.closest('input')) { drop.querySelector('input[type=file]').click(); return; }
    const refBtn = e.target.closest('[data-r]');
    if (refBtn) {
      const id = refBtn.closest('[data-ref]').dataset.ref;
      const r = D().refs.find((x) => x.id === id);
      try {
        if (refBtn.dataset.r === 'del') {
          if (!confirm('Supprimer cette référence ?')) return;
          await api.del(`/api/refs/${id}`);
          D().refs = D().refs.filter((x) => x.id !== id);
        } else {
          const patch = refBtn.dataset.r === 'pin' ? { pinned: !r.pinned } : { kind: r.kind === 'mine' ? 'inspiration' : 'mine' };
          const res = await api.patch(`/api/refs/${id}`, patch);
          Object.assign(r, res.ref);
        }
        $('#refs-grid').innerHTML = D().refs.map(refCard).join('');
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const ab = e.target.closest('[data-asset-act]');
    if (ab) { assetAction(ab); return; }
    const fdel = e.target.closest('[data-f-del]');
    if (fdel) {
      if (!confirm('Supprimer cette photo ?')) return;
      try {
        await api.del(`/api/faces/${fdel.dataset.fDel}`);
        D().faces = D().faces.filter((x) => x.id !== fdel.dataset.fDel);
        renderDA();
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const b = e.target.closest('[data-da]');
    if (!b) return;
    const act = b.dataset.da;
    try {
      if (act === 'analyze') {
        await api.post('/api/da/analyze', { folderId: D().activeFolder });
        D().status = { ...D().status, running: true, progress: 'Démarrage de l\'analyse…' };
        renderDA();
        updateBadge();
        startPolling();
      } else if (act === 'learn') {
        await api.post('/api/learn', { folderId: D().activeFolder });
        D().status = { ...D().status, running: true, progress: 'J\'apprends de tes notes…' };
        renderDA();
        updateBadge();
        startPolling();
      } else if (act === 'save-channel') {
        const ch = Object.fromEntries($$('[data-ch]', root).map((el) => [el.dataset.ch, el.value]));
        const res = await api.post('/api/channel', ch);
        D().channel = res.channel;
        toast('Chaîne enregistrée ✓', 'ok');
        updateOnboarding();
      } else if (act === 'save-da') {
        await saveDA(collectDA());
      } else if (act === 'add-color') {
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.innerHTML = '<input type="color" data-pal value="#FF0000" data-role=""><span></span><button data-da="del-color" title="Retirer">✕</button>';
        b.before(sw);
        drawTypoPreview();
      } else if (act === 'del-color') {
        b.closest('.swatch').remove();
        drawTypoPreview();
      } else if (act === 'del-learned' || act === 'add-learned') {
        const da = $('#da-form') ? collectDA() : JSON.parse(JSON.stringify(D().da || {}));
        da.learned = [...(D().da?.learned || [])];
        if (act === 'del-learned') da.learned.splice(Number(b.dataset.i), 1);
        else {
          const v = $('[data-new-learned]').value.trim();
          if (!v) return;
          da.learned.push(v);
        }
        await saveDA(da, act === 'add-learned' ? 'Règle ajoutée ✓' : 'Règle oubliée ✓');
      } else if (act === 'restore') {
        await api.post('/api/da/restore', { version: Number(b.dataset.v), folderId: D().activeFolder });
        toast(`Version ${b.dataset.v} restaurée ✓`, 'ok');
        await refresh();
      } else if (act === 'yt-import') {
        importYouTube(b);
      } else if (act === 'edit-folder') {
        openFolderModal('edit', currentFolder());
      } else if (act === 'asset-create') {
        createAsset(b);
      }
    } catch (err) { toast(err.message, 'err', 8000); }
  };
  root.onchange = (e) => {
    if (e.target.matches('[data-asset-f]')) { assetField(e.target); return; }
    if (e.target.matches('input[type=file]')) {
      const which = e.target.closest('[data-drop]').dataset.drop;
      if (which === 'refs') addRefFiles(e.target.files, currentRefKind());
      else if (which === 'assets') addAssetFiles(e.target.files);
      else addFaceFiles(e.target.files);
      e.target.value = '';
    }
    if (e.target.name === 'refkind') S.refKind = e.target.value;
  };
  root.oninput = (e) => { if (e.target.closest('#da-form') && (e.target.matches('[data-t]') || e.target.matches('[data-pal]'))) drawTypoPreview(); };
  $$('[data-drop]', root).forEach((z) => {
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => {
      e.preventDefault();
      z.classList.remove('over');
      if (z.dataset.drop === 'refs') addRefFiles(e.dataTransfer.files, currentRefKind());
      else if (z.dataset.drop === 'assets') addAssetFiles(e.dataTransfer.files);
      else addFaceFiles(e.dataTransfer.files);
    });
  });
}

// ==================================================================
// RÉGLAGES
// ==================================================================
const KEY_NAMES = { vertex: 'Google Cloud (express)', gemini: 'Gemini AI Studio', xai: 'Grok (xAI)', groq: 'Groq', openai: 'OpenAI', custom: 'Compatible OpenAI' };
const PRESETS = {
  gemfree: { brain: 'vertex', image: 'vertex', msg: 'Crée ta clé Google Cloud en « mode express » (gratuit 90 jours, sans carte bancaire) avec le bouton « Obtenir ↗ », puis colle-la sur la ligne « Google Cloud (express) ».' },
  google: { brain: 'gemini', image: 'gemini', msg: 'Colle ta clé Gemini AI Studio juste en dessous (pour les images, la facturation doit être activée).' },
  reco: { brain: 'gemini', image: 'xai', msg: 'Colle ta clé Gemini (gratuite) et ta clé xAI juste en dessous.' },
  grok: { brain: 'xai', image: 'xai', msg: 'Colle ta clé xAI juste en dessous.' },
  demo: { brain: 'demo', image: 'demo', msg: 'Mode démo activé : tu peux tout tester sans clé.' },
};

function modelOptions(kind, provider) {
  const sug = D().info.suggested[kind]?.[provider] || [];
  const loaded = S.models[`${kind}:${provider}`] || [];
  const labels = D().info.labels || {};
  const all = [...new Map([...sug.map((s) => [s, labels[s] || '']), ...loaded.map((m) => [m.id, m.label || labels[m.id] || ''])]).entries()];
  return all.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
}

function renderSettings() {
  const root = $('#view-settings');
  const d = D();
  const c = d.config;
  const P = d.info.providers;
  const m = d.stats.monthly?.[d.month] || { images: 0, costUsd: 0 };
  const opts = (kind) => Object.entries(P).filter(([, v]) => v[kind]).map(([k, v]) => `<option value="${k}" ${c[kind].provider === k ? 'selected' : ''}>${esc(v.label)}${k === 'vertex' ? ' — gratuit 90 jours ✓' : kind === 'brain' && k === 'gemini' ? ' — gratuit ✓' : ''}</option>`).join('');
  const sel = (v, cur) => (String(v) === String(cur) ? 'selected' : '');
  const placeholder = (kind) => {
    const def = d.info.defaults[kind][c[kind].provider];
    return def ? `par défaut : ${def}` : 'automatique (choisi dans ta liste)';
  };
  root.innerHTML = `
    <div class="panel">
      <h2>⚡ Configuration rapide</h2>
      <p class="muted small">Choisis une formule, puis colle la ou les clés demandées juste en dessous. Tout est enregistré automatiquement.</p>
      <div class="presets">
        <button class="btn preset star" data-preset="gemfree">⭐ Gemini gratuit<small>Tout avec Gemini via Google Cloud « mode express » : images gratuites pendant 90 jours, sans carte bancaire</small></button>
        <button class="btn preset" data-preset="google">🔵 Gemini (clé AI Studio)<small>Cerveau gratuit · images ≈ 0,03 à 0,05 $ (facturation à activer)</small></button>
        <button class="btn preset" data-preset="reco">🟠 Gemini + Grok<small>Cerveau Gemini gratuit · images Grok Imagine (≈ 0,04 à 0,08 $)</small></button>
        <button class="btn preset" data-preset="grok">🟣 Tout Grok<small>Une seule clé xAI pour tout (payant, quelques centimes)</small></button>
        <button class="btn preset" data-preset="demo">🧪 Mode démo<small>Pour découvrir le site sans aucune clé</small></button>
      </div>
    </div>

    <div class="panel">
      <h2>🔑 Clés API</h2>
      <p class="muted small">Tes clés restent dans ce navigateur, sur cet appareil. Elles ne sont envoyées qu'au fournisseur concerné (jamais à MiniaStudio ni à personne d'autre).</p>
      ${Object.keys(KEY_NAMES).map((k) => `
        <div class="key-row">
          <span class="name">${KEY_NAMES[k]} ${c.keys[k].set ? '<span class="tag ok">✓</span>' : ''}</span>
          <input type="password" data-key="${k}" autocomplete="off" placeholder="${c.keys[k].set ? `Clé enregistrée (${esc(c.keys[k].hint)}) — colle une autre clé pour la remplacer` : 'Colle ta clé ici'}">
          <span class="row tight">
            ${P[k]?.keyUrl ? `<a class="btn small ghost" href="${P[k].keyUrl}" target="_blank" rel="noopener">Obtenir ↗</a>` : ''}
            ${c.keys[k].set ? `<button class="btn small ghost danger" data-delkey="${k}">Effacer</button>` : ''}
          </span>
        </div>`).join('')}
      <label class="mt">Adresse de l'API « compatible OpenAI » <span class="hint">(OpenRouter, Mistral, LM Studio, Ollama…)</span>
        <input data-s="customBaseUrl" value="${esc(c.customBaseUrl)}" placeholder="Ex : https://openrouter.ai/api/v1 ou http://localhost:11434/v1"></label>
    </div>

    <div class="settings-grid">
      <div class="panel">
        <h2>🧠 Cerveau <span class="hint">analyse ta DA, invente les idées</span></h2>
        <label>Fournisseur<select data-s="brain.provider">${opts('brain')}</select></label>
        <div class="model-row">
          <label>Modèle<input data-s="brain.model" list="dl-brain" value="${esc(c.brain.model)}" placeholder="${esc(placeholder('brain'))}"></label>
          <button class="btn" data-act="models" data-kind="brain" ${c.brain.provider === 'demo' ? 'disabled' : ''}>📋 Charger</button>
        </div>
        <datalist id="dl-brain">${modelOptions('brain', c.brain.provider)}</datalist>
        <div class="row tight mt"><button class="btn" data-act="test" data-kind="brain">🔌 Tester la connexion</button></div>
        <div class="test-result" id="test-brain"></div>
        <p class="hint mt">Il doit savoir lire les images (modèle « vision »). Gemini Flash est gratuit et très bon pour ça.</p>
      </div>
      <div class="panel">
        <h2>🎨 Générateur d'images</h2>
        <label>Fournisseur<select data-s="image.provider">${opts('image')}</select></label>
        <div class="model-row">
          <label>Modèle<input data-s="image.model" list="dl-image" value="${esc(c.image.model)}" placeholder="${esc(placeholder('image'))}"></label>
          <button class="btn" data-act="models" data-kind="image" ${['demo'].includes(c.image.provider) ? 'disabled' : ''}>📋 Charger</button>
        </div>
        <datalist id="dl-image">${modelOptions('image', c.image.provider)}</datalist>
        <div class="row">
          <label>Définition<select data-s="image.resolution"><option value="1k" ${sel('1k', c.image.resolution)}>1K (suffisant, moins cher)</option><option value="2k" ${sel('2k', c.image.resolution)}>2K (plus net)</option></select></label>
          <label>Qualité<select data-s="image.quality">
            <option value="auto" ${sel('auto', c.image.quality)}>Auto</option><option value="low" ${sel('low', c.image.quality)}>Basse (moins chère)</option>
            <option value="medium" ${sel('medium', c.image.quality)}>Moyenne</option><option value="high" ${sel('high', c.image.quality)}>Haute (OpenAI)</option></select></label>
        </div>
        <label>Miniatures modèles envoyées à chaque création
          <select data-s="image.maxRefs">${[0, 1, 2, 3, 4].map((n) => `<option value="${n}" ${sel(n, c.image.maxRefs)}>${n}${n === 0 ? ' (aucune)' : ''}</option>`).join('')}</select>
          <span class="hint">Plus = plus fidèle à ta DA, mais un peu plus cher (Grok : +0,01 $ par image envoyée). Les ⭐ passent en premier.</span></label>
        <div id="forge-fields" ${c.image.provider === 'forge' ? '' : 'hidden'}>
          <label>Adresse de Forge / Automatic1111<input data-s="image.forgeUrl" value="${esc(c.image.forgeUrl)}"></label>
          <div class="row">
            <label>Étapes<input type="number" data-s="image.forgeSteps" min="1" max="150" value="${esc(c.image.forgeSteps)}"></label>
            <label>CFG<input type="number" step="0.5" data-s="image.forgeCfg" min="1" max="30" value="${esc(c.image.forgeCfg)}"></label>
          </div>
          <p class="hint">Lance Forge avec l'option <code>--api</code>. En local, tes photos et références ne sont pas envoyées (seulement le texte).</p>
        </div>
        <div class="row tight mt"><button class="btn" data-act="test" data-kind="image">🔌 Tester la connexion</button></div>
        <div class="test-result" id="test-image"></div>
      </div>
    </div>

    <div class="settings-grid">
      <div class="panel">
        <h2>🧠 Apprentissage</h2>
        <label class="toggle"><input type="checkbox" data-s="autoLearn" ${c.autoLearn ? 'checked' : ''}> Mettre à jour ma DA automatiquement</label>
        <label>Après combien de notes ?<input type="number" min="2" max="50" data-s="learnEvery" value="${esc(c.learnEvery)}"></label>
        <p class="hint">Chaque note (👎 👍 ❤️ 🏆), commentaire ou miniature finale compte.</p>
      </div>
      <div class="panel">
        <h2>💰 Consommation <span class="hint">estimation</span></h2>
        <div class="info-box">Ce mois-ci : <strong>${m.images} image(s)</strong> · ≈ <strong>${(m.costUsd || 0).toFixed(2)} $</strong><br>Depuis le début : ${d.stats.imagesGenerated || 0} image(s) · ≈ ${(d.stats.costUsd || 0).toFixed(2)} $</div>
        <h2 class="mt">📁 Tes données</h2>
        <div class="info-box">Tout est enregistré dans <strong>ce navigateur</strong>, sur cet appareil (ta DA, tes références, tes miniatures, tes clés). Pour changer d'appareil ou de navigateur, fais une sauvegarde puis restaure-la de l'autre côté. Les clés API ne sont pas incluses : recolle-les.</div>
        <div class="row tight mt">
          <button class="btn small" data-act="backup">💾 Sauvegarder mes données</button>
          <button class="btn small" data-act="restore">📂 Restaurer une sauvegarde</button>
          <input type="file" id="restore-file" accept="application/json,.json" hidden>
        </div>
      </div>
    </div>`;
  bindSettings(root);
}

async function saveSettings(patch, rerender = false) {
  try {
    const res = await api.post('/api/settings', patch);
    D().config = res.config;
    updateCostHint();
    if (rerender) renderSettings();
  } catch (e) { toast(e.message, 'err'); }
}

function bindSettings(root) {
  root.onchange = async (e) => {
    const el = e.target;
    if (el.id === 'restore-file') { restoreData(el); return; }
    if (el.dataset.key) {
      const v = el.value.trim();
      if (!v) return;
      await saveSettings({ keys: { [el.dataset.key]: v } }, true);
      toast(`Clé ${KEY_NAMES[el.dataset.key]} enregistrée ✓`, 'ok');
      return;
    }
    const path = el.dataset.s;
    if (!path) return;
    const val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    const [a, b] = path.split('.');
    const patch = b ? { [a]: { [b]: val } } : { [a]: val };
    if (b === 'provider') patch[a].model = '';
    await saveSettings(patch, b === 'provider');
  };
  root.onclick = async (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) {
      const pr = PRESETS[p.dataset.preset];
      await saveSettings({ brain: { provider: pr.brain }, image: { provider: pr.image } }, true);
      toast(pr.msg, 'ok', 7000);
      updateOnboarding();
      return;
    }
    const dk = e.target.closest('[data-delkey]');
    if (dk) {
      if (!confirm(`Effacer la clé ${KEY_NAMES[dk.dataset.delkey]} ?`)) return;
      await saveSettings({ keys: { [dk.dataset.delkey]: '__delete__' } }, true);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'backup') { backupData(b); return; }
    if (b.dataset.act === 'restore') { $('#restore-file').click(); return; }
    const kind = b.dataset.kind;
    if (b.dataset.act === 'models') {
      b.disabled = true;
      try {
        const provider = D().config[kind].provider;
        const { models } = await api.post('/api/models', { kind, provider });
        S.models[`${kind}:${provider}`] = models;
        $(`#dl-${kind}`).innerHTML = modelOptions(kind, provider);
        toast(models.length ? `${models.length} modèle(s) trouvé(s) : clique dans le champ « Modèle » pour choisir.` : 'Aucun modèle compatible trouvé sur ce compte.', models.length ? 'ok' : 'err', 6000);
      } catch (err) { toast(err.message, 'err', 9000); }
      b.disabled = false;
    }
    if (b.dataset.act === 'test') {
      const out = $(`#test-${kind}`);
      out.className = 'test-result';
      out.innerHTML = '<span class="spinner"></span> Test en cours…';
      b.disabled = true;
      try {
        const r = await api.post('/api/test', { kind });
        out.className = `test-result ${r.warning ? 'warn' : 'ok'}`;
        out.textContent = `✓ ${r.message}${r.warning ? `\n⚠️ ${r.warning}` : ''}`;
        const res = await api.get('/api/state');
        D().config = res.config;
        const input = $(`[data-s="${kind}.model"]`);
        if (input && !input.value) input.placeholder = res.config[kind].model || input.placeholder;
      } catch (err) {
        out.className = 'test-result err';
        out.textContent = `✗ ${err.message}`;
      }
      b.disabled = false;
    }
  };
}

async function backupData(btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Préparation…';
  try {
    const backup = await api.get('/api/backup');
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    saveBlob(blob, `miniastudio-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
    toast('💾 Sauvegarde téléchargée. Garde ce fichier précieusement (il ne contient pas tes clés API).', 'ok', 7000);
  } catch (err) { toast(err.message, 'err'); }
  btn.disabled = false;
  btn.textContent = '💾 Sauvegarder mes données';
}

async function restoreData(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!window.confirm('Restaurer cette sauvegarde ? Les données actuelles de ce navigateur seront remplacées (tes clés API sont gardées).')) return;
  try {
    const backup = JSON.parse(await file.text());
    const res = await api.post('/api/restore', { backup });
    S.results = [];
    await refresh();
    renderResults();
    toast(`📂 Sauvegarde restaurée (${res.files} image(s)).`, 'ok', 6000);
  } catch (err) { toast(err instanceof SyntaxError ? 'Ce fichier n\'est pas une sauvegarde valide.' : err.message, 'err', 8000); }
}

// ==================================================================
// APERÇU YOUTUBE
// ==================================================================
function openPreview(dataUrl, g) {
  const d = D();
  const title = g?.input?.title || 'Le titre de ta vidéo';
  const chan = d.channel.name || 'Ta chaîne';
  const others = d.refs.filter((r) => r.kind === 'mine').slice(-5).reverse()
    .map((r) => ({ src: refThumb(r), title: r.title || 'Une autre de tes vidéos' }));
  while (others.length < 5) others.push({ src: '', title: 'Vidéo d\'une autre chaîne' });
  const img = (src) => (src ? `<img src="${src}" alt="">` : '<img alt="" style="background:#3a3a3a">');
  const card = (o, me) => `
    <div class="yt-card ${me ? 'me' : ''}">${img(o.src)}
      <div class="yt-info"><div class="yt-avatar">${esc((chan[0] || 'T').toUpperCase())}</div>
      <div><div class="yt-t">${esc(o.title)}</div><div class="yt-m">${esc(chan)}<br>${me ? '1,2 k vues • il y a 2 heures' : '48 k vues • il y a 3 jours'}</div></div></div></div>`;
  const row = (o, me) => `
    <div class="yt-row ${me ? 'me' : ''}">${img(o.src)}<div><div class="yt-t">${esc(o.title)}</div><div class="yt-m">${esc(chan)}<br>${me ? '1,2 k vues' : '48 k vues'}</div></div></div>`;
  const mine = { src: dataUrl, title };
  $('#pv-content').innerHTML = `
    <h4>Page d'accueil (ta miniature est entourée en bleu)</h4>
    <div class="yt-grid">${[card(mine, true), ...others.slice(0, 5).map((o) => card(o))].join('')}</div>
    <div class="yt-side">
      <div><h4>Suggestions à côté d'une vidéo (petite taille)</h4>${[row(others[0]), row(mine, true), row(others[1]), row(others[2])].join('')}</div>
      <div><h4>Sur mobile</h4><div class="yt-mobile">${card(mine, true)}</div></div>
    </div>`;
  $('#preview').hidden = false;
}

function bindPreview() {
  const close = () => { $('#preview').hidden = true; };
  $('#pv-close').onclick = close;
  $('#preview').addEventListener('click', (e) => { if (e.target.id === 'preview') close(); });
  $('#pv-theme').onclick = () => {
    const yt = $('#pv-content');
    yt.classList.toggle('light');
    $('#pv-theme').textContent = yt.classList.contains('light') ? '🌙 Thème sombre' : '☀️ Thème clair';
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#preview').hidden) close(); });
}

// ==================================================================
// ÉDITEUR
// ==================================================================
const editor = new Editor({
  getImage: (g) => genFull(g),
  getDA: () => D().da,
  toast,
  onSave: async (g, layers, adjust) => {
    try {
      await api.patch(`/api/generations/${g.id}`, { layers, adjust });
      const gg = genById(g.id);
      if (gg) { gg.layers = layers; gg.adjust = adjust; }
      refreshGenViews(g.id);
    } catch (e) { toast(e.message, 'err'); }
  },
  onExport: async (g, dataUrl, layers, adjust, blob) => {
    try {
      const res = await api.post(`/api/generations/${g.id}/export`, { dataUrl, layers, adjust });
      upsertGen(res.generation);
      refreshGenViews(g.id);
      updateBadge();
      saveBlob(blob, fileName(g));
      toast(`✅ Miniature finale enregistrée (et téléchargée) !\n📁 ${res.path}`, 'ok', 10000, { label: '➕ L\'ajouter à mes références', fn: () => addGenToRefs(res.generation) });
      if (res.learningStarted) startPolling();
    } catch (e) { toast(e.message, 'err'); }
  },
  onPreview: (dataUrl, g) => openPreview(dataUrl, g),
  onRetouch: async (g, instruction, layers, adjust) => {
    try {
      const { generation } = await api.post(`/api/generations/${g.id}/edit`, { instruction });
      generation.layers = layers;
      generation.adjust = adjust;
      await api.patch(`/api/generations/${generation.id}`, { layers, adjust });
      upsertGen(generation);
      makeThumb(generation);
      const r = S.results.find((x) => x.genId === g.id);
      if (r) insertResultAfter(r, { key: uid(), concept: generation.concept, input: generation.input, status: 'done', genId: generation.id });
      return generation;
    } catch (e) {
      toast(e.message, 'err', 9000);
      return null;
    }
  },
  onDownload: (g, blob) => saveBlob(blob, fileName(g)),
});

// ==================================================================
// BANQUE D'IMAGES (personnages, véhicules, logos…) : par dossier
// ==================================================================
const ASSET_KIND_LABELS = { character: 'Personnage', vehicle: 'Véhicule', object: 'Objet', place: 'Lieu / décor', logo: 'Logo', other: 'Autre' };
const assetById = (id) => (D().assets || []).find((a) => a.id === id);
const assetThumb = (a) => (a.thumb ? fileUrl('thumbs', a.thumb) : fileUrl('assets', a.file));

function assetCard(a) {
  return `<div class="asset ${a.pinned ? 'pinned' : ''}" data-asset="${a.id}">
    <div class="asset-img"><img src="${assetThumb(a)}" alt="" loading="lazy" title="${esc(a.note || a.name)}"></div>
    <input class="asset-name" data-asset-f="name" value="${esc(a.name)}" maxlength="60" title="Nom de l'élément (l'IA s'en sert pour le choisir)">
    <div class="asset-bar">
      <select data-asset-f="kind" title="Type">${Object.entries(ASSET_KIND_LABELS).map(([k, l]) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" data-asset-act="pin" title="${a.pinned ? 'Ne plus mettre d\'office' : 'Toujours présent dans les miniatures de ce dossier'}">${a.pinned ? '⭐' : '☆'}</button>
      <button type="button" data-asset-act="del" title="Supprimer">🗑️</button>
    </div>
  </div>`;
}

function renderAssetsGrid() {
  const grid = $('#assets-grid');
  if (!grid) return;
  grid.innerHTML = (D().assets || []).map(assetCard).join('');
  const h = $('#assets-panel h2 .hint');
  if (h) h.textContent = String((D().assets || []).length);
}

function assetsStatus(html) {
  const el = $('#assets-status');
  if (el) el.innerHTML = html ? `<div class="progress-line mt">${html}</div>` : '';
}

async function assetField(el) {
  const id = el.closest('[data-asset]').dataset.asset;
  const patch = { [el.dataset.assetF]: el.value };
  try {
    const { asset } = await api.patch(`/api/assets/${id}`, patch);
    Object.assign(assetById(id) || {}, asset);
  } catch (err) { toast(err.message, 'err'); }
}

async function assetAction(btn) {
  const id = btn.closest('[data-asset]').dataset.asset;
  const a = assetById(id);
  if (!a) return;
  try {
    if (btn.dataset.assetAct === 'del') {
      if (!window.confirm(`Supprimer « ${a.name} » de la banque d'images ?`)) return;
      await api.del(`/api/assets/${id}`);
      D().assets = D().assets.filter((x) => x.id !== id);
    } else {
      const { asset } = await api.patch(`/api/assets/${id}`, { pinned: !a.pinned });
      Object.assign(a, asset);
    }
    renderAssetsGrid();
  } catch (err) { toast(err.message, 'err'); }
}

// L'IA reconnaît les nouvelles images (nom, type, description) : modifiable ensuite.
async function labelAssets(ids, folderId) {
  if (!ids.length || D().config.brain.provider === 'demo') return;
  assetsStatus(`<span class="spinner"></span> L'IA reconnaît tes ${ids.length} image(s)…`);
  try {
    const { assets } = await api.post('/api/assets/label', { ids });
    if (D().activeFolder === folderId) for (const a of assets) Object.assign(assetById(a.id) || {}, a);
  } catch (err) { toast(`Reconnaissance des images : ${err.message}`, 'err', 8000); }
  assetsStatus('');
  if (D().activeFolder === folderId) renderAssetsGrid();
}

async function addAssetFiles(files) {
  const list = [...files].filter((f) => /^image\//.test(f.type));
  if (!list.length) return;
  const folderId = D().activeFolder;
  const ids = [];
  assetsStatus(`<span class="spinner"></span> Ajout de ${list.length} image(s)…`);
  for (const f of list) {
    try {
      const img = await fileToImage(f);
      const type = /png|webp|gif/.test(f.type) ? 'image/png' : 'image/jpeg';
      const name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 60) || 'Élément';
      const { asset } = await api.post('/api/assets', { dataUrl: fitDataUrl(img, 1024, type, 0.9), thumbDataUrl: fitDataUrl(img, 360, type, 0.85), name, folderId });
      if (D().activeFolder === folderId) { D().assets.push(asset); renderAssetsGrid(); }
      ids.push(asset.id);
    } catch (e) { toast(`${f.name} : ${e.message}`, 'err'); }
  }
  assetsStatus('');
  toast(`🧩 ${ids.length} élément(s) ajouté(s) à « ${folderName(folderId)} »`, 'ok');
  await labelAssets(ids, folderId);
}

async function createAsset(btn) {
  const input = $('[data-asset-new]');
  const description = input.value.trim();
  if (!description) { input.focus(); return; }
  const folderId = D().activeFolder;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Gemini crée l\'élément…';
  try {
    const { asset } = await api.post('/api/assets/create', { description, folderId });
    try {
      const img = await loadImage(fileUrl('assets', asset.file));
      const { thumb } = await api.post(`/api/assets/${asset.id}/thumb`, { dataUrl: fitDataUrl(img, 360, 'image/jpeg', 0.85) });
      asset.thumb = thumb;
    } catch (_) { /* l'aperçu n'est qu'un confort */ }
    if (D().activeFolder === folderId) { D().assets.push(asset); renderAssetsGrid(); }
    input.value = '';
    toast(`✨ « ${description} » ajouté à la banque d'images`, 'ok');
    await labelAssets([asset.id], folderId);
  } catch (err) { toast(err.message, 'err', 9000); }
  btn.disabled = false;
  btn.textContent = '✨ Créer l\'élément';
}

function conceptAssetsHtml(c) {
  if (!(D().assets || []).length) return '';
  const chosen = (c.assetIds || []).map(assetById).filter(Boolean);
  const others = D().assets.filter((a) => !(c.assetIds || []).includes(a.id));
  return `<div class="concept-assets"><span class="small muted">🧩 Éléments :</span>
    ${chosen.map((a) => (a.pinned ? `<span class="chip on" title="Toujours présent (⭐)">⭐ ${esc(a.name)}</span>` : `<span class="chip on" data-rm-asset="${a.id}" title="Retirer">${esc(a.name)} ✕</span>`)).join('')}
    ${others.length ? `<select data-add-asset><option value="">＋ ajouter</option>${others.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>` : ''}
    ${chosen.length ? '' : '<span class="small muted">aucun (Gemini crée tout)</span>'}
  </div>`;
}

// « Me mettre dans la miniature » est mémorisé pour chaque dossier.
function syncFaceSetting() {
  const f = $('#create-form');
  const cf = currentFolder();
  if (!f || !cf) return;
  f.useFace.checked = cf.useFace !== false;
  if (!f.useFace.dataset.bound) {
    f.useFace.dataset.bound = '1';
    f.useFace.addEventListener('change', async () => {
      const folder = currentFolder();
      if (!folder) return;
      folder.useFace = f.useFace.checked;
      try { await api.patch(`/api/folders/${folder.id}`, { useFace: f.useFace.checked }); } catch (err) { toast(err.message, 'err'); }
      syncFaceSetting();
    });
  }
  const hint = $('#asset-hint');
  const n = (D().assets || []).length;
  const chars = (D().assets || []).filter((a) => a.kind === 'character').length;
  hint.hidden = !n;
  hint.textContent = n ? `🧩 ${n} élément(s) dans la banque de « ${cf.name} »${!f.useFace.checked && chars ? ` : sans ton visage, le sujet sera un de tes ${chars} personnage(s)` : ''}. L'IA choisit ceux qui collent à chaque miniature.` : '';
}

// ==================================================================
// DOSSIERS (GTA, films, histoire…) : chacun a ses références, sa DA et son apprentissage
// ==================================================================
function recentResults() {
  return D().generations
    .filter((g) => Date.now() - new Date(g.createdAt).getTime() < 3 * 3600e3)
    .slice(0, 8)
    .map((g) => ({ key: uid(), concept: g.concept, input: g.input, status: 'done', genId: g.id, folderId: g.folderId }));
}

function renderFolderBar() {
  const bar = $('#folder-bar');
  if (!bar || !D().folders) return;
  bar.innerHTML = `
    <label class="folder-pick" title="Dossier de miniatures">📁
      <select id="folder-select" aria-label="Dossier">
        ${D().folders.map((f) => `<option value="${f.id}" ${f.id === D().activeFolder ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
        <option value="__new">＋ Nouveau dossier…</option>
      </select>
    </label>
    <button class="btn icon small ghost" id="folder-edit" title="Renommer, décrire ou supprimer ce dossier">✏️</button>`;
  $('#folder-select').onchange = (e) => {
    const v = e.target.value;
    if (v === '__new') { e.target.value = D().activeFolder; openFolderModal('create'); } else switchFolder(v);
  };
  $('#folder-edit').onclick = () => openFolderModal('edit', currentFolder());
  renderFolderChips();
}

function renderFolderChips() {
  const el = $('#folder-chips');
  if (!el || !D().folders) return;
  el.innerHTML = D().folders.map((f) => `<button type="button" class="chip folder-chip ${f.id === D().activeFolder ? 'on' : ''}" data-folder="${f.id}" title="${esc(f.description || f.name)}">📁 ${esc(f.name)}</button>`).join('')
    + '<button type="button" class="chip folder-chip" data-folder="__new" title="Créer un dossier (ex : GTA, Films…)">＋ Nouveau</button>';
  el.onclick = (e) => {
    const b = e.target.closest('[data-folder]');
    if (!b) return;
    if (b.dataset.folder === '__new') openFolderModal('create'); else switchFolder(b.dataset.folder);
  };
}

async function switchFolder(id) {
  if (!id || id === D().activeFolder) return;
  S.resultsByFolder[D().activeFolder] = S.results;
  try {
    await api.post(`/api/folders/${id}/activate`, {});
    S.data = await api.get('/api/state');
  } catch (e) { toast(e.message, 'err'); return; }
  S.results = S.resultsByFolder[id] || recentResults();
  S.concepts = [];
  updateBadge();
  renderFolderBar();
  renderView(S.view);
  if ($('#results')) { renderResults(); renderConcepts(); }
}

function openFolderModal(mode, folder = null) {
  const m = $('#folder-modal');
  const f = $('#folder-form');
  m.dataset.mode = mode;
  m.dataset.id = folder?.id || '';
  $('#fm-title').textContent = mode === 'create' ? 'Nouveau dossier' : `Modifier « ${folder?.name || ''} »`;
  $('#fm-submit').textContent = mode === 'create' ? 'Créer le dossier' : 'Enregistrer';
  f.name.value = mode === 'create' ? '' : folder?.name || '';
  f.description.value = mode === 'create' ? '' : folder?.description || '';
  const withDA = (D().folders || []).filter((x) => x.hasDA);
  $('#fm-copy-wrap').hidden = mode !== 'create' || !withDA.length;
  f.copyFrom.innerHTML = '<option value="">Non, une DA toute neuve</option>' + withDA.map((x) => `<option value="${x.id}">Oui, celle de « ${esc(x.name)} »</option>`).join('');
  $('#fm-delete').hidden = mode !== 'edit' || (D().folders || []).length <= 1;
  m.hidden = false;
  setTimeout(() => f.name.focus(), 30);
}

function closeFolderModal() { $('#folder-modal').hidden = true; }

function bindFolderModal() {
  const m = $('#folder-modal');
  const f = $('#folder-form');
  $('#fm-cancel').onclick = closeFolderModal;
  m.addEventListener('click', (e) => { if (e.target === m) closeFolderModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) closeFolderModal(); });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) { f.name.focus(); return; }
    try {
      if (m.dataset.mode === 'create') {
        S.resultsByFolder[D().activeFolder] = S.results;
        await api.post('/api/folders', { name, description: f.description.value.trim(), copyFrom: f.copyFrom.value || null });
        S.data = await api.get('/api/state');
        S.results = [];
        S.concepts = [];
        closeFolderModal();
        updateBadge();
        renderFolderBar();
        if ($('#results')) { renderResults(); renderConcepts(); }
        showView('da');
        toast(`📁 Dossier « ${name} » créé. Ajoute ses miniatures de référence, puis analyse sa DA.`, 'ok', 7000);
      } else {
        await api.patch(`/api/folders/${m.dataset.id}`, { name, description: f.description.value.trim() });
        closeFolderModal();
        await refresh();
        toast('Dossier mis à jour ✓', 'ok');
      }
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#fm-delete').onclick = async () => {
    const id = m.dataset.id;
    const name = folderName(id);
    if (!window.confirm(`Supprimer le dossier « ${name} » avec ses références, sa DA et ses miniatures ? C'est définitif.`)) return;
    try {
      await api.del(`/api/folders/${id}`);
      delete S.resultsByFolder[id];
      S.data = await api.get('/api/state');
      S.results = S.resultsByFolder[D().activeFolder] || recentResults();
      closeFolderModal();
      updateBadge();
      renderFolderBar();
      renderView(S.view);
      if ($('#results')) { renderResults(); renderConcepts(); }
      toast(`Dossier « ${name} » supprimé.`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ==================================================================
// DÉMARRAGE
// ==================================================================
async function boot() {
  try {
    await ensureFonts();
    S.data = await api.get('/api/state');
  } catch (e) {
    document.querySelector('main').innerHTML = `<div class="panel"><h2>😕 MiniaStudio ne peut pas démarrer</h2><p>Ton navigateur bloque l'enregistrement des données (navigation privée ?). Ouvre le site dans une fenêtre normale de Chrome, Edge ou Firefox, puis recharge la page.</p><p class="muted small">${esc(e.message)}</p></div>`;
    return;
  }
  // On remet les dernières propositions (moins de 3 h) dans l'écran Créer.
  S.results = recentResults();
  updateBadge();
  renderFolderBar();
  bindFolderModal();
  renderCreate();
  bindPreview();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b && !b.closest('.modal')) showView(b.dataset.view);
  });
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (!e.target.closest?.('.drop')) e.preventDefault(); }));
  document.addEventListener('paste', (e) => {
    if (S.view !== 'da') return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) addRefFiles(files, currentRefKind());
  });
  if (D().status?.running) startPolling();
}

boot();
