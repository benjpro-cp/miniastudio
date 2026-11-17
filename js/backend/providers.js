// Connexion aux IA, directement depuis ton navigateur. Deux rôles :
//  - le « cerveau » (lit les images, comprend ta DA, invente les idées)
//  - le « générateur d'images » (Gemini Nano Banana, Grok Imagine, OpenAI…)
import * as store from './store.js';
import { request, friendly, ApiError } from './http.js';
import { extractJson, blobToBase64, base64ToBlob, sniffBlob } from './util.js';
import * as demo from './demo.js';

// Adresses modifiables pour les tests automatiques.
const OVERRIDE = () => globalThis.__MINIA_URLS || {};

export const PROVIDERS = {
  vertex: { label: 'Gemini · Google Cloud (mode express)', url: () => OVERRIDE().vertex || 'https://aiplatform.googleapis.com', keyUrl: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview', brain: true, image: true },
  gemini: { label: 'Gemini · clé AI Studio', url: () => OVERRIDE().gemini || 'https://generativelanguage.googleapis.com', keyUrl: 'https://aistudio.google.com/apikey', brain: true, image: true },
  xai: { label: 'Grok (xAI)', url: () => OVERRIDE().xai || 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai', brain: true, image: true },
  groq: { label: 'Groq', url: () => OVERRIDE().groq || 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', brain: true, image: false },
  openai: { label: 'OpenAI', url: () => OVERRIDE().openai || 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', brain: true, image: true },
  custom: { label: 'Autre API compatible OpenAI', url: () => String(store.config.customBaseUrl || '').trim().replace(/\/+$/, ''), brain: true, image: false },
  demo: { label: 'Démo (sans IA)', brain: true, image: true },
};

const VERTEX_MODELS = {
  brain: [['gemini-3-flash-preview', 'Gemini 3 Flash (recommandé)'], ['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite (plus rapide)']],
  image: [['gemini-3.1-flash-image', 'Nano Banana 2 (recommandé)'], ['gemini-2.5-flash-image', 'Nano Banana'], ['gemini-3-pro-image', 'Nano Banana Pro (meilleure qualité, plus lent)']],
};

const DEFAULT_MODELS = {
  brain: { vertex: VERTEX_MODELS.brain[0][0], gemini: 'gemini-flash-latest', xai: '', groq: '', openai: '', custom: '' },
  image: { vertex: VERTEX_MODELS.image[0][0], xai: 'grok-imagine-image-2.0', gemini: '', openai: 'gpt-image-1', demo: '' },
};

const SUGGESTED = {
  brain: {
    vertex: VERTEX_MODELS.brain.map((m) => m[0]),
    gemini: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'],
    xai: ['grok-4-latest'],
    groq: ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'],
    openai: ['gpt-4.1-mini', 'gpt-4o-mini'],
    custom: [],
  },
  image: {
    vertex: VERTEX_MODELS.image.map((m) => m[0]),
    xai: ['grok-imagine-image-2.0', 'grok-imagine-image'],
    gemini: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'],
    openai: ['gpt-image-1', 'gpt-image-1-mini'],
  },
};

const cfg = () => store.config;

function wrap(e, label) {
  if (e && e.friendly) return e;
  const err = new Error(friendly(e, label));
  err.status = e.status || 500;
  err.friendly = true;
  return err;
}

function requireKey(provider) {
  const key = String(cfg().keys?.[provider] || '').trim();
  if (!key && provider !== 'custom') {
    throw Object.assign(new Error(`Il manque ta clé pour « ${PROVIDERS[provider]?.label || provider} ». Colle-la dans Réglages → Clés API.`), { status: 400, friendly: true });
  }
  return key;
}

const dataUrlOf = async (r) => `data:${r.mime};base64,${await blobToBase64(r.blob)}`;

// ---------- Liste des modèles ----------
const NOT_CHAT = /imagine|image|dall-e|tts|whisper|embed|audio|video|veo|imagen|moderation|guard|transcribe|realtime|search|computer|orpheus|playai|lyria|aqa|robotics/i;

export async function listModels(provider, kind) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Fournisseur inconnu');
  if (provider === 'demo') return [];
  if (provider === 'vertex') return VERTEX_MODELS[kind === 'image' ? 'image' : 'brain'].map(([id, label]) => ({ id, label }));
  try {
    if (provider === 'gemini') {
      const key = requireKey('gemini');
      const j = await request(`${p.url()}/v1beta/models?pageSize=1000`, { method: 'GET', headers: { 'x-goog-api-key': key }, timeoutMs: 20000 });
      return (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' }))
        .filter((m) => (kind === 'image'
          ? /image|nano-banana/i.test(m.id) && !/imagen/i.test(m.id)
          : !/image|nano-banana|tts|audio|embed|aqa|robotics|computer|live|native/i.test(m.id)));
    }
    const key = requireKey(provider);
    const j = await request(`${p.url()}/models`, { method: 'GET', headers: key ? { Authorization: `Bearer ${key}` } : {}, timeoutMs: 20000 });
    const out = [];
    for (const m of j.data || []) {
      out.push({ id: m.id, label: '' });
      for (const a of m.aliases || []) out.push({ id: a, label: `alias de ${m.id}` });
    }
    if (kind === 'image') return out.filter((m) => /imagine-image|gpt-image|dall-e/i.test(m.id) || (provider === 'xai' && /image/i.test(m.id) && !/vision/i.test(m.id)));
    return out.filter((m) => !NOT_CHAT.test(m.id));
  } catch (e) {
    throw wrap(e, p.label);
  }
}

function pickModel(provider, kind, ids) {
  const has = (re) => ids.find((id) => re.test(id));
  if (kind === 'image') {
    if (provider === 'xai') return has(/imagine-image-2/) || has(/imagine-image/) || ids[0];
    if (provider === 'gemini') return has(/nano-banana-2\.\d/) || has(/3\.1-flash-image$/) || has(/flash-image$/) || has(/flash-image/) || ids[0];
    if (provider === 'openai') return has(/^gpt-image-1\.5$/) || has(/^gpt-image-1$/) || has(/gpt-image/) || ids[0];
    return ids[0];
  }
  if (provider === 'xai') return has(/fast.*non-reasoning/) || has(/fast/) || has(/mini/) || has(/^latest$/) || has(/grok-4/) || ids[0];
  if (provider === 'groq') return has(/llama-4-scout/) || has(/llama-4-maverick/) || has(/vision|scout|maverick|-vl|muse|qwen.*vl/i) || ids[0];
  if (provider === 'openai') return has(/^gpt-5(\.\d+)?-mini$/) || has(/^gpt-4\.1-mini$/) || has(/^gpt-4o-mini$/) || has(/mini/) || ids[0];
  if (provider === 'gemini') return has(/^gemini-flash-latest$/) || has(/flash/) || ids[0];
  return ids[0];
}

export async function resolveModel(kind) {
  const c = cfg()[kind];
  if (c.model) return c.model;
  const def = DEFAULT_MODELS[kind][c.provider];
  if (def) return def;
  if (c.provider === 'demo') return '';
  const list = await listModels(c.provider, kind);
  const chosen = pickModel(c.provider, kind, list.map((m) => m.id));
  if (!chosen) throw Object.assign(new Error(`Aucun modèle compatible trouvé sur ton compte ${PROVIDERS[c.provider].label}. Choisis-en un dans Réglages.`), { status: 400, friendly: true });
  c.model = chosen;
  await store.saveConfig();
  return chosen;
}

// ---------- Gemini : clé AI Studio (generativelanguage) ou Google Cloud mode express (aiplatform) ----------
async function geminiCall(provider, model, body, timeoutMs = 180000) {
  const key = requireKey(provider);
  const base = PROVIDERS[provider].url();
  const m = encodeURIComponent(String(model).replace(/^(models|publishers\/google\/models)\//, ''));
  const headers = { 'x-goog-api-key': key };
  if (provider === 'vertex') {
    return request(`${base}/v1/publishers/google/models/${m}:generateContent`, { headers, body, timeoutMs, retries: 3 });
  }
  try {
    return await request(`${base}/v1beta/models/${m}:generateContent`, { headers, body, timeoutMs });
  } catch (e) {
    if (e.status === 404) {
      try { return await request(`${base}/v1/models/${m}:generateContent`, { headers, body, timeoutMs }); } catch (_) { /* on garde la 1re erreur */ }
    }
    throw e;
  }
}

// Mode express en automatique : si Google a retiré un modèle, on passe au suivant de la liste officielle.
async function withModelFallback(kind, provider, model, fn) {
  const auto = provider === 'vertex' && cfg()[kind].provider === provider && !cfg()[kind].model;
  const list = auto ? [model, ...VERTEX_MODELS[kind].map((x) => x[0]).filter((x) => x !== model)] : [model];
  for (let i = 0; ; i++) {
    try {
      const out = await fn(list[i]);
      if (i > 0) { cfg()[kind].model = list[i]; await store.saveConfig(); }
      return { out, model: list[i] };
    } catch (e) {
      if (e.status !== 404 || i === list.length - 1) throw e;
    }
  }
}

async function geminiChat({ provider = 'gemini', model, system, user, images }) {
  const parts = [];
  for (const [i, img] of images.entries()) {
    parts.push({ text: `Image ${i + 1}${img.label ? ` (${img.label})` : ''} :` });
    parts.push({ inlineData: { mimeType: img.mime, data: await blobToBase64(img.blob) } });
  }
  parts.push({ text: user });
  const j = await geminiCall(provider, model, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const cand = j.candidates?.[0];
  if (!cand) throw new ApiError(400, j.promptFeedback?.blockReason ? `Demande bloquée par le filtre de sécurité (${j.promptFeedback.blockReason})` : 'Réponse vide');
  const text = (cand.content?.parts || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  if (!text) throw new ApiError(400, `Réponse vide (${cand.finishReason || 'raison inconnue'})`);
  return text;
}

// ---------- Cerveau : API compatibles OpenAI ----------
async function openaiChat({ provider, model, system, user, images, temperature }) {
  const key = requireKey(provider);
  const base = PROVIDERS[provider].url();
  if (!base) throw Object.assign(new Error("Renseigne l'adresse de l'API dans Réglages."), { status: 400, friendly: true });
  let content = user;
  if (images.length) {
    content = [];
    for (const [i, img] of images.entries()) {
      content.push({ type: 'text', text: `Image ${i + 1}${img.label ? ` (${img.label})` : ''} :` });
      content.push({ type: 'image_url', image_url: { url: await dataUrlOf(img) } });
    }
    content.push({ type: 'text', text: user });
  }
  const messages = [{ role: 'system', content: system }, { role: 'user', content }];
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  let j;
  try {
    j = await request(`${base}/chat/completions`, { headers, body: { model, messages, temperature, response_format: { type: 'json_object' } } });
  } catch (e) {
    if (e.status === 400 || e.status === 422) j = await request(`${base}/chat/completions`, { headers, body: { model, messages } });
    else throw e;
  }
  let text = j.choices?.[0]?.message?.content;
  if (Array.isArray(text)) text = text.map((p) => p.text || '').join('');
  if (!text) throw new ApiError(400, 'Réponse vide');
  return text;
}

/** Appel au cerveau qui renvoie un objet JSON. images = [{blob, mime, label}] */
export async function brainJson({ system, user, images = [], temperature = 0.7 }) {
  const provider = cfg().brain.provider;
  const label = PROVIDERS[provider]?.label || provider;
  if (provider === 'demo') throw new Error('Le mode démo ne passe pas par ici.');
  try {
    const model = await resolveModel('brain');
    const text = provider === 'gemini' || provider === 'vertex'
      ? (await withModelFallback('brain', provider, model, (m) => geminiChat({ provider, model: m, system, user, images }))).out
      : await openaiChat({ provider, model, system, user, images, temperature });
    try { return extractJson(text); } catch (_) {
      throw Object.assign(new Error(`${label} a répondu dans un format inattendu. Réessaie (ou change de modèle).`), { status: 502, friendly: true });
    }
  } catch (e) {
    throw wrap(e, label);
  }
}

// ---------- Générateurs d'images ----------
export function estimateCost(provider, model, nInputs) {
  const c = cfg().image;
  const r2k = c.resolution === '2k';
  if (provider === 'xai') return /image-2|2\.0/.test(model) ? (r2k ? 0.06 : 0.04) + 0.01 * nInputs : 0.02;
  if (provider === 'gemini') return /pro/.test(model) ? 0.134 : /2\.5/.test(model) ? 0.039 : r2k ? 0.05 : 0.034;
  if (provider === 'openai') return c.quality === 'low' ? 0.016 : c.quality === 'high' ? 0.25 : 0.063;
  return 0; // Google Cloud mode express : gratuit pendant l'essai de 90 jours.
}

function maxInputImages(provider, model) {
  if (provider === 'xai') return /image-2|2\.0/.test(model) ? 5 : 1;
  if (provider === 'gemini' || provider === 'vertex') return /lite/.test(model) ? 3 : 7;
  if (provider === 'openai') return 6;
  return 0;
}

async function blobFromResult(d) {
  if (d?.b64_json) return base64ToBlob(d.b64_json, d.mime_type || '');
  if (d?.url) return request(d.url, { method: 'GET', expect: 'blob', timeoutMs: 60000 });
  throw new ApiError(502, 'Aucune image dans la réponse');
}

async function finish(blob) {
  const mime = await sniffBlob(blob);
  return { blob: blob.type === mime ? blob : new Blob([blob], { type: mime }), mime };
}

async function xaiImage({ model, buildPrompt, refs, aspect = '16:9' }) {
  const key = requireKey('xai');
  const base = PROVIDERS.xai.url();
  const c = cfg().image;
  const headers = { Authorization: `Bearer ${key}` };
  const tag = (i) => `<IMAGE_${i}>`;
  const common = { model, n: 1, response_format: 'b64_json', aspect_ratio: aspect, resolution: c.resolution === '2k' ? '2k' : '1k' };
  if (/image-2|2\.0/.test(model) && ['low', 'medium'].includes(c.quality)) common.quality = c.quality;
  const toRef = async (r) => ({ url: await dataUrlOf(r), type: 'image_url' });
  const numbered = (list) => list.map((r, index) => ({ ...r, index }));
  let used = numbered(refs);
  let j;
  if (!used.length) {
    j = await request(`${base}/images/generations`, { headers, body: { ...common, prompt: buildPrompt([], null) } });
  } else {
    try {
      const body = used.length === 1
        ? { ...common, prompt: buildPrompt(used, tag), image: await toRef(used[0]) }
        : { ...common, prompt: buildPrompt(used, tag), images: await Promise.all(used.map(toRef)) };
      j = await request(`${base}/images/edits`, { headers, body });
    } catch (e) {
      if (used.length > 1 && (e.status === 400 || e.status === 422)) {
        used = numbered(refs.slice(0, 1));
        j = await request(`${base}/images/edits`, { headers, body: { ...common, prompt: buildPrompt(used, tag), image: await toRef(used[0]) } });
      } else throw e;
    }
  }
  const out = await finish(await blobFromResult(j.data?.[0]));
  const ticks = Number(j.usage?.cost_in_usd_ticks);
  const costUsd = Number.isFinite(ticks) && ticks > 0 ? ticks / 1e10 : estimateCost('xai', model, used.length);
  return { ...out, costUsd, prompt: buildPrompt(used, used.length ? tag : null), usedRefs: used.length };
}

async function geminiImage({ provider = 'gemini', model, buildPrompt, refs, aspect = '16:9' }) {
  const c = cfg().image;
  const tag = (i) => `reference image ${i + 1}`;
  const used = refs.map((r, index) => ({ ...r, index }));
  const prompt = buildPrompt(used, used.length ? tag : null);
  const parts = [];
  for (const [i, r] of used.entries()) {
    parts.push({ text: `Reference image ${i + 1}${r.label ? ` (${r.label})` : ''}:` });
    parts.push({ inlineData: { mimeType: r.mime, data: await blobToBase64(r.blob) } });
  }
  parts.push({ text: prompt });
  const imageConfig = { aspectRatio: aspect };
  const wants2k = c.resolution === '2k' && !/2\.5/.test(model);
  if (wants2k) imageConfig.imageSize = '2K';
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig } };
  let j;
  try {
    j = await geminiCall(provider, model, body, 240000);
  } catch (e) {
    if (e.status === 400 && wants2k) { delete imageConfig.imageSize; j = await geminiCall(provider, model, body, 240000); } else throw e;
  }
  const cand = j.candidates?.[0];
  const cparts = cand?.content?.parts || [];
  const imgs = cparts.filter((p) => (p.inlineData || p.inline_data) && !p.thought);
  const img = imgs[imgs.length - 1];
  if (!img) {
    const txt = cparts.filter((p) => p.text && !p.thought).map((p) => p.text).join(' ').trim();
    const reason = cand?.finishReason || j.promptFeedback?.blockReason || '';
    throw new ApiError(400, `Pas d'image renvoyée${reason ? ` (${reason})` : ''}${txt ? ` : ${txt.slice(0, 300)}` : ''}`);
  }
  const d = img.inlineData || img.inline_data;
  const out = await finish(base64ToBlob(d.data, d.mimeType || d.mime_type || ''));
  return { ...out, costUsd: estimateCost(provider, model, used.length), prompt, usedRefs: used.length };
}

async function openaiImage({ model, buildPrompt, refs, aspect = '16:9' }) {
  const key = requireKey('openai');
  const base = PROVIDERS.openai.url();
  const c = cfg().image;
  const headers = { Authorization: `Bearer ${key}` };
  const tag = (i) => `reference image ${i + 1}`;
  const used = refs.map((r, index) => ({ ...r, index }));
  const prompt = buildPrompt(used, used.length ? tag : null);
  const quality = ['low', 'medium', 'high'].includes(c.quality) ? c.quality : undefined;
  const size = aspect === '1:1' ? '1024x1024' : '1536x1024';
  let j;
  if (!used.length) {
    j = await request(`${base}/images/generations`, { headers, body: { model, prompt, size, n: 1, ...(quality ? { quality } : {}) } });
  } else {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('size', size);
    fd.append('n', '1');
    if (quality) fd.append('quality', quality);
    used.forEach((r, i) => fd.append('image[]', r.blob, `reference-${i + 1}.${r.mime === 'image/png' ? 'png' : 'jpg'}`));
    j = await request(`${base}/images/edits`, { headers, body: fd, timeoutMs: 240000 });
  }
  const out = await finish(await blobFromResult(j.data?.[0]));
  return { ...out, costUsd: estimateCost('openai', model, used.length), prompt, usedRefs: used.length };
}

/**
 * Crée une image. refs = [{role:'face'|'style'|'source', blob, mime, label}] (par ordre d'importance)
 * buildPrompt(refsUtilisées, tag) → texte du prompt.
 */
export async function makeImage({ buildPrompt, refs = [], demoHint = {}, aspect = '16:9' }) {
  const provider = cfg().image.provider;
  const label = PROVIDERS[provider]?.label || provider;
  try {
    let model = await resolveModel('image');
    const usable = refs.slice(0, maxInputImages(provider, model));
    let out;
    if (provider === 'xai') out = await xaiImage({ model, buildPrompt, refs: usable, aspect });
    else if (provider === 'gemini' || provider === 'vertex') {
      const r = await withModelFallback('image', provider, model, (m) => geminiImage({ provider, model: m, buildPrompt, refs: usable, aspect }));
      out = r.out;
      model = r.model;
    } else if (provider === 'openai') out = await openaiImage({ model, buildPrompt, refs: usable, aspect });
    else {
      const blob = await demo.makeImage(aspect === '1:1' ? { ...demoHint, width: 720, height: 720, subjectPosition: 'center' } : demoHint);
      out = { blob, mime: 'image/png', costUsd: 0, prompt: buildPrompt([], null), usedRefs: 0 };
    }
    return { ...out, provider, model: model || provider };
  } catch (e) {
    throw wrap(e, label);
  }
}

// ---------- Test de connexion ----------
export async function test(kind) {
  const c = cfg()[kind];
  const p = PROVIDERS[c.provider];
  if (!p) throw new Error('Fournisseur inconnu');
  if (c.provider === 'demo') return { ok: true, message: 'Mode démo : rien à tester, tout fonctionne sans IA.' };
  if (c.provider === 'vertex') {
    const model = await resolveModel(kind);
    const body = { contents: [{ role: 'user', parts: [{ text: 'Réponds juste : OK' }] }], generationConfig: kind === 'image' ? { responseModalities: ['TEXT'] } : {} };
    try {
      const r = await withModelFallback(kind, 'vertex', model, (m) => geminiCall('vertex', m, body, 30000));
      return {
        ok: true,
        message: `Clé Google Cloud valide ✓ (modèle : ${r.model}).${kind === 'image' ? ' Images gratuites pendant ton essai de 90 jours, dans la limite des quotas (aucune image générée pendant le test).' : ''}`,
      };
    } catch (e) {
      throw wrap(e, p.label);
    }
  }
  const list = await listModels(c.provider, kind);
  const ids = list.map((m) => m.id);
  const model = await resolveModel(kind);
  let warning = '';
  if (ids.length && !ids.includes(model)) {
    const suggestion = pickModel(c.provider, kind, ids);
    warning = `Le modèle « ${model} » n'apparaît pas dans la liste de ton compte.${suggestion ? ` Essaie « ${suggestion} ».` : ''}`;
  }
  if (kind === 'brain') {
    const r = await brainJson({ system: 'Réponds en JSON.', user: 'Réponds exactement {"ok": true}', temperature: 0 });
    if (!r || r.ok !== true) warning = warning || 'Réponse inattendue, mais la connexion fonctionne.';
    return { ok: true, message: `${p.label} répond ✓ (modèle : ${model}).`, warning };
  }
  if (c.provider === 'gemini' && !warning) warning = 'Avec une clé AI Studio, les images Gemini sont payantes : il faut activer la facturation (sinon erreur « quota »). Pour des images gratuites, choisis plutôt « Gemini · Google Cloud (mode express) » (90 jours offerts).';
  return { ok: true, message: `Clé ${p.label} valide ✓ (modèle : ${model}). Aucune image générée pendant le test, donc rien n'a été facturé.`, warning };
}

export function publicInfo() {
  return {
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, keyUrl: v.keyUrl || '', brain: v.brain, image: v.image }])),
    suggested: SUGGESTED,
    defaults: DEFAULT_MODELS,
    labels: Object.fromEntries([...VERTEX_MODELS.brain, ...VERTEX_MODELS.image]),
  };
}
