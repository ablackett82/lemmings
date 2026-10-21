// The level editor: a screen of its own over the game. Levels are built from
// the original game's pieces and objects (build.js), with the paint brush,
// the lump brush (the set's own organic pieces, scattered along a stroke),
// the rubber, and skill stamps. As it's edited, the level is played with no
// skills in the background, and where the lemmings go and how they end up is
// drawn over it (the ghost trails), with every fall off an edge and whether
// it's survivable (analyse.js).
//
// Touch: one finger draws, places, picks and drags; two fingers pan and
// pinch-zoom. Mouse: drag the background to pan, the wheel scrolls, ctrl or
// cmd + wheel (or a trackpad pinch) zooms; arrow keys nudge, Delete deletes,
// ctrl/cmd + Z undoes.
//
// Several things at once: the Select tool (tap things to add or remove them,
// or drag a box round them), or shift-tap with the mouse. Moving, copying,
// mirroring, flipping and deleting then work on all of them, and Group ties
// them together (a `g` number on each, format.js) so tapping one picks the lot.

import { WORLD_W, WORLD_H, SKILLS } from '../game/engine.js';
import { hdIcon, HD_LABELS } from '../render/hdicons.js';
import { buildCustom, drawLevel, objectKinds, standY, brush } from './build.js';
import { ghostRun, falls, SAFE_DROP } from './analyse.js';
import { SETS, texture } from './sets.js';
import { originalSpec } from './import.js';
import { drawPiece } from '../dos/dosdata.js';
import { newLevel, playKey, LIMITS, check } from './format.js';
import * as store from './store.js';

