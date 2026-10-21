// The menus over the picture (HTML, so they're easy to hit with a finger):
// the settings and cheats (the cog), the pause menu, the level chooser, and
// the buttons on the screens between levels, and the clear buttons over the
// skill panel.
import { HD_DEFS, HD_LABELS, hdIcon } from './render/hdicons.js';
import { statsLine } from './editor/store.js';

// Our levels' orders: [value, label, compare]
const rate = (s) => (s.attempts ? s.wins / s.attempts : null);
const SORTS = [
  ['new', 'Newest', (a, b) => b.created - a.created],
  ['todo', 'Not done yet first', (a, b, done) => done.has(a.id) - done.has(b.id)],
  ['done', 'Done first', (a, b, done) => done.has(b.id) - done.has(a.id)],
  ['name', 'Name', (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })],
  ['stars', 'Most stars', (a, b) => (b.stats.stars ?? 0) - (a.stats.stars ?? 0) || b.stats.ratings - a.stats.ratings],
  ['easy', 'Most won', (a, b) => (rate(b.stats) ?? -1) - (rate(a.stats) ?? -1)],
  ['hard', 'Least won', (a, b) => (rate(a.stats) ?? 2) - (rate(b.stats) ?? 2)],
];

export const CHEAT_LIST = [
  ['unlimitedSkills', 'Unlimited skills'],
  ['pauseAssign', 'Give skills while paused'],
  ['safeFalls', 'Lemmings never splat'],
  ['noTimeLimit', 'No time limit'],
  ['saveOne', 'Saving one lemming is enough'],
  ['allLevels', 'Every level open'],
];

const GEAR = '<svg viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 0h2v1h-2zM1 1h1v1h-1zM3 1h4v1h-4zM8 1h1v1h-1zM0 2h10v1h-10zM1 3h3v1h-3zM6 3h3v1h-3zM0 4h3v2h-3zM7 4h3v2h-3zM1 6h3v1h-3zM6 6h3v1h-3zM0 7h10v1h-10zM1 8h1v1h-1zM3 8h4v1h-4zM8 8h1v1h-1zM4 9h2v1h-2z"/></svg>';
const MENU = '<svg viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="1" width="8" height="2"/><rect x="1" y="4" width="8" height="2"/><rect x="1" y="7" width="8" height="2"/></svg>';

