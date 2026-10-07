// The menus over the picture (HTML, so they're easy to hit with a finger):
// the settings and cheats (the cog), the pause menu, the level chooser, and
// the buttons on the screens between levels.

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
    el.innerHTML = `
      <button class="ui-menu-btn" type="button" aria-label="Menu">${MENU}</button>
      <button class="ui-gear" type="button" aria-label="Settings">${GEAR}</button>
      <div class="ui-panel ui-menu" hidden>
        <h2>Paused</h2>
        <button class="ui-resume" type="button">Resume</button>
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
        <button class="ui-close" type="button">Done</button>
      </div>
      <div class="ui-panel ui-levels" hidden>
        <h2>Choose a level</h2>
        <div class="ui-grid"></div>
        <button class="ui-close" type="button">Back</button>
      </div>
      <div class="ui-bar" hidden></div>`;
    this.q = (s) => el.querySelector(s);
    this.panels = { menu: this.q('.ui-menu'), settings: this.q('.ui-settings'), levels: this.q('.ui-levels') };
    this.bar = this.q('.ui-bar');
    // hooks for main.js
    this.on = {};
    const call = (name, ...a) => () => this.on[name]?.(...a);
    this.q('.ui-gear').addEventListener('click', () => this.open('settings'));
    this.q('.ui-menu-btn').addEventListener('click', call('menu'));
    this.q('.ui-resume').addEventListener('click', call('resume'));
    this.q('.ui-restart').addEventListener('click', call('restart'));
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