const TOOLS = [
  ['move', 'Move'], ['select', 'Select'], ['pieces', 'Pieces'], ['lumps', 'Lumps'], ['paint', 'Paint'], ['rubber', 'Rubber'], ['stamps', 'Stamps'], ['things', 'Things'],
];
const STAMP_LIST = [['build', 'builder', 'Stairs'], ['bash', 'basher', 'Bash'], ['mine', 'miner', 'Mine'], ['dig', 'digger', 'Dig'], ['bomb', 'bomber', 'Bomb']];
const THING_NAMES = { entrance: 'Entrance', exit: 'Exit', water: 'Water', fire: 'Fire', trap: 'Trap', left: 'One way ←', right: 'One way →', deco: 'Decoration' };
const END_STYLE = {
  splat: ['#ff4040', 'SPLAT'], drown: ['#40a0ff', 'DROWNED'], fire: ['#ff9020', 'BURNT'], trap: ['#d060ff', 'TRAPPED'],
  out: ['#ff4040', 'FELL OUT'], stuck: ['#ffd040', 'STUCK'],
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class Editor {
  /**
   * hooks: { dos(): DosData or null, test(spec, level): play it,
   *   close(): back to the title }
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.entry = null;          // { id, spec, pub? } being edited
    this.tool = 'move';
    this.sel = null;            // { t: 'terrain' | 'object', i }: the main one picked
    this.more = [];             // the others picked with it, same shape
    this.marquee = null;        // the box being dragged out in the Select tool
    this.opts = { piece: null, lump: 'mixed', paint: 8, rubber: 8, stamp: 'build', dir: 1, thing: null };
    this.cam = { z: 4, x: 0, y: 0 };
    this.show = { trails: true, falls: true };
    this.undoStack = []; this.redoStack = [];
    this.built = null; this.analysis = null; this.fallList = [];
    this.thumbs = new Map();
    this.html();
    this.bind();
  }

  get spec() { return this.entry.spec; }
  get dos() { return this.hooks.dos(); }
  get open() { return !this.root.hidden; }

  // ---- the screens: my levels, and the editor -------------------------------

  html() {
    this.root.innerHTML = `
      <div class="ed-home">
        <div class="ed-bar"><button class="ed-back" type="button">‹ Back</button><h2>My levels</h2></div>
        <div class="ed-home-body">
          <div class="ed-new"><h3>Make a new level</h3><div class="ed-sets"></div>
            <p class="ed-orig"><button type="button" class="ed-orig-btn">Copy an original level…</button></p></div>
          <h3 class="ed-mine-h">Made on this ${/iPad|iPhone/.test(navigator.userAgent) ? 'iPad' : 'computer'}</h3>
          <div class="ed-mine"></div>
        </div>
      </div>
      <div class="ed-main" hidden>
        <div class="ed-bar">
          <button class="ed-levels" type="button">‹ Levels</button>
          <button class="ed-name" type="button"></button>
          <span class="ed-gap"></span>
          <button class="ed-undo" type="button" title="Undo">↶</button>
          <button class="ed-redo" type="button" title="Redo">↷</button>
          <button class="ed-zoomout" type="button" title="Zoom out">−</button>
          <button class="ed-zoomin" type="button" title="Zoom in">+</button>
          <button class="ed-toggle ed-trails on" type="button">Trails</button>
          <button class="ed-toggle ed-falls on" type="button">Falls</button>
          <button class="ed-settings" type="button">Level</button>
          <button class="ed-test main" type="button">▶ Test</button>
        </div>
        <div class="ed-view">
          <canvas></canvas>
          <div class="ed-selbar" hidden></div>
          <div class="ed-status"></div>
        </div>
        <div class="ed-tools">${TOOLS.map(([k, t]) => `<button type="button" data-tool="${k}">${t}</button>`).join('')}</div>
        <div class="ed-tray"></div>
      </div>
      <div class="ed-modal" hidden><div class="ed-dialog"></div></div>`;
    const q = (s) => this.root.querySelector(s);
    this.q = q;
    this.homeEl = q('.ed-home'); this.mainEl = q('.ed-main');
    this.canvas = q('.ed-view canvas'); this.ctx = this.canvas.getContext('2d');
    this.viewEl = q('.ed-view'); this.selbar = q('.ed-selbar'); this.statusEl = q('.ed-status');
    this.tray = q('.ed-tray'); this.modal = q('.ed-modal'); this.dialog = q('.ed-dialog');
    this.world = document.createElement('canvas');
    this.world.width = WORLD_W; this.world.height = WORLD_H;
    this.wctx = this.world.getContext('2d');
    this.wimg = this.wctx.createImageData(WORLD_W, WORLD_H);
  }

  bind() {
    const on = (s, fn) => this.q(s).addEventListener('click', fn);
    on('.ed-back', () => this.hooks.close());
    on('.ed-levels', () => this.home());
    on('.ed-name', () => this.settings());
    on('.ed-settings', () => this.settings());
    on('.ed-undo', () => this.undo());
    on('.ed-redo', () => this.redo());
    on('.ed-zoomin', () => this.zoomBy(1.5));
    on('.ed-zoomout', () => this.zoomBy(1 / 1.5));
    on('.ed-trails', (e) => { this.show.trails = !this.show.trails; e.currentTarget.classList.toggle('on', this.show.trails); this.draw(); });
    on('.ed-falls', (e) => { this.show.falls = !this.show.falls; e.currentTarget.classList.toggle('on', this.show.falls); this.draw(); });
    on('.ed-test', () => this.test());
    for (const b of this.root.querySelectorAll('[data-tool]')) b.addEventListener('click', () => this.setTool(b.dataset.tool));
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.closeModal(); });
    // the game behind mustn't get these
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'wheel']) this.root.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev !== 'wheel' });
    this.bindPointers();
    addEventListener('keydown', (e) => this.key(e));
    addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
    const fit = () => { if (this.open && !this.mainEl.hidden) this.resize(); };
    addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(this.viewEl);
  }

  /** My levels: the list, and making a new one. */
  home() {
    if (this.entry) this.save();
    this.root.hidden = false;
    this.homeEl.hidden = false; this.mainEl.hidden = true;
    this.closeModal();
    const dos = this.dos;
    const sets = this.q('.ed-sets');
    sets.innerHTML = dos ? SETS.map((s, i) => `<button type="button" data-set="${i}"><img alt="" src="${this.setPicture(i)}"><span>${s.name}</span></button>`).join('')
      : '<p class="ed-note">Loading the game’s graphics…</p>';
    for (const b of sets.querySelectorAll('[data-set]')) b.addEventListener('click', () => this.create(+b.dataset.set));
    const orig = this.q('.ed-orig-btn');
    orig.disabled = !dos;
    orig.onclick = () => this.pickOriginal();
    this.listMine();
  }

  listMine() {
    const list = store.myLevels(), el = this.q('.ed-mine');
    this.q('.ed-mine-h').hidden = !list.length;
    el.innerHTML = list.map((e) => {
      const proved = this.proved(e.spec), pub = e.pub && e.pub.key === playKey(e.spec) ? e.pub : null;
      const badge = pub ? { pending: ['Waiting for approval', 'wait'], approved: [`Shared · ${pub.code}`, 'ok'], rejected: ['Not approved', 'no'], gone: ['Not shared', ''] }[pub.status] ?? ['Sent', 'wait']
        : proved ? ['Beaten ✓ — ready to share', 'ok'] : ['Not beaten yet', ''];
      return `<div class="ed-card" data-id="${e.id}">
        <canvas width="320" height="32"></canvas>
        <div class="ed-card-t"><b>${esc(e.spec.name || 'Untitled')}</b><span class="ed-badge ${badge[1]}">${esc(badge[0])}</span></div>
        <div class="ed-card-s" hidden></div>
        <div class="ed-card-b">
          <button type="button" data-act="edit" class="main">Edit</button>
          <button type="button" data-act="share" ${proved && !(pub && pub.status !== 'gone' && pub.status !== 'rejected') ? '' : 'disabled'}>Share</button>
          <button type="button" data-act="copy">Copy</button>
          ${e.pub && (e.pub.status === 'approved' || e.pub.status === 'pending') ? '<button type="button" data-act="remove" title="Ask for it to come off Our levels">Ask to remove</button>' : ''}
          <button type="button" data-act="delete">Delete</button>
        </div></div>`;
    }).join('');
    for (const card of el.querySelectorAll('.ed-card')) {
      const e = list.find((x) => x.id === card.dataset.id);
      this.thumb(card.querySelector('canvas'), e.spec);
      card.querySelector('canvas').addEventListener('click', () => this.edit(e.id));
      for (const b of card.querySelectorAll('[data-act]')) b.addEventListener('click', () => this.cardAction(b.dataset.act, e));
    }
    // how the shared ones are getting on: approved yet? how many have played them?
    for (const e of list) {
      if (!e.pub || (e.pub.status !== 'pending' && e.pub.status !== 'approved')) continue;
      store.status(e.pub.code).then((r) => {
        if (!r) return;
        if (r.status !== e.pub.status) {
          const cur = store.getMine(e.id);
          if (!cur?.pub) return;
          cur.pub.status = r.status;
          store.saveMine(cur);
          if (this.open && !this.homeEl.hidden) this.listMine();
          return;
        }
        const line = r.status === 'approved' && store.statsLine(r.stats);
        const el2 = el.querySelector(`.ed-card[data-id="${e.id}"] .ed-card-s`);
        if (line && el2) { el2.textContent = line; el2.hidden = false; }
      });
    }
  }

  cardAction(act, e) {
    if (act === 'edit') this.edit(e.id);
    else if (act === 'copy') {
      const spec = { ...structuredClone(e.spec), name: `${e.spec.name || 'Untitled'} (copy)`.slice(0, 40) };
      delete spec.proof;
      store.saveMine({ id: store.newId(), spec });
      this.listMine();
    } else if (act === 'delete') {
      this.confirm(`Delete “${esc(e.spec.name || 'Untitled')}”? This can’t be undone.${e.pub && (e.pub.status === 'approved' || e.pub.status === 'pending') ? ' It stays in Our levels: use Ask to remove first if you want it gone.' : ''}`, 'Delete', () => { store.removeMine(e.id); this.listMine(); });
    } else if (act === 'remove') this.askRemoval(e.pub.code, e.spec.name);
    else if (act === 'share') this.share(e);
  }

  create(set) {
    const dos = this.dos;
    const spec = newLevel(set, standY(dos, set, 0, 128));
    spec.author = store.author();
    const entry = { id: store.newId(), spec };
    store.saveMine(entry);
    this.edit(entry.id);
    this.settings(true);
  }

  /** Choose one of the original levels to copy into my levels. */
  pickOriginal() {
    const dos = this.dos;
    const groups = [];
    dos.levels.forEach((l, i) => {
      let g = groups.find((x) => x.rating === l.rating);
      if (!g) groups.push(g = { rating: l.rating, items: [] });
      const picture = !originalSpec(dos, i); // drawn as one picture: nothing to edit
      g.items.push(`<option value="${i}"${picture ? ' disabled' : ''}>${l.number}. ${esc(l.name)}${picture ? ' (can’t be edited)' : ''}</option>`);
    });
    this.dialog.innerHTML = `<h2>Copy an original level</h2>
      <p>You get your own copy to change. The original stays as it is.</p>
      <select class="ed-orig-pick">${groups.map((g) => `<optgroup label="${g.rating}">${g.items.join('')}</optgroup>`).join('')}</select>
      <div class="ed-row ed-end"><button type="button" class="ed-no">Cancel</button><button type="button" class="main ed-yes">Copy it</button></div>`;
    this.modal.hidden = false;
    this.dialog.querySelector('.ed-no').addEventListener('click', () => this.closeModal());
    this.dialog.querySelector('.ed-yes').addEventListener('click', () => {
      const spec = originalSpec(dos, +this.dialog.querySelector('.ed-orig-pick').value);
      if (!spec) return;
      spec.name = `${spec.name} (copy)`.slice(0, 40);
      spec.author = store.author();
      const entry = { id: store.newId(), spec };
      store.saveMine(entry);
      this.closeModal();
      this.edit(entry.id);
    });
  }

  /** Copies a level (a shared one, say) into my levels and opens it. */
  remix(spec) {
    const s = structuredClone(spec);
    delete s.proof;
    s.name = `${s.name || 'Untitled'} (my version)`.slice(0, 40);
    s.author = store.author();
    const entry = { id: store.newId(), spec: s };
    store.saveMine(entry);
    this.root.hidden = false;
    this.edit(entry.id);
  }

  edit(id) {
    const e = store.getMine(id);
    if (!e || !this.dos) return;
    this.entry = { ...e, spec: check(e.spec) };
    this.undoStack = []; this.redoStack = [];
    this.setAll([]);
    this.root.hidden = false;
    this.homeEl.hidden = true; this.mainEl.hidden = false;
    this.opts.piece = null; this.opts.thing = null;
    this.setTool('move');
    this.rebuild();
    this.resize();
    // start on the entrance, the ground filling the height
    this.cam.z = this.fitZoom();
    const ent = this.built.level.objects.find((o) => o.kind === 'entrance');
    this.cam.x = ent ? ent.x + 24 - this.viewW / this.cam.z / 2 : 0;
    this.cam.y = 0;
    this.clampCam();
    this.draw();
  }

  /** Back from test play. win: the log of a win with no cheats, or null. */
  back(win, shareNow = false) {
    if (!this.entry) return this.home();
    this.root.hidden = false;
    if (win) {
      this.spec.proof = { log: win, key: playKey(this.spec) };
      this.warnedEdit = false;
      this.save();
      if (!shareNow) this.toast('Beaten! You can share it from ‹ Levels → Share. Changing anything means beating it again.');
    }
    this.resize();
    this.draw();
    if (win && shareNow) this.share(this.entry);
  }

  hide() { if (this.entry) this.save(); this.root.hidden = true; }

  save() { if (this.entry) store.saveMine(this.entry); }

  proved(spec) { return !!spec.proof && spec.proof.key === playKey(spec); }

  // ---- building and analysing -----------------------------------------------

  /** After any change: rebuild, redraw, and work out the trails and falls a moment later. */
  changed() {
    this.rebuild();
    this.draw();
    clearTimeout(this.analyseTimer);
    this.analyseTimer = setTimeout(() => this.analyse(), 120);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }

  rebuild() {
    this.built = buildCustom(this.spec, this.dos);
    const rgba = drawLevel(this.built.level);
    this.wimg.data.set(rgba);
    this.wctx.putImageData(this.wimg, 0, 0);
    if (!this.analysis) this.analyse();
  }

  /**
   * Mid-stroke, just the new bit: painted onto the built level and redrawn
   * there. It goes on top of everything, so that's what a rebuild would make;
   * the rebuild (and the trails and falls) wait for the finger to lift.
   */
  strokeMore(it, from) {
    const lv = this.built.level;
    let box;
    if (it.k === 'piece') {
      const p = this.dos.set(this.spec.set).pieces[it.p];
      drawPiece(lv.terrain, p, it.x, it.y, { flipV: it.fv, flipH: it.fh });
      box = { x: it.x, y: it.y, w: p.w, h: p.h };
    } else box = brush(lv.terrain, it, texture(this.dos, this.spec.set), from);
    if (!(box.w > 0 && box.h > 0)) return;
    drawLevel(lv, lv.terrain, this.wimg.data, box);
    this.wctx.putImageData(this.wimg, 0, 0, box.x, box.y, box.w, box.h);
    this.draw();
  }

  analyse() {
    if (!this.built) return;
    const lv = this.built.level;
    this.analysis = ghostRun(lv);
    // falls: one line for a run of edges that end the same way
    const all = falls(lv, lv.terrain), kept = [];
    for (const f of all) {
      if (kept.some((k) => k.dir === f.dir && Math.abs(k.x - f.x) <= 4 && Math.abs(k.y - f.y) <= 4 && k.land.dies === f.land.dies)) continue;
      kept.push(f);
    }
    this.fallList = kept;
    this.draw();
  }

  // ---- the view ---------------------------------------------------------------

  resize() {
    const r = this.viewEl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.viewW = r.width; this.viewH = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`; this.canvas.style.height = `${r.height}px`;
    this.dpr = dpr;
    this.clampCam();
    this.draw();
  }

  fitZoom() { return Math.max(0.5, this.viewH / (WORLD_H + 8)); }
  minZoom() { return Math.min(this.viewW / (WORLD_W + 40), this.fitZoom()); }

  clampCam() {
    const { z } = this.cam;
    this.cam.z = Math.max(this.minZoom(), Math.min(16, z));
    const vw = this.viewW / this.cam.z, vh = this.viewH / this.cam.z;
    const pad = 40;
    this.cam.x = vw >= WORLD_W + 2 * pad ? (WORLD_W - vw) / 2 : Math.max(-pad, Math.min(WORLD_W + pad - vw, this.cam.x));
    this.cam.y = vh >= WORLD_H + 8 ? (WORLD_H - vh) / 2 : Math.max(-pad, Math.min(WORLD_H + pad - vh, this.cam.y));
  }

  zoomBy(f, sx = this.viewW / 2, sy = this.viewH / 2) {
    const wx = this.cam.x + sx / this.cam.z, wy = this.cam.y + sy / this.cam.z;
    this.cam.z *= f;
    this.clampCam();
    this.cam.x = wx - sx / this.cam.z; this.cam.y = wy - sy / this.cam.z;
    this.clampCam();
    this.draw();
  }

  toWorld(sx, sy) { return { x: this.cam.x + sx / this.cam.z, y: this.cam.y + sy / this.cam.z }; }

  draw() {
    if (!this.built || this.mainEl.hidden || this.root.hidden) return;
    cancelAnimationFrame(this.drawFrame);
    this.drawFrame = requestAnimationFrame(() => this.paint());
  }

  paint() {
    const c = this.ctx, { z, x: cx, y: cy } = this.cam, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#15151c'; c.fillRect(0, 0, this.viewW, this.viewH);
    c.save();
    c.scale(z, z); c.translate(-cx, -cy);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.world, 0, 0);
    c.restore();
    const S = (x, y) => [(x - cx) * z, (y - cy) * z];
    // the level's edges
    c.strokeStyle = '#3a3a50'; c.lineWidth = 1;
    const [ax, ay] = S(0, 0), [bx, by] = S(WORLD_W, WORLD_H);
    c.strokeRect(ax - 0.5, ay - 0.5, bx - ax + 1, by - ay + 1);
    // steel, faintly
    c.strokeStyle = 'rgba(160,170,200,0.45)'; c.setLineDash([3, 3]);
    for (const s of this.built.level.steel) { const [x0, y0] = S(s.x, s.y); c.strokeRect(x0, y0, s.w * z, s.h * z); }
    c.setLineDash([]);

    const an = this.analysis;
    if (an && this.show.trails) {
      // each faint, so a path many take shows stronger than one a few take
      const n = an.trails.filter((t) => t?.length >= 4).length || 1;
      c.strokeStyle = `rgba(255,255,255,${(1 - 0.35 ** (1 / n)).toFixed(3)})`; c.lineWidth = Math.max(1.5, z * 0.8); c.lineJoin = 'round';
      for (const t of an.trails) {
        if (!t || t.length < 4) continue;
        c.beginPath();
        for (let k = 0; k < t.length; k += 2) {
          const [px, py] = S(t[k] + 0.5, t[k + 1]);
          // a jump of more than a few pixels (a lemming put somewhere new) starts a new line
          if (k && Math.abs(t[k] - t[k - 2]) > 6) c.moveTo(px, py); else if (k) c.lineTo(px, py); else c.moveTo(px, py);
        }
        c.stroke();
      }
      // how they ended up, grouped
      const groups = new Map();
      for (const e of an.ends) {
        if (e.cause === 'home') continue;
        const key = `${e.cause}:${Math.round(e.x / 6)}:${Math.round(e.y / 6)}`;
        const g = groups.get(key) ?? { ...e, n: 0 };
        g.n++; groups.set(key, g);
      }
      c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
      for (const g of groups.values()) {
        const [col, label] = END_STYLE[g.cause];
        const [px, py0] = S(g.x + 0.5, g.y - 5);
        const py = Math.min(py0, this.viewH - 6);
        c.strokeStyle = '#000'; c.lineWidth = 4; c.beginPath(); c.moveTo(px - 5, py - 5); c.lineTo(px + 5, py + 5); c.moveTo(px + 5, py - 5); c.lineTo(px - 5, py + 5); c.stroke();
        c.strokeStyle = col; c.lineWidth = 2; c.stroke();
        const s = `${label}${g.n > 1 ? ` ×${g.n}` : ''}`;
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(s, px, py - 7);
        c.fillStyle = col; c.fillText(s, px, py - 7);
      }
    }
    if (this.show.falls) {
      c.font = '600 10px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      for (const f of this.fallList) {
        const col = f.land.dies ? '#ff4a4a' : '#5ae66a';
        const [x0, y0] = S(f.x + f.dir + 0.5, f.y), [x1, y1] = S(f.land.x + 0.5, Math.min(f.land.y, WORLD_H));
        if (Math.max(x0, x1) < -20 || Math.min(x0, x1) > this.viewW + 20) continue;
        c.strokeStyle = col; c.lineWidth = 1.5; c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.setLineDash([]);
        const drop = f.land.out ? null : f.land.y - f.y;
        // the furthest it can land and live, for the close ones
        if (drop === null || drop > SAFE_DROP - 24) {
          const [lx, ly] = S(f.land.x + 0.5, f.y + SAFE_DROP);
          if (f.y + SAFE_DROP < WORLD_H) { c.strokeStyle = '#ff4a4a'; c.lineWidth = 2; c.beginPath(); c.moveTo(lx - 7, ly); c.lineTo(lx + 7, ly); c.stroke(); }
        }
        if (z >= 2.5) {
          const s = drop === null ? 'falls out' : `${drop}${f.land.dies ? ' splat' : ''}`;
          const tx = x0 + (f.dir > 0 ? 4 : -4), ty = (y0 + Math.min(y1, this.viewH)) / 2;
          c.textAlign = f.dir > 0 ? 'left' : 'right';
          c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(s, tx, ty);
          c.fillStyle = col; c.fillText(s, tx, ty);
        }
      }
    }
    // the selection
    for (const { box, grouped } of this.selBoxes()) {
      const [x0, y0] = S(box.x, box.y);
      c.strokeStyle = '#000'; c.lineWidth = 3; c.strokeRect(x0 - 1, y0 - 1, box.w * z + 2, box.h * z + 2);
      c.strokeStyle = grouped ? '#4ad8ff' : '#ffe14a'; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.strokeRect(x0 - 1, y0 - 1, box.w * z + 2, box.h * z + 2); c.setLineDash([]);
    }
    if (this.marquee) {
      const m = this.marquee, [ax2, ay2] = S(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
      const mw = Math.abs(m.x1 - m.x0) * z, mh = Math.abs(m.y1 - m.y0) * z;
      c.fillStyle = 'rgba(255,225,74,0.12)'; c.fillRect(ax2, ay2, mw, mh);
      c.strokeStyle = '#ffe14a'; c.lineWidth = 1; c.setLineDash([4, 3]); c.strokeRect(ax2 + 0.5, ay2 + 0.5, mw, mh); c.setLineDash([]);
    }
    // a brush's size, under the pointer
    if (this.cursor && ['paint', 'rubber'].includes(this.tool)) {
      const r = this.opts[this.tool];
      const [px, py] = S(this.cursor.x, this.cursor.y);
      c.strokeStyle = this.tool === 'rubber' ? '#ff8080' : '#ffffff'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(px, py, r * z, 0, Math.PI * 2); c.stroke();
    }
    this.status();
  }

  status() {
    const an = this.analysis;
    if (!an) { this.statusEl.textContent = ''; return; }
    const by = {};
    for (const e of an.ends) by[e.cause] = (by[e.cause] ?? 0) + 1;
    const parts = Object.entries(by).filter(([k]) => k !== 'home').map(([k, n]) => `${n} ${END_STYLE[k][1].toLowerCase()}`);
    const ok = an.home >= this.spec.save;
    const proof = this.proved(this.spec) ? '<span class="ok">Beaten ✓ (any change means beating it again)</span>' : '<span>Not beaten yet</span>';
    this.statusEl.innerHTML = `<span class="${ok ? 'warn' : ''}">With no skills: ${an.home} of ${an.count} get home${parts.length ? `, ${parts.join(', ')}` : ''}${ok ? ' — too easy?' : ''}</span> · need ${this.spec.save} · ${proof}`;
  }

  // ---- what's where -------------------------------------------------------------

  /** Everything picked: the main one, then the others. */
  all() { return this.sel ? [this.sel, ...this.more] : []; }
  setAll(list) { this.sel = list[0] ?? null; this.more = list.slice(1); }
  isSel(t, i) { return this.all().some((s) => s.t === t && s.i === i); }

  /** The bounds of a thing, { x, y, w, h }, or null. */
  boxOf(s) {
    if (s.t === 'object') {
      const o = this.spec.objects[s.i], d = this.dos.set(this.spec.set).objects[o?.id];
      return o && d ? { x: o.x, y: o.y, w: d.w, h: d.h } : null;
    }
    return this.built.boxes[s.i] ?? null;
  }

  selBoxes() {
    return this.all().map((s) => ({ box: this.boxOf(s), grouped: !!this.item(s)?.g })).filter((b) => b.box);
  }

  /** A thing, and everything grouped with it. */
  withGroup(s) {
    const g = this.item(s)?.g;
    if (!g) return [s];
    const out = [s];
    this.spec.objects.forEach((o, i) => { if (o.g === g && !(s.t === 'object' && s.i === i)) out.push({ t: 'object', i }); });
    this.spec.terrain.forEach((o, i) => { if (o.g === g && !(s.t === 'terrain' && s.i === i)) out.push({ t: 'terrain', i }); });
    return out;
  }

  nextGroup() {
    let m = 0;
    for (const it of [...this.spec.objects, ...this.spec.terrain]) if (it.g > m) m = it.g;
    return m + 1;
  }

  /** The thing at a world point: { t, i } or null. The selected one first, then the top one. */
  hit(x, y) {
    const set = this.dos.set(this.spec.set);
    const inBox = (b) => b && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    const tests = [];
    for (let i = this.spec.objects.length - 1; i >= 0; i--) {
      const o = this.spec.objects[i], d = set.objects[o.id];
      tests.push({ t: 'object', i, ok: d && inBox({ x: o.x, y: o.y, w: d.w, h: d.h }) });
    }
    const hidden = [];
    for (let i = this.spec.terrain.length - 1; i >= 0; i--) {
      const it = this.spec.terrain[i], b = this.built.boxes[i];
      if (!inBox(b)) continue;
      let ok = true;
      if (it.k === 'piece') {
        const p = set.pieces[it.p];
        const px = Math.floor(x - it.x), py = Math.floor(y - it.y);
        const sx = it.fh ? p.w - 1 - px : px, sy = it.fv ? p.h - 1 - py : py;
        ok = !!p.mask[sy * p.w + sx];
      } else if (it.k === 'paint' || it.k === 'erase') {
        ok = near(it.pts, x, y, it.r + 2 / this.cam.z);
      }
      if (!ok) continue;
      (it.k === 'erase' || it.erase ? hidden : tests).push({ t: 'terrain', i, ok: true });
    }
    const cur = this.sel && [...tests, ...hidden].find((h) => h.ok && this.isSel(h.t, h.i));
    const hit = cur ?? tests.find((h) => h.ok) ?? hidden[0];
    return hit ? { t: hit.t, i: hit.i } : null;
  }

  item(sel = this.sel) { return sel && (sel.t === 'object' ? this.spec.objects[sel.i] : this.spec.terrain[sel.i]); }

  /** Moves a thing by (dx, dy). */
  shift(it, dx, dy) {
    if (it.pts) it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
    else { it.x += dx; it.y += dy; }
  }

  // ---- undo ---------------------------------------------------------------------

  /** First change to a beaten level: offer the Undo toast, once. */
  warnBeaten() {
    if (!this.proved(this.spec) || this.warnedEdit) return;
    this.warnedEdit = true;
    const { proof: _p, ...before } = this.spec;
    this.offerUndo(JSON.stringify(before), this.undoStack.length);
  }

  snapshot(quiet = false) {
    // first change to a beaten level: say it'll need beating again (not for grouping, which doesn't change how it plays)
    if (!quiet) this.warnBeaten();
    const { proof, ...rest } = this.spec;
    this.undoStack.push(JSON.stringify(rest));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  restore(json) {
    const proof = this.spec.proof;
    this.entry.spec = { ...JSON.parse(json) };
    if (proof) this.entry.spec.proof = proof;
    // keep what was picked, if it's still there
    this.more = this.more.filter((s) => this.item(s));
    if (this.sel && !this.item()) this.sel = this.more.shift() ?? null;
    this.changed();
    this.selection();
  }
  undo() {
    if (!this.undoStack.length) return;
    const { proof, ...rest } = this.spec;
    this.redoStack.push(JSON.stringify(rest));
    this.restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) return;
    const { proof, ...rest } = this.spec;
    this.undoStack.push(JSON.stringify(rest));
    this.restore(this.redoStack.pop());
  }

  // ---- tools --------------------------------------------------------------------

  setTool(tool) {
    this.tool = tool;
    for (const b of this.root.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === tool);
    this.trayFor(tool);
    this.draw();
  }

  /** Fills the tray for a tool, keeping where it was scrolled to if it's the same tool (picking a piece redraws it). */
  trayFor(tool) {
    const same = this.trayTool === tool, left = same ? this.tray.querySelector('.ed-strip')?.scrollLeft ?? 0 : 0, top = same ? this.tray.scrollTop : 0;
    this.drawTray(tool);
    this.trayTool = tool;
    const strip = this.tray.querySelector('.ed-strip');
    if (strip && left) {
      // the pictures may not have their widths yet, so again as they arrive
      const apply = () => { strip.scrollLeft = left; };
      apply(); requestAnimationFrame(apply);
      for (const img of strip.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', apply, { once: true });
    }
    this.tray.scrollTop = top;
  }

  drawTray(tool) {
    const t = this.tray, set = this.spec.set, dos = this.dos;
    if (tool === 'move') {
      t.innerHTML = '<p class="ed-hint">Tap something to pick it, then drag it, or use the buttons at the top to nudge, flip or delete it. Drag empty space to look around; two fingers to zoom. To pick several, use Select (or shift-tap with a mouse).</p>';
    } else if (tool === 'select') {
      t.innerHTML = '<p class="ed-hint">Tap things to add them (tap again to let go), or drag a box round them. Then move, copy, mirror, flip or delete them all together, or Group them so they always get picked together. Two fingers to look around.</p>';
    } else if (tool === 'pieces') {
      const s = dos.set(set), steel = new Set(SETS[set].steel);
      t.innerHTML = `<div class="ed-strip">${s.pieces.map((p, i) => p ? `<button type="button" data-piece="${i}" class="${this.opts.piece === i ? 'on' : ''}"><img alt="" src="${this.pieceThumb(i)}">${steel.has(i) ? '<span class="ed-steel">STEEL</span>' : ''}</button>` : '').join('')}</div>`;
      for (const b of t.querySelectorAll('[data-piece]')) b.addEventListener('click', () => { this.opts.piece = +b.dataset.piece; this.trayFor('pieces'); });
      if (this.opts.piece === null) t.insertAdjacentHTML('afterbegin', '<p class="ed-hint">Pick a piece, then tap the level to put it there.</p>');
    } else if (tool === 'lumps') {
      t.innerHTML = `<div class="ed-row"><span class="ed-hint">Draw with your finger: lumps of ${SETS[set].name.toLowerCase()} go down along the line.</span>
        ${[['small', 'Small'], ['mixed', 'Mixed'], ['big', 'Big']].map(([k, l]) => `<button type="button" data-lump="${k}" class="${this.opts.lump === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      for (const b of t.querySelectorAll('[data-lump]')) b.addEventListener('click', () => { this.opts.lump = b.dataset.lump; this.trayFor('lumps'); });
    } else if (tool === 'paint' || tool === 'rubber') {
      const k = tool;
      t.innerHTML = `<div class="ed-row"><span class="ed-hint">${k === 'paint' ? 'Draw ground with your finger.' : 'Rub out ground with your finger.'}</span>
        <label>Size <input type="range" min="2" max="30" value="${this.opts[k]}"></label><span class="ed-size">${this.opts[k]}</span></div>`;
      const r = t.querySelector('input');
      r.addEventListener('input', () => { this.opts[k] = +r.value; t.querySelector('.ed-size').textContent = r.value; });
    } else if (tool === 'stamps') {
      t.innerHTML = `<div class="ed-row">${STAMP_LIST.map(([k, icon, label]) => `<button type="button" class="ed-stamp ${this.opts.stamp === k ? 'on' : ''}" data-stamp="${k}"><span class="ed-pic">${hdIcon(icon)}</span>${label}</button>`).join('')}
        <span class="ed-sep"></span>
        <button type="button" data-dir="-1" class="${this.opts.dir < 0 ? 'on' : ''}">← Left</button><button type="button" data-dir="1" class="${this.opts.dir > 0 ? 'on' : ''}">Right →</button>
        <span class="ed-hint">Tap where a lemming would stand. Tap the top of a staircase to add another.</span></div>`;
      for (const b of t.querySelectorAll('[data-stamp]')) b.addEventListener('click', () => { this.opts.stamp = b.dataset.stamp; this.trayFor('stamps'); });
      for (const b of t.querySelectorAll('[data-dir]')) b.addEventListener('click', () => { this.opts.dir = +b.dataset.dir; this.trayFor('stamps'); });
    } else if (tool === 'things') {
      const kinds = objectKinds(dos, set);
      t.innerHTML = `<div class="ed-strip">${kinds.map((k) => `<button type="button" data-thing="${k.id}" class="${this.opts.thing === k.id ? 'on' : ''}"><img alt="" src="${this.objectThumb(k.id)}"><span>${THING_NAMES[k.kind]}</span></button>`).join('')}</div>`;
      for (const b of t.querySelectorAll('[data-thing]')) b.addEventListener('click', () => { this.opts.thing = +b.dataset.thing; this.trayFor('things'); });
      if (this.opts.thing === null) t.insertAdjacentHTML('afterbegin', '<p class="ed-hint">Pick one, then tap the level to put it there. Lemmings come out of the entrance and go home through the exit.</p>');
    }
  }

  /** The buttons for the selected thing, over the top of the view. */
  selection() {
    const it = this.item();
    const sb = this.selbar;
    if (!it) { sb.hidden = true; return; }
    const b = (act, label, on, title = '') => `<button type="button" data-act="${act}" class="${on ? 'on' : ''}" title="${title}">${label}</button>`;
    let html = b('left', '◀', false, 'Nudge left') + b('up', '▲', false, 'Nudge up') + b('down', '▼', false, 'Nudge down') + b('right', '▶', false, 'Nudge right');
    const list = this.all();
    if (list.length > 1) {
      const gs = list.map((s) => this.item(s)?.g);
      const same = gs[0] && gs.every((g) => g === gs[0]);
      html = `<span class="ed-n">${list.length} picked</span>` + html
        + b('mh', '↔ Mirror', false, 'Turn them left-to-right, as a set') + b('mv', '↕ Flip', false, 'Turn them upside down, as a set');
      if (list.some((s) => s.t === 'terrain')) html += b('front', 'To front') + b('back', 'To back');
      html += same ? b('ungroup', 'Ungroup', false, 'Let them be picked one at a time again')
        : b('group', 'Group', false, 'Pick, move and copy them together from now on') + (gs.some(Boolean) ? b('ungroup', 'Ungroup') : '');
      html += b('copy', 'Copy') + b('delete', 'Delete') + b('done', '✓');
    } else if (it.k === 'piece') {
      html += b('fh', '↔ Mirror', it.fh) + b('fv', '↕ Flip', it.fv) + b('behind', 'Behind', it.behind, 'Only fills where there’s nothing yet') + b('erase', 'Cut', it.erase, 'Cuts its shape out instead');
    } else if (it.k === 'stamp') {
      html += b('dir', it.dir < 0 ? '← Left' : 'Right →', false, 'Which way');
      if (it.s === 'build') html += b('less', '−', false, 'Fewer staircases') + `<span class="ed-n">${it.n ?? 1}</span>` + b('more', '+', false, 'Another staircase');
    } else if (this.sel.t === 'object') {
      html += b('fv', '↕ Flip', it.fv) + b('behind', 'Behind', it.behind, 'Behind the ground');
    }
    if (list.length === 1) {
      if (this.sel.t === 'terrain') html += b('front', 'To front') + b('back', 'To back');
      html += b('copy', 'Copy') + b('delete', 'Delete') + b('done', '✓');
    }
    sb.innerHTML = html;
    sb.hidden = false;
    for (const el of sb.querySelectorAll('[data-act]')) {
      const act = el.dataset.act;
      if (['left', 'right', 'up', 'down'].includes(act)) this.holdRepeat(el, () => this.nudge(act));
      else el.addEventListener('click', () => this.selAction(act));
    }
  }

  holdRepeat(el, fn) {
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.snapshot();
      fn();
      const go = (ms) => { timer = setTimeout(() => { fn(); go(60); }, ms); };
      go(350);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
  }

  nudge(dir, snap = false) {
    if (!this.item()) return;
    if (snap) this.snapshot();
    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
    for (const s of this.all()) this.shift(this.item(s), dx, dy);
    this.changed();
  }

  selAction(act) {
    const it = this.item();
    if (!it) return;
    if (act === 'done') { this.select(null); return; }
    if (this.more.length) { this.multiAction(act); return; }
    this.snapshot();
    const list = this.sel.t === 'object' ? this.spec.objects : this.spec.terrain;
    switch (act) {
      case 'fh': case 'fv': case 'behind': case 'erase':
        if (it[act]) delete it[act]; else it[act] = true;
        break;
      case 'dir': it.dir = it.dir < 0 ? 1 : -1; break;
      case 'less': it.n = Math.max(1, (it.n ?? 1) - 1); break;
      case 'more': it.n = Math.min(40, (it.n ?? 1) + 1); break;
      case 'delete': list.splice(this.sel.i, 1); this.setAll([]); break;
      case 'copy': {
        const c = structuredClone(it);
        this.shift(c, 8, it.k === 'stamp' ? 0 : 8);
        list.push(c);
        this.setAll([{ t: this.sel.t, i: list.length - 1 }]);
        break;
      }
      case 'front': list.splice(this.sel.i, 1); list.push(it); this.sel.i = list.length - 1; break;
      case 'back': list.splice(this.sel.i, 1); list.unshift(it); this.sel.i = 0; break;
    }
    this.changed();
    this.selection();
  }

  /** Several picked at once: the same buttons, on all of them. */
  multiAction(act) {
    const list = this.all();
    const lists = { object: this.spec.objects, terrain: this.spec.terrain };
    if (act === 'group' || act === 'ungroup') {
      this.snapshot(true);
      if (act === 'group') { const g = this.nextGroup(); for (const s of list) this.item(s).g = g; }
      else for (const s of list) delete this.item(s).g;
      this.changed(); this.selection();
      return;
    }
    this.snapshot();
    switch (act) {
      case 'delete':
        for (const t of ['object', 'terrain']) {
          for (const i of list.filter((s) => s.t === t).map((s) => s.i).sort((a, b) => b - a)) lists[t].splice(i, 1);
        }
        this.setAll([]);
        break;
      case 'copy': {
        // groups copy to groups of their own
        const sorted = [...list].sort((a, b) => a.i - b.i), groups = new Map(), out = [];
        let next = this.nextGroup();
        for (const s of sorted) {
          const c = structuredClone(this.item(s));
          if (c.g) { if (!groups.has(c.g)) groups.set(c.g, next++); c.g = groups.get(c.g); }
          this.shift(c, 8, c.k === 'stamp' ? 0 : 8);
          lists[s.t].push(c);
          out.push({ t: s.t, i: lists[s.t].length - 1 });
        }
        this.setAll(out);
        break;
      }
      case 'front': case 'back': {
        const at = new Set(list.filter((s) => s.t === 'terrain').map((s) => s.i)), keep = [], moved = [];
        this.spec.terrain.forEach((it, i) => (at.has(i) ? moved : keep).push(it));
        const front = act === 'front';
        this.spec.terrain = front ? [...keep, ...moved] : [...moved, ...keep];
        const first = front ? keep.length : 0;
        this.setAll([...list.filter((s) => s.t === 'object'), ...moved.map((_, k) => ({ t: 'terrain', i: first + k }))]);
        break;
      }
      case 'mh': case 'mv': this.reflect(list, act === 'mh'); break;
    }
    this.changed();
    this.selection();
  }

  /**
   * Turns the picked things as a set about the middle of the lot: left-to-right
   * (horizontal) or upside down. Pieces are moved across and turned; brush
   * strokes and stamps (a staircase turns to face the other way) are moved
   * across. Things can only be flipped upside down, not mirrored, so they're
   * just moved across (a one-way arrow becomes the other way's).
   */
  reflect(list, horizontal) {
    const boxes = list.map((s) => ({ s, b: this.boxOf(s), it: this.item(s) })).filter((r) => r.b);
    if (!boxes.length) return;
    const lo = horizontal ? Math.min(...boxes.map((r) => r.b.x)) : Math.min(...boxes.map((r) => r.b.y));
    const hi = horizontal ? Math.max(...boxes.map((r) => r.b.x + r.b.w)) : Math.max(...boxes.map((r) => r.b.y + r.b.h));
    const kinds = objectKinds(this.dos, this.spec.set);
    let stuck = 0, objects = 0;
    for (const { s, b, it } of boxes) {
      if (it.pts) {
        const k = horizontal ? 0 : 1;
        it.pts = it.pts.map((p) => { const q = [...p]; q[k] = lo + hi - 1 - q[k]; return q; });
      } else if (it.k === 'stamp') {
        if (horizontal) { it.x = lo + hi - 1 - it.x; it.dir = -it.dir; } else stuck++;
      } else if (horizontal) {
        it.x = lo + hi - (it.x + b.w);
        if (it.k === 'piece') { if (it.fh) delete it.fh; else it.fh = true; }
        else {
          const k = kinds.find((m) => m.id === it.id), flip = k && { left: 'right', right: 'left' }[k.kind];
          const other = flip && kinds.find((m) => m.kind === flip && m.w === k.w && m.h === k.h);
          if (other) it.id = other.id; else objects++;
        }
      } else {
        it.y = lo + hi - (it.y + b.h);
        if (it.fv) delete it.fv; else it.fv = true;
      }
    }
    if (objects) this.toast('Turned them round, but things like exits can only be moved across, not mirrored.');
    else if (stuck) this.toast('Skill stamps stay where they are when you flip upside down.');
  }

  select(sel) { this.setAll(sel ? this.withGroup(sel) : []); this.selection(); this.draw(); }

  /** Adds a tapped thing (and its group) to the picked ones, or lets it go if it's picked already. */
  toggle(h) {
    const mates = this.withGroup(h), list = this.all();
    const has = (a, s) => a.some((m) => m.t === s.t && m.i === s.i);
    this.setAll(this.isSel(h.t, h.i) ? list.filter((s) => !has(mates, s)) : [...list, ...mates.filter((m) => !has(list, m))]);
    this.selection(); this.draw();
  }

  /** Picks everything the box touches (brush strokes only if it holds the whole stroke), plus what they're grouped with. */
  pickInside({ x0, y0, x1, y1 }) {
    [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)]; [y0, y1] = [Math.min(y0, y1), Math.max(y0, y1)];
    const touches = (b) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
    const holds = (b) => b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1;
    const found = [];
    this.spec.objects.forEach((_, i) => { const b = this.boxOf({ t: 'object', i }); if (b && touches(b)) found.push({ t: 'object', i }); });
    this.spec.terrain.forEach((it, i) => { const b = this.boxOf({ t: 'terrain', i }); if (b && (it.pts ? holds(b) : touches(b))) found.push({ t: 'terrain', i }); });
    const list = this.all();
    for (const f of found) for (const m of this.withGroup(f)) if (!list.some((s) => s.t === m.t && s.i === m.i)) list.push(m);
    this.setAll(list);
    this.selection(); this.draw();
  }

  // ---- pointers ---------------------------------------------------------------

  bindPointers() {
    const cv = this.canvas, pts = new Map();
    let gesture = null; // { kind: 'pinch' | 'pan' | 'drag' | 'stroke' | 'tap', ... }
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

    const startPinch = () => {
      if (['stroke', 'drag', 'marquee'].includes(gesture?.kind)) this.cancelGesture(gesture);
      const [a, b] = [...pts.values()];
      gesture = { kind: 'pinch', d0: Math.hypot(a.sx - b.sx, a.sy - b.sy), z0: this.cam.z, mid: { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 }, cam0: { ...this.cam } };
    };

    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* gone */ }
      const p = pos(e);
      pts.set(e.pointerId, p);
      if (pts.size === 2) { startPinch(); return; }
      if (pts.size > 2) return;
      const w = this.toWorld(p.sx, p.sy);
      const panOnly = e.button === 1 || this.spaceDown;
      gesture = this.begin(w, p, panOnly, e.pointerType, e.shiftKey);
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (e.pointerType === 'mouse') { this.cursor = this.toWorld(p.sx, p.sy); if (['paint', 'rubber'].includes(this.tool)) this.draw(); }
      if (!pts.has(e.pointerId)) return;
      e.preventDefault();
      pts.set(e.pointerId, p);
      if (gesture?.kind === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), mid = { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 };
        const g = gesture;
        const wx = g.cam0.x + g.mid.sx / g.cam0.z, wy = g.cam0.y + g.mid.sy / g.cam0.z;
        this.cam.z = g.z0 * (d / Math.max(10, g.d0));
        this.clampCam();
        this.cam.x = wx - mid.sx / this.cam.z; this.cam.y = wy - mid.sy / this.cam.z;
        this.clampCam();
        this.draw();
        return;
      }
      if (gesture && pts.size === 1) this.move(gesture, this.toWorld(p.sx, p.sy), p, e.pointerType);
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (gesture?.kind === 'pinch') { if (!pts.size) gesture = null; return; }
      if (gesture && !pts.size) { if (e.type === 'pointerup') this.end(gesture); else this.cancelGesture(gesture); gesture = null; }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { this.cursor = null; this.draw(); } });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004), p.sx, p.sy);
      else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX + (Math.abs(e.deltaX) < 1 ? e.deltaY : 0);
        const dy = e.shiftKey ? 0 : Math.abs(e.deltaX) < 1 ? 0 : e.deltaY;
        this.cam.x += dx / this.cam.z; this.cam.y += dy / this.cam.z;
        this.clampCam(); this.draw();
      }
    }, { passive: false });
  }

  /** A finger (or the mouse) goes down on the level. */
  begin(w, p, panOnly, type, shift = false) {
    const g = { w0: w, p0: p, cam0: { ...this.cam }, moved: false, touch: type !== 'mouse' };
    if (panOnly) return { ...g, kind: 'pan' };
    const tool = this.tool;
    if (['lumps', 'paint', 'rubber'].includes(tool)) {
      this.snapshot();
      g.kind = 'stroke';
      g.count0 = this.spec.terrain.length;
      if (tool === 'lumps') { g.lumps = []; g.last = null; this.addLump(g, w); }
      else {
        g.item = { k: tool === 'paint' ? 'paint' : 'erase', r: this.opts[tool], pts: [[Math.round(w.x), Math.round(w.y)]] };
        this.spec.terrain.push(g.item);
        this.strokeMore(g.item, 0);
      }
      return g;
    }
    // on the selected thing (or, moving, on anything): drag it
    const h = this.hit(w.x, w.y);
    const onSel = h && this.isSel(h.t, h.i);
    if (shift && h && tool !== 'stamps') return { ...g, kind: 'tap', hit: h, toggle: true };
    if (onSel || (tool === 'move' && h)) {
      if (!onSel) this.select(h);
      return { ...g, kind: 'drag', at: { x: Math.round(w.x), y: Math.round(w.y) }, snapped: false };
    }
    return { ...g, kind: 'tap', hit: h };
  }

  move(g, w, p) {
    const far = Math.hypot(p.sx - g.p0.sx, p.sy - g.p0.sy) > (g.touch ? 8 : 4);
    if (far) g.moved = true;
    if (g.kind === 'tap' && far) g.kind = this.tool === 'select' ? 'marquee' : 'pan';
    if (g.kind === 'marquee') {
      this.marquee = { x0: g.w0.x, y0: g.w0.y, x1: w.x, y1: w.y };
      this.draw();
      return;
    }
    if (g.kind === 'pan') {
      this.cam.x = g.cam0.x - (p.sx - g.p0.sx) / this.cam.z;
      this.cam.y = g.cam0.y - (p.sy - g.p0.sy) / this.cam.z;
      this.clampCam(); this.draw();
    } else if (g.kind === 'drag') {
      if (!g.moved) return;
      const nx = Math.round(w.x), ny = Math.round(w.y);
      if (nx === g.at.x && ny === g.at.y) return;
      if (!g.snapped) { this.snapshot(); g.snapped = true; }
      for (const s of this.all()) this.shift(this.item(s), nx - g.at.x, ny - g.at.y);
      g.at = { x: nx, y: ny };
      this.changed();
    } else if (g.kind === 'stroke') {
      this.cursor = w;
      if (g.lumps) this.addLump(g, w);
      else {
        const last = g.item.pts.at(-1), x = Math.round(w.x), y = Math.round(w.y);
        if (Math.hypot(x - last[0], y - last[1]) >= Math.max(1, g.item.r / 3)) { g.item.pts.push([x, y]); this.strokeMore(g.item, g.item.pts.length - 2); }
      }
    }
  }

  end(g) {
    if (g.kind === 'tap') this.tap(g.w0, g.hit, g.toggle);
    else if (g.kind === 'marquee') { const m = this.marquee; this.marquee = null; if (m) this.pickInside(m); }
    else if (g.kind === 'stroke') {
      if (this.spec.terrain.length === g.count0) this.undoStack.pop();
      this.cursor = null;
      this.changed();
    } else if (g.kind === 'drag' && !g.moved && this.tool === 'stamps') {
      // a tap on the selected staircase: maybe its top, for another one
      this.tap(g.w0, null);
    }
  }

  /** A second finger came down mid-stroke: that was the start of a pinch, not drawing. */
  cancelGesture(g) {
    if (g.kind === 'stroke') { this.spec.terrain.length = g.count0; this.undoStack.pop(); this.changed(); }
    if (g.kind === 'drag' && g.snapped) this.undo();
    if (g.kind === 'marquee') { this.marquee = null; this.draw(); }
  }

  /** A tap on the level, with the tool in hand. */
  tap(w, hit, toggle = false) {
    const x = Math.round(w.x), y = Math.round(w.y), dos = this.dos, set = dos.set(this.spec.set);
    if (toggle || this.tool === 'select') { if (hit) this.toggle(hit); else if (!toggle) this.select(null); return; }
    if (this.tool === 'move') { this.select(hit); return; }
    if (this.tool === 'pieces') {
      if (this.opts.piece === null) { this.toast('Pick a piece first (below).'); return; }
      const p = set.pieces[this.opts.piece];
      this.snapshot();
      this.spec.terrain.push({ k: 'piece', p: this.opts.piece, x: x - (p.w >> 1), y: y - (p.h >> 1) });
      this.setAll([{ t: 'terrain', i: this.spec.terrain.length - 1 }]);
    } else if (this.tool === 'things') {
      if (this.opts.thing === null) { this.toast('Pick one first (below).'); return; }
      const d = set.objects[this.opts.thing];
      this.snapshot();
      // hatches and exits sit where you tap the ground
      const kind = objectKinds(dos, this.spec.set).find((k) => k.id === this.opts.thing)?.kind;
      const oy = kind === 'exit' ? standY(dos, this.spec.set, this.opts.thing, this.ground(x, y)) : y - (d.h >> 1);
      this.spec.objects.push({ id: this.opts.thing, x: x - (d.w >> 1), y: oy });
      this.setAll([{ t: 'object', i: this.spec.objects.length - 1 }]);
    } else if (this.tool === 'stamps') {
      const s = this.opts.stamp;
      // the top of a staircase going the same way: one more staircase
      if (s === 'build') {
        const i = this.spec.terrain.findIndex((it, n) => it.k === 'stamp' && it.s === 'build' && it.dir === this.opts.dir
          && this.built.ends[n] && Math.abs(this.built.ends[n].x - x) <= 8 && Math.abs(this.built.ends[n].y - y) <= 8);
        if (i >= 0) {
          this.snapshot();
          this.spec.terrain[i].n = Math.min(40, (this.spec.terrain[i].n ?? 1) + 1);
          this.setAll([{ t: 'terrain', i }]);
          this.changed(); this.selection();
          return;
        }
      }
      const gy = s === 'bomb' ? y + 4 : this.ground(x, y);
      this.snapshot();
      this.spec.terrain.push({ k: 'stamp', s, x, y: gy, dir: this.opts.dir, n: 1 });
      this.setAll([{ t: 'terrain', i: this.spec.terrain.length - 1 }]);
    }
    this.changed();
    this.selection();
  }

  /** Where a lemming tapped at (x, y) would stand: the ground at or a little below, or (x, y) if there's none. */
  ground(x, y) {
    const pix = this.built.level.terrain;
    for (let yy = Math.max(0, y - 3); yy < Math.min(WORLD_H, y + 30); yy++) {
      if (pix[yy * WORLD_W + x] && (yy === 0 || !pix[(yy - 1) * WORLD_W + x])) return yy;
    }
    return Math.max(0, Math.min(WORLD_H - 1, y));
  }

  /** The lump brush: a lump of the set at the point, if the last one's far enough away. */
  addLump(g, w) {
    const set = this.dos.set(this.spec.set);
    const lumps = SETS[this.spec.set].lumps.map((i) => ({ i, p: set.pieces[i] })).filter((l) => l.p).sort((a, b) => a.p.w * a.p.h - b.p.w * b.p.h);
    const half = Math.ceil(lumps.length / 2);
    const pool = this.opts.lump === 'small' ? lumps.slice(0, half) : this.opts.lump === 'big' ? lumps.slice(lumps.length - half) : lumps;
    if (g.last && Math.hypot(w.x - g.last.x, w.y - g.last.y) < g.last.gap) return;
    const { i, p } = pool[Math.floor(Math.random() * pool.length)];
    const jx = (Math.random() - 0.5) * p.w * 0.25, jy = (Math.random() - 0.5) * p.h * 0.25;
    const it = { k: 'piece', p: i, x: Math.round(w.x - p.w / 2 + jx), y: Math.round(w.y - p.h / 2 + jy) };
    if (Math.random() < 0.5) it.fh = true;
    if (Math.random() < 0.25) it.fv = true;
    this.spec.terrain.push(it);
    g.lumps.push(it);
    g.last = { x: w.x, y: w.y, gap: Math.max(6, Math.min(p.w, p.h) * 0.45) };
    this.strokeMore(it);
  }

  key(e) {
    if (!this.open || this.mainEl.hidden || !this.modal.hidden) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
    if (mod && e.code === 'KeyG' && this.more.length) { e.preventDefault(); this.multiAction(e.shiftKey ? 'ungroup' : 'group'); return; }
    if (!this.sel) return;
    const arrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (arrows[e.code]) { e.preventDefault(); this.nudge(arrows[e.code], true); }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.selAction('delete'); }
    if (e.code === 'Escape') this.select(null);
  }

  // ---- level settings, testing, sharing -----------------------------------------

  settings(isNew = false) {
    const s = this.spec;
    const num = (k, label, [lo, hi]) => `<label class="ed-num"><span>${label}</span><button type="button" data-dec="${k}">−</button><input type="number" inputmode="numeric" data-k="${k}" min="${lo}" max="${hi}" value="${k.startsWith('skill.') ? s.skills[k.slice(6)] : s[k]}"><button type="button" data-inc="${k}">+</button></label>`;
    this.dialog.innerHTML = `
      <h2>${isNew ? 'Your new level' : 'The level'}</h2>
      <label class="ed-text"><span>Name</span><input type="text" data-k="name" maxlength="40" value="${esc(s.name)}" placeholder="Give it a name"></label>
      <label class="ed-text"><span>Made by</span><input type="text" data-k="author" maxlength="24" value="${esc(s.author)}" placeholder="Your name"></label>
      <div class="ed-grid2">
        ${num('count', 'Lemmings', LIMITS.count)}
        ${num('save', 'To save', [0, 80])}
        ${num('rate', 'Release rate', LIMITS.rate)}
        ${num('time', 'Minutes', LIMITS.time)}
      </div>
      <h3>Skills</h3>
      <div class="ed-skills">${SKILLS.map((k) => `<div class="ed-skill"><span class="ed-pic">${hdIcon(k)}</span><span>${HD_LABELS[k]}</span>${num(`skill.${k}`, '', LIMITS.skill)}</div>`).join('')}</div>
      <div class="ed-row ed-end"><button type="button" class="main ed-ok">Done</button></div>`;
    this.modal.hidden = false;
    let snapped = false;
    const set = (k, v) => {
      const cur = k.startsWith('skill.') ? s.skills[k.slice(6)] : s[k];
      if (cur === v) return;
      // name and author aren't part of how it plays, so they don't warn "beat it again"
      const quiet = k === 'name' || k === 'author';
      if (!snapped) { this.snapshot(quiet); snapped = true; } else if (!quiet) this.warnBeaten();
      if (k.startsWith('skill.')) s.skills[k.slice(6)] = v; else s[k] = v;
    };
    const clampAll = () => {
      for (const inp of this.dialog.querySelectorAll('input[type=number]')) {
        const k = inp.dataset.k, lo = +inp.min, hi = k === 'save' ? s.count : +inp.max;
        const v = Math.max(lo, Math.min(hi, Math.round(+inp.value || 0)));
        if (String(v) !== inp.value) inp.value = v;
        set(k, v);
      }
    };
    for (const inp of this.dialog.querySelectorAll('input')) {
      inp.addEventListener('change', () => { if (inp.type === 'text') set(inp.dataset.k, inp.value.trim()); else clampAll(); this.changed(); });
    }
    const step = (k, d) => { const inp = this.dialog.querySelector(`input[data-k="${k}"]`); inp.value = +inp.value + d; clampAll(); this.changed(); };
    for (const b of this.dialog.querySelectorAll('[data-dec]')) this.holdRepeatSimple(b, () => step(b.dataset.dec, -1));
    for (const b of this.dialog.querySelectorAll('[data-inc]')) this.holdRepeatSimple(b, () => step(b.dataset.inc, 1));
    this.dialog.querySelector('.ed-ok').addEventListener('click', () => {
      for (const inp of this.dialog.querySelectorAll('input[type=text]')) set(inp.dataset.k, inp.value.trim());
      if (s.author) store.setAuthor(s.author);
      this.closeModal();
      this.q('.ed-name').textContent = s.name || 'Untitled';
      this.changed();
    });
    this.q('.ed-name').textContent = s.name || 'Untitled';
  }

  holdRepeatSimple(el, fn) {
    let timer = null;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); const go = (ms) => { timer = setTimeout(() => { fn(); go(70); }, ms); }; go(400); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(timer));
  }

  closeModal() { this.modal.hidden = true; this.dialog.innerHTML = ''; }

  confirm(text, yes, fn) {
    this.dialog.innerHTML = `<p>${text}</p><div class="ed-row ed-end"><button type="button" class="ed-no">Cancel</button><button type="button" class="main ed-yes">${yes}</button></div>`;
    this.modal.hidden = false;
    this.dialog.querySelector('.ed-no').addEventListener('click', () => this.closeModal());
    this.dialog.querySelector('.ed-yes').addEventListener('click', () => { this.closeModal(); fn(); });
  }

  /** After the first change to a beaten level: say it'll need beating again, with a button to put it back as it was. */
  offerUndo(json, depth) {
    let t = this.root.querySelector('.ed-undo-toast');
    if (!t) {
      t = document.createElement('div'); t.className = 'ed-undo-toast';
      t.innerHTML = '<span>That change means you’ll have to beat the level again.</span> <button type="button" class="main">Undo</button>';
      this.root.appendChild(t);
    }
    t.hidden = false;
    t.querySelector('button').onclick = () => {
      t.hidden = true;
      this.undoStack.length = Math.min(depth, this.undoStack.length); this.redoStack = [];
      this.restore(json);
      this.toast('Put back. It’s still beaten ✓');
    };
    clearTimeout(this.undoToastTimer);
    this.undoToastTimer = setTimeout(() => { t.hidden = true; }, 10000);
  }

  toast(text) {
    let t = this.root.querySelector('.ed-toast');
    if (!t) { t = document.createElement('div'); t.className = 'ed-toast'; this.root.appendChild(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  test() {
    const lv = this.built.level;
    const problems = [];
    if (!lv.objects.some((o) => o.kind === 'entrance')) problems.push('an entrance (in Things)');
    if (!lv.objects.some((o) => o.kind === 'exit')) problems.push('an exit (in Things)');
    if (problems.length) { this.toast(`It needs ${problems.join(' and ')}.`); return; }
    this.save();
    this.root.hidden = true;
    this.hooks.test(this.spec, buildCustom(this.spec, this.dos).level);
  }

  /** "Ask to remove" a shared level: are you sure, then a note to the approver, who decides. The red button wants two taps. */
  askRemoval(code, name) {
    this.dialog.innerHTML = `
      <h2>Are you sure?</h2>
      <p class="ed-note">Ask for “${esc(name || code)}” to be taken down for everyone. The person who looks after Our levels will have a look first.</p>
      <label class="ed-text"><span>Why? (if you like)</span><input type="text" class="ed-why" maxlength="200" placeholder="e.g. I made a better one"></label>
      <label class="ed-text"><span>Your name (if you like)</span><input type="text" class="ed-who" maxlength="24" value="${esc(store.author())}"></label>
      <p class="ed-err"></p>
      <div class="ed-row ed-end"><button type="button" class="ed-nuke">☢ Request removal</button><button type="button" class="main ed-no">No, keep it</button></div>`;
    this.modal.hidden = false;
    const err = this.dialog.querySelector('.ed-err'), nuke = this.dialog.querySelector('.ed-nuke');
    let timer = null, armed = false;
    const arm = (on) => {
      clearTimeout(timer); armed = on;
      nuke.classList.toggle('armed', on);
      nuke.textContent = on ? 'TAP AGAIN TO BE SURE' : '☢ Request removal';
      if (on) timer = setTimeout(() => arm(false), 4000);
    };
    this.dialog.querySelector('.ed-no').addEventListener('click', () => { arm(false); this.closeModal(); });
    nuke.addEventListener('click', async () => {
      if (!armed) { arm(true); return; }
      arm(false);
      nuke.disabled = true; err.textContent = 'Sending…';
      try {
        await store.askRemoval(code, this.dialog.querySelector('.ed-why').value.trim(), this.dialog.querySelector('.ed-who').value.trim());
        this.closeModal();
        this.toast('Sent. It will come down once it’s been looked at.');
      } catch (x) { err.textContent = x.message; nuke.disabled = false; }
    });
  }

  share(e) {
    const spec = check(e.spec);
    if (!this.proved(spec)) { this.toast('Beat it first: Edit, then ▶ Test, and get enough home.'); return; }
    this.dialog.innerHTML = `
      <h2>Share “${esc(spec.name || 'Untitled')}”</h2>
      <p class="ed-note">It goes to be checked first. Once it’s approved, everyone playing can find it in Our levels.</p>
      <label class="ed-text"><span>Level name</span><input type="text" class="ed-pname" maxlength="40" value="${esc(spec.name)}"></label>
      <label class="ed-text"><span>Made by</span><input type="text" class="ed-pauthor" maxlength="24" value="${esc(spec.author || store.author())}"></label>
      <p class="ed-err"></p>
      <div class="ed-row ed-end"><button type="button" class="ed-no">Cancel</button><button type="button" class="main ed-send">Send it</button></div>`;
    this.modal.hidden = false;
    const err = this.dialog.querySelector('.ed-err');
    this.dialog.querySelector('.ed-no').addEventListener('click', () => this.closeModal());
    this.dialog.querySelector('.ed-send').addEventListener('click', async (ev) => {
      const name = this.dialog.querySelector('.ed-pname').value.trim(), who = this.dialog.querySelector('.ed-pauthor').value.trim();
      if (!name || !who) { err.textContent = 'It needs a name, and who made it.'; return; }
      ev.currentTarget.disabled = true; err.textContent = 'Sending…';
      spec.name = name; spec.author = who;
      store.setAuthor(who);
      try {
        const res = await store.publish(spec, this.previewPng(spec));
        const cur = store.getMine(e.id) ?? e;
        cur.spec = { ...cur.spec, name, author: who };
        cur.pub = { code: res.id, status: res.status, key: playKey(spec) };
        store.saveMine(cur);
        this.dialog.innerHTML = `<h2>Sent!</h2><p>“${esc(name)}” is waiting to be approved. Its code is <b>${res.id}</b>.</p><div class="ed-row ed-end"><button type="button" class="main ed-ok">OK</button></div>`;
        this.dialog.querySelector('.ed-ok').addEventListener('click', () => { this.closeModal(); this.listMine(); });
      } catch (x) {
        err.textContent = x.message;
        ev.currentTarget.disabled = false;
      }
    });
  }

  // ---- pictures -------------------------------------------------------------------

  /** The whole level as a PNG data URL (for sharing). */
  previewPng(spec) {
    const { level } = buildCustom(spec, this.dos);
    const cv = document.createElement('canvas');
    cv.width = WORLD_W; cv.height = WORLD_H;
    const cx = cv.getContext('2d'), img = cx.createImageData(WORLD_W, WORLD_H);
    img.data.set(drawLevel(level));
    cx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  /** A level drawn small into a canvas. */
  thumb(cv, spec) {
    try {
      const { level } = buildCustom(check(spec), this.dos);
      const full = document.createElement('canvas');
      full.width = WORLD_W; full.height = WORLD_H;
      const fx = full.getContext('2d'), img = fx.createImageData(WORLD_W, WORLD_H);
      img.data.set(drawLevel(level)); fx.putImageData(img, 0, 0);
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.drawImage(full, 0, 0, cv.width, cv.height);
    } catch { /* a broken level: no picture */ }
  }

  setPicture(n) {
    const key = `set${n}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    const dos = this.dos, set = dos.set(n);
    const spec = newLevel(n, standY(dos, n, 0, 128));
    const lumps = SETS[n].lumps.slice(0, 3);
    lumps.forEach((p, i) => { const pc = set.pieces[p]; if (pc) spec.terrain.push({ k: 'piece', p, x: 200 + i * 110, y: 128 - pc.h + 10 }); });
    const { level } = buildCustom(spec, dos);
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 160;
    const c = cv.getContext('2d'), img = c.createImageData(WORLD_W, WORLD_H);
    img.data.set(drawLevel(level));
    const full = document.createElement('canvas'); full.width = WORLD_W; full.height = WORLD_H;
    full.getContext('2d').putImageData(img, 0, 0);
    c.drawImage(full, 0, 0, 640, 160, 0, 0, 640, 160);
    const url = cv.toDataURL();
    this.thumbs.set(key, url);
    return url;
  }

  pieceThumb(i) {
    const key = `${this.spec.set}:p${i}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    const set = this.dos.set(this.spec.set), p = set.pieces[i], pal = set.custom;
    const cv = document.createElement('canvas'); cv.width = p.w; cv.height = p.h;
    const c = cv.getContext('2d'), img = c.createImageData(p.w, p.h);
    for (let k = 0; k < p.w * p.h; k++) {
      if (!p.mask[k]) continue;
      const col = pal[p.img[k]];
      img.data.set([col[0], col[1], col[2], 255], k * 4);
    }
    c.putImageData(img, 0, 0);
    const url = cv.toDataURL();
    this.thumbs.set(key, url);
    return url;
  }

  objectThumb(id) {
    const key = `${this.spec.set}:o${id}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    const lv = this.built.level, d = this.dos.set(this.spec.set).objects[id];
    const o = this.dos.placeObject(d, 0, 0, 1, lv.palette);
    const p = o.def.draw(o.def.startFrame ?? 0);
    const cv = document.createElement('canvas'); cv.width = p.w; cv.height = p.h;
    const c = cv.getContext('2d'), img = c.createImageData(p.w, p.h);
    img.data.set(p.data); c.putImageData(img, 0, 0);
    const url = cv.toDataURL();
    this.thumbs.set(key, url);
    return url;
  }
}

/** Is (x, y) within r of the line through pts? */
function near(pts, x, y, r) {
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1] ?? pts[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= r) return true;
  }
  return false;
}
