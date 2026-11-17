// Le « savoir-faire » du site : les consignes envoyées à l'IA.
// C'est ici que se joue la qualité des miniatures et l'apprentissage de ta DA.
import { normHex, clamp } from './util.js';

const FONTS = [
  ['Anton', 'condensée, ultra impactante (style vlog / divertissement)'],
  ['Bebas Neue', 'condensée élégante, tout en majuscules'],
  ['Montserrat', 'moderne, large et massive'],
  ['Archivo Black', 'très large et lourde'],
  ['Poppins', 'ronde et moderne'],
  ['Rubik', 'arrondie, sympathique'],
  ['Oswald', 'condensée classique'],
  ['Luckiest Guy', 'fun, cartoon'],
  ['Bangers', 'style bande dessinée'],
  ['Titan One', 'ronde, gaming / kids'],
  ['Permanent Marker', 'manuscrite au feutre'],
];
const FONT_NAMES = FONTS.map((f) => f[0]);
const POSITIONS = ['left', 'right', 'top', 'bottom', 'center'];

const SYSTEM = `Tu es un directeur artistique expert en miniatures YouTube à fort taux de clic (CTR). Tu travailles pour UNE seule chaîne et ton travail est d'apprendre et de respecter sa direction artistique (DA), puis de l'améliorer grâce aux retours du créateur.

Ce qui marche sur YouTube :
- Lisible en tout petit (sur mobile) : 1 sujet principal, 3 éléments maximum, fond simple.
- Contraste fort, couleurs saturées, sujet bien détaché du fond (lumière de contour, arrière-plan flou ou épuré).
- Émotion immédiatement lisible : visage très expressif quand la chaîne montre des visages, regard caméra ou vers l'objet clé.
- Curiosité : la miniature montre l'enjeu ou le résultat sans tout révéler. Elle COMPLÈTE le titre, elle ne le répète pas.
- Texte : 0 à 4 mots, énormes, épais, avec contour ; jamais le titre en entier.
- Composition : règle des tiers, une zone dégagée pour le texte, rien d'important en bas à droite (la durée de la vidéo s'affiche là).
- Cohérence : mêmes couleurs, typo, cadrage et énergie d'une vidéo à l'autre, pour que la chaîne soit reconnaissable.

Tu réponds TOUJOURS uniquement en JSON valide, sans texte autour.`;

function channelBlock(channel) {
  const c = channel || {};
  const lines = [];
  if (c.name) lines.push(`Nom : ${c.name}`);
  if (c.niche) lines.push(`Thème / niche : ${c.niche}`);
  if (c.audience) lines.push(`Public cible : ${c.audience}`);
  if (c.tone) lines.push(`Ton / ambiance voulue : ${c.tone}`);
  return lines.length ? lines.join('\n') : '(pas encore renseigné)';
}

function compactDA(da) {
  if (!da) return '(aucune DA définie pour l\'instant : propose un style efficace et cohérent)';
  const { summary, mood, palette, composition, subject, background, lighting, textStyle, recurring, avoid, typography, imageStyle, learned } = da;
  return JSON.stringify({ summary, mood, palette, composition, subject, background, lighting, textStyle, recurring, avoid, typography, imageStyle, learned }, null, 1);
}

// ---------- 1. Analyse des miniatures de référence ----------
function analyzePrompt(refs, channel) {
  const lines = refs.map((r, i) => {
    const bits = [`Image ${i + 1} : ${r.kind === 'mine' ? 'miniature DE LA CHAÎNE' : 'miniature d\'INSPIRATION (autre chaîne)'}`];
    if (r.title) bits.push(`titre de la vidéo : « ${r.title} »`);
    if (r.palette?.length) bits.push(`couleurs dominantes mesurées : ${r.palette.join(', ')}`);
    return '- ' + bits.join(' | ');
  });
  return `Chaîne :
${channelBlock(channel)}

Voici ${refs.length} miniature(s) :
${lines.join('\n')}

Analyse chaque miniature comme un directeur artistique : qu'est-ce qui crée son style et son efficacité ? Sois précis et concret (couleurs exactes, placement, taille du texte, expression, type de fond...).

Réponds en JSON :
{"analyses":[{"image":1,"description":"ce qu'on voit en 1 phrase","composition":"placement du sujet, du texte, cadrage","sujet":"qui/quoi, expression, cadrage","emotion":"émotion principale","fond":"type de fond","lumiere":"type d'éclairage, contraste","texte":{"present":true,"contenu":"texte lu sur l'image","nbMots":3,"style":"police, couleurs, contour, effets","position":"gauche/droite/haut/bas"},"couleurs":["#RRGGBB"],"elementsGraphiques":"flèches, cercles, emojis, logos...","pointsForts":"ce qui la rend efficace","note":7}]}`;
}

