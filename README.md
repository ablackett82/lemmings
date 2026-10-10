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

With a copy of DOS Lemmings, the game plays the original 120 levels (Fun,
Tricky, Taxing, Mayhem) with the original terrain, objects, lemmings, dig
masks and skill panel. In settings (the cog), **Load game files** and pick
these files from the game, or a .zip with them in:

`MAIN.DAT`, `ODDTABLE.DAT`, `LEVEL000.DAT`-`LEVEL009.DAT`,
`GROUND0O.DAT`-`GROUND4O.DAT`, `VGAGR0.DAT`-`VGAGR4.DAT`, `VGASPEC0.DAT`-`VGASPEC3.DAT`

They're kept on the device (IndexedDB) and never uploaded; **Levels** in
settings switches between the original levels and the new ones, each with its
own ticks. The files are never part of this repository (`reference/` is
ignored); on localhost the dev server's copy in `reference/lemming1.pc` is used
when nothing has been loaded.

The sounds and music can come from the Windows 95 version: its `SOUND\*.WAV`
(the voices, "Let's go!", "Oh no!", "Yippee!", and the traps' own sounds)
and `MUSIC\*.MID` (15 tunes, played on a small General MIDI synth in
`src/render/gm.js`). Load them the same way, with the DOS files or after them
(its zip works as it is; its own GROUND files are ignored). Without them the
game uses its synthesized sounds and tunes.

`src/dos/` reads them: `dat.js` unpacks the .DAT compression, `dosdata.js`
reads the levels, graphic sets, sprites, masks and panel (formats as
ccexplore documented them, and as Lemmix and Lemmings.ts read them), `files.js`
picks, unzips and stores them. `node tools/dosshot.mjs out.png <1..120>` draws
an original level.

## Develop

```
npm run dev     # http://localhost:8080/
npm test
```

`node tools/icons.mjs` redraws the home-screen icons;
`node tools/sheet.mjs out.png [animations] [scale]` draws the lemming sprites;
`node tools/try.mjs [n] [--no-solve]` plays levels and reports how they went.
Bump `VERSION` in `sw.js` when anything changes so installed copies update.