export class UI {
  constructor(el) {
    this.el = el;
    el.innerHTML = `${HD_DEFS}
      <div class="ui-hd" hidden></div>
      <button class="ui-menu-btn" type="button" aria-label="Menu">${MENU}</button>
      <button class="ui-gear" type="button" aria-label="Settings">${GEAR}</button>
      <div class="ui-panel ui-menu" hidden>
        <h2>Paused</h2>
        <button class="ui-resume" type="button">Resume</button>
        <button class="ui-rewind" type="button" hidden>Back 5 seconds</button>
        <button class="ui-restart" type="button">Restart level</button>
        <button class="ui-skip" type="button">Skip level (cheat)</button>
        <button class="ui-levels-btn" type="button">Choose level</button>
        <button class="ui-title" type="button">Quit to title</button>
      </div>
      <div class="ui-panel ui-settings" hidden>
        <h2>Settings</h2>
        <label>Game speed <select data-opt="speed"><option value="1">Normal</option><option value="0.75">Slow</option><option value="0.5">Very slow</option></select></label>
        <label><input data-opt="music" type="checkbox"> Music</label>
        <label><input data-opt="sound" type="checkbox"> Sound effects</label>
        <label><input data-opt="smartPick" type="checkbox"> Smart tap (gives the skill to the lemming that can use it)</label>
        <label><input data-opt="steelAssign" type="checkbox"> Bashers and miners can start next to steel (they stop at it; off: refused, as in the original)</label>
        <h3>Accessibility</h3>
        <label><input data-opt="bigButtons" type="checkbox"> Clear buttons (a picture of each skill, with its name)</label>
        <h3>Original game</h3>
        <label>Levels <select data-opt="pack"><option value="dos">The original 120 (DOS)</option><option value="new">The new ones</option></select></label>
        <p class="ui-note ui-dos-status"></p>
        <div class="ui-row">
          <button class="ui-dos-load" type="button">Load game files</button>
          <button class="ui-dos-forget" type="button">Remove</button>
        </div>
        <input class="ui-dos-pick" type="file" multiple hidden>
        <p class="ui-note">The original levels, graphics and lemmings come from your own copy of DOS Lemmings: MAIN.DAT, ODDTABLE.DAT, LEVEL000-009.DAT, GROUND0-4O.DAT, VGAGR0-4.DAT and VGASPEC0-3.DAT. The sounds ("Oh no!") and music come from Windows 95 Lemmings: the .WAV files in its SOUND folder and the .MID files in MUSIC. Load either or both, or a .zip of them; they stay on this device.</p>
        <h3>Cheats</h3>
        ${CHEAT_LIST.map(([k, t]) => `<label><input data-opt="${k}" type="checkbox"> ${t}</label>`).join('')}
        <p class="ui-note">A level only gets its tick when it's done with no cheats on (slow speed is fine).</p>
        <p class="ui-note ui-version"></p>
        <button class="ui-close" type="button">Done</button>
      </div>
      <div class="ui-panel ui-levels" hidden>
        <h2>Choose a level</h2>
        <div class="ui-grid"></div>
        <button class="ui-close" type="button">Back</button>
      </div>
      <div class="ui-panel ui-shared" hidden>
        <h2>Our levels</h2>
        <p class="ui-note ui-shared-status"></p>
        <label class="ui-sort">Sort by <select>${SORTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        <div class="ui-shared-list"></div>
        <button class="ui-close" type="button">Back</button>
      </div>
      <div class="ui-panel ui-rate" hidden>
        <h2>Did you like it?</h2>
        <p class="ui-note ui-rate-title"></p>
        <div class="ui-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
        <label class="ui-field">Your name (if you like) <input class="ui-rate-name" maxlength="24" autocomplete="off"></label>
        <label class="ui-field">Say something about it (if you like) <textarea class="ui-rate-comment" maxlength="300" rows="3"></textarea></label>
        <p class="ui-note">Comments show for everyone once they’ve been checked.</p>
        <p class="ui-note ui-rate-msg"></p>
        <div class="ui-row">
          <button class="ui-rate-send main" type="button" disabled>Send</button>
          <button class="ui-rate-skip" type="button">Not now</button>
        </div>
      </div>
      <div class="ui-panel ui-remove" hidden>
        <h2>Are you sure?</h2>
        <p class="ui-note ui-remove-title"></p>
        <p class="ui-note">This asks the person who looks after Our levels to take it down for everyone. They’ll have a look first.</p>
        <label class="ui-field">Why? (if you like) <input class="ui-remove-why" maxlength="200" autocomplete="off"></label>
        <label class="ui-field">Your name (if you like) <input class="ui-remove-who" maxlength="24" autocomplete="off"></label>
        <p class="ui-note ui-remove-msg"></p>
        <div class="ui-row">
          <button class="ui-remove-nuke" type="button">☢ Request removal</button>
          <button class="ui-remove-no main" type="button">No, keep it</button>
        </div>
      </div>
      <div class="ui-panel ui-said" hidden>
        <h2>What people said</h2>
        <p class="ui-note ui-said-title"></p>
        <div class="ui-said-list"></div>
        <button class="ui-close" type="button">Back</button>
      </div>
      <div class="ui-bar" hidden></div>
      <div class="ui-toast" hidden></div>`;
    this.q = (s) => el.querySelector(s);
    this.panels = { menu: this.q('.ui-menu'), settings: this.q('.ui-settings'), levels: this.q('.ui-levels'), shared: this.q('.ui-shared'), rate: this.q('.ui-rate'), remove: this.q('.ui-remove'), said: this.q('.ui-said') };
    this.bar = this.q('.ui-bar');
    this.hd = this.q('.ui-hd'); this.hdKeys = [];
    // hooks for main.js
    this.on = {};
    const call = (name, ...a) => () => this.on[name]?.(...a);
    this.q('.ui-gear').addEventListener('click', () => this.open('settings'));
    this.q('.ui-menu-btn').addEventListener('click', call('menu'));
    this.q('.ui-resume').addEventListener('click', call('resume'));
    this.q('.ui-restart').addEventListener('click', call('restart'));
    this.q('.ui-rewind').addEventListener('click', call('rewind'));
    this.q('.ui-skip').addEventListener('click', call('skip'));
    this.q('.ui-levels-btn').addEventListener('click', call('chooseLevel'));
    this.q('.ui-title').addEventListener('click', call('title'));
    for (const b of el.querySelectorAll('.ui-close')) b.addEventListener('click', () => { this.close(); this.on.closed?.(); });
    for (const f of el.querySelectorAll('[data-opt]')) {
      f.addEventListener('change', () => this.on.option?.(f.dataset.opt, f.type === 'checkbox' ? f.checked : Number.isNaN(Number(f.value)) ? f.value : Number(f.value)));
    }
    const pick = this.q('.ui-dos-pick');
    this.q('.ui-dos-load').addEventListener('click', () => pick.click());
    pick.addEventListener('change', () => { if (pick.files.length) this.on.loadFiles?.([...pick.files]); pick.value = ''; });
    this.q('.ui-dos-forget').addEventListener('click', () => this.on.forgetFiles?.());
    // Our levels' order
    this.q('.ui-sort select').addEventListener('change', (e) => { this.on.sort?.(e.target.value); this.listShared(); });
    // the rating card
    this.stars = 0;
    for (const b of el.querySelectorAll('[data-star]')) b.addEventListener('click', () => this.setStars(+b.dataset.star));
    this.q('.ui-rate-send').addEventListener('click', () => {
      this.on.rateSend?.({ stars: this.stars, name: this.q('.ui-rate-name').value.trim(), comment: this.q('.ui-rate-comment').value.trim() });
    });
    this.q('.ui-rate-skip').addEventListener('click', () => { this.close(); this.on.rateSkip?.(); });
    // asking for a level to come down: the red button wants two taps
    const nuke = this.q('.ui-remove-nuke');
    nuke.addEventListener('click', () => {
      if (!this.nukeArmed) { this.armNuke(true); return; }
      this.armNuke(false);
      this.on.removeSend?.({ why: this.q('.ui-remove-why').value.trim(), who: this.q('.ui-remove-who').value.trim() });
    });
    this.q('.ui-remove-no').addEventListener('click', () => { this.armNuke(false); this.close(); });
    // keep taps on the menus off the game
    for (const ev of ['pointerdown', 'pointerup', 'pointermove']) {
      for (const n of [this.q('.ui-gear'), this.q('.ui-menu-btn'), ...Object.values(this.panels), this.bar]) n.addEventListener(ev, (e) => e.stopPropagation());
    }
  }