// ---------- 2. Synthèse de la DA ----------
const DA_SCHEMA = `{
 "summary": "2-3 phrases qui résument la DA de la chaîne",
 "mood": "ambiance / énergie",
 "palette": [{"hex":"#RRGGBB","role":"fond | accent | texte | sujet"}],
 "composition": "règles de composition récurrentes",
 "subject": "comment le sujet / le créateur est montré (cadrage, expressions)",
 "background": "types de fonds",
 "lighting": "éclairage et traitement de l'image",
 "textStyle": "règles du texte (nb de mots, ton, placement, effets)",
 "recurring": "éléments graphiques récurrents (flèches, cercles, logo, emojis...)",
 "avoid": "ce qu'il faut éviter",
 "typography": {"font":"une police de la liste","fill":"#RRGGBB","stroke":"#RRGGBB","strokeWidth":10,"accent":"#RRGGBB","uppercase":true,"maxWords":4,"position":"left|right|top|bottom|center","box":false,"boxColor":"#RRGGBB"},
 "imageStyle": "EN ANGLAIS : 40 à 70 mots-clés de style pour un générateur d'images (rendu, couleurs, lumière, cadrage, niveau de détail). Ne parle pas de texte.",
 "learned": ["préférences apprises du créateur, règles courtes et actionnables"]
}`;

function synthesizePrompt(refs, channel, prevDA) {
  const mine = refs.filter((r) => r.kind === 'mine');
  const insp = refs.filter((r) => r.kind !== 'mine');
  const fmt = (r, i) => {
    const a = r.analysis || {};
    const t = a.texte || {};
    return `#${i + 1}${r.pinned ? ' ⭐(modèle préféré)' : ''}${r.title ? ` « ${r.title} »` : ''}
  couleurs mesurées : ${(r.palette || []).join(', ') || '?'}
  ${a.description || ''} | composition : ${a.composition || '?'} | sujet : ${a.sujet || '?'} | émotion : ${a.emotion || '?'} | fond : ${a.fond || '?'} | lumière : ${a.lumiere || '?'}
  texte : ${t.present === false ? 'aucun' : `${t.contenu || '?'} (${t.nbMots ?? '?'} mots, ${t.style || '?'}, ${t.position || '?'})`} | graphismes : ${a.elementsGraphiques || '-'} | points forts : ${a.pointsForts || '-'}`;
  };
  return `Chaîne :
${channelBlock(channel)}

Miniatures DE LA CHAÎNE (c'est la DA à respecter en priorité) :
${mine.length ? mine.map(fmt).join('\n') : '(aucune)'}

Miniatures d'INSPIRATION (styles que le créateur aime, à intégrer sans copier) :
${insp.length ? insp.map(fmt).join('\n') : '(aucune)'}

${prevDA ? `DA actuelle (à faire évoluer, garde ses "learned" sauf contradiction claire) :\n${compactDA(prevDA)}\n` : ''}
Les images jointes sont quelques-unes de ces références.

Déduis-en la direction artistique complète de la chaîne. Sois concret et spécifique à CETTE chaîne (pas de généralités).
Contraintes :
- "typography.font" DOIT être exactement une de ces polices : ${FONTS.map(([n, d]) => `${n} (${d})`).join(' ; ')}. Choisis celle qui ressemble le plus au texte des miniatures.
- Couleurs au format #RRGGBB, en t'appuyant sur les couleurs mesurées.
- "imageStyle" en anglais.

Réponds en JSON avec exactement cette structure :
${DA_SCHEMA}`;
}

// ---------- 3. Idées de miniatures ----------
function describeExample(g) {
  const bits = [`titre « ${g.input?.title || '?'} »`];
  if (g.concept?.text) bits.push(`texte « ${g.concept.text} »`);
  if (g.concept?.angle) bits.push(`angle « ${g.concept.angle} »`);
  if (g.concept?.scene) bits.push(`image : ${g.concept.scene}`);
  if (g.comment) bits.push(`son commentaire : « ${g.comment} »`);
  return '- ' + bits.join(' | ');
}

