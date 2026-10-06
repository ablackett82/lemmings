// Draws the DOS screen: 320x200, the top 160 rows a window onto the 1600-wide
// level, then the info line and the skill panel with the minimap, laid out as
// on DOS (release rate - and +, the eight skills, pause, nuke, and here a
// fast-forward button too).
import { WORLD_W, WORLD_H, SKILLS } from '../game/engine.js';
import { makeLemmingFrames, LEM_PALETTE, DIGITS } from '../game/sprites.js';
import { oneWayArrow } from '../game/objects.js';
import { FONT } from './font.js';

export const SCREEN_W = 320, SCREEN_H = 200, VIEW_H = 160;
export const PANEL_Y = 176, BTN_W = 16, BTN_H = 24;
export const BUTTONS = ['slower', 'faster', ...SKILLS, 'pause', 'nuke', 'ff'];
export const MINI = { x: 214, y: 178, w: 100, h: 20 };

const PANEL = [44, 52, 78], PANEL_HI = [84, 96, 136], PANEL_LO = [24, 28, 44];
const INFO = [80, 230, 90];
const LABEL = { walking: 'WALKER', jumping: 'WALKER', digging: 'DIGGER', climbing: 'CLIMBER', drowning: 'DROWNER', hoisting: 'CLIMBER', building: 'BUILDER', bashing: 'BASHER', mining: 'MINER', falling: 'FALLER', floating: 'FLOATER', splatting: 'SPLATTER', exiting: 'WALKER', vaporizing: 'FRIER', blocking: 'BLOCKER', shrugging: 'SHRUGGER', ohnoing: 'BOMBER', exploding: 'BOMBER' };
const ICON = { climber: ['climbing', 2], floater: ['floating', 5], bomber: ['ohnoing', 3], blocker: ['blocking', 0], builder: ['building', 8], basher: ['bashing', 3], miner: ['mining', 7], digger: ['digging', 1] };

export class Screen {
  constructor() {
    this.rgba = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
    this.frames = makeLemmingFrames();
    this.objCache = new Map();
    this.mini = null; this.miniAge = 0;
  }

  // ---- drawing primitives ----------------------------------------------------

