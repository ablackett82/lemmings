// Big, clear pictures for the buttons along the bottom (the "clear buttons"
// setting): each skill as a lemming doing it, drawn in SVG so it's sharp at
// any size, with the button's name underneath. They sit over the canvas's
// panel in HTML; the canvas still takes the taps.

const OL = '#141a33'; // outline
const ROBE = '#4a5ae8', ROBE_BACK = '#3443b8', SKIN = '#f0c8ac', CAVE = '#1a1426';

// gradients, shared by every picture (one hidden <svg> holds them)
export const HD_DEFS = `<svg style="position:absolute;width:0;height:0;pointer-events:none" aria-hidden="true"><defs>
  <radialGradient id="hd-skin" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff0e2"/><stop offset="1" stop-color="#e2a98a"/></radialGradient>
  <linearGradient id="hd-robe" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aabff"/><stop offset="0.55" stop-color="#4a5ae8"/><stop offset="1" stop-color="#2a36a8"/></linearGradient>
  <radialGradient id="hd-hair" cx="40%" cy="25%" r="80%"><stop offset="0" stop-color="#a8ff8c"/><stop offset="0.5" stop-color="#2cd040"/><stop offset="1" stop-color="#0a7a20"/></radialGradient>
  <linearGradient id="hd-rock" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#c08850"/><stop offset="1" stop-color="#6a4220"/></linearGradient>
  <linearGradient id="hd-brick" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe8a8"/><stop offset="1" stop-color="#c8922e"/></linearGradient>
  <linearGradient id="hd-umb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a8a"/><stop offset="1" stop-color="#b81818"/></linearGradient>
  <radialGradient id="hd-fire" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#fffbd0"/><stop offset="0.4" stop-color="#ffc030"/><stop offset="1" stop-color="#e04010"/></radialGradient>
  <linearGradient id="hd-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b07840"/><stop offset="1" stop-color="#6a4018"/></linearGradient>
  <linearGradient id="hd-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8eef8"/><stop offset="1" stop-color="#8090a8"/></linearGradient>
</defs></svg>`;

