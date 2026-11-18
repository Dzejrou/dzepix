# Godot 4 engine (not implemented yet)

`"engine": "godot"`. `export.mjs` is a stub that stops with an error; this is
the plan for it. Target: Godot 4.6, C# or GDScript games, `out` inside the
project (e.g. `assets/gfx`, a `res://` path).

## Planned output in `<out>`

| File | What it will be |
| --- | --- |
| `<key>.png` | The sheet, as built. |
| `<key>_frames.tres` | `SpriteFrames`: one animation per tag (`<tag>`), frames as `AtlasTexture` regions of the sheet, per-frame durations from the `.aseprite` file, loop = tag repeat empty. Ping-pong tags get their frames played forwards then backwards. |
| `<key>_offsets.json` | Per-frame origin offsets (from `pivot` and the trim), which `AnimatedSprite2D` can't hold per frame; a small game-side helper applies them. |
| `<key>_<state>.tres` | UI pieces: a `StyleBoxTexture` per state, `texture_margin_*` from `scale9Borders`, axis stretch mode tile when the piece tiles. |
| `ui_theme.tres` | A `Theme` that sets those styles on Button (normal / hover / pressed / disabled), Panel, PanelContainer, TooltipPanel and so on, by a naming rule for UI keys. One theme at the root of the UI restyles every control, including ones built in code. |
| `<key>.fnt` | Fonts as BMFont text, which Godot imports as a font (to check: whether it takes the XML variant the Phaser export writes). |
| `<key>_n.png` | Normal map for `CanvasTexture`. |
| `points.json` | Rig points per asset. |

## Game side

A small helper (C#, later GDScript too) to copy into the game: load
`SpriteFrames` and offsets, apply the theme, read rig points.

## Checking

Load the export in Godot headless, never the editor:
`Godot --headless --path <project> --quit-after 1`, and add it to
`npm test` when Godot is installed.

## Notes for the project

- Put a `.gdignore` file in the art folder (`art/`), or Godot imports every
  preview PNG and `.build/` sheet in it.
- Godot writes `.import` files next to every exported PNG; commit them.
