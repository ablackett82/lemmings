# Lemmings

A browser reimplementation of the 1991 DOS game Lemmings (DMA Design /
Psygnosis), built to run fullscreen on an iPad as a home-screen app. Plain
HTML/JS, no build step.

The game engine follows the DOS version's rules exactly as Lemmix has them.
Lemmix is the open-source remake that ccexplore and namida checked against
DOS Lemmings frame by frame; the routines in `src/game/engine.js` match
Lemmix's `LemGame.pas` one for one. That covers:

- the 60 ms iteration and the 17-iteration clock tick
- walking up 2-pixel steps, jumping 3 to 6, turning at 7
- falls: more than 60 pixels splats
- the floater's 16-step drift table
- the builder's 12 six-pixel bricks
- the basher's and miner's frame-by-frame cutting and stepping
- the bomber's 79-iteration fuse
- the blocker's force field on the 4x4-pixel object map
- the release rate formula ((99 - rate) / 2 + 4 iterations between lemmings)
- the A B B A entrance order
- the skill assignment rules and the cursor's preference for busy lemmings
- the nuke, one lemming an iteration
- the DOS quirks the original game has, kept on: fallers start counting at 3,
  the climber/shrugger bug, the miner one-way-right bug, and a splatting
  lemming landing in an exit getting home

What isn't included is DMA's content. The lemming sprites, the terrain styles,
the objects (hatch, exit, water, fire, squasher), the sounds and the levels are
all new, drawn and written for this. The sprites keep the DOS frame counts,
sizes and foot positions, so everything lines up with the terrain as the
originals do. The dig shapes (basher, miner, explosion) are redrawn to the DOS
sizes. The music is new arrangements of out-of-copyright tunes: the can-can,
London Bridge, Frere Jacques, Yankee Doodle.

## Play

Open the site, then on iPad: Share → **Add to Home Screen**. Play in
landscape.

- **Tap a skill** on the panel, then **tap a lemming** to give it that skill.
  A white box shows which lemming will get it. With "smart tap" on (the
  default), it picks the lemming in reach that can actually use the skill.
- **Drag** the level left and right to look around, or tap or drag the
  minimap.
- **- and +** (hold) change the release rate. **Pause** pauses.
  **Fast forward** runs at 4x. **Nuke** (tap twice) blows them all up.
- The ≡ button pauses and gives Resume / Restart level / Skip level / Choose
  level / Quit to title.
- Keyboard: 1-8 pick skills, arrows scroll, - and = the release rate, P pause,
  F fast forward, N nuke, M mute, Esc menu. With a mouse, click lemmings, and
  the level scrolls when the pointer is at the edge.

Settings and cheats (the cog):

- Game speed: Normal, Slow (75%), Very slow (50%)
- Music, sound effects, smart tap
- Accessibility: clear buttons, a sharp picture of a lemming doing each
  skill with its name under it, over the pixel-art buttons
  (`src/render/hdicons.js`)
- Cheats: unlimited skills; give skills while paused; lemmings never splat; no
  time limit; saving one lemming is enough; every level open; skip level (in
  the ≡ menu)

A level gets its tick in the level chooser only when it's done with no cheats
on (slow speed is allowed). Levels open one at a time as you finish them, or
all at once with the cheat.

## Levels

16 so far. 10 **Fun** levels teach one skill each: dig, climb, block, build,
float, bash, mine, bomb, climber + floater, and a staircase built in three
goes. 5 **Tricky** ones: a squasher trap, steel, one-way arrows, a bridge that
needs a blocker and a bomber, and a tour of everything. 1 **Taxing** one: four
staircases over a fire pit. `npm test` plays every level's solution to prove it
can be done, and plays each one with no skills to prove the skills are needed.

To add a level, add it to `src/game/levels.js`: terrain is a list of shapes
and objects (see `src/game/level.js`), and `solution` says which skill to give
at which spot (see `src/game/solver.js`). Then run `node tools/try.mjs <n>`
until it passes, and `node tools/shot.mjs out.png <n> [iterations] [scrollX]`
to see it.

## The original levels

The game plays the original 120 levels (Fun, Tricky, Taxing, Mayhem) with the
original terrain, objects, lemmings, dig masks and skill panel, plus the
Windows 95 version's sounds and music (the voices, "Let's go!", "Oh no!",
"Yippee!", the traps' own sounds, and 15 tunes played on a small General MIDI
synth in `src/render/gm.js`) — all licensed for this app and bundled in
`data/dos/`. The first time the game runs, it fetches them automatically and
keeps them on the device (IndexedDB); after that they load from there, the
same as if the player had picked their own copy. **Levels** in settings
switches between the original levels and the new ones, each with its own
ticks.

**Load game files** (in settings, the cog) still lets a player load their own
copy instead — picking the files below, or a .zip with them in — which
replaces the bundled ones on that device; **Forget these files** goes back to
the bundled copy. Nothing picked is ever uploaded; it stays on the device.

