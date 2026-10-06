// The game itself: one level being played, one iteration at a time.
//
// The rules are the DOS version's, taken from Lemmix (the Lemmix Player
// source, LemGame.pas), the open-source reimplementation that ccexplore and
// namida checked against DOS Lemmings frame by frame. The routine names below
// match Lemmix's (handleWalking = HandleWalking and so on), and so do the
// numbers: a lemming steps up 6 pixels but not 7, falls 60 pixels and lives,
// lays 12 bricks of 6 pixels, a bomber counts down 79 iterations, the release
// rate formula, the 4x4-pixel object map, the DOS quirks Lemmix keeps on for
// the original game (fallers start at 3, ABBA entrance order, the climber /
// shrugger bug, the miner one-way-right bug, splatting into an exit).
//
// An iteration is 60 ms on DOS (about 17 a second); the clock ticks every 17.
//
// Coordinates are the lemming's foot: (x, y) is the terrain pixel it stands on.

export const WORLD_W = 1600;
export const WORLD_H = 160;

const LEMMING_MIN_X = 0;
const LEMMING_MAX_X = 1647;
const LEMMING_MAX_Y = 163;
const HEAD_MIN_Y = -5;
const MAX_FALLDISTANCE = 60;
const PARTICLE_FRAMECOUNT = 52;

// object map values (4x4 pixel cells): 0..127 is a trap's index, 128+ an effect
export const DOM = {
  NONE: 128, EXIT: 129, FORCELEFT: 130, FORCERIGHT: 131, WATER: 133, FIRE: 134,
  ONEWAYLEFT: 135, ONEWAYRIGHT: 136, STEEL: 137, BLOCKER: 138,
};
const OM_OFF = 16;                       // the map covers x -16..1647, y -16..175
const OM_W = (1647 + OM_OFF) >> 2, OM_H = (175 + OM_OFF) >> 2, OM_ADD = OM_OFF >> 2;

// the actions, and each one's animation: frames, the foot's place in the frame
// (footX, footY), and whether it loops (DOS MAIN.DAT's table)
export const ANIM = {
  walking:    { frames: 8,  fx: 8, fy: 10, loop: true },
  jumping:    { frames: 1,  fx: 8, fy: 10, loop: false },
  digging:    { frames: 16, fx: 8, fy: 12, loop: true },
  climbing:   { frames: 8,  fx: 8, fy: 12, loop: true },
  drowning:   { frames: 16, fx: 8, fy: 10, loop: false },
  hoisting:   { frames: 8,  fx: 8, fy: 12, loop: false },
  building:   { frames: 16, fx: 8, fy: 13, loop: true },
  bashing:    { frames: 32, fx: 8, fy: 10, loop: true },
  mining:     { frames: 24, fx: 8, fy: 13, loop: true },
  falling:    { frames: 4,  fx: 8, fy: 10, loop: true },
  floating:   { frames: 8,  fx: 8, fy: 16, loop: true },
  splatting:  { frames: 16, fx: 8, fy: 10, loop: false },
  exiting:    { frames: 8,  fx: 8, fy: 13, loop: false },
  vaporizing: { frames: 14, fx: 8, fy: 14, loop: false },
  blocking:   { frames: 16, fx: 8, fy: 10, loop: true },
  shrugging:  { frames: 8,  fx: 8, fy: 10, loop: false },
  ohnoing:    { frames: 16, fx: 8, fy: 10, loop: false },
  exploding:  { frames: 1,  fx: 16, fy: 25, loop: false },
};

// the skill panel's skills, in panel order
export const SKILLS = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];

// the floater: 16 steps of (dy, frame), then round 8..15 again
const FLOAT_TABLE = [
  [3, 1], [3, 2], [3, 3], [3, 5], [-1, 5], [0, 5], [1, 5], [1, 5],
  [2, 5], [2, 6], [2, 7], [2, 7], [2, 6], [2, 5], [2, 4], [2, 4],
];

// what the cursor prefers when lemmings overlap (PrioritizedHitTest)
const PRIO = new Set(['blocking', 'building', 'shrugging', 'bashing', 'mining', 'digging', 'ohnoing']);

// the shapes bashers, miners and bombers cut out. DOS keeps these as bitmaps
// in MAIN.DAT; these are drawn to the same sizes (bash 16x10 in 4 steps, mine
// 16x13 in 2, explosion 16x22) and cut the same tunnels, give or take a pixel.
export const MASKS = makeMasks();