  get anyOpen() { return Object.values(this.panels).some((p) => !p.hidden); }

  open(name) {
    for (const [k, p] of Object.entries(this.panels)) p.hidden = k !== name;
    this.on.opened?.(name);
  }
  close() { for (const p of Object.values(this.panels)) p.hidden = true; }

  setOptions(o) {
    for (const f of this.el.querySelectorAll('[data-opt]')) {
      const v = o[f.dataset.opt];
      if (f.type === 'checkbox') f.checked = !!v; else f.value = String(v);
    }
  }

  /** The original games' files: a line saying what's loaded; levels: the DOS levels are; any: anything is. */
  setDos(status, levels, any = levels) {
    this.q('.ui-dos-status').textContent = status;
    this.q('.ui-dos-forget').hidden = !any;
    this.q('[data-opt="pack"]').disabled = !levels;
    if (!levels) this.q('[data-opt="pack"]').value = 'new';
  }

  setVersion(v) { this.q('.ui-version').textContent = `Version ${v}`; }

  /** Whether the in-game menu button shows. */
  setPlaying(on) { this.el.classList.toggle('ui-playing', on); }

  /** The level chooser: levels [{name, rating}], done (Set), open (n => bool). */
  showLevels(levels, done, isOpen) {
    const grid = this.q('.ui-grid');
    grid.innerHTML = '';
    let rating = null;
    levels.forEach((lv, i) => {
      if (lv.rating !== rating) {
        rating = lv.rating;
        const h = document.createElement('h3');
        h.textContent = rating;
        grid.appendChild(h);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-level' + (done.has(i) ? ' done' : '');
      b.disabled = !isOpen(i);
      b.innerHTML = `<span class="n">${lv.number ?? i + 1}</span><span class="t">${lv.name}</span><span class="c">${done.has(i) ? '&#10003;' : b.disabled ? '&#128274;' : ''}</span>`;
      b.addEventListener('click', () => { this.close(); this.on.pickLevel?.(i); });
      grid.appendChild(b);
    });
    this.open('levels');
  }

  /**
   * The pause menu for a level that isn't one of the packs' (one being made,
   * or a shared one): quit: what Quit says, or null for the packs' menu.
   */
  setMenuFor(quit, rewind) {
    this.q('.ui-rewind').hidden = !rewind;
    this.q('.ui-skip').hidden = !!quit;
    this.q('.ui-levels-btn').hidden = !!quit;
    this.q('.ui-title').textContent = quit ?? 'Quit to title';
  }

  /**
   * Our levels: items [{ id, name, author, created, picture, stats }], done (Set of ids),
   * or a message instead; sort: the order to show them in (see SORTS).
   */
  showShared(items, done, message, sort) {
    this.shared = { items: items ?? [], done };
    if (sort) this.q('.ui-sort select').value = sort;
    this.q('.ui-sort').hidden = !this.shared.items.length;
    this.q('.ui-shared-status').textContent = message ?? (items.length ? 'Levels made by people who play this. Tap one to play it.' : 'No levels shared yet. Make one in Make levels!');
    this.listShared();
    this.open('shared');
  }

  listShared() {
    const list = this.q('.ui-shared-list');
    const { items, done } = this.shared ?? { items: [], done: new Set() };
    const by = SORTS.find(([v]) => v === this.q('.ui-sort select').value) ?? SORTS[0];
    list.innerHTML = '';
    for (const it of items.slice().sort((a, b) => by[2](a, b, done) || b.created - a.created)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="pic"><img alt="" loading="lazy"></span><span class="t"></span><span class="a"></span><span class="s"></span><span class="c"></span>`;
      if (done.has(it.id)) { b.classList.add('done'); b.querySelector('.pic').insertAdjacentHTML('beforeend', '<span class="tick" aria-label="Done">✓</span>'); }
      b.querySelector('img').src = it.picture;
      b.querySelector('.t').textContent = it.name;
      b.querySelector('.a').textContent = `by ${it.author} · ${it.id}`;
      b.querySelector('.s').textContent = statsLine(it.stats);
      b.querySelector('.c').textContent = done.has(it.id) ? '✓ You’ve done this one' : '';
      b.addEventListener('click', () => this.on.pickShared?.(it.id));
      list.appendChild(b);
    }
  }

  /** The rating card after winning a shared level: title, and what this device said last time (or {}). */
  showRate(title, { stars = 0, name = '', comment = '' } = {}) {
    this.q('.ui-rate-title').textContent = title;
    this.q('.ui-rate-name').value = name;
    this.q('.ui-rate-comment').value = comment;
    this.rateMessage('');
    this.setStars(stars);
    this.open('rate');
  }
  /** The "are you sure?" card for asking a shared level to come down. */
  showRemove(title, who = '') {
    this.q('.ui-remove-title').textContent = title;
    this.q('.ui-remove-why').value = '';
    this.q('.ui-remove-who').value = who;
    this.removeMessage('');
    this.armNuke(false);
    this.open('remove');
  }
  removeMessage(msg) { this.q('.ui-remove-msg').textContent = msg; }
  /** The red button: tap once to arm it (it stands down after a few seconds), tap again to go. */
  armNuke(on) {
    clearTimeout(this.nukeTimer);
    this.nukeArmed = on;
    const b = this.q('.ui-remove-nuke');
    b.classList.toggle('armed', on);
    b.textContent = on ? 'TAP AGAIN TO BE SURE' : '☢ Request removal';
    if (on) this.nukeTimer = setTimeout(() => this.armNuke(false), 4000);
  }
  setStars(n) {
    this.stars = n;
    for (const b of this.el.querySelectorAll('[data-star]')) b.classList.toggle('on', +b.dataset.star <= n);
    this.q('.ui-rate-send').disabled = !n;
  }
  rateMessage(msg) { this.q('.ui-rate-msg').textContent = msg; }

  /** What people said about a level: list [{ stars, name, comment }], or a message instead. */
  showSaid(title, list, message) {
    this.q('.ui-said-title').textContent = title;
    const el = this.q('.ui-said-list');
    el.innerHTML = '';
    if (message || !list?.length) el.innerHTML = `<p class="ui-note"></p>`, el.firstChild.textContent = message ?? 'Nobody’s said anything yet.';
    for (const c of list ?? []) {
      const d = document.createElement('div');
      d.className = 'ui-said-one';
      d.innerHTML = '<span class="st"></span> <b></b><p></p>';
      d.querySelector('.st').textContent = '★'.repeat(c.stars) + '☆'.repeat(5 - c.stars);
      d.querySelector('b').textContent = c.name || 'Someone';
      d.querySelector('p').textContent = c.comment;
      el.appendChild(d);
    }
    this.open('said');
  }

  /** Where the panel's buttons are on the page (CSS px): the clear buttons go over them. */
  placeButtons(x, y, w, h, n) {
    Object.assign(this.hd.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.hd.style.setProperty('--cw', `${w / n}px`);
  }

  /**
   * The clear buttons, or null to hide them. buttons: [{ name, count, sel, on, off }]
   * in the panel's order (name is the picture: a skill, slower, faster, pause, play, nuke, ff).
   */
  setButtons(buttons) {
    this.hd.hidden = !buttons;
    if (!buttons) return;
    if (this.hd.children.length !== buttons.length) {
      this.hd.innerHTML = buttons.map(() => '<div class="hd"><span class="hd-n"></span><span class="hd-pic"></span><span class="hd-l"></span></div>').join('');
      this.hdKeys = [];
    }
    buttons.forEach((b, i) => {
      const key = `${b.name} ${b.count ?? ''} ${b.sel ? 's' : ''}${b.on ? 'o' : ''}${b.off ? 'x' : ''}`;
      if (this.hdKeys[i] === key) return;
      const [cell, prev] = [this.hd.children[i], this.hdKeys[i]?.split(' ')[0]];
      this.hdKeys[i] = key;
      cell.className = 'hd' + (b.sel ? ' sel' : '') + (b.on ? ' on' : '') + (b.off ? ' off' : '');
      cell.children[0].textContent = b.count ?? '';
      if (prev !== b.name) { cell.children[1].innerHTML = hdIcon(b.name); cell.children[2].textContent = HD_LABELS[b.name]; }
    });
  }

  /** A message for a few seconds. */
  toast(msg) {
    const t = this.q('.ui-toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  /** Buttons along the bottom (between levels). buttons: [[label, fn, main?]] */
  showBar(buttons) {
    this.bar.innerHTML = '';
    for (const [label, fn, main] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (main) b.className = 'main';
      b.addEventListener('click', fn);
      this.bar.appendChild(b);
    }
    this.bar.hidden = buttons.length === 0;
  }
}
