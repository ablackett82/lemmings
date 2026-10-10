// Entry point: the title screen, the level preview, the game and the results,
// and the controls. The game runs at the DOS speed (an iteration every 60 ms)
// and is drawn every frame. Settings, cheats and which levels are done are
// kept in localStorage.
import { Game, SKILLS, WORLD_W } from './game/engine.js';
import { buildLevel } from './game/level.js';
import { LEVELS } from './game/levels.js';
import { TITLE_LEVEL } from './game/title.js';
import { Solver } from './game/solver.js';
import { Screen, SCREEN_W, SCREEN_H, VIEW_H, PANEL_Y, BTN_W, BTN_H, BUTTONS, MINI } from './render/screen.js';
import { Sound } from './render/audio.js';
import { Music } from './render/music.js';
import { Keyboard } from './input/keyboard.js';
import { UI, CHEAT_LIST } from './ui.js';
import { DosData } from './dos/dosdata.js';
import * as dosFiles from './dos/files.js';

const ITER_MS = 60;
const STORE = 'lemmings.';
const CHEATS = CHEAT_LIST.map(([k]) => k);
// pack: which levels, 'dos' (the original 120, from the player's own game files) or 'new'
const DEFAULTS = { speed: 1, music: true, sound: true, smartPick: true, bigButtons: false, pack: 'dos', ...Object.fromEntries(CHEATS.map((k) => [k, false])) };

