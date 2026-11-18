# Phaser 4 engine

`"engine": "phaser"` (the default). Tested on an isometric Phaser 4 game.

## What `art export` writes to `<out>`

Default `out`: `public/assets/gfx` (Vite serves `public/` at the site root).

| File | What it is |
| --- | --- |
| `<key>.png` + `<key>.json` | The sheet and Aseprite json-hash data, which `load.aseprite` reads. Each frame's `pivot` is its origin; UI frames carry `scale9Borders` (NineSlice); `meta.nineTile` = repeat edges; jump tags carry `air` ([from, to] fractions of the clip off the ground); `meta.kind` = the asset kind. |
| `<key>_n.png` | Normal map, same layout as `<key>.png` (assets with normals). |
| `<key>.xml` | BMFont for font assets (white glyphs, dark outline). |
| `index.json` | key -> kind (or `{ kind, normal: true }`) for every exported asset; the game loads only what it lists. |

## Game side: `art-runtime.js`

Copy `art-runtime.js` into the game (e.g. `src/art.js`) and adapt freely.

- `loadArt(this)` in the first scene's `preload` (reads `assets/gfx/index.json`,
  queues every asset; pass a base path if `out` differs),
  `setupArt(this)` in its `create` (animations, character tables).
- Set `pixelArt: true` in the Phaser config and scale by whole numbers.
- Animations: one per tag, `animOf(key, tag)` (`<key>-<tag>`); tag repeat
  empty = loop, N = play N times; ping-pong = `yoyo`. Characters get missing
  directions filled from the nearest one; `still-<dir>` frames are in the
  registry as `<key>-still-<dir>`, jump windows as `<key>-air-<dir>`.
- Frames: `frameOf(key, tag)` (first frame of a tag: stills, object states,
  UI states), `anyFrameOf(key, tag)` (random variant), `tagFrames`,
  `tagNames`, `hasArt`.
- Rig points: `pointOf(scene, key, name, tag?)`, offset from the origin.
- UI: `addPiece(scene, x, y, key, state, w, h)` (a NineSlice when the piece
  has one, else an image), `setPieceState(piece, key, state)`.
- Text: `addText(scene, x, y, text, { font, color, scale, center })`.
- Talking portraits: `lipSync(text)` -> mouth shapes with timings.
- Lighting: assets with `<key>_n.png` load their normal map;
  `setLighting(true)` per object, `lights.enable()`, `render.maxLights`.

## Pitfalls

- A frame's `pivot` is the origin, so don't set origins on art.
- Trimmed frames work: origins are relative to the untrimmed size.
  `img.width` is the untrimmed size, `frame.cutWidth` the art.
- `createFromAseprite` ignores tag repeat; the runtime sets it.
- After `setFrame` on a NineSlice, call `setSlices(w, h)`.
- `setTintFill` is gone: `setTint(c).setTintMode(Phaser.TintModes.FILL)`.
- `scene.restart()` reuses the scene object: reset every per-level field in
  `create()`.
