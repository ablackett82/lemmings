// Plays a level's solution, as a player would: each step of the solution
// gives a skill to the next lemming that reaches a spot. The tests use this
// to prove every level can be done; the title screen uses it to play itself.
//
// A step is { skill, x, y?, dir?, after?, count? }: the first lemming (that
// isn't already doing something else, unless `any`) to be at x (and y, give
// or take 4, if given), heading dir (1 right, -1 left, if given), at or after
// iteration `after`. `count` repeats it for that many lemmings.

export class Solver {
  constructor(steps) {
    this.steps = steps.map((s) => ({ ...s, left: s.count ?? 1 }));
    this.given = new Set(); // lemming index + skill already handled
  }

  apply(g) {
    for (const s of this.steps) {
      if (s.left <= 0 || (s.after && g.iteration < s.after)) continue;
      if (s.need && !this.steps[s.need - 1].done) continue;
      for (const L of g.lemmings) {
        if (L.removed || this.given.has(`${L.index}:${s.skill}:${this.steps.indexOf(s)}`)) continue;
        if (L.x !== s.x || (s.dir && L.dx !== s.dir) || (s.y !== undefined && Math.abs(L.y - s.y) > 4)) continue;
        if (!s.any && !['walking', 'falling'].includes(L.action) && !(s.from ?? []).includes(L.action)) continue;
        if (s.only !== undefined && L.index !== s.only) continue;
        const who = g.canAssign(s.skill, L, null);
        if (who !== L) continue;
        g.assign(s.skill, L);
        this.given.add(`${L.index}:${s.skill}:${this.steps.indexOf(s)}`);
        if (--s.left <= 0) { s.done = true; break; }
      }
    }
  }
}