  px(x, y, c) {
    if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return;
    const i = (y * SCREEN_W + x) * 4;
    this.rgba[i] = c[0]; this.rgba[i + 1] = c[1]; this.rgba[i + 2] = c[2]; this.rgba[i + 3] = 255;
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); }
  frame(x, y, w, h, c) { this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c); this.rect(x, y, 1, h, c); this.rect(x + w - 1, y, 1, h, c); }
  clear(c = [0, 0, 0]) { for (let i = 0; i < SCREEN_W * SCREEN_H; i++) { const o = i * 4; this.rgba[o] = c[0]; this.rgba[o + 1] = c[1]; this.rgba[o + 2] = c[2]; this.rgba[o + 3] = 255; } }

  /** Text in the 5x7 font. */
  text(x, y, s, c = [255, 255, 255], scale = 1) {
    s = String(s).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i]];
      if (!g) continue;
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) {
        if ((g[r] >> (4 - k)) & 1) this.rect(x + (i * 6 + k) * scale, y + r * scale, scale, scale, c);
      }
    }
  }
  textWidth(s, scale = 1) { return (String(s).length * 6 - 1) * scale; }
  centred(y, s, c, scale = 1) { this.text(Math.round((SCREEN_W - this.textWidth(s, scale)) / 2), y, s, c, scale); }

  /** Small 3x5 digits (the skill counts, the bomb countdown). */
  digits(x, y, s, c) {
    for (const ch of String(s)) {
      const g = SMALL[ch];
      if (g) for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '1') this.px(x + k, y + r, c);
      x += 4;
    }
  }

  /** A lemming animation frame with its foot at (x, y) on the screen. */
  sprite(f, x, y, clipBottom = SCREEN_H, tint = null) {
    const left = x - f.fx, top = y - f.fy;
    for (let j = 0; j < f.h; j++) {
      const sy = top + j;
      if (sy < 0 || sy >= clipBottom) continue;
      for (let i = 0; i < f.w; i++) {
        const c = f.data[j * f.w + i];
        if (c) this.px(left + i, sy, tint ?? LEM_PALETTE[c]);
      }
    }
  }

  objectFrames(o) {
    let list = this.objCache.get(o.def);
    if (!list) {
      list = [];
      for (let i = 0; i < o.def.frames; i++) list.push(o.def.draw ? o.def.draw(i) : null);
      this.objCache.set(o.def, list);
    }
    return list[o.frame] ?? list[0];
  }

  drawObject(o, sx) {
    const p = this.objectFrames(o);
    if (!p) return;
    const x0 = o.x - sx;
    for (let j = 0; j < p.h; j++) {
      const y = o.y + j;
      if (y < 0 || y >= VIEW_H) continue;
      for (let i = 0; i < p.w; i++) {
        const x = x0 + i;
        if (x < 0 || x >= SCREEN_W) continue;
        const k = (j * p.w + i) * 4;
        if (p.data[k + 3]) this.px(x, y, [p.data[k], p.data[k + 1], p.data[k + 2]]);
      }
    }
  }

  // ---- the game --------------------------------------------------------------

  /**
   * ui: { scrollX, selected, paused, ff, nukeArmed, hover: lemming or null,
   *   hoverCount, flash: [{x, y, t}], cheats: string }
   */
  drawGame(g, ui) {
    const sx = ui.scrollX;
    const lv = g.level, pal = lv.palette, pix = g.pix, rgba = this.rgba;
    this.rect(0, 0, SCREEN_W, VIEW_H, [0, 0, 0]);
    for (const o of g.objects) if (!o.front && o.kind !== 'oneway') this.drawObject(o, sx);
    // the terrain
    for (let y = 0; y < VIEW_H; y++) {
      const row = y * WORLD_W;
      for (let x = 0; x < SCREEN_W; x++) {
        const wx = x + sx;
        if (wx < 0 || wx >= WORLD_W) continue;
        const c = pix[row + wx];
        if (!c) continue;
        const col = pal[c], o = (y * SCREEN_W + x) * 4;
        rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2];
      }
    }
    // one-way arrows, on whatever terrain is still there
    for (const o of lv.oneway) {
      for (let y = Math.max(0, o.y); y < Math.min(VIEW_H, o.y + o.def.h); y++) for (let x = o.x; x < o.x + o.def.w; x++) {
        const scr = x - sx;
        if (scr < 0 || scr >= SCREEN_W || !pix[y * WORLD_W + x]) continue;
        const ax = o.dir === 'left' ? o.x + o.def.w - 1 - x : x - o.x;
        if (oneWayArrow(ax, y - o.y)) this.px(scr, y, o.dir === 'left' ? [250, 240, 120] : [140, 240, 255]);
      }
    }
    for (const o of g.objects) if (o.front) this.drawObject(o, sx);
    // the lemmings
    for (const L of g.lemmings) {
      if (L.removed) continue;
      const set = this.frames[L.action][L.rtl ? 1 : 0];
      const f = set[Math.min(L.frame, set.length - 1)];
      this.sprite(f, L.x - sx, L.y, VIEW_H);
      if (L.explosionTimer > 0) {
        const d = L.explosionTimer >= 65 ? 5 : L.explosionTimer >= 49 ? 4 : L.explosionTimer >= 33 ? 3 : L.explosionTimer >= 17 ? 2 : 1;
        const rows = DIGITS[d];
        for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (rows[r][k] === '1') {
          const yy = L.y - f.fy - 7 + r;
          if (yy >= 0 && yy < VIEW_H) this.px(L.x - sx - 1 + k, yy, [255, 255, 255]);
        }
      }
    }
    // explosion bits
    const PC = [[255, 255, 255], [255, 230, 60], [255, 120, 20], [230, 40, 40], [0, 200, 40], [70, 90, 240], [240, 210, 190], [170, 170, 190]];
    for (const p of g.particles) {
      const x = Math.round(p.x) - sx, y = Math.round(p.y);
      if (y >= 0 && y < VIEW_H) this.px(x, y, PC[p.c]);
    }
    // the lemming the skill would go to
    if (ui.hover && !ui.hover.removed) {
      const L = ui.hover, x = L.x - sx, y = L.y - 5;
      const c = [255, 255, 255];
      for (const [dx, dy] of [[-7, -7], [6, -7], [-7, 6], [6, 6]]) {
        const hx = Math.sign(dx), hy = Math.sign(dy);
        for (let k = 0; k < 3; k++) {
          if (y + dy - hy * k >= 0 && y + dy - hy * k < VIEW_H) this.px(x + dx, y + dy - hy * k, c);
          if (y + dy >= 0 && y + dy < VIEW_H) this.px(x + dx - hx * k, y + dy, c);
        }
      }
    }
    for (const f of ui.flash ?? []) {
      const r = 10 - f.t;
      if (r > 2) this.frame(f.x - sx - r, f.y - 5 - r, r * 2, r * 2, [255, 255, 255]);
    }
    if (ui.cheats) this.text(SCREEN_W - this.textWidth(ui.cheats) - 2, 2, ui.cheats, [255, 110, 110]);
    if (ui.message) this.centred(70, ui.message, [255, 255, 255]);
    this.drawPanel(g, ui);
    return rgba;
  }

  drawPanel(g, ui) {
    this.rect(0, VIEW_H, SCREEN_W, SCREEN_H - VIEW_H, [0, 0, 0]);
    // the info line
    let left = '';
    if (ui.hover && ui.hoverCount) {
      const L = ui.hover;
      const name = L.isClimber && L.isFloater ? 'ATHLETE' : (L.action === 'walking' || L.action === 'falling') && L.isClimber ? 'CLIMBER' : (L.action === 'walking' || L.action === 'falling') && L.isFloater ? 'FLOATER' : LABEL[L.action];
      left = `${name} ${ui.hoverCount}`;
    }
    this.text(2, 165, left, INFO);
    this.text(104, 165, `OUT ${g.out}`, INFO);
    this.text(170, 165, `IN ${g.savedPercent}%`, INFO);
    const time = g.assist.noTimeLimit ? 'TIME --' : `TIME ${Math.max(0, g.minutes)}-${String(Math.max(0, g.seconds)).padStart(2, '0')}`;
    this.text(236, 165, time, INFO);
    // the buttons
    BUTTONS.forEach((b, i) => {
      const x = i * BTN_W, y = PANEL_Y;
      const on = (b === 'pause' && ui.paused) || (b === 'ff' && ui.ff) || (b === 'nuke' && (ui.nukeArmed || g.nuking));
      this.rect(x, y, BTN_W, BTN_H, on ? [110, 70, 70] : PANEL);
      this.rect(x, y, BTN_W, 1, PANEL_HI); this.rect(x, y, 1, BTN_H, PANEL_HI);
      this.rect(x, y + BTN_H - 1, BTN_W, 1, PANEL_LO); this.rect(x + BTN_W - 1, y, 1, BTN_H, PANEL_LO);
      const num = (n) => this.digits(x + (n >= 10 ? 4 : 6), y + 2, n, [255, 255, 255]);
      if (b === 'slower') { num(g.minRate); this.rect(x + 4, y + 15, 8, 2, [255, 255, 255]); }
      else if (b === 'faster') { num(g.rate); this.rect(x + 4, y + 15, 8, 2, [255, 255, 255]); this.rect(x + 7, y + 12, 2, 8, [255, 255, 255]); }
      else if (b === 'pause') { this.rect(x + 4, y + 9, 3, 10, [255, 255, 255]); this.rect(x + 9, y + 9, 3, 10, [255, 255, 255]); }
      else if (b === 'ff') {
        for (let k = 0; k < 5; k++) { this.rect(x + 2 + k, y + 10 + k, 1, 9 - k * 2, [255, 255, 255]); this.rect(x + 8 + k, y + 10 + k, 1, 9 - k * 2, [255, 255, 255]); }
      } else if (b === 'nuke') {
        // a mushroom cloud
        const c1 = [255, 200, 60], c2 = [255, 120, 30];
        this.rect(x + 4, y + 6, 8, 2, c2); this.rect(x + 3, y + 8, 10, 3, c1); this.rect(x + 4, y + 11, 8, 1, c2);
        this.rect(x + 7, y + 12, 2, 6, c1); this.rect(x + 4, y + 18, 8, 2, c2); this.rect(x + 3, y + 20, 10, 1, c1);
      } else {
        const n = g.left(b);
        if (n > 0) num(Math.min(99, n));
        const [act, fi] = ICON[b];
        this.sprite(this.frames[act][0][fi], x + 8, y + 22, SCREEN_H, n > 0 ? null : [90, 100, 130]);
        if (ui.selected === b) this.frame(x, y, BTN_W, BTN_H, [255, 255, 255]);
      }
    });
    this.drawMinimap(g, ui);
  }

  drawMinimap(g, ui) {
    const { x: mx, y: my, w, h } = MINI;
    if (!this.mini || this.miniGame !== g || --this.miniAge <= 0) {
      this.mini = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let n = 0;
        for (let y = j * 8; y < j * 8 + 8; y += 2) for (let x = i * 16; x < i * 16 + 16; x += 2) if (g.pix[y * WORLD_W + x]) n++;
        this.mini[j * w + i] = n;
      }
      this.miniGame = g; this.miniAge = 10;
    }
    this.rect(mx - 1, my - 1, w + 2, h + 2, PANEL_LO);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const n = this.mini[j * w + i];
      this.px(mx + i, my + j, n > 6 ? [150, 110, 70] : n > 0 ? [90, 66, 44] : [0, 0, 0]);
    }
    for (const o of g.objects) {
      if (o.kind === 'exit') this.px(mx + ((o.x + 20) >> 4), my + ((o.y + 20) >> 3), [255, 220, 60]);
      if (o.kind === 'entrance') this.px(mx + ((o.x + 24) >> 4), my + ((o.y + 8) >> 3), [220, 220, 255]);
      if (o.kind === 'water' || o.kind === 'fire') this.rect(mx + (o.x >> 4), my + ((o.y + 6) >> 3), 2, 1, o.kind === 'water' ? [40, 80, 220] : [230, 90, 30]);
    }
    for (const L of g.lemmings) if (!L.removed) this.px(mx + (L.x >> 4), my + Math.max(0, Math.min(h - 1, (L.y - 4) >> 3)), [0, 255, 0]);
    // the window
    const vx = mx + Math.round(ui.scrollX / 16);
    this.frame(vx, my - 1, 20, h + 2, [255, 255, 255]);
  }
}

// small digits for the panel
const SMALL = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '011', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

export { WORLD_W, WORLD_H };
