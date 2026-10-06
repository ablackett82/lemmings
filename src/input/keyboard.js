// Keyboard: arrows / A D scroll the level, - and + the release rate; other
// keys (1-8 skills, P pause, F fast forward, N nuke, M mute, Esc menu) are
// read edge-triggered by main.js.
const MAP = {
  ArrowLeft: 'left', ArrowRight: 'right', KeyA: 'left', KeyD: 'right',
  Minus: 'slower', NumpadSubtract: 'slower', Equal: 'faster', NumpadAdd: 'faster',
};

export class Keyboard {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set(); // edge-triggered, cleared by consume()
    target.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!e.repeat) this.pressed.add(e.code);
      const a = MAP[e.code];
      if (a) { this.down.add(a); e.preventDefault(); }
      if (/^F\d+$/.test(e.code) || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      const a = MAP[e.code];
      if (a) { this.down.delete(a); e.preventDefault(); }
    });
    window.addEventListener('blur', () => this.down.clear());
  }
  /** True once per key press of any of the given codes. */
  consume(...codes) {
    for (const c of codes) if (this.pressed.has(c)) { this.pressed.delete(c); return true; }
    return false;
  }
}
