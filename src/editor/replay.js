// Recording a game as it's played, and playing it back. The engine does the
// same thing every time given the same inputs, so a game is just its inputs:
// which skill went to which lemming, the release rate buttons, the nuke, each
// with the iteration it happened before. That's what proves a level can be
// done (its maker's win, saved with it), what "Watch how" plays, and what
// rewinding replays up to.
//
// A log entry: [iteration, 'a', skill, lemming index] | [iteration, 'r', -1|0|1] | [iteration, 'n']

import { Game, SKILLS } from '../game/engine.js';

export class Recorder {
  constructor(log = []) { this.log = log; this.rd = 0; }
  assign(g, skill, L) { this.log.push([g.iteration, 'a', skill, L.index]); }
  nuke(g) { this.log.push([g.iteration, 'n']); }
  /** Before each step: the release rate buttons, when they change. */
  beforeStep(g) {
    if (g.rateDelta !== this.rd) { this.rd = g.rateDelta; this.log.push([g.iteration, 'r', this.rd]); }
  }
  /** Forget everything from iteration t on (after rewinding to it). */
  cut(t) {
    this.log = this.log.filter((e) => e[0] < t);
    this.rd = 0;
    for (const e of this.log) if (e[1] === 'r') this.rd = e[2];
  }
}

/** Plays a log back into a game, a step at a time. */
export class Player {
  constructor(log) { this.log = log; this.i = 0; this.rd = 0; }
  beforeStep(g) {
    g.rateDelta = this.rd;
    while (this.i < this.log.length && this.log[this.i][0] <= g.iteration) {
      const e = this.log[this.i++];
      if (e[0] < g.iteration) continue; // can't happen in a good log
      if (e[1] === 'r') g.rateDelta = this.rd = e[2] < 0 ? -1 : e[2] > 0 ? 1 : 0;
      else if (e[1] === 'n') g.nuke();
      else if (e[1] === 'a' && SKILLS.includes(e[2])) {
        const L = g.lemmings[e[3]];
        // only as the player could have: the rules still apply
        if (L && !L.removed && g.canAssign(e[2], L, null) === L) g.assign(e[2], L);
      }
    }
  }
  get done() { return this.i >= this.log.length; }
}

/** A new game of the level played from the log up to iteration t. */
export function replayTo(level, log, t, assist = {}) {
  const g = new Game(level, assist);
  const p = new Player(log);
  while (g.iteration < t && !g.finished) { p.beforeStep(g); g.step(); }
  return g;
}

/** Plays the log to the end: does it get enough lemmings home? */
export function proves(level, log) {
  const g = new Game(level);
  const p = new Player(log);
  const max = (level.time * 60 + 30) * 17 + 2000;
  while (!g.finished && g.iteration < max) { p.beforeStep(g); g.step(); }
  return g.finished && g.passed;
}
