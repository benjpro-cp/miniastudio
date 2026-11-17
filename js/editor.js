// Éditeur de miniature : déplacer/modifier les textes, retoucher l'image, exporter pour YouTube.
import { W, H, FONTS, DEFAULT_ADJUST, BOOST_ADJUST, renderThumbnail, drawBackground, drawLayer, hitTest, newLayer, layersFor, cleanLayers, imageRect, supportsFilter } from './render.js';
import { canvasToJpegUnder, blobToDataUrl } from './img.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Editor {
  constructor({ getImage, getDA, onSave, onExport, onPreview, onRetouch, onDownload, toast }) {
    Object.assign(this, { getImage, getDA, onSave, onExport, onPreview, onRetouch, onDownload, toast });
    this.modal = document.getElementById('editor');
    this.canvas = document.getElementById('ed-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.panel = document.getElementById('ed-panel');
    this.titleEl = document.getElementById('ed-title');
    this.guides = { thirds: false, duration: true };
    this.bg = document.createElement('canvas');
    this.bg.width = W;
    this.bg.height = H;
    this.bgKey = '';
    this.bindStatic();
  }

  get open() { return !this.modal.hidden; }
  get selected() { return this.layers.find((l) => l.id === this.sel) || null; }

  async show(gen) {
    try {
      this.img = await this.getImage(gen);
    } catch (_) {
      this.toast('Impossible d\'ouvrir cette image (fichier supprimé ?).', 'err');
      return;
    }
    this.gen = gen;
    this.layers = clone(layersFor(gen, this.getDA()));
    this.adjust = { ...DEFAULT_ADJUST, ...(gen.adjust || {}) };
    this.sel = this.layers[0]?.id || null;
    this.bgKey = '';
    this.titleEl.textContent = gen.input?.title || 'Miniature';
    this.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    this.renderPanel();
    this.draw();
  }

  close() {
    if (!this.open) return;
    this.flushSave();
    this.modal.hidden = true;
    document.body.style.overflow = '';
  }

  // ---------- Dessin ----------
  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      const key = JSON.stringify(this.adjust) + (this.img?.src || '');
      if (key !== this.bgKey) {
        drawBackground(this.bg.getContext('2d'), this.img, this.adjust);
        this.bgKey = key;
      }
      renderThumbnail(this.ctx, { img: this.img, layers: this.layers, adjust: this.adjust, bgCache: this.bg });
      this.drawOverlays();
    });
  }

  drawOverlays() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.width / W, 0, 0);
    if (this.guides.thirds) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      for (const x of [W / 3, (2 * W) / 3]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (const y of [H / 3, (2 * H) / 3]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (this.guides.duration) {
      // Le badge de durée que YouTube affiche en bas à droite.
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      const bw = 112, bh = 44, bx = W - bw - 14, by = H - bh - 14;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 8) : ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('12:34', bx + bw / 2, by + bh / 2 + 1);
    }
    const L = this.selected;
    if (L && L._bounds) {
      ctx.translate(L.x, L.y);
      ctx.rotate(((L.rotation || 0) * Math.PI) / 180);
      ctx.strokeStyle = '#3ea6ff';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(-L._bounds.w / 2, -L._bounds.h / 2, L._bounds.w, L._bounds.h);
    }
    ctx.restore();
  }

  // ---------- Souris / clavier ----------
  toCanvas(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  bindStatic() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      const p = this.toCanvas(e);
      const hit = [...this.layers].reverse().find((L) => hitTest(L, p));
      if (hit) {
        if (this.sel !== hit.id) { this.sel = hit.id; this.renderPanel(); }
        this.drag = { type: 'layer', L: hit, dx: p.x - hit.x, dy: p.y - hit.y };
      } else {
        if (this.sel) { this.sel = null; this.renderPanel(); }
        this.drag = { type: 'pan', sx: p.x, sy: p.y, px: this.adjust.panX || 0, py: this.adjust.panY || 0 };
      }
      c.setPointerCapture(e.pointerId);
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.toCanvas(e);
      if (!this.drag) {
        c.style.cursor = this.layers.some((L) => hitTest(L, p)) ? 'move' : 'grab';
        return;
      }
      if (this.drag.type === 'layer') {
        const L = this.drag.L;
        let x = Math.max(0, Math.min(W, p.x - this.drag.dx));
        let y = Math.max(0, Math.min(H, p.y - this.drag.dy));
        if (Math.abs(x - W / 2) < 10) x = W / 2; // aimant au centre
        if (Math.abs(y - H / 2) < 10) y = H / 2;
        L.x = Math.round(x);
        L.y = Math.round(y);
      } else if (this.img) {
        const r = imageRect(this.img, this.adjust);
        if (r.mx > 0) this.adjust.panX = Math.max(-1, Math.min(1, this.drag.px + (p.x - this.drag.sx) / r.mx));
        if (r.my > 0) this.adjust.panY = Math.max(-1, Math.min(1, this.drag.py + (p.y - this.drag.sy) / r.my));
      }
      this.draw();
    });
    const end = () => { if (this.drag) { this.drag = null; this.scheduleSave(); } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      const p = this.toCanvas(e);
      const hit = [...this.layers].reverse().find((L) => hitTest(L, p));
      if (hit) {
        this.sel = hit.id;
        this.renderPanel();
        const ta = this.panel.querySelector('[data-f="text"]');
        if (ta) { ta.focus(); ta.select(); }
      }
    });

    this.modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ed]');
      if (!b) return;
      const act = b.dataset.ed;
      if (act === 'close') this.close();
      if (act === 'download') this.download();
      if (act === 'final') this.exportFinal(b);
      if (act === 'preview') this.preview();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.open || !document.getElementById('preview').hidden) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape') { if (typing) document.activeElement.blur(); else this.close(); return; }
      if (typing) return;
      const L = this.selected;
      if (!L) return;
      const step = e.shiftKey ? 10 : 2;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        L.x += moves[e.key][0];
        L.y += moves[e.key][1];
        this.draw();
        this.scheduleSave();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.removeLayer(L.id);
      }
    });
  }

  // ---------- Panneau de réglages ----------
  renderPanel() {
    const L = this.selected;
    const a = this.adjust;
    const fontOpts = FONTS.map((f) => `<option value="${esc(f.name)}" style="font-family:'${esc(f.name)}';font-weight:${f.weight}" ${L?.font === f.name ? 'selected' : ''}>${esc(f.name)} — ${esc(f.desc)}</option>`).join('');
    const slider = (f, label, min, max, step, val, src = 'layer') =>
      `<label>${label} <span class="hint" data-v="${f}">${src === 'adj' && f !== 'vignette' && f !== 'zoom' ? Math.round(val * 100) + '%' : Math.round(val * 100) / 100}</span>
        <input type="range" data-${src === 'adj' ? 'a' : 'f'}="${f}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
    this.panel.innerHTML = `
      <section>
        <h3>Textes</h3>
        <div class="layer-list">
          ${this.layers.map((l) => `<button class="btn small ${l.id === this.sel ? 'on' : ''}" data-layer="${l.id}">${esc(String(l.text || '…').replace(/\*/g, '').slice(0, 18) || '…')}</button>`).join('')}
          <button class="btn small" data-act="add">➕ Texte</button>
        </div>
        ${L ? `
          <label>Texte <span class="hint">— entoure un mot avec *étoiles* pour la couleur d'accent</span>
            <textarea data-f="text" rows="2">${esc(L.text)}</textarea></label>
          <label>Police <select class="font-select" data-f="font">${fontOpts}</select></label>
          ${slider('size', 'Taille', 30, 280, 1, L.size)}
          ${slider('maxWidth', 'Largeur avant retour à la ligne', 150, 1260, 10, L.maxWidth)}
          <div class="colors">
            <label>Texte<input type="color" data-f="fill" value="${L.fill}"></label>
            <label>Accent<input type="color" data-f="accent" value="${L.accent}"></label>
            <label>Contour<input type="color" data-f="stroke" value="${L.stroke}"></label>
          </div>
          ${slider('strokeWidth', 'Épaisseur du contour', 0, 30, 1, L.strokeWidth)}
          ${slider('rotation', 'Inclinaison', -20, 20, 1, L.rotation)}
          <div class="row tight">
            <label class="toggle"><input type="checkbox" data-f="uppercase" ${L.uppercase ? 'checked' : ''}> Majuscules</label>
            <label class="toggle"><input type="checkbox" data-f="shadow" ${L.shadow ? 'checked' : ''}> Ombre</label>
          </div>
          <div class="row tight">
            <label class="toggle"><input type="checkbox" data-f="box" ${L.box ? 'checked' : ''}> Fond coloré</label>
            <input type="color" data-f="boxColor" value="${L.boxColor}" title="Couleur du fond">
          </div>
          <div class="seg">
            <button class="btn small ${L.align === 'left' ? 'on' : ''}" data-align="left">⇤ Gauche</button>
            <button class="btn small ${L.align === 'center' ? 'on' : ''}" data-align="center">↔ Centre</button>
            <button class="btn small ${L.align === 'right' ? 'on' : ''}" data-align="right">⇥ Droite</button>
          </div>
          <div class="row tight mt">
            <button class="btn small" data-act="dup">⧉ Dupliquer</button>
            <button class="btn small danger" data-act="del">🗑️ Supprimer</button>
          </div>` : '<p class="hint">Clique sur un texte de la miniature pour le modifier.</p>'}
      </section>
      <section>
        <h3>Image</h3>
        ${supportsFilter ? `
        ${slider('brightness', 'Luminosité', 0.6, 1.5, 0.01, a.brightness, 'adj')}
        ${slider('contrast', 'Contraste', 0.6, 1.7, 0.01, a.contrast, 'adj')}
        ${slider('saturate', 'Saturation', 0, 2, 0.01, a.saturate, 'adj')}` : '<p class="hint">Les réglages de couleur nécessitent Chrome, Edge ou Firefox.</p>'}
        ${slider('vignette', 'Vignettage (bords sombres)', 0, 0.8, 0.01, a.vignette, 'adj')}
        ${slider('zoom', 'Zoom (glisse l\'image pour recadrer)', 1, 2.5, 0.01, a.zoom, 'adj')}
        <div class="row tight">
          <button class="btn small" data-act="boost">✨ Boost YouTube</button>
          <button class="btn small" data-act="reset">↺ Réinitialiser</button>
        </div>
      </section>
      <section>
        <h3>Retouche par l'IA</h3>
        <textarea data-retouch rows="2" placeholder="Ex : fond plus rouge, moi plus choqué, ajoute de la fumée…"></textarea>
        <button class="btn small mt" data-act="retouch">🪄 Retoucher l'image</button>
        <p class="hint">Crée une nouvelle version de l'image en gardant tes textes.</p>
      </section>
      <section>
        <h3>Affichage</h3>
        <label class="toggle"><input type="checkbox" data-guide="duration" ${this.guides.duration ? 'checked' : ''}> Badge de durée YouTube</label>
        <label class="toggle"><input type="checkbox" data-guide="thirds" ${this.guides.thirds ? 'checked' : ''}> Grille des tiers</label>
      </section>`;

    this.panel.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.layer) { this.sel = b.dataset.layer; this.renderPanel(); this.draw(); return; }
      if (b.dataset.align && this.selected) { this.selected.align = b.dataset.align; this.renderPanel(); this.changed(); return; }
      const act = b.dataset.act;
      if (act === 'add') this.addLayer();
      if (act === 'dup' && this.selected) this.addLayer({ ...clone(this.selected), id: undefined, x: this.selected.x + 30, y: this.selected.y + 30 });
      if (act === 'del' && this.selected) this.removeLayer(this.selected.id);
      if (act === 'boost') { Object.assign(this.adjust, BOOST_ADJUST); this.renderPanel(); this.changed(); }
      if (act === 'reset') { this.adjust = { ...DEFAULT_ADJUST }; this.renderPanel(); this.changed(); }
      if (act === 'retouch') this.retouch(b);
    };
    this.panel.oninput = (e) => {
      const el = e.target;
      if (el.dataset.guide) { this.guides[el.dataset.guide] = el.checked; this.draw(); return; }
      if (el.dataset.a) {
        this.adjust[el.dataset.a] = parseFloat(el.value);
        const v = this.panel.querySelector(`[data-v="${el.dataset.a}"]`);
        if (v) v.textContent = el.dataset.a === 'vignette' || el.dataset.a === 'zoom' ? (+el.value).toFixed(2) : Math.round(el.value * 100) + '%';
        this.changed();
        return;
      }
      const L = this.selected;
      const f = el.dataset.f;
      if (!L || !f) return;
      if (el.type === 'checkbox') L[f] = el.checked;
      else if (el.type === 'range') {
        L[f] = parseFloat(el.value);
        const v = this.panel.querySelector(`[data-v="${f}"]`);
        if (v) v.textContent = el.value;
      } else L[f] = el.value;
      if (f === 'text') {
        const btn = this.panel.querySelector(`[data-layer="${L.id}"]`);
        if (btn) btn.textContent = String(L.text || '…').replace(/\*/g, '').slice(0, 18) || '…';
      }
      this.changed();
    };
    this.panel.onchange = this.panel.oninput;
  }

  addLayer(over = {}) {
    const t = this.getDA()?.typography || {};
    const L = newLayer({
      font: t.font || 'Anton', fill: t.fill || '#FFFFFF', accent: t.accent || '#FFD400', stroke: t.stroke || '#000000',
      strokeWidth: t.strokeWidth ?? 10, uppercase: t.uppercase !== false, x: W / 2, y: H / 2,
      ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)),
    });
    if (!over.id) L.id = newLayer().id;
    this.layers.push(L);
    this.sel = L.id;
    this.renderPanel();
    this.changed();
  }

  removeLayer(id) {
    this.layers = this.layers.filter((l) => l.id !== id);
    this.sel = this.layers[0]?.id || null;
    this.renderPanel();
    this.changed();
  }

  changed() {
    this.draw();
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 700);
  }

  flushSave() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.onSave(this.gen, cleanLayers(this.layers), { ...this.adjust });
  }

  // ---------- Exports ----------
  compose(width = W) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round((width * H) / W);
    renderThumbnail(c.getContext('2d'), { img: this.img, layers: this.layers, adjust: this.adjust });
    return c;
  }

  async download() {
    const blob = await canvasToJpegUnder(this.compose());
    this.onDownload(this.gen, blob);
  }

  async exportFinal(btn) {
    btn.disabled = true;
    try {
      this.flushSave();
      const blob = await canvasToJpegUnder(this.compose());
      await this.onExport(this.gen, await blobToDataUrl(blob), cleanLayers(this.layers), { ...this.adjust }, blob);
    } finally {
      btn.disabled = false;
    }
  }

  async preview() {
    const c = this.compose();
    this.onPreview(c.toDataURL('image/jpeg', 0.9), this.gen);
  }

  async retouch(btn) {
    const ta = this.panel.querySelector('[data-retouch]');
    const instruction = ta.value.trim();
    if (!instruction) { ta.focus(); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Retouche en cours…';
    try {
      this.flushSave();
      const gen = await this.onRetouch(this.gen, instruction, cleanLayers(this.layers), { ...this.adjust });
      if (gen) {
        this.gen = gen;
        this.img = await this.getImage(gen);
        this.bgKey = '';
        this.draw();
        this.scheduleSave();
        this.toast('Nouvelle version créée ✓ (l\'ancienne reste dans la galerie)', 'ok');
        ta.value = '';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '🪄 Retoucher l\'image';
    }
  }
}