const store = {
  get(k, d) { try { const v = localStorage.getItem(STORE + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

function main() {
  const canvas = document.getElementById('screen');
  canvas.width = SCREEN_W; canvas.height = SCREEN_H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = ctx.createImageData(SCREEN_W, SCREEN_H);
  const screen = new Screen();
  const sound = new Sound();
  const music = new Music(sound);
  const keyboard = new Keyboard();
  const ui = new UI(document.getElementById('ui'));

  const opts = { ...DEFAULTS, ...store.get('opts', {}) };

  // the level sets: ours, and the DOS game's once its files are loaded. Each
  // keeps its own ticks and place.
  let dos = null;
  const packs = {
    new: { list: LEVELS, level: (i) => buildLevel(LEVELS[i]), key: '' },
    dos: { list: [], level: (i) => dos.build(i), key: '.dos' },
  };
  let pack = packs.new, done = new Set(), levelNo = 0;
  function usePack() {
    pack = opts.pack === 'dos' && dos ? packs.dos : packs.new;
    done = new Set(store.get('done' + pack.key, []));
    levelNo = Math.max(0, Math.min(pack.list.length - 1, store.get('level' + pack.key, 0)));
  }
  usePack();

  // what's on: 'title' | 'preview' | 'play' | 'result'
  let mode = 'title';
  let g = null, spec = null, scrollX = 0, cheated = false;
  let paused = false, ff = false, selected = 'climber', nukeArmed = 0;
  let acc = 0, last = performance.now(), frameNo = 0, endDelay = 0;
  let flash = [];
  let demo = makeDemo();
  const hover = { x: 0, y: 0, on: false, touch: false };

  ui.setOptions(opts);
  sound.setMuted(!opts.sound);

  // ---- options ----
  const anyCheat = () => CHEATS.some((k) => k !== 'allLevels' && opts[k]);
  function setOption(k, v) {
    opts[k] = v;
    store.set('opts', opts);
    if (k === 'sound') sound.setMuted(!v);
    if (k === 'music') { if (v && mode === 'play') music.start(levelNo); else music.stop(); }
    if (k === 'pack') { usePack(); toTitle(); return; }
    if (g) applyAssist();
    if (mode === 'play' && anyCheat()) cheated = true;
  }
  function applyAssist() {
    if (!g) return;
    for (const k of ['unlimitedSkills', 'noTimeLimit', 'safeFalls', 'saveOne']) g.assist[k] = opts[k];
  }
  // Like the original's rating signs, level 1 of every rating is open from the start.
  const isOpen = (i) => opts.allLevels || i === 0 || done.has(i) || done.has(i - 1)
    || pack.list[i]?.rating !== pack.list[i - 1]?.rating;

  // ---- the screens ----
  function makeDemo() {
    const d = new Game(buildLevel(TITLE_LEVEL), { noTimeLimit: true });
    d.solver = new Solver(TITLE_LEVEL.solution);
    return d;
  }

  function toTitle() {
    mode = 'title'; g = null; paused = false;
    music.stop();
    demo = makeDemo();
    ui.setPlaying(false);
    ui.close();
    ui.showBar([['Play', () => toPreview(firstUndone()), true], ['Choose level', chooseLevel]]);
  }
  const firstUndone = () => { for (let i = 0; i < pack.list.length; i++) if (!done.has(i)) return i; return levelNo; };

  function chooseLevel() {
    paused = true;
    ui.showLevels(pack.list, done, isOpen);
  }

  function toPreview(n) {
    levelNo = Math.max(0, Math.min(pack.list.length - 1, n));
    store.set('level' + pack.key, levelNo);
    spec = pack.level(levelNo); // the level description, built (the games don't change it)
    g = new Game(spec);
    applyAssist();
    mode = 'preview'; paused = false;
    music.stop();
    ui.setPlaying(false);
    ui.close();
    ui.showBar([['Start', startLevel, true], ['Choose level', chooseLevel]]);
  }

  function startLevel() {
    if (!g || g.iteration > 0) { g = new Game(spec); applyAssist(); }
    mode = 'play'; paused = false; ff = false; nukeArmed = 0; endDelay = 0; flash = [];
    cheated = anyCheat();
    scrollX = clampScroll(spec.start ?? 0);
    selected = SKILLS.find((s) => g.skills[s] > 0) ?? 'climber';
    ui.setPlaying(true);
    ui.close();
    ui.showBar([]);
    sound.unlock();
    if (opts.music) music.start(levelNo);
  }

  function toResult() {
    mode = 'result';
    music.stop();
    ui.setPlaying(false);
    const passed = g.passed;
    if (passed && !cheated && !g.cheated) { done.add(levelNo); store.set('done' + pack.key, [...done]); }
    if (passed && levelNo + 1 < pack.list.length) store.set('level' + pack.key, levelNo + 1);
    const buttons = passed && levelNo + 1 < pack.list.length
      ? [['Next level', () => toPreview(levelNo + 1), true], ['Play again', startLevel], ['Choose level', chooseLevel]]
      : passed ? [['Choose level', chooseLevel, true], ['Play again', startLevel]]
        : [['Try again', startLevel, true], ['Choose level', chooseLevel]];
    ui.showBar(buttons);
  }

  // ---- the menus ----
  ui.on.option = setOption;

  // ---- the original games' files: DOS for the levels and graphics, Windows 95 for the sounds and music ----
  let gameFiles = {};
  function useFiles(files) {
    gameFiles = files;
    sound.setSamples(files);
    music.setTunes(files);
    dos = null; packs.dos.list = [];
    if (!files['main.dat']) return;
    dos = new DosData(files);
    dos.build(0); // fails here, not mid-game, if the files are wrong
    packs.dos.list = dos.levels;
  }
  function dosStatus(msg) {
    const parts = [];
    if (dos) parts.push(`the ${dos.levels.length} original levels`);
    if (sound.hasSamples) parts.push('the sounds');
    if (music.midi.length) parts.push(`${music.midi.length} tunes`);
    const said = parts.length ? `Loaded: ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : 'Not loaded.';
    const need = !dos ? ' For the original levels, pick the .DAT files from DOS Lemmings (or a .zip of them).'
      : !sound.hasSamples ? ' For the original sounds and music, also load the Windows 95 version (its .zip, or its SOUND and MUSIC files).' : '';
    ui.setDos(msg ?? said + need, !!dos, parts.length > 0);
    if (dos) ui.setOptions(opts);
  }
  dosFiles.loadSaved().then((files) => {
    if (!files) return;
    try { useFiles(files); } catch (err) { dos = null; dosStatus(`Couldn't read the saved files: ${err.message}`); return; }
    dosStatus();
    if (opts.pack === 'dos' && mode === 'title') { usePack(); toTitle(); }
  }).catch(() => {}).finally(() => { if (!dos && !sound.hasSamples) dosStatus(); });
  ui.on.loadFiles = async (list) => {
    dosStatus('Reading...');
    const before = gameFiles;
    try {
      const { files, added } = await dosFiles.readPicked(list, gameFiles);
      if (!added) { dosStatus('None of those are files the game uses. Pick the files from DOS Lemmings or Windows 95 Lemmings, or a .zip of them.'); return; }
      const hadDos = !!dos;
      useFiles(files);
      await dosFiles.save(files).catch(() => {});
      if (dos && !hadDos) { opts.pack = 'dos'; store.set('opts', opts); ui.setOptions(opts); }
      dosStatus();
      usePack(); toTitle();
    } catch (err) {
      try { useFiles(before); } catch { /* the old ones worked before */ }
      dosStatus(`Those files didn't work: ${err.message}`);
    }
  };
  ui.on.forgetFiles = async () => {
    await dosFiles.forget();
    useFiles({});
    dosStatus('Removed from this device.');
    usePack(); toTitle();
  };
  ui.on.menu = () => { if (mode === 'play') { paused = true; ui.open('menu'); } };
  ui.on.resume = () => { ui.close(); paused = false; };
  ui.on.restart = () => { ui.close(); startLevel(); };
  ui.on.skip = () => { ui.close(); if (g) { cheated = true; g.cheated = true; } toPreview(levelNo + 1 < pack.list.length ? levelNo + 1 : levelNo); };
  ui.on.chooseLevel = chooseLevel;
  ui.on.title = toTitle;
  ui.on.pickLevel = (i) => toPreview(i);
  ui.on.closed = () => { if (mode === 'play' && !ui.anyOpen) paused = false; };
  ui.on.opened = (name) => { if (mode === 'play' && name !== 'menu') paused = true; };

  // ---- the game's controls ----
  const maxScroll = () => Math.max(0, (spec?.width ?? WORLD_W) - SCREEN_W);
  const clampScroll = (x) => Math.max(0, Math.min(maxScroll(), Math.round(x)));

  /** The lemming the selected skill would go to at a point on the screen. */
  function pick(px, py, touch) {
    if (!g || py >= VIEW_H) return { L: null, count: 0 };
    const wx = px + scrollX, wy = py;
    const box = touch ? 10 : 6;
    const hit = g.hitTest(wx, wy, box);
    if (!hit.count) return { L: null, count: 0 };
    let L = g.canAssign(selected, hit.lem1, hit.lem2) ?? null;
    if (!L && opts.smartPick) {
      // the nearest lemming in reach that can take this skill
      const near = g.lemmings.filter((m) => !m.removed && Math.abs(m.x - wx) <= box + 2 && Math.abs(m.y - 5 - wy) <= box + 2)
        .sort((a, b) => Math.hypot(a.x - wx, a.y - 5 - wy) - Math.hypot(b.x - wx, b.y - 5 - wy));
      for (const m of near) if (g.canAssign(selected, m, null) === m) { L = m; break; }
    }
    return { L: L ?? hit.lem1, ok: !!L, count: hit.count };
  }

  function tapWorld(px, py, touch) {
    if (mode !== 'play' || g.finished) return;
    if (paused && !opts.pauseAssign) return;
    const { L, ok } = pick(px, py, touch);
    if (!L || !ok) return;
    g.assign(selected, L);
    sound.play(['assign']);
    flash.push({ x: L.x, y: L.y, t: 0 });
  }

  function pressButton(b) {
    if (mode !== 'play') return;
    if (SKILLS.includes(b)) { if (selected !== b) sound.play(['tick']); selected = b; return; }
    if (b === 'pause') { paused = !paused; return; }
    if (b === 'ff') { ff = !ff; return; }
    if (b === 'nuke') {
      if (g.nuking) return;
      if (nukeArmed > 0) { g.nuke(); nukeArmed = 0; paused = false; } else nukeArmed = 25;
    }
  }

  // pointers: on the level, a tap gives the skill and a drag scrolls; on the
  // panel, the buttons (the release rate ones while held) and the minimap
  const pointers = new Map();
  const stage = document.getElementById('stage');
  const toScreen = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * SCREEN_W, y: (e.clientY - r.top) / r.height * SCREEN_H, scale: r.width / SCREEN_W };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    sound.unlock();
    const p = toScreen(e);
    const touch = e.pointerType !== 'mouse';
    hover.touch = touch;
    if (mode === 'title') { /* the buttons do it */ return; }
    if (mode === 'preview') { startLevel(); return; }
    if (mode !== 'play') return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    const st = { x0: p.x, y0: p.y, sx0: scrollX, drag: false, area: null, touch };
    if (p.y < VIEW_H) { st.area = 'world'; hover.x = p.x; hover.y = p.y; hover.on = true; }
    else if (p.y >= PANEL_Y && p.x < BUTTONS.length * BTN_W) {
      const b = BUTTONS[Math.floor(p.x / BTN_W)];
      st.area = b;
      if (b === 'slower' || b === 'faster') { if (!paused) g.rateDelta = b === 'slower' ? -1 : 1; } else pressButton(b);
    } else if (p.x >= MINI.x - 4 && p.y >= MINI.y - 4) { st.area = 'mini'; scrollX = clampScroll((p.x - MINI.x) * 16 - SCREEN_W / 2); }
    pointers.set(e.pointerId, st);
  });
  stage.addEventListener('pointermove', (e) => {
    const p = toScreen(e);
    const st = pointers.get(e.pointerId);
    if (!st) {
      if (e.pointerType === 'mouse') { hover.x = p.x; hover.y = p.y; hover.on = p.y < VIEW_H && p.y >= 0 && p.x >= 0 && p.x < SCREEN_W; hover.touch = false; }
      return;
    }
    e.preventDefault();
    if (st.area === 'world') {
      if (!st.drag && Math.abs(p.x - st.x0) > (st.touch ? 5 : 3)) st.drag = true;
      if (st.drag) { scrollX = clampScroll(st.sx0 - (p.x - st.x0)); hover.on = false; } else { hover.x = p.x; hover.y = p.y; }
    } else if (st.area === 'mini') scrollX = clampScroll((p.x - MINI.x) * 16 - SCREEN_W / 2);
  });
  const up = (e) => {
    const st = pointers.get(e.pointerId);
    if (!st) return;
    pointers.delete(e.pointerId);
    if (st.area === 'slower' || st.area === 'faster') g.rateDelta = 0;
    if (st.area === 'world') {
      const p = toScreen(e);
      if (!st.drag && e.type === 'pointerup') tapWorld(p.x, p.y, st.touch);
      if (st.touch) hover.on = false;
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  window.__lem = { get g() { return g; }, get mode() { return mode; }, toPreview, startLevel, sound, get pack() { return pack; } }; // debug handle

  // ---- layout ----
  function fit() {
    const vw = stage.clientWidth, vh = stage.clientHeight;
    const scale = Math.min(vw / SCREEN_W, vh / SCREEN_H);
    canvas.style.width = `${Math.floor(SCREEN_W * scale)}px`;
    canvas.style.height = `${Math.floor(SCREEN_H * scale)}px`;
    const r = canvas.getBoundingClientRect(), s = r.width / SCREEN_W;
    ui.placeButtons(r.left, r.top + PANEL_Y * s, BUTTONS.length * BTN_W * s, BTN_H * s, BUTTONS.length);
  }
  // iOS fires resize/orientationchange before the new viewport size has settled,
  // so also watch the stage itself and re-fit a few times after a rotation.
  let refitTimers = [];
  function refit() {
    fit();
    refitTimers.forEach(clearTimeout);
    refitTimers = [100, 300, 700].map(ms => setTimeout(fit, ms));
  }
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  window.visualViewport?.addEventListener('resize', refit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  fit();

  // ---- drawing the screens between levels ----
  const GREEN = [80, 230, 90], WHITE = [255, 255, 255], YELLOW = [255, 220, 80], PINK = [255, 140, 200];

  function drawTitle() {
    screen.drawGame(demo, { scrollX: 0 });
    screen.rect(0, VIEW_H, SCREEN_W, SCREEN_H - VIEW_H, [0, 0, 0]);
    const t = 'LEMMINGS';
    screen.text(Math.round((SCREEN_W - screen.textWidth(t, 4)) / 2) + 2, 20, t, [0, 90, 20], 4);
    screen.centred(18, t, GREEN, 4);
    screen.centred(54, 'FOR IPAD', [120, 140, 255]);
    screen.centred(156, pack === packs.dos ? 'THE ORIGINAL LEVELS' : 'THE NEW LEVELS', [170, 170, 190]);
    if (done.size) screen.centred(170, `${done.size} OF ${pack.list.length} LEVELS DONE`, YELLOW);
    if (anyCheat()) screen.centred(184, 'CHEATS ON', [255, 110, 110]);
  }

  function overview(y) {
    // the whole level, small
    const w = spec.width ?? WORLD_W, sc = Math.max(5, Math.ceil(w / SCREEN_W));
    const ox = Math.round((SCREEN_W - w / sc) / 2);
    for (let j = 0; j < 160 / sc; j++) for (let i = 0; i < w / sc; i++) {
      const wx = i * sc + (sc >> 1), wy = j * sc + (sc >> 1);
      const c = g.pix[wy * WORLD_W + wx];
      if (c) screen.px(ox + i, y + j, g.level.palette[c]);
    }
    for (const o of g.objects) {
      if (o.kind === 'exit') screen.rect(ox + Math.round((o.x + 16) / sc), y + Math.round((o.y + 12) / sc), 2, 3, YELLOW);
      if (o.kind === 'entrance') screen.rect(ox + Math.round((o.x + 20) / sc), y + Math.round((o.y + 4) / sc), 3, 2, WHITE);
      if (o.kind === 'water') screen.rect(ox + Math.round(o.x / sc), y + Math.round((o.y + 4) / sc), Math.ceil(32 / sc), 2, [40, 80, 220]);
      if (o.kind === 'fire') screen.rect(ox + Math.round(o.x / sc), y + Math.round((o.y + 4) / sc), Math.ceil(32 / sc), 2, [230, 90, 30]);
    }
  }

  function drawPreview() {
    screen.clear();
    overview(6);
    screen.centred(48, spec.number ? `${spec.rating.toUpperCase()} ${spec.number}` : `LEVEL ${levelNo + 1}`, PINK);
    screen.centred(60, spec.name, WHITE, 2);
    const lines = [
      [`NUMBER OF LEMMINGS ${spec.count}`, [80, 160, 255]],
      [`${g.neededPercent}% TO BE SAVED`, GREEN],
      [`RELEASE RATE ${spec.rate}`, YELLOW],
      [opts.noTimeLimit ? 'NO TIME LIMIT' : `TIME ${spec.time} MINUTE${spec.time === 1 ? '' : 'S'}`, [100, 230, 230]],
      [`RATING ${spec.rating}`, PINK],
    ];
    lines.forEach(([s, c], i) => screen.centred(82 + i * 11, s, c));
    if (spec.hint) wrap(spec.hint.toUpperCase(), 50).forEach((s, i) => screen.centred(142 + i * 9, s, [170, 170, 190]));
    if (done.has(levelNo)) screen.text(4, 48, 'DONE', YELLOW);
    if (frameNo & 32) screen.centred(186, 'TAP TO START', WHITE);
  }

  function drawResult() {
    screen.clear();
    const passed = g.passed;
    screen.centred(20, g.timeUp ? 'YOUR TIME IS UP!' : 'ALL LEMMINGS ACCOUNTED FOR.', WHITE);
    screen.centred(46, `YOU RESCUED ${g.savedPercent}%`, GREEN, 2);
    screen.centred(68, `YOU NEEDED ${g.neededPercent}%`, YELLOW, 2);
    const msg = g.savedPercent >= 100 ? 'SUPERB! EVERY SINGLE LEMMING IS SAFE. YOU ARE A LEMMINGS MASTER!'
      : passed && g.assist.saveOne && g.savedPercent < g.neededPercent ? 'ONE LEMMING HOME IS ENOUGH WITH THAT CHEAT ON. ON TO THE NEXT ONE!'
        : passed ? 'WELL DONE! THAT LEVEL WAS NO PROBLEM FOR YOU. ON TO THE NEXT ONE...'
          : g.savedPercent + 10 >= g.neededPercent ? 'SO CLOSE! JUST A FEW MORE NEEDED. HAVE ANOTHER GO!'
            : g.in === 0 ? 'OH DEAR. NOT ONE LEMMING MADE IT. TRY A DIFFERENT IDEA!'
              : 'NOT QUITE. HAVE ANOTHER GO - YOU CAN DO IT!';
    wrap(msg, 44).forEach((s, i) => screen.centred(100 + i * 11, s, [200, 200, 220]));
    if (cheated && passed) screen.centred(150, 'CHEATS WERE ON, SO NO TICK THIS TIME', [255, 110, 110]);
  }

  function wrap(s, n) {
    const out = []; let line = '';
    for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
    if (line) out.push(line);
    return out;
  }

  // ---- keyboard ----
  function keys() {
    if (keyboard.consume('KeyM')) setOption('sound', !opts.sound), ui.setOptions(opts);
    if (keyboard.consume('Escape')) { if (mode === 'play') ui.on.menu(); else if (mode !== 'title') toTitle(); }
    if (mode === 'preview' && keyboard.consume('Space', 'Enter')) startLevel();
    if (mode === 'title' && keyboard.consume('Space', 'Enter')) toPreview(firstUndone());
    if (mode === 'result' && keyboard.consume('Space', 'Enter')) { if (g.passed && levelNo + 1 < pack.list.length) toPreview(levelNo + 1); else startLevel(); }
    if (mode !== 'play') return;
    SKILLS.forEach((s, i) => { if (keyboard.consume(`Digit${i + 1}`, `F${i + 3}`)) pressButton(s); });
    if (keyboard.consume('KeyP', 'Pause')) pressButton('pause');
    if (keyboard.consume('KeyF')) pressButton('ff');
    if (keyboard.consume('KeyN')) pressButton('nuke');
    const minus = keyboard.down.has('slower'), plus = keyboard.down.has('faster');
    if (!pointers.size) g.rateDelta = paused ? 0 : minus ? -1 : plus ? 1 : 0;
    if (keyboard.down.has('left')) scrollX = clampScroll(scrollX - 4);
    if (keyboard.down.has('right')) scrollX = clampScroll(scrollX + 4);
    // a mouse at the edge of the level scrolls it, as on DOS
    if (hover.on && !hover.touch && !pointers.size) {
      if (hover.x < 6) scrollX = clampScroll(scrollX - 4);
      else if (hover.x > SCREEN_W - 6) scrollX = clampScroll(scrollX + 4);
    }
  }

  // the panel's buttons as the clear buttons (settings, accessibility) show them
  const clearButtons = () => BUTTONS.map((b) => {
    if (b === 'slower') return { name: b, count: g.minRate };
    if (b === 'faster') return { name: b, count: g.rate };
    if (b === 'pause') return { name: paused ? 'play' : 'pause', on: paused };
    if (b === 'ff') return { name: b, on: ff };
    if (b === 'nuke') return { name: b, on: nukeArmed > 0 || g.nuking };
    const n = g.left(b);
    return { name: b, count: n > 0 ? Math.min(99, n) : '', sel: selected === b, off: n <= 0 };
  });

  // everyone else is home or gone, and blockers never move: DOS waits for the
  // clock or the nuke
  const onlyBlockers = () => g.released >= g.count && !g.nuking && g.out > 0 && g.lemmings.every((L) => L.removed || L.action === 'blocking');

  // ---- the main loop ----
  function tick(now) {
    const dt = Math.min(250, now - last);
    last = now;
    frameNo++;
    keys();
    const menuOpen = ui.anyOpen;
    if (mode === 'title' && !menuOpen) {
      acc += dt;
      while (acc >= ITER_MS) { demo.solver.apply(demo); demo.step(); acc -= ITER_MS; if (demo.finished) demo = makeDemo(); }
    } else if (mode === 'play' && !paused && !menuOpen) {
      acc += dt;
      const step = ITER_MS / opts.speed / (ff ? 4 : 1);
      const events = [];
      let n = 0;
      while (acc >= step && n++ < 12) {
        g.step();
        events.push(...g.events);
        acc -= step;
        if (nukeArmed > 0) nukeArmed--;
        for (const f of flash) f.t++;
        flash = flash.filter((f) => f.t < 10);
      }
      if (acc > step) acc = 0;
      sound.play(events);
      if (g.finished && ++endDelay > 40) toResult();
    } else acc = 0;

    if (mode === 'title') drawTitle();
    else if (mode === 'preview') drawPreview();
    else if (mode === 'result') drawResult();
    else {
      const h = hover.on ? pick(hover.x, hover.y, hover.touch) : { L: null, count: 0 };
      const tags = [];
      if (opts.unlimitedSkills) tags.push('INF');
      if (opts.safeFalls) tags.push('SAFE');
      if (opts.noTimeLimit) tags.push('NOCLOCK');
      if (opts.saveOne) tags.push('SAVE1');
      if (opts.pauseAssign) tags.push('PAUSE+');
      screen.drawGame(g, {
        scrollX, selected, paused, ff, nukeArmed: nukeArmed > 0, flash,
        hover: h.ok ? h.L : null, hoverCount: h.count, hoverAny: h.L,
        cheats: tags.join(' '),
        message: paused && !menuOpen ? 'PAUSED' : nukeArmed > 0 ? 'TAP NUKE AGAIN TO BLOW THEM ALL UP' : onlyBlockers() ? 'ONLY BLOCKERS LEFT: NUKE TO FINISH' : null,
      });
    }
    ui.setButtons(mode === 'play' && opts.bigButtons ? clearButtons() : null);
    image.data.set(screen.rgba);
    ctx.putImageData(image, 0, 0);
  }
  function frame(now) { tick(now); requestAnimationFrame(frame); }
  // debug: run n frames of 1/60 s straight away (for testing in a hidden tab)
  window.__lem.run = (n = 1) => { for (let i = 0; i < n; i++) tick(last + 1000 / 60); };
  window.__lem.tap = (x, y) => tapWorld(x, y, true);
  window.__lem.press = pressButton;

  toTitle();
  requestAnimationFrame(frame);

  // audio can only start from a user gesture on iOS
  for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click']) window.addEventListener(ev, () => sound.unlock(), { passive: true, capture: true });
  // iOS: play through the silent switch, as a game should
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older iOS */ }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'play') { paused = true; music.stop(); }
    if (!document.hidden) {
      sound.unlock(); if (mode === 'play' && opts.music) music.start(levelNo);
      navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {}); // a home-screen app can stay open for days
    }
  });

  // a new version: switch to it now (or when this level's over), not next time
  const sw = navigator.serviceWorker;
  if (sw?.controller) {
    let reloadDue = false;
    sw.addEventListener('controllerchange', () => { reloadDue = true; });
    setInterval(() => { if (reloadDue && mode !== 'play') location.reload(); }, 1000);
  }
  // which version this is, in settings
  (window.caches?.keys() ?? Promise.resolve([])).then((k) => ui.setVersion(k.find((n) => n.startsWith('lemmings-'))?.replace('lemmings-', '') ?? 'dev')).catch(() => {});
}

try { main(); } catch (err) {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;padding:1em">${err.stack || err}</pre>`);
}