export const DEFAULT_ASSIST = {
  unlimitedSkills: false, // every skill has 99 and never runs out
  noTimeLimit: false,     // the clock never runs out
  safeFalls: false,       // no fall is too far
  saveOne: false,         // saving one lemming passes the level
};

export class Lemming {
  constructor(index) {
    this.index = index;
    this.x = 0; this.y = 0; this.dx = 1;
    this.action = null;
    this.frame = 0; this.endOfAnim = false;
    this.fallen = 0; this.bricksLeft = 0;
    this.isClimber = false; this.isFloater = false; this.isBlocking = false;
    this.isNewDigger = false;
    this.explosionTimer = 0;
    this.floatIdx = 0;
    this.removed = false; this.exploded = false; this.particleTimer = 0;
    this.objBelow = DOM.NONE; this.objInFront = DOM.NONE;
    this.savedMap = new Uint8Array(9);
  }
  get anim() { return ANIM[this.action]; }
  get rtl() { return this.dx < 0; }
}

export class Game {
  /**
   * level: { terrain: Uint8Array (WORLD_W*WORLD_H palette indices, 0 = empty),
   *   steel: [{x,y,w,h}], objects: [{kind, x, y, def}], count, save, rate,
   *   time (minutes), skills: {climber: n, ...}, brick (palette index of the
   *   builder's bricks) }
   */
  constructor(level, assist = {}) {
    this.level = level;
    this.assist = { ...DEFAULT_ASSIST, ...assist };
    this.pix = new Uint8Array(level.terrain); // the world: changes as lemmings dig
    this.objMap = new Uint8Array(OM_W * OM_H).fill(DOM.NONE);
    this.lemmings = [];
    this.particles = [];
    this.events = [];
    this.iteration = 0;
    this.clockFrame = 0;
    this.minutes = level.time; this.seconds = 0;
    this.released = 0; this.out = 0; this.in = 0; this.removedCount = 0;
    this.count = level.count;
    this.rate = level.rate; this.minRate = level.rate;
    this.rateDelta = 0;
    this.skills = {};
    for (const s of SKILLS) this.skills[s] = level.skills?.[s] ?? 0;
    this.nextRelease = 20;
    this.entriesOpened = false;
    this.nuking = false; this.nukeInProgress = false; this.nukeIndex = 0;
    this.particleFinish = 0;
    this.finished = false; this.timeUp = false;
    this.cheated = false;

    // objects: runtime state for animation and traps
    this.objects = level.objects.map((o, i) => ({ ...o, index: i, frame: o.def.startFrame ?? 0, triggered: false }));
    // DOS releases from up to 4 entrances in the order A B A B (one: A A A A;
    // two: A B B A; three: A B C B)
    const ent = this.objects.filter((o) => o.kind === 'entrance').slice(0, 4);
    const order = { 1: [0, 0, 0, 0], 2: [0, 1, 1, 0], 3: [0, 1, 2, 1], 4: [0, 1, 2, 3] }[ent.length];
    this.entryTable = order ? order.map((i) => ent[i]) : [];
    this.initObjectMap();
  }

  // ---- the world ------------------------------------------------------------

  hasPixel(x, y) {
    return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && this.pix[y * WORLD_W + x] !== 0;
  }
  /** HasPixelAt_ClipY: above minY, look at minY instead. */
  hasPixelClip(x, y, minY) { return this.hasPixel(x, y >= minY ? y : minY); }
  removePixel(x, y) { if (x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H) this.pix[y * WORLD_W + x] = 0; }

  readMap(x, y) {
    x = (x >> 2) + OM_ADD; y = (y >> 2) + OM_ADD; // >> rounds down for negatives, like "and not 3"
    return x >= 0 && x < OM_W && y >= 0 && y < OM_H ? this.objMap[y * OM_W + x] : DOM.NONE;
  }
  writeMap(x, y, v) {
    x = (x >> 2) + OM_ADD; y = (y >> 2) + OM_ADD;
    if (x >= 0 && x < OM_W && y >= 0 && y < OM_H) this.objMap[y * OM_W + x] = v;
  }