function pickExamples(generations) {
  const rated = generations.filter((g) => g.rating || g.final);
  const score = (g) => (g.final ? 2.5 : 0) + (g.rating || 0);
  const loved = rated.filter((g) => score(g) >= 2).sort((a, b) => score(b) - score(a) || (b.ratedAt || '').localeCompare(a.ratedAt || '')).slice(0, 6);
  const hated = rated.filter((g) => g.rating < 0).sort((a, b) => (b.ratedAt || '').localeCompare(a.ratedAt || '')).slice(0, 4);
  return { loved, hated };
}

function conceptsPrompt({ input, da, channel, examples, hasFace, count }) {
  const maxWords = clamp(da?.typography?.maxWords || 4, 1, 8);
  return `Chaîne :
${channelBlock(channel)}

DA de la chaîne (à respecter) :
${compactDA(da)}

${examples.loved.length ? `Miniatures que le créateur a ADORÉES (inspire-toi de ce qui lui plaît) :\n${examples.loved.map(describeExample).join('\n')}\n` : ''}${examples.hated.length ? `Miniatures qu'il a REJETÉES (ne refais pas ces erreurs) :\n${examples.hated.map(describeExample).join('\n')}\n` : ''}
NOUVELLE VIDÉO
- Titre : « ${input.title} »
- Ce qui se passe dans la vidéo : ${input.idea || '(non précisé : déduis-le du titre)'}
- Éléments imposés : ${input.constraints || '(aucun)'}
- Le créateur apparaît dans la miniature : ${hasFace ? 'OUI (on a des photos du créateur : c\'est le sujet principal, avec une expression forte)' : 'non (pas de photo du créateur : sujet = objet, scène, personnage générique...)'}
- Texte : ${input.textMode === 'image' ? 'dessiné directement par le générateur d\'images' : 'ajouté APRÈS par le site → l\'image ne doit contenir AUCUN texte'}

Propose ${count} concept(s) de miniature TRÈS différents entre eux (ex : émotion/visage, résultat/objet, avant-après ou contraste, mystère/curiosité, chiffre/enjeu...), tous fidèles à la DA et aux préférences apprises.

Règles :
- "text" : en français, 1 à ${maxWords} mots, percutant, qui complète le titre sans le répéter. Tu peux entourer UN mot important d'astérisques pour le mettre dans la couleur d'accent (ex : "J'AI *GAGNÉ*"). Texte vide "" si une miniature sans texte est plus forte.
- "imagePrompt" : en ANGLAIS, 60 à 120 mots, très visuel et précis : sujet, expression, action, objet clé, fond, lumière, couleurs, cadrage, profondeur de champ. ${input.textMode === 'image' ? '' : 'Ne demande JAMAIS de texte, lettres ou chiffres dans l\'image.'}
- "subjectPosition" et "textPosition" ne doivent pas se chevaucher (ex : sujet à droite, texte à gauche).

Réponds en JSON :
{"concepts":[{"angle":"nom court de l'idée","why":"pourquoi ça va donner envie de cliquer (1 phrase)","text":"TEXTE","textPosition":"left|right|top|bottom|center","subjectPosition":"left|right|center","emotion":"émotion principale","scene":"description de l'image en français (1-2 phrases)","imagePrompt":"English prompt..."}]}`;
}

// ---------- 4. Apprentissage à partir des retours ----------
function learnPrompt({ da, channel, loved, liked, hated, imageLabels }) {
  return `Chaîne :
${channelBlock(channel)}

DA actuelle :
${compactDA(da)}

Retours du créateur sur les dernières miniatures générées :
🏆/❤️ ADORÉES :
${loved.length ? loved.map(describeExample).join('\n') : '(aucune)'}
👍 CORRECTES :
${liked.length ? liked.map(describeExample).join('\n') : '(aucune)'}
👎 REJETÉES :
${hated.length ? hated.map(describeExample).join('\n') : '(aucune)'}
${imageLabels.length ? `\nImages jointes : ${imageLabels.map((l, i) => `Image ${i + 1} = ${l}`).join(' ; ')}.` : ''}

Mets à jour la DA pour qu'elle colle encore mieux aux goûts du créateur :
- garde ce qui plaît, corrige ce qui est rejeté (en tenant compte de ses commentaires) ;
- fais évoluer la DA progressivement, ne change pas tout ;
- "learned" : 12 règles maximum, courtes, concrètes et actionnables ("Toujours...", "Éviter...", "Préférer..."), fusionne les doublons ;
- "typography.font" doit rester une police de la liste : ${FONT_NAMES.join(', ')}.

Réponds en JSON avec la même structure que la DA :
${DA_SCHEMA.replace(/\n}$/, ',\n "changelog": ["ce qui a changé et pourquoi, en 1 phrase chacun"]\n}')}`;
}

// ---------- Normalisation (on ne fait jamais confiance aveuglément au JSON de l'IA) ----------
function str(v, max = 1200) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.join(', ');
  if (typeof v === 'object') v = JSON.stringify(v);
  return String(v).trim().slice(0, max);
}

function normalizeDA(raw, prev) {
  const r = raw && typeof raw === 'object' ? (raw.da && typeof raw.da === 'object' ? raw.da : raw) : {};
  const p = prev || {};
  const pt = p.typography || {};
  const t = r.typography && typeof r.typography === 'object' ? r.typography : {};
  let palette = Array.isArray(r.palette) ? r.palette : [];
  palette = palette.map((c) => (typeof c === 'string' ? { hex: normHex(c), role: '' } : { hex: normHex(c?.hex), role: str(c?.role, 60) }))
    .filter((c) => c.hex).slice(0, 8);
  if (!palette.length && Array.isArray(p.palette)) palette = p.palette;
  const font = FONT_NAMES.find((f) => f.toLowerCase() === String(t.font || '').toLowerCase()) || pt.font || 'Anton';
  const learned = (Array.isArray(r.learned) ? r.learned : Array.isArray(p.learned) ? p.learned : [])
    .map((x) => str(x, 200)).filter(Boolean).slice(0, 12);
  return {
    summary: str(r.summary) || p.summary || '',
    mood: str(r.mood) || p.mood || '',
    palette,
    composition: str(r.composition) || p.composition || '',
    subject: str(r.subject) || p.subject || '',
    background: str(r.background) || p.background || '',
    lighting: str(r.lighting) || p.lighting || '',
    textStyle: str(r.textStyle) || p.textStyle || '',
    recurring: str(r.recurring) || p.recurring || '',
    avoid: str(r.avoid) || p.avoid || '',
    typography: {
      font,
      fill: normHex(t.fill) || pt.fill || '#FFFFFF',
      stroke: normHex(t.stroke) || pt.stroke || '#000000',
      strokeWidth: clamp(t.strokeWidth ?? pt.strokeWidth ?? 10, 0, 40),
      accent: normHex(t.accent) || pt.accent || '#FFD400',
      uppercase: typeof t.uppercase === 'boolean' ? t.uppercase : pt.uppercase !== false,
      maxWords: clamp(t.maxWords ?? pt.maxWords ?? 4, 1, 8),
      position: POSITIONS.includes(t.position) ? t.position : (pt.position || 'left'),
      box: typeof t.box === 'boolean' ? t.box : !!pt.box,
      boxColor: normHex(t.boxColor) || pt.boxColor || '#E10600',
    },
    imageStyle: str(r.imageStyle, 900) || p.imageStyle || '',
    learned,
  };
}

function normalizeConcepts(raw, count, input) {
  let list = Array.isArray(raw) ? raw : Array.isArray(raw?.concepts) ? raw.concepts : [];
  list = list.filter((c) => c && typeof c === 'object').slice(0, count).map((c) => {
    const subj = ['left', 'right', 'center'].includes(c.subjectPosition) ? c.subjectPosition : 'right';
    let tp = POSITIONS.includes(c.textPosition) ? c.textPosition : (subj === 'left' ? 'right' : 'left');
    if (tp === subj && subj !== 'center') tp = subj === 'left' ? 'right' : 'left';
    return {
      angle: str(c.angle, 80) || 'Idée',
      why: str(c.why, 300),
      text: str(c.text, 80).replace(/^["«»“”\s]+|["«»“”\s]+$/g, ''),
      textPosition: tp,
      subjectPosition: subj,
      emotion: str(c.emotion, 60) || 'surprise',
      scene: str(c.scene, 400),
      imagePrompt: str(c.imagePrompt, 1500) || str(c.scene, 400) || input.title,
    };
  });
  if (!list.length) throw new Error("L'IA n'a proposé aucune idée exploitable. Réessaie.");
  return list;
}

// ---------- Prompts pour le générateur d'images (en anglais) ----------
const SIDE = { left: 'left', right: 'right', center: 'center', top: 'top', bottom: 'bottom' };

function plainText(t) { return String(t || '').replace(/\*/g, ''); }

function refsLines(refs, tag, emotion) {
  if (!tag || !refs.length) return [];
  const lines = [];
  const faces = refs.filter((r) => r.role === 'face');
  const styles = refs.filter((r) => r.role === 'style');
  if (faces.length) {
    lines.push(`The person shown in ${faces.map((f) => tag(f.index)).join(' and ')} is the YouTuber: feature this exact same person, keep their real face identity, facial features, hairstyle, skin tone and age (do not beautify or change the face)${emotion ? `, with a strong, exaggerated "${emotion}" facial expression` : ''}.`);
  }
  if (styles.length) {
    lines.push(`Use ${styles.map((s) => tag(s.index)).join(', ')} only as STYLE references from the same channel (color grading, lighting, contrast, rendering, energy). Do not copy their subjects, layout details or any text.`);
  }
  return lines;
}

function buildImagePrompt({ concept, da, textMode, refs = [], tag = null }) {
  const lines = ['YouTube video thumbnail, 16:9 landscape format. Bold, eye-catching, high contrast, crisp details, readable even at small size, professional quality.'];
  lines.push(concept.imagePrompt || concept.scene || '');
  if (da?.imageStyle) lines.push(`Channel visual style: ${da.imageStyle}`);
  const pal = (da?.palette || []).map((p) => p.hex).filter(Boolean).slice(0, 5);
  if (pal.length) lines.push(`Color palette: ${pal.join(', ')}.`);
  const subj = SIDE[concept.subjectPosition] || 'right';
  const textSide = SIDE[concept.textPosition] || (subj === 'left' ? 'right' : 'left');
  if (textMode === 'image' && plainText(concept.text)) {
    const ty = da?.typography || {};
    lines.push(`Composition: main subject on the ${subj} side.`);
    lines.push(`Write the text "${plainText(concept.text)}" in huge, thick, bold letters with a strong dark outline, on the ${textSide} side, perfectly spelled (French), main color ${ty.fill || '#FFFFFF'}${ty.accent ? ` with accent color ${ty.accent}` : ''}. No other text.`);
  } else {
    lines.push(`Composition: main subject on the ${subj} side; keep a clean, uncluttered area on the ${textSide} side where a title will be added later. Nothing important in the bottom-right corner.`);
    lines.push('IMPORTANT: no text, no letters, no numbers, no captions, no logos and no watermark anywhere in the image.');
  }
  lines.push(...refsLines(refs, tag, concept.emotion));
  return lines.filter(Boolean).join('\n');
}

function buildEditPrompt({ instruction, textMode, refs = [], tag = null }) {
  const src = refs.find((r) => r.role === 'source');
  const target = tag && src ? tag(src.index) : 'this image';
  const lines = [
    `Edit ${target} (a YouTube thumbnail). Requested change: ${instruction}`,
    'Keep everything else as close as possible to the original (subject, composition, colors, style) and keep the 16:9 landscape format.',
  ];
  const wantsText = /texte|écri|ecri|\btext\b|lettre|mot\b/i.test(instruction);
  if (textMode !== 'image' && !wantsText) lines.push('Do not add any text, letters or watermark.');
  const faces = refs.filter((r) => r.role === 'face');
  if (tag && faces.length) lines.push(`The person in ${faces.map((f) => tag(f.index)).join(' and ')} is the YouTuber: keep their exact face identity.`);
  return lines.join('\n');
}

function negativePrompt(textMode) {
  return `${textMode === 'image' ? '' : 'text, letters, words, captions, '}watermark, logo, signature, blurry, lowres, jpeg artifacts, deformed face, extra fingers, bad anatomy, dull colors`;
}

export {
  SYSTEM, FONTS, FONT_NAMES,
  analyzePrompt, synthesizePrompt, conceptsPrompt, learnPrompt, pickExamples,
  normalizeDA, normalizeConcepts, buildImagePrompt, buildEditPrompt, negativePrompt, plainText,
};