`MAIN.DAT`, `ODDTABLE.DAT`, `LEVEL000.DAT`-`LEVEL009.DAT`,
`GROUND0O.DAT`-`GROUND4O.DAT`, `VGAGR0.DAT`-`VGAGR4.DAT`, `VGASPEC0.DAT`-`VGASPEC3.DAT`,
and the Windows 95 version's `SOUND\*.WAV` and `MUSIC\*.MID`.

`src/dos/` reads them: `dat.js` unpacks the .DAT compression, `dosdata.js`
reads the levels, graphic sets, sprites, masks and panel (formats as
ccexplore documented them, and as Lemmix and Lemmings.ts read them), `files.js`
picks, unzips and stores them. `node tools/dosshot.mjs out.png <1..120>` draws
an original level.

## Making levels

**Make levels** on the title screen opens the editor (`src/editor/`). A level
is built from one of the original graphic sets (Dirt, Fire, Marble, Pillar,
Crystal): its own terrain pieces and objects, so it looks like an original.

- **Pieces**: any of the set's pieces; tap to place, drag to move, then
  mirror, flip, put behind, or make it cut its shape out. The steel ones
  (marked) bring a steel area of their own, grouped with them.
- **Steel**: ground lemmings can't dig, bash or mine into. Steel is drawn
  areas (a `steel` item: x, y, w, h), as in the original files, not a
  property of pieces: drag a box to make one (on a 4 pixel grid), tap to pick
  it, drag a corner to resize. It isn't drawn in the game. Levels made before
  this (no `sv: 2`) took each steel piece as its own area; `upgradeSteel()`
  (`build.js`) turns those into drawn areas, at once if the level isn't beaten,
  else on its first change.
- **Lumps**: draw a line and the set's organic lumps are scattered along it,
  flipped and jumbled, the way the original levels' landscapes are made.
- **Paint** / **Rubber**: draw ground in the set's texture, or rub it out.
- **Stamps**: a staircase, bash tunnel, mine, dig hole or bomb crater, made by
  the engine itself (an invisible lemming given the skill), so it's exactly
  what a player could make. Tap the top of a staircase for another.
- **Things**: entrance, exit (its top comes with it), water, fire, traps,
  one-way walls, decorations.
- **Select**: pick several things (tap to add or let go, or drag a box round
  them; shift-tap with a mouse in any tool). They then move, copy, mirror,
  flip, go to front or back, and delete together. Mirror and flip turn the
  lot as a set about its middle. **Group** (ctrl/cmd + G) ties them together,
  saved as a `g` number on each, so tapping one picks the whole group (shown
  with blue boxes); **Ungroup** (shift + ctrl/cmd + G) lets them go. Grouping
  doesn't change how a level plays, so it doesn't undo a beaten level.

While editing, the level is played with no skills in the background
(`analyse.js`): the **trails** show where the lemmings go, and a cross says
how each ends up (splat, drowned, burnt, trapped, fell out, stuck). **Falls**
draws a line from every edge a lemming can walk off to where it lands, green
if it lives and red if it splats, with the drop in pixels; a lemming survives
a drop of up to 63 (the game's 60, counted its way), and close ones get a red
mark at the limit. Two fingers pan and pinch; undo and redo; the arrow
buttons (or keys) nudge one pixel.

**Copy an original level** (on the My levels screen) makes your own editable
copy of one of the 120 (`import.js`): same pieces, objects, settings and exact
steel areas, each area grouped with the steel piece it mostly covers. The four
levels drawn as one full-screen picture (22, 44, 75, 112) can't be copied. A
test checks the copies build the same ground, steel and settings as the originals.

**▶ Test** plays it. The game is recorded as its inputs (`replay.js`; the
engine is deterministic), so the pause menu's **Back 5 seconds** replays up
to then, and a win with no cheats is saved with the level as its proof. Any
change to how the level plays clears the proof.

**Share** (on a beaten level, in My levels) sends it to the levels server
(`server/`): it waits until it's approved (a Telegram message with a picture
and an approve link), then shows in **Our levels** for everyone, with
**Watch how** to see its maker's win. A shared level opens straight from
`?level=CODE`. Levels made on a device are kept in its localStorage
(`lemmings.mine`).

## Hosting

GitHub Pages serves this repo's `master` branch (root folder) at
`https://ablackett82.github.io/lemmings/`; pushing is the deploy of that
standalone copy.

The game is also in the Arcade (its own repo, `ablackett82/arcade`, a sibling
folder of this one), which keeps its own **copy** in `games/lemmings/`. After
pushing here, go to the arcade and run `npm run sync`, then commit and push
there: the arcade doesn't pick up changes by itself.

## Develop

```
npm run dev     # http://localhost:8080/
npm test
```

`node tools/icons.mjs` redraws the home-screen icons;
`node tools/sheet.mjs out.png [animations] [scale]` draws the lemming sprites;
`node tools/try.mjs [n] [--no-solve]` plays levels and reports how they went.
`npm test` includes `test/editor.test.js`: stamps, falls, the ghost run, and
recorded wins replaying (and rewinding) exactly.
Bump `VERSION` in `sw.js` when anything changes so installed copies update.