  initObjectMap() {
    for (const s of this.level.steel) {
      for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) this.writeMap(x, y, DOM.STEEL);
    }
    for (const o of this.objects) {
      const t = o.def.trigger;
      if (!t) continue;
      const v = t.effect === 'trap' ? o.index : DOM[t.effect.toUpperCase()];
      const left = (o.x & ~3) + t.x, top = (o.y & ~3) + t.y;
      for (let y = top; y < top + t.h; y++) for (let x = left; x < left + t.w; x++) this.writeMap(x, y, v);
    }
  }

  // ---- one iteration (UpdateLemmings) ---------------------------------------

  step() {
    this.events = [];
    if (this.finished) return;
    this.checkFinished();
    if (this.finished) return;
    this.adjustRate();
    this.incrementIteration();
    this.checkRelease();
    this.checkLemmings();
    this.checkNuking();
    this.updateObjects();
    this.updateParticles();
  }

  checkFinished() {
    if (this.particleFinish > 0) return;
    if (!this.assist.noTimeLimit && this.minutes <= 0 && this.seconds <= 0) { this.timeUp = true; this.finished = true; return; }
    if (this.in >= this.count || this.removedCount >= this.count || (this.nuking && this.out === 0)) this.finished = true;
  }

  adjustRate() {
    if (this.rateDelta) this.rate = Math.max(this.minRate, Math.min(99, this.rate + this.rateDelta));
  }

  incrementIteration() {
    this.iteration++;
    if (this.particleFinish > 0) this.particleFinish--;
    if (++this.clockFrame === 17) {
      this.clockFrame = 0;
      if (!this.assist.noTimeLimit && --this.seconds < 0) { this.minutes--; this.seconds = 59; }
    }
    if (this.iteration === 15) this.events.push('letsgo');
    if (this.iteration === 34) this.events.push('door');
    if (this.iteration === 35) {
      this.entriesOpened = true;
      for (const o of this.objects) if (o.kind === 'entrance') { o.triggered = true; o.frame = 1; }
    }
  }

  releaseInterval() {
    let r = 99 - this.rate;
    if (r < 0) r += 256;
    return (r >> 1) + 4;
  }

  checkRelease() {
    if (!this.entriesOpened || this.nuking) return;
    if (--this.nextRelease !== 0) return;
    this.nextRelease = this.releaseInterval();
    if (this.released >= this.count) return;
    const e = this.entryTable[this.released % 4];
    if (!e) return;
    const L = new Lemming(this.lemmings.length);
    this.lemmings.push(L);
    this.transition(L, 'falling');
    L.x = e.x + 24; L.y = e.y + 14; L.dx = 1;
    this.released++; this.out++;
  }

  checkLemmings() {
    for (const L of this.lemmings) {
      if (L.particleTimer > 0) L.particleTimer--;
      if (L.removed) continue;
      if (L.explosionTimer !== 0 && this.updateExplosionTimer(L)) continue;
      if (this.handleLemming(L)) this.checkObjects(L);
    }
  }

  checkNuking() {
    if (!this.nuking || !this.nukeInProgress) return;
    while (this.nukeIndex < this.released && this.lemmings[this.nukeIndex].removed) this.nukeIndex++;
    if (this.nukeIndex > this.released - 1) { this.nukeInProgress = false; return; }
    const L = this.lemmings[this.nukeIndex++];
    if (L.explosionTimer === 0 && L.action !== 'splatting' && L.action !== 'exploding') L.explosionTimer = 79;
  }

  updateObjects() {
    for (const o of this.objects) {
      const d = o.def;
      if (o.triggered || d.continuous) o.frame++;
      if (o.frame >= d.frames) { o.frame = 0; o.triggered = false; }
    }
  }

  // ---- states ----------------------------------------------------------------

  transition(L, action, turn = false) {
    if (L.action === action && !turn) return;
    if (turn) L.dx = -L.dx;
    if (L.action === action) return;
    L.action = action;
    L.frame = 0; L.endOfAnim = false; L.fallen = 0; L.bricksLeft = 0;
    switch (action) {
      case 'splatting': L.explosionTimer = 0; L.dx = 0; this.events.push('splat'); break;
      case 'blocking': L.isBlocking = true; this.saveMap(L); this.setBlockerField(L); break;
      case 'exiting': this.events.push('yippee'); break;
      case 'digging': L.isNewDigger = true; break;
      case 'falling': L.fallen = 3; break;
      case 'building': L.bricksLeft = 12; break;
      case 'ohnoing': this.events.push('ohno'); break;
      case 'exploding': this.events.push('explode'); break;
      case 'floating': L.floatIdx = 0; break;
      case 'mining': L.y++; break;
    }
  }

  turnAround(L) { L.dx = -L.dx; }

  removeLemming(L) {
    L.removed = true;
    this.out--;
    this.removedCount++;
  }

  saveMap(L) {
    let i = 0;
    for (const dy of [-6, -2, 2]) for (const dx of [-4, 0, 4]) L.savedMap[i++] = this.readMap(L.x + dx, L.y + dy);
  }
  restoreMap(L) {
    let i = 0;
    for (const dy of [-6, -2, 2]) for (const dx of [-4, 0, 4]) this.writeMap(L.x + dx, L.y + dy, L.savedMap[i++]);
  }
  setBlockerField(L) {
    for (const dy of [-6, -2, 2]) {
      this.writeMap(L.x - 4, L.y + dy, DOM.FORCELEFT);
      this.writeMap(L.x, L.y + dy, DOM.BLOCKER);
      this.writeMap(L.x + 4, L.y + dy, DOM.FORCERIGHT);
    }
  }
  overlapsField(L) {
    for (const dy of [-6, -2, 2]) for (const dx of [-4, 0, 4]) {
      const v = this.readMap(L.x + dx, L.y + dy);
      if (v === DOM.FORCELEFT || v === DOM.BLOCKER || v === DOM.FORCERIGHT) return true;
    }
    return false;
  }

  updateExplosionTimer(L) {
    if (--L.explosionTimer > 0) return false;
    if (['vaporizing', 'drowning', 'floating', 'falling'].includes(L.action)) this.transition(L, 'exploding');
    else this.transition(L, 'ohnoing');
    return true;
  }

  checkTopBoundary(L) {
    const dy = -L.anim.fy;
    if (L.y + dy < HEAD_MIN_Y) {
      L.y = HEAD_MIN_Y - 2 - dy;
      this.turnAround(L);
      if (L.action === 'jumping') this.transition(L, 'walking');
    }
  }

  checkObjects(L) {
    L.objBelow = this.readMap(L.x, L.y);
    L.objInFront = this.readMap(L.x + 8 * L.dx, L.y - 8);
    const v = L.objBelow;
    if (v === DOM.NONE) return;
    if (v < 128) {
      const o = this.objects[v];
      if (!o.triggered) {
        o.triggered = true;
        this.removeLemming(L);
        this.events.push('trap');
      }
      return;
    }
    switch (v) {
      case DOM.EXIT: if (L.action !== 'falling') this.transition(L, 'exiting'); break;
      case DOM.FORCELEFT: if (L.dx > 0) this.turnAround(L); break;
      case DOM.FORCERIGHT: if (L.dx < 0) this.turnAround(L); break;
      case DOM.WATER: this.transition(L, 'drowning'); this.events.push('drown'); break;
      case DOM.FIRE: this.transition(L, 'vaporizing'); this.events.push('fry'); break;
    }
  }

  /** HandleLemming: next frame, then the action. True means check objects. */
  handleLemming(L) {
    if (L.action !== 'floating' && L.action !== 'digging') {
      if (L.frame < L.anim.frames - 1) { L.endOfAnim = false; L.frame++; }
      else { L.endOfAnim = true; if (L.anim.loop) L.frame = 0; }
    }
    return this[L.action](L);
  }

  walking(L) {
    L.x += L.dx;
    if (L.x < LEMMING_MIN_X || L.x > LEMMING_MAX_X) { this.turnAround(L); return true; }
    if (this.hasPixelClip(L.x, L.y, 0)) {
      // walk up, jump up, climb, or turn round
      let dy = 0, ny = L.y;
      while (dy <= 6 && this.hasPixelClip(L.x, ny - 1, -dy - 1)) { dy++; ny--; }
      if (dy > 6) {
        if (L.isClimber) this.transition(L, 'climbing'); else this.turnAround(L);
        return true;
      }
      if (dy >= 3) { this.transition(L, 'jumping'); ny = L.y - 2; }
      L.y = ny;
      this.checkTopBoundary(L);
      return true;
    }
    // walk down, or fall
    let dy = 1;
    while (dy <= 3) {
      L.y++;
      if (this.hasPixelClip(L.x, L.y, dy)) break;
      dy++;
    }
    if (dy > 3) { L.y++; this.transition(L, 'falling'); }
    if (L.y > LEMMING_MAX_Y) { this.removeLemming(L); return false; }
    return true;
  }

  jumping(L) {
    let dy = 0;
    while (dy < 2 && this.hasPixelClip(L.x, L.y - 1, -dy - 1)) { dy++; L.y--; }
    if (dy < 2) this.transition(L, 'walking');
    this.checkTopBoundary(L);
    return true;
  }

  digOneRow(L, y) {
    let any = false;
    const yy = Math.max(0, y);
    for (let x = L.x - 4; x < L.x + 5; x++) if (this.hasPixel(x, yy)) { this.removePixel(x, yy); any = true; }
    return any;
  }

  digging(L) {
    if (L.isNewDigger) {
      this.digOneRow(L, L.y - 2);
      this.digOneRow(L, L.y - 1);
      L.isNewDigger = false;
    } else if (++L.frame >= 16) L.frame -= 16;
    if (L.frame !== 0 && L.frame !== 8) return false;
    const y = L.y;
    L.y++;
    if (L.y > LEMMING_MAX_Y) { this.removeLemming(L); return false; }
    if (!this.digOneRow(L, y)) this.transition(L, 'falling');
    else if (this.readMap(L.x, L.y) === DOM.STEEL) { this.events.push('steel'); this.transition(L, 'walking'); }
    return true;
  }

  climbing(L) {
    if (L.frame <= 3) {
      // near the top?
      if (!this.hasPixelClip(L.x, L.y - 7 - L.frame, 0)) {
        L.y = L.y - L.frame + 2;
        this.transition(L, 'hoisting');
        this.checkTopBoundary(L);
      }
      return true;
    }
    L.y--;
    // an overhang, or the top of the level: fall off backwards
    if (L.y - L.anim.fy < HEAD_MIN_Y || this.hasPixelClip(L.x - L.dx, L.y - 8, -8)) {
      this.transition(L, 'falling', true);
      L.x += L.dx * 2;
    }
    return true;
  }

  drowning(L) {
    if (L.endOfAnim) this.removeLemming(L);
    else if (!this.hasPixel(L.x + 8 * L.dx, L.y)) L.x += L.dx;
    return false;
  }

  hoisting(L) {
    if (L.frame <= 4) { L.y -= 2; this.checkTopBoundary(L); return true; }
    if (L.endOfAnim) { this.transition(L, 'walking'); this.checkTopBoundary(L); return true; }
    return false;
  }

  layBrick(L) {
    const x0 = L.dx === 1 ? L.x : L.x - 4;
    const shade = Math.max(0, Math.min(11, 12 - L.bricksLeft));
    const c = this.level.brick + shade;
    for (let x = x0; x < x0 + 6; x++) {
      if (x >= 0 && x < WORLD_W && L.y - 1 >= 0 && L.y - 1 < WORLD_H && this.pix[(L.y - 1) * WORLD_W + x] === 0) this.pix[(L.y - 1) * WORLD_W + x] = c;
    }
  }

  building(L) {
    if (L.frame === 10 && L.bricksLeft <= 3) this.events.push('buildwarn');
    if (L.frame === 9 || (L.frame === 10 && L.bricksLeft === 9)) { this.layBrick(L); return false; }
    if (L.frame !== 0) return true;
    const stop = () => { this.transition(L, 'walking', true); this.checkTopBoundary(L); return true; };
    L.x += L.dx; L.y--;
    if (L.x <= LEMMING_MIN_X || L.x > LEMMING_MAX_X || this.hasPixelClip(L.x, L.y - 1, -1)) return stop();
    L.x += L.dx;
    if (this.hasPixelClip(L.x, L.y - 1, -1)) return stop();
    if (--L.bricksLeft === 0) { this.transition(L, 'shrugging'); this.checkTopBoundary(L); return true; }
    if (this.hasPixelClip(L.x + L.dx * 2, L.y - 9, -9) || L.x <= LEMMING_MIN_X || L.x > LEMMING_MAX_X) return stop();
    // too high: becomes a walker (and, as on DOS, doesn't turn round)
    if (L.y - L.anim.fy < HEAD_MIN_Y) { this.transition(L, 'walking'); this.checkTopBoundary(L); }
    return true;
  }

  bashing(L) {
    const index = L.frame >= 16 ? L.frame - 16 : L.frame;
    if (index >= 11 && index <= 15) {
      L.x += L.dx;
      if (L.x < LEMMING_MIN_X || L.x > LEMMING_MAX_X) { this.transition(L, 'walking', true); return true; }
      let dy = 0;
      while (dy < 3 && !this.hasPixelClip(L.x, L.y, dy)) { dy++; L.y++; }
      if (dy === 3) { this.transition(L, 'falling'); return true; }
      const front = this.readMap(L.x + L.dx * 8, L.y - 8);
      if (front === DOM.STEEL) this.events.push('steel');
      if (front === DOM.STEEL || (front === DOM.ONEWAYLEFT && L.dx !== -1) || (front === DOM.ONEWAYRIGHT && L.dx !== 1)) this.transition(L, 'walking', true);
      return true;
    }
    if (index >= 2 && index <= 5) {
      this.applyMask(MASKS.bash[index - 2], L.rtl, L.x - 8, L.y - 10);
      // frame 5 (not 21): nothing left in front? stop bashing
      if (L.frame === 5) {
        let n = 0, x = L.x + L.dx * 8;
        while (n < 4 && !this.hasPixel(x, L.y - 6)) { n++; x += L.dx; }
        if (n === 4) this.transition(L, 'walking');
      }
    }
    return false;
  }

  mining(L) {
    if (L.frame === 1) { this.applyMask(MASKS.mine[0], L.rtl, L.x - 8, L.y - 13); return false; }
    if (L.frame === 2) { this.applyMask(MASKS.mine[1], L.rtl, L.x + L.dx - 8, L.y + 1 - 13); return false; }
    if (L.frame === 3 || L.frame === 15) {
      for (let i = 0; i < 2; i++) {
        L.x += L.dx;
        if (L.x < LEMMING_MIN_X || L.x > LEMMING_MAX_X) { this.transition(L, 'walking', true); return true; }
      }
      if (L.frame === 3) {
        L.y++;
        if (L.y > LEMMING_MAX_Y) { this.removeLemming(L); return false; }
      }
      if (!this.hasPixelClip(L.x, L.y, 0)) { this.transition(L, 'falling'); return true; }
      const below = this.readMap(L.x, L.y);
      if (below === DOM.STEEL) this.events.push('steel');
      // DOS bug kept: a one-way-right wall can't be mined from either side
      if (below === DOM.STEEL || (below === DOM.ONEWAYLEFT && L.dx !== -1) || below === DOM.ONEWAYRIGHT) this.transition(L, 'walking', true);
      return true;
    }
    if (L.frame === 0) {
      L.y++;
      if (L.y > LEMMING_MAX_Y) { this.removeLemming(L); return false; }
      return true;
    }
    return false;
  }

  falling(L) {
    if (L.fallen > 16 && L.isFloater) { this.transition(L, 'floating'); return true; }
    let dy = 0;
    while (dy < 3 && !this.hasPixelClip(L.x, L.y, dy)) {
      dy++; L.y++;
      if (L.y > LEMMING_MAX_Y) { this.removeLemming(L); return false; }
    }
    if (dy === 3) { L.fallen += 3; return true; }
    // landed. (Returning true lets a splatting lemming that lands in an exit
    // go in, as on DOS.)
    if (L.fallen > MAX_FALLDISTANCE && !this.assist.safeFalls) this.transition(L, 'splatting');
    else this.transition(L, 'walking');
    return true;
  }

  floating(L) {
    const [dy0, frame] = FLOAT_TABLE[L.floatIdx];
    L.frame = frame;
    if (++L.floatIdx >= 16) L.floatIdx = 8;
    let dy = dy0;
    if (dy <= 0) L.y += dy;
    else {
      let minY = 0;
      while (dy > 0) {
        if (this.hasPixelClip(L.x, L.y, minY)) { this.transition(L, 'walking'); return true; }
        L.y++; dy--; minY++;
      }
    }
    if (L.y > LEMMING_MAX_Y) { this.removeLemming(L); return false; }
    return true;
  }

  splatting(L) { if (L.endOfAnim) this.removeLemming(L); return false; }

  exiting(L) {
    if (L.endOfAnim) { this.removeLemming(L); this.in++; }
    return false;
  }

  vaporizing(L) { if (L.endOfAnim) this.removeLemming(L); return false; }

  blocking(L) {
    if (!this.hasPixelClip(L.x, L.y, 0)) {
      this.transition(L, 'walking');
      L.isBlocking = false;
      this.restoreMap(L);
    }
    return false;
  }

  shrugging(L) {
    if (L.endOfAnim) { this.transition(L, 'walking'); return true; }
    return false;
  }

  ohnoing(L) {
    if (L.endOfAnim) { this.transition(L, 'exploding'); return false; }
    let dy = 0;
    while (dy < 3 && !this.hasPixelClip(L.x, L.y, dy)) { dy++; L.y++; }
    if (L.y > LEMMING_MAX_Y) { this.removeLemming(L); return false; }
    return true;
  }

  exploding(L) {
    if (!L.endOfAnim) return false;
    if (L.isBlocking) { L.isBlocking = false; this.restoreMap(L); }
    const below = this.readMap(L.x, L.y);
    if (below !== DOM.STEEL && below !== DOM.WATER) this.applyMask(MASKS.explode, false, L.x - 8, L.y - 14);
    this.removeLemming(L);
    L.exploded = true;
    L.particleTimer = PARTICLE_FRAMECOUNT;
    this.particleFinish = PARTICLE_FRAMECOUNT;
    this.spawnParticles(L);
    return false;
  }

  applyMask(mask, mirror, left, top) {
    const { w, h, bits } = mask;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (bits[y * w + (mirror ? w - 1 - x : x)]) this.removePixel(left + x, top + y);
    }
  }

  // ---- explosions' bits flying about (only for show) ------------------------

  spawnParticles(L) {
    let seed = (L.index * 7919 + this.iteration * 104729) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) / 65536; };
    for (let i = 0; i < 40; i++) {
      this.particles.push({ x: L.x, y: L.y - 6, vx: (rnd() - 0.5) * 8, vy: -rnd() * 7 - 1, c: i % 8, life: PARTICLE_FRAMECOUNT });
    }
  }

  updateParticles() {
    for (const p of this.particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.5; p.life--; }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < WORLD_H + 20);
  }

  // ---- the player ------------------------------------------------------------

  /**
   * The lemmings under a point, the way the DOS cursor picks them: a prioritised
   * one (blocker, builder, basher, miner, digger, shrugger, oh-no-er) wins over
   * the rest. `box` is the half-size of the area searched around the point
   * (touch uses a bigger one); among several, the nearest wins.
   * Returns { lem1, lem2, count } as Lemmix's PrioritizedHitTest does.
   */
  hitTest(px, py, box = 6) {
    let prio = null, nonPrio = null, count = 0, dP = Infinity, dN = Infinity;
    for (const L of this.lemmings) {
      if (L.removed) continue;
      const cx = L.x, cy = L.y - 5; // the middle of the lemming
      const ddx = Math.abs(px - cx), ddy = Math.abs(py - cy);
      if (ddx > box || ddy > box) continue;
      count++;
      const d = ddx * ddx + ddy * ddy;
      if (PRIO.has(L.action)) { if (d < dP) { prio = L; dP = d; } } else if (d < dN) { nonPrio = L; dN = d; }
    }
    return { lem1: prio ?? nonPrio, lem2: nonPrio, count };
  }

  /** Which lemming a skill would go to at (px, py), or null. Doesn't assign. */
  whoWouldGet(skill, px, py, box) {
    const { lem1, lem2 } = this.hitTest(px, py, box);
    if (!lem1) return null;
    return this.canAssign(skill, lem1, lem2);
  }

  /** Assign at a point. Returns the lemming that got it, or null. */
  assignAt(skill, px, py, box) {
    const L = this.whoWouldGet(skill, px, py, box);
    if (!L) return null;
    this.assign(skill, L);
    return L;
  }

  left(skill) { return this.assist.unlimitedSkills ? 99 : this.skills[skill]; }

  /** The rules for each skill (AssignClimber etc.): the lemming that would get it. */
  canAssign(skill, L1, L2) {
    if (this.left(skill) <= 0) return null;
    const pick = (set) => (set.includes(L1.action) ? L1 : L2 && set.includes(L2.action) ? L2 : null);
    switch (skill) {
      case 'climber':
        return !L1.isClimber && !['blocking', 'splatting', 'exploding'].includes(L1.action) ? L1 : null;
      case 'floater':
        return !L1.isFloater && !['blocking', 'splatting', 'exploding'].includes(L1.action) ? L1 : null;
      case 'bomber':
        return L1.explosionTimer === 0 && !['ohnoing', 'exploding', 'vaporizing', 'splatting'].includes(L1.action) ? L1 : null;
      case 'blocker':
        return ['walking', 'shrugging', 'building', 'bashing', 'mining', 'digging'].includes(L1.action) && !this.overlapsField(L1) ? L1 : null;
      case 'builder':
        if (L1.y - L1.anim.fy < HEAD_MIN_Y) return null;
        return pick(['walking', 'shrugging', 'bashing', 'mining', 'digging']);
      case 'basher': {
        const L = pick(['walking', 'shrugging', 'building', 'mining', 'digging']);
        if (!L) return null;
        if (L.objInFront === DOM.STEEL) return null;
        if ((L.objInFront === DOM.ONEWAYLEFT && L.dx !== -1) || (L.objInFront === DOM.ONEWAYRIGHT && L.dx !== 1)) return null;
        return L;
      }
      case 'miner': {
        const L = pick(['walking', 'shrugging', 'building', 'bashing', 'digging']);
        if (!L) return null;
        if (L.objInFront === DOM.STEEL) return null;
        if (L.objBelow === DOM.STEEL || (L.objInFront === DOM.ONEWAYLEFT && L.dx !== -1) || (L.objInFront === DOM.ONEWAYRIGHT && L.dx !== 1)) return null;
        return L;
      }
      case 'digger':
        if (L1.objBelow === DOM.STEEL) return null;
        return pick(['walking', 'shrugging', 'building', 'bashing', 'mining']);
    }
    return null;
  }

  assign(skill, L) {
    switch (skill) {
      case 'climber':
        L.isClimber = true;
        if (L.action === 'shrugging') L.action = 'walking'; // the DOS bug: no new animation
        break;
      case 'floater': L.isFloater = true; break;
      case 'bomber': L.explosionTimer = 79; break;
      case 'blocker': this.transition(L, 'blocking'); break;
      case 'builder': this.transition(L, 'building'); break;
      case 'basher': this.transition(L, 'bashing'); break;
      case 'miner': this.transition(L, 'mining'); break;
      case 'digger': this.transition(L, 'digging'); break;
    }
    if (!this.assist.unlimitedSkills) this.skills[skill]--;
    this.events.push('assign');
  }

  nuke() {
    if (this.nuking) return;
    this.nuking = true;
    this.nukeInProgress = true;
    this.nukeIndex = 0;
  }

  /** The lemmings saved, as a percentage of the level's lemmings (rounded down). */
  get savedPercent() { return this.count ? Math.floor(this.in * 100 / this.count) : 0; }
  get neededPercent() { return this.count ? Math.floor(this.level.save * 100 / this.count) : 0; }
  get passed() { return this.assist.saveOne ? this.in >= 1 : this.savedPercent >= this.neededPercent; }
}