const line = (pts, w, c) => `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** An arm or a leg: a line with an outline, a hand (or foot) on the end. */
function limb(pts, { w = 4.6, c = ROBE, end = 'hand' } = {}) {
  const p = pts.trim().split(/\s+/).at(-1).split(',').map(Number);
  const tip = end === 'hand' ? `<circle cx="${p[0]}" cy="${p[1]}" r="2.7" fill="url(#hd-skin)" stroke="${OL}" stroke-width="1.2"/>`
    : end === 'foot' ? `<ellipse cx="${p[0]}" cy="${p[1]}" rx="3.4" ry="2.2" fill="${c}" stroke="${OL}" stroke-width="1.2"/>` : '';
  return line(pts, w + 2.6, OL) + line(pts, w, c) + tip;
}
/** The robe, hips at (x, y), leaning `a` degrees. */
const torso = (x, y, a = 0) => `<g transform="translate(${x} ${y}) rotate(${a})"><path d="M-5,-15 C-2,-17.5 2,-17.5 5,-15 L7.5,-1 C3,2 -3,2 -7.5,-1Z" fill="url(#hd-robe)" stroke="${OL}" stroke-width="1.4"/></g>`;
/**
 * The hair: a wild tuft of fat, pointed leaves. spikes: [angle (0 up, + forwards), length];
 * it sits on the top of the head, from `front` round to `back` (angles).
 */
function hair(spikes, front, back) {
  const at = (deg, r) => { const a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
  const f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const valleys = [front, ...spikes.slice(1).map(([a], i) => (a + spikes[i][0]) / 2), back];
  const sweep = -12, w = 16 * Math.sign(back - front); // the leaves curve back, as if blown
  let d = `M${f(at(front, 6))}`;
  spikes.forEach(([a, len], i) => {
    d += ` Q${f(at(a - w + sweep * 0.3, len * 0.68))} ${f(at(a + sweep, len))}`;
    d += ` Q${f(at(a + w + sweep * 0.3, len * 0.68))} ${f(at(valleys[i + 1], i === spikes.length - 1 ? 6 : 9))}`;
  });
  d += ` A6,6 0 0 ${front > back ? 1 : 0} ${f(at(front, 6))}Z`;
  return `<path d="${d}" fill="url(#hd-hair)" stroke="${OL}" stroke-width="1.3" stroke-linejoin="round"/>`;
}
const HAIR_SIDE = hair([[-105, 15], [-72, 17], [-40, 19], [-8, 20], [24, 18], [52, 14]].reverse(), 62, -125);
const HAIR_FRONT = hair([[-66, 15], [-34, 19], [0, 21], [34, 19], [66, 15]], -88, 88);
const MOUTH = { smile: 'M2,4.5 Q4.5,6.5 6.5,4.2', oh: '', grit: 'M2.5,4.8 H6.5' };
/** A head side on, facing dir (1 right, -1 left). */
function head(x, y, dir = 1, mood = 'smile', tilt = 0) {
  const mouth = mood === 'oh' ? `<ellipse cx="4.6" cy="5" rx="1.6" ry="2" fill="${OL}"/>` : `<path d="${MOUTH[mood]}" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${tilt}) scale(${dir} 1)">
    <circle r="7.6" fill="url(#hd-skin)" stroke="${OL}" stroke-width="1.4"/>
    <ellipse cx="7.6" cy="1.6" rx="2.6" ry="2.1" fill="url(#hd-skin)" stroke="${OL}" stroke-width="1.1"/>
    <ellipse cx="3.4" cy="-0.8" rx="2" ry="2.6" fill="#fff" stroke="${OL}" stroke-width="0.8"/><circle cx="4.1" cy="-0.5" r="1.15" fill="${OL}"/>
    ${mouth}
    ${HAIR_SIDE}
  </g>`;
}
/** A head facing us. */
function headFront(x, y, mood = 'smile') {
  const mouth = mood === 'oh' ? `<ellipse cx="0" cy="5" rx="1.8" ry="2.2" fill="${OL}"/>` : `<path d="M-2.5,4.6 Q0,6.6 2.5,4.6" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>`;
  return `<g transform="translate(${x} ${y})">
    <circle r="7.6" fill="url(#hd-skin)" stroke="${OL}" stroke-width="1.4"/>
    ${[-1, 1].map((s) => `<ellipse cx="${s * 2.9}" cy="-0.6" rx="1.9" ry="2.5" fill="#fff" stroke="${OL}" stroke-width="0.8"/><circle cx="${s * 2.9}" cy="-0.2" r="1.1" fill="${OL}"/>`).join('')}
    <ellipse cx="0" cy="2.4" rx="1.9" ry="1.6" fill="url(#hd-skin)" stroke="${OL}" stroke-width="1"/>
    ${mouth}
    ${HAIR_FRONT}
  </g>`;
}
/** A starburst of `n` points, centre (x, y), radii r1 out and r2 in, turned `rot` degrees. */
function star(x, y, r1, r2, n, fill, rot = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2) * 360 + rot) * Math.PI / 180, r = i % 2 ? r2 : r1 * (i % 4 ? 1 : 0.85);
    pts.push(`${(x + r * Math.sin(a)).toFixed(1)},${(y - r * Math.cos(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${OL}" stroke-width="1.3" stroke-linejoin="round"/>`;
}
/** Bits of rock flying. */
const chips = (list) => list.map(([x, y, r = 1.6]) => `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" transform="rotate(30 ${x} ${y})" fill="#d8a060" stroke="${OL}" stroke-width="0.8"/>`).join('');
const speckle = (list) => list.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2" ry="1.2" fill="#000" opacity="0.18"/>`).join('');
const ROCK = (d) => `<path d="${d}" fill="url(#hd-rock)" stroke="${OL}" stroke-width="1.4"/>`;
const CAVE_PATH = (d) => `<path d="${d}" fill="${CAVE}" stroke="${OL}" stroke-width="1"/>`;
const ground = (y = 57) => ROCK(`M-2,${y} H66 V66 H-2Z`);
const swish = (d) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="0.75"/>`;

const PICTURES = {
  climber: () =>
    ROCK('M44,-2 H66 V66 H44 C46,50 42,40 45,28 C47,18 43,8 44,-2Z') + speckle([[52, 12], [57, 30], [50, 46], [58, 54]])
    + `<path d="M14,40 l5,-6 5,6 M14,30 l5,-6 5,6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`
    + limb('33,42 37,51 42,54', { c: ROBE_BACK, end: 'foot' }) + limb('34,29 39,31 43,31', { c: ROBE_BACK })
    + torso(35, 43, 4)
    + limb('36,42 42,45 43,49', { end: 'foot' })
    + head(36, 20, 1, 'grit', -8)
    + limb('37,30 41,24 43,18'),
  floater: () =>
    `<path d="M8,20 Q32,-6 56,20 Q50,16 44,20 Q38,16 32,20 Q26,16 20,20 Q14,16 8,20Z" fill="url(#hd-umb)" stroke="${OL}" stroke-width="1.4"/>`
    + `<path d="M20,20 Q22,6 32,3 Q42,6 44,20 Q38,16 32,20 Q26,16 20,20Z" fill="#fff" opacity="0.85"/>`
    + `<path d="M8,20 Q32,-6 56,20" fill="none" stroke="${OL}" stroke-width="1.4"/>`
    + line('32,20 32,30', 3.4, OL) + line('32,20 32,30', 1.8, '#c08850')
    + swish('M10,34 v8 M54,34 v8 M14,46 v6 M50,46 v6')
    + limb('30,53 28,61', { c: ROBE_BACK, end: 'foot' }) + limb('34,53 36,61', { end: 'foot' })
    + torso(32, 54, 0)
    + head(32, 33, 1, 'smile')
    + limb('27,42 24,35 30,29') + limb('37,42 40,35 34,29'),
  bomber: () =>
    star(32, 34, 32, 19, 14, 'url(#hd-fire)') + star(32, 34, 21, 13, 14, '#fff6b0', 12)
    + chips([[6, 12], [58, 10, 1.3], [4, 50, 1.3], [60, 54], [16, 4, 1.1], [50, 60, 1.1]])
    + swish('M8,30 h-5 M56,30 h5 M12,16 l-4,-4 M52,16 l4,-4')
    + `<g transform="translate(32 36) scale(0.8) translate(-32 -36)">`
    + limb('30,49 23,57', { c: ROBE_BACK, end: 'foot' }) + limb('34,49 41,57', { end: 'foot' })
    + torso(32, 50, 0)
    + limb('27,38 18,32 13,24') + limb('37,38 46,32 51,24')
    + headFront(32, 27, 'oh') + '</g>',
  blocker: () =>
    `<path d="M5,40 l-3,4 3,4 M10,40 l-3,4 3,4 M59,40 l3,4 -3,4 M54,40 l3,4 -3,4" fill="none" stroke="#ff6060" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
    + ground(58)
    + limb('29,49 23,57', { c: ROBE_BACK, end: 'foot' }) + limb('35,49 41,57', { end: 'foot' })
    + torso(32, 50, 0)
    + limb('27,37 19,35 12,30') + limb('37,37 45,35 52,30')
    + headFront(32, 26, 'smile'),
  builder: () =>
    ground(59)
    + [0, 1, 2].map((k) => `<rect x="${10 + k * 8}" y="${54 - k * 4.5}" width="13" height="4.5" rx="0.8" fill="url(#hd-brick)" stroke="${OL}" stroke-width="1.1"/>`).join('')
    + `<g transform="translate(0 5)">`
    + limb('27,32 25,40 28,40.5', { c: ROBE_BACK, end: 'foot' })
    + limb('34,30 40,34 45,35', { c: ROBE_BACK })
    + torso(29, 32, 28)
    + limb('31,32 33,40 36,40.5', { end: 'foot' })
    + head(39, 12, 1, 'smile', 14)
    + `<rect x="42" y="34" width="13" height="4.5" rx="0.8" fill="url(#hd-brick)" stroke="${OL}" stroke-width="1.1"/>`
    + limb('35,22 42,28 46,33') + '</g>',
  basher: () =>
    ROCK('M40,-2 H66 V66 H40 V58 H50 C56,46 56,26 50,14 H40Z') + speckle([[54, 6], [60, 26], [60, 46], [44, 6]])
    + ground(58)
    + chips([[46, 22], [42, 18, 1.3], [44, 30, 1.2], [38, 14, 1.1]])
    + limb('28,49 23,57', { c: ROBE_BACK, end: 'foot' })
    + limb('33,37 38,40 43,41', { c: ROBE_BACK })
    + torso(30, 49, 12)
    + limb('32,49 38,57', { end: 'foot' })
    + head(35, 26, 1, 'grit', 6)
    + swish('M30,32 h-8 M29,36 h-10')
    + limb('34,36 41,36 49,35'),
  miner: () =>
    ROCK('M-2,10 H66 V66 H-2Z') + speckle([[52, 16], [58, 22], [10, 58], [44, 62]])
    + CAVE_PATH('M-2,10 L46,30 Q60,40 55,66 H32 L-2,51Z')
    + chips([[54, 50], [58, 44, 1.3], [50, 46, 1.2]])
    + swish('M26,8 Q46,0 60,14')
    + limb('20,54 15,61', { c: ROBE_BACK, end: 'foot' })
    + torso(22, 53, 36)
    + limb('24,53 29,61', { end: 'foot' })
    + head(32, 34, 1, 'grit', 28)
    + limb('27,43 33,42 37,39', { c: ROBE_BACK })
    // the pickaxe, big: a wooden handle and a steel head mid-swing
    + line('33,44 51,22', 7, OL) + line('33,44 51,22', 4.4, 'url(#hd-wood)')
    + `<path d="M36,8 Q58,8 63,34 Q57,26 52,25 Q47,19 36,8Z" fill="url(#hd-steel)" stroke="${OL}" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<rect x="47.5" y="18.5" width="7" height="7" rx="1.5" transform="rotate(40 51 22)" fill="#5a6478" stroke="${OL}" stroke-width="1.2"/>`
    + limb('29,44 35,45 40,36'),
  digger: () =>
    ROCK('M-2,30 H66 V66 H-2Z') + speckle([[8, 40], [56, 38], [10, 56], [56, 58]])
    + CAVE_PATH('M18,30 H46 V54 Q46,62 32,62 Q18,62 18,54Z')
    + chips([[12, 22], [8, 16, 1.3], [52, 22], [56, 16, 1.3], [16, 12, 1.1], [48, 12, 1.1]])
    + limb('29,49 26,58', { c: ROBE_BACK, end: 'foot' }) + limb('35,49 38,58', { end: 'foot' })
    + torso(32, 50, 0)
    + limb('27,38 23,46 27,53') + limb('37,38 41,46 37,53')
    + headFront(32, 26, 'grit'),
  slower: () => hatch() + badge('−'),
  faster: () => hatch() + badge('+'),
  pause: () => `<rect x="17" y="12" width="11" height="40" rx="3" fill="#fff" stroke="${OL}" stroke-width="1.4"/><rect x="36" y="12" width="11" height="40" rx="3" fill="#fff" stroke="${OL}" stroke-width="1.4"/>`,
  play: () => `<path d="M20,10 L50,32 L20,54Z" fill="#fff" stroke="${OL}" stroke-width="1.6" stroke-linejoin="round"/>`,
  ff: () => `<path d="M6,14 L30,32 L6,50Z M32,14 L56,32 L32,50Z" fill="#fff" stroke="${OL}" stroke-width="1.6" stroke-linejoin="round"/>`,
  nuke: () =>
    ground(58)
    + `<path d="M26,56 Q29,44 27,30 H37 Q35,44 38,56Z" fill="url(#hd-fire)" stroke="${OL}" stroke-width="1.3"/>`
    + `<ellipse cx="32" cy="57" rx="20" ry="5" fill="url(#hd-fire)" stroke="${OL}" stroke-width="1.3"/>`
    + `<path d="M10,26 C4,18 12,8 20,10 C22,2 34,0 38,6 C46,2 56,8 54,16 C62,20 58,32 48,30 C42,36 22,36 16,30 C10,32 6,28 10,26Z" fill="url(#hd-fire)" stroke="${OL}" stroke-width="1.4"/>`
    + `<path d="M18,22 C22,18 26,20 28,16 M36,14 C40,16 44,14 46,18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>`,
};

// the release rate: the trapdoor they drop from, and - or +
function hatch() {
  return `<path d="M8,6 H56 V20 H8Z" fill="url(#hd-wood)" stroke="${OL}" stroke-width="1.4"/>`
    + `<path d="M8,20 L2,32 L8,32Z M56,20 L62,32 L56,32Z" fill="url(#hd-wood)" stroke="${OL}" stroke-width="1.2"/>`
    + `<rect x="14" y="20" width="36" height="4" fill="${CAVE}"/>`
    + limb('30,40 28,46', { c: ROBE_BACK, end: 'foot' }) + limb('34,40 36,46', { end: 'foot' })
    + `<g transform="translate(32 41) scale(0.62) translate(-32 -41)">${torso(32, 41, 0)}${headFront(32, 18, 'oh')}</g>`;
}
const badge = (s) => `<circle cx="47" cy="47" r="13" fill="#fff" stroke="${OL}" stroke-width="1.6"/>`
  + `<text x="47" y="54.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="22" fill="${OL}">${s}</text>`;

export const HD_LABELS = {
  slower: 'Slower', faster: 'Faster', climber: 'Climb', floater: 'Float', bomber: 'Bomb', blocker: 'Block',
  builder: 'Build', basher: 'Bash', miner: 'Mine', digger: 'Dig', pause: 'Pause', play: 'Play', nuke: 'Nuke', ff: 'Fast',
};

const cache = {};
/** The picture for a button, as an <svg>. */
export function hdIcon(name) {
  return (cache[name] ??= `<svg viewBox="0 0 64 64" aria-hidden="true">${PICTURES[name]()}</svg>`);
}
