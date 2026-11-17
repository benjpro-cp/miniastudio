// Outils image côté navigateur : chargement, recadrage 16:9, compression, couleurs dominantes.

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = src;
  });
}

export async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Recadre au centre pour remplir exactement w×h (comme object-fit: cover).
export function coverDataUrl(img, w, h, type = 'image/jpeg', q = 0.88) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c.toDataURL(type, q);
}

// Réduit sans recadrer (le plus grand côté ≤ max).
export function fitDataUrl(img, max, type = 'image/jpeg', q = 0.9) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = canvas(img.width * s, img.height * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, q);
}

const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

// Couleurs dominantes (k-means simplifié sur une version réduite de l'image).
export function extractPalette(img, k = 5) {
  const c = canvas(96, 54);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) px.push([data[i], data[i + 1], data[i + 2]]);
  if (!px.length) return [];
  // Initialisation k-means++ (déterministe)
  const centers = [px[Math.floor(px.length / 2)]];
  while (centers.length < k) {
    let best = null, bestD = -1;
    for (let i = 0; i < px.length; i += 7) {
      const p = px[i];
      const d = Math.min(...centers.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2));
      if (d > bestD) { bestD = d; best = p; }
    }
    centers.push([...best]);
  }
  const counts = new Array(k).fill(0);
  for (let it = 0; it < 8; it++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts.fill(0);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        const c = centers[j];
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bd) { bd = d; bi = j; }
      }
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; counts[bi]++;
    }
    for (let j = 0; j < k; j++) if (counts[j]) centers[j] = sums[j].map((s) => s / counts[j]);
  }
  return centers
    .map((c, j) => ({ hex: toHex(...c), n: counts[j] }))
    .filter((c) => c.n > px.length * 0.03)
    .sort((a, b) => b.n - a.n)
    .map((c) => c.hex);
}

// Prépare une miniature de référence : 1280×720 + aperçu 640×360 + couleurs.
export function prepareThumbnail(img) {
  return {
    dataUrl: coverDataUrl(img, 1280, 720, 'image/jpeg', 0.9),
    thumbDataUrl: coverDataUrl(img, 640, 360, 'image/jpeg', 0.85),
    palette: extractPalette(img),
  };
}

// Prépare une photo du créateur (pas de recadrage, juste réduite).
export function preparePhoto(img) {
  const s = Math.min(img.width, img.height);
  const c = canvas(240, 240);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 240, 240);
  return { dataUrl: fitDataUrl(img, 1024, 'image/jpeg', 0.9), thumbDataUrl: c.toDataURL('image/jpeg', 0.85) };
}

// Export JPEG sous la limite YouTube (2 Mo).
export async function canvasToJpegUnder(c, maxBytes = 2 * 1024 * 1024) {
  let q = 0.95;
  for (;;) {
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob.size <= maxBytes || q <= 0.5) return blob;
    q -= 0.07;
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