// ---- masks -------------------------------------------------------------------

function makeMasks() {
  const mask = (w, h, fn) => {
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = fn(x, y) ? 1 : 0;
    return { w, h, bits };
  };
  // the basher: a tunnel the lemming's height (rows 0..9, the foot is at
  // x 8 under row 9), cut further ahead each step, with rounded front corners
  const bash = [0, 1, 2, 3].map((s) => mask(16, 10, (x, y) => {
    const reach = 11 + s;
    const trim = y === 0 || y === 9 ? 2 : y === 1 || y === 8 ? 1 : 0;
    return x >= 7 && x <= reach - trim;
  }));
  // the miner: a swing of the pick cuts a hole 10 or so high in front, down
  // to the foot row ahead (so a miner breaking out of the underside of
  // something leaves a hole for the others to drop through). The second
  // swing is placed 1 across and 1 down, and reaches a little further.
  const mine = [0, 1].map((s) => mask(16, 13, (x, y) => {
    if (x < 6 || x > 12 + s) return false;
    const front = x - (12 + s); // 0 at the very front, -1 next
    const trim = front === 0 ? 2 : front === -1 ? 1 : 0;
    const top = 2 + ((x - 6) >> 1) + trim, bottom = (x >= 9 ? 12 : 11) - (front === 0 ? 1 : 0);
    return y >= top && y <= bottom;
  }));
  // the explosion: a round hole 16 across and 22 high
  const explode = mask(16, 22, (x, y) => {
    const dx = (x - 7.5) / 8, dy = (y - 11) / 11;
    return dx * dx + dy * dy <= 1;
  });
  return { bash, mine, explode };
}
