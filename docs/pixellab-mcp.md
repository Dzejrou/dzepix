# Art pipeline: PixelLab -> .aseprite -> game

Instructions for an LLM agent making game art with the PixelLab MCP tools and
this tool, which a game includes as a git submodule at `tools/art/`. This
document is engine-neutral; what the export writes and how the game loads it
is in `engines/<engine>/README.md` (`phaser`, `godot`). Everything here was
tested on an isometric Phaser 4 game (64px characters, 64x32 floor
diamonds); numbers are from those tests.

## 1. What `tools/art/` is

| File (in `tools/art/`) | What it does |
| --- | --- |
| `art.mjs` | The tool: imports PixelLab results into `.aseprite` files, exports them for the game, checks and fixes art. `node tools/art/art.mjs help` lists every command. |
| `*.lua` | Aseprite batch scripts that `art.mjs` runs (build files, patch frames, points, normal layer). |
| `airborne.mjs` | Works out a jump clip's off-the-ground window at export. |
| `contact.mjs` | `node tools/art/contact.mjs out.png [--cols N] [--scale S] a.png b.png ...`: contact sheet for reviewing many images in one look. |
| `engines/<engine>/` | The exporter for one engine (`export.mjs`), its README (export format, game side, pitfalls) and any game-side code to copy into the game (`phaser/art-runtime.js`). |
| `test/smoke.mjs` | `npm test`: import, build and export a small saved asset, offline. |

### Setup

1. The tool is a submodule at `tools/art/` (`git submodule add <url>
   tools/art`; clone games with `--recurse-submodules`), with
   `art.config.json` in the project root. Run `npm install` in
   `tools/art/` once per checkout (needs `pngjs`, `adm-zip`; Node 20+).
   Changes to the tool go to the tool's own repository, then the game
   updates the submodule; game changes never edit `tools/art/`.
2. Aseprite 1.3+: the tool runs `~/Applications/Aseprite.app/Contents/MacOS/aseprite`,
   or set `ASEPRITE=/path/to/aseprite`. Batch runs use a clean settings
   folder (`asepriteUserFolder`, default `~/.aseprite-headless`) so user
   extensions don't load or print errors.
3. `art.config.json` (all optional; defaults in `art.mjs`):
   - `engine` (`phaser` default, `godot`): which exporter writes `out`;
   - `art` (where `<key>/<key>.aseprite` live, default `art`),
     `out` (export folder, default `public/assets/gfx`);
   - `frameMs` (ms per frame by animation base name), `defaultFrameMs`,
     `looping` (base names that loop; others play once);
   - `footOffset` (character origin: px above the lowest pixel of the
     standing poses), `uiStates` (hover / pressed brightness),
     `sheetWidth`, `asepriteUserFolder`.
4. Game side: see `engines/<engine>/README.md`.

The `.aseprite` files are engine-neutral. Every command works on a **built
sheet** per asset in `art/.build/` (git-ignored; rebuilt whenever the
`.aseprite` file is newer): `<key>.png` + `<key>.json`, trimmed, frames
named by index, tags `<key>-<tag>`, each frame's origin as `pivot`
(fractions of the untrimmed frame), UI frames with `scale9Borders`, jump
tags with `air`. The engine's exporter turns built sheets into what that
engine loads; a new engine is a new `engines/<name>/export.mjs` with
`exportAsset` and `exportIndex`.

## 2. How to work

- **Read https://api.pixellab.ai/mcp/docs once per session**: tools,
  parameters, limits and prices change. `search_help` answers questions.
- **Name the exact tool and mode** and keep it for a whole family of assets
  (all characters of a game: same tool, mode, view, size, style anchor).
  Repeat the view ("high top-down", "isometric") in every prompt.
- **Look at every result before importing.** Use `contact.mjs` sheets, not
  one image at a time. Sometimes adapting the design beats re-rolling.
- **Prefer text checks** (`art loops`, `art colors`, `art preview`, frame
  measurements in node) to viewing many images: images are expensive in
  context.
- **Jobs:** generation is asynchronous; at most 10 jobs at once (a call needing
  more slots fails up front, so queue in batches). Wait with
  `wait_for_jobs(timeout_seconds <= 240)` and call again; above ~290 s the MCP
  client times out. Downloads return 423 while an asset (or any animation of
  that character) is still generating.
- **Never overwrite** an `.aseprite` file without the user's OK: it may
  have hand edits. `import` / `reimport` refuse without `--force`.
- **Record how an asset was made**: `import ... --recipe '<json>'` (tool,
  prompt, mode, seed, palette, style references) goes into the asset's
  `.pixellab.json`.
- Ask before spending a lot (pro / big tools are 10-25 generations each).

## 3. Files and conventions

Every asset is `art/<key>/<key>.aseprite` + `art/<key>/<key>.pixellab.json`
(kind, PixelLab ids, import options, recipe). `art export` writes what the
engine loads into `<out>` (see the engine's README).

Concept art (reference only, never imported or exported) is in
`art/concept/`, stored in Git LFS; its `README.md` says what to take from
each picture. Palettes are in `art/palettes/`.

Flow: generate -> review -> `art import <kind> <key> ...` -> check ->
hand-edit in Aseprite if needed -> `art export [<key>]`.

Behaviour lives in the `.aseprite` file, so changing it needs no code:

- **Tags** name animations / pieces. Repeat empty = loop, 1 = play once.
  Direction ping-pong = played back and forth.
- **Frame durations** = animation timing.
- **Slice `anchor`** (its pivot) = the ground point / origin. Without one:
  characters stand on their feet (lowest pixel - `footOffset`), objects on
  the bottom of their pixels, UI pieces on their middle.
- **Slice `nine`** with a 9-slice centre = stretchable UI. Slice user data
  `tile` = repeat the edges instead of stretching.
- **Slices `point:<name>`** = rig points (where a boss's hands go, a weapon
  attaches...). They may lie outside the canvas.
- Hidden layers: `before` (frames replaced by `art patch`) and `normal`
  (normal map).

Tags per kind:

| Kind | Tags |
| --- | --- |
| character | `still-<dir>` (1 frame) and `<anim>-<dir>`; dirs `south`, `south-east`, `east`, ... `south-west` (screen directions) |
| tiles | `plain`, `decor` (place decor more rarely) |
| tileset | `c<mask>` (corner rule) or `e<mask>` (edge rule); several frames in a tag = variants |
| kit | one tag per building-kit piece: `floor`, `side_N`, `corner_NE`, `outer_NE`, `door_Na`, `pillar`, `stairs_1`, `roof`... |
| objects | one tag per object; animations `<name>_<anim>`; 8-direction objects `<name>-<dir>` |
| fx | `play` |
| ui | one piece per file, a tag per state (`normal`, `hover`, `pressed`, `on`) |
| font | a tag per character (frame = glyph); export adds a BMFont `<key>.xml` |
| images | a tag per picture or per animation (`anim:` sources) |

Clip names `<base>_<variant>` (`attack_slam`, `idle_afk`) take timing and
looping from the base name. Map clip names to game actions in game data
(`anims: { attack: 'attack_slam' }`) instead of renaming art.

## 4. Commands

```
art import <kind> <key> ...      build art/<key>/<key>.aseprite from PixelLab (kinds below)
art reimport <key>|--all [--force]  rebuild from the record (after new animations / re-rolls)
art export [<key>...]            write what the engine loads to <out>
art list                         every asset and its kind
art loops <key>                  looping tags with a visible hitch (last -> first)
art colors <key> [--palette p]   colour count, % off a palette
art palette <name> --from <keys> [--colors N] | --hex '#..,#..'   make a palette
art preview <key> [--out f.png]  demo map from a kit / tileset, rendered offline
art frame <id|key> <still|anim:last|anim:N> [--dir d] [--size-of spec] [--upload url]
art clip <id|key> <anim> [--dir d] [--fit 80] [--upload url]
art frames <key> <tag> [--only 4,5] [--mask] --upload <url>
art patch <key> <frame>=<image-job[:n] | https-url | file.png> ...
art points <key> <name>=<x>,<y> ...
art normals-prep <key> [--tags a,b] --upload <url>
art normals-apply <key> <job-id>...
```

(`art` = `node tools/art/art.mjs`, run from the project root; games may wrap
it, e.g. `./run.sh art`.)

Imports (every one also takes `--palette <name> [--snap]`, `--despeckle`,
`--recipe '<json>'`, `--force`):

```
import character <key> <character-id> [--skip <tag>:<i>,<i>;...] [--chain <name>=<a>+<b>+...]
import tiles     <key> <tiles-id> [--plain 0,6,8] [--pick 0,1,2] [--anchor x,y]
import tileset   <key> <tiles-id> [--rule corner|edge] [--masks m0,m1,x,...] [--variants <id>,<id>] [--terrains 'A|B']
import kit       <key> <tiles-id> [--roles floor=0,side_N=1,...]
import objects   <key> <name>=<object-id> ...
import fx        <key> <image-id>/<file> [--once]
import font      <key> <font-job-id> [--color '#ffffff'] [--outline '#140c0a'|none]
import images    <key> <name>=<https-url | job:<image-job> | anim:<animate-image-job>>[@x,y,w,h] ...
import ui        <key> [<state>=]<ui-asset-id>[@x,y,w,h] ... [--states] [--nine auto|l,t,r,b] [--tile]
```

Uploading a local image to PixelLab (for start / end frames, references,
normal maps): `get_upload_url` (free, URL valid 15 min, files kept 3 days),
then the tool's `--upload <url>` options do the upload and print
`upload:<id>` refs to pass as image URLs. By hand:
`curl -sS -F "file=@frame.png" <url>`.

## 5. Recipes

### 5.1 One look for the whole game (do this first)

Unlocked PixelLab art uses 750-1,700 colours with soft shading, and assets
made separately look like different games. To prevent that (start from the
concept art in `art/concept/` and its `README.md`):

1. **Design a palette**: a ramp per material including highlights, or a
   Lospec palette. Don't extract one from generated art: it comes out muddy.
   `art palette <name> --hex '#..,...'` writes `art/palettes/<name>.*` and
   prints the JSON array for PixelLab's `palette` parameter.
2. **Anchor character**: `create_character` mode `pro` (10 gen) with the
   palette (`palette` + `palette_name`), from a prompt or concept art
   (`concept_image_url`). Every later character: mode `pro` +
   `style_character_id` = the anchor (+ palette). This was the single best
   consistency tool. `size` must be >= the anchor's content size.
3. **Anchor floor**: one tiles-pro set; later tile sets get
   `style_images: [{image: <url | upload:id>}, ...]` (we used 4 tiles).
4. Import with `--palette <name>`; add `--snap` for anything animated
   (animations take no palette and drift ~5% off). Check with
   `art colors <key> --palette <name>`.

`palette` is exact on tiles-pro and `create_character` pro only. v3 refuses
`palette` / `max_colors`. `max_colors N` alone keeps the model's own colours,
so assets don't match each other.

### 5.2 Characters

- `create_character` v3 (2 gen) or pro (10 gen), 64px, view `high top-down`
  for an isometric camera, 8 directions. In pro mode `outline` is ignored.
- `import character <key> <id>` -> `still-<dir>` + every animation. The
  character's download holds all its states; the tool picks the one whose
  id you gave.
- **States** (`create_character_state`, 10 gen at 64px): the same character
  changed (elite recolour, horns, damaged, outfit) in all rotations, same
  canvas and anchor. It starts with no animations but inherits the skeleton,
  so skeleton-v3 with the same `move` reproduces the original's motion frame
  for frame. Treat each state as its own asset key.
- **Outfit transfer** (`transfer_outfit`, ~10 gen per call): reskins existing
  frames keeping every pose. Reference = a `create_character_state` of the
  same character in the new outfit, padded to the frames' size. Frames per
  call: <=64px 15, <=80px 8, else 3, so `art clip --fit 80` first and import
  back with `import character ... --frames <tag>=<job>@x,y,w,h`. Costs a
  call per clip x direction: fine for skins, too expensive per gear piece.

### 5.3 Character animation

`animate_character` modes, best first for most uses:

| Mode | Cost (64px char) | Use for |
| --- | --- | --- |
| `v3` custom | 1 gen / direction, 8 frames | Most clips. Describe the motion only. |
| `skeleton-v3` | 3 gen / direction | Monster attacks (v3 invents fire / flashes), consistent sets, states. Named moves. |
| `pixminimax` | 4-8 frames 1 gen, up to 40 frames (3 gen at 64px) | Long idles, chained clips, loops (last frame ~ first). Subtle: ask for bigger motion. |
| template | 1 gen / direction | Not recommended. Humanoid only and stiff; it broke monsters. |

- `keep_first_frame=false`: exactly `frame_count` frames, and the clip doesn't
  start on the base pose. With it true, drop frame 0 (`--skip <tag>:0`).
- **skeleton-v3 named moves**: call once with mode skeleton-v3 +
  `action_description` and no poses (free) to get the catalogue (~70 moves),
  then `move: {name, energy 0.6-1.4, side?, facing?}`. Useful: slash, chop,
  sweep, stab, punch, kick, cast, cast_down, throw, block, hit, fall_back,
  fall_forward, slump_knees, jump, idle, breathe_heavy, power_up, hover, fly,
  get_up. From the front, `fall_back` reads as arms spread: use
  `fall_forward` for south deaths. Walks need energy 1.2-1.3 facing the camera.
- **Facing away** (N, NE, NW): animate them in their own call with the
  prompt prefixed `seen from behind: `. Then the body doesn't twist toward
  the camera and v3 adds fewer effects. The body hides the weapon, so describe
  swings going out to a side.
- Jumps: "facing <dir> the whole time". Spells: name the glow colour or it
  varies by direction.
- **Re-roll one direction**: `delete_animation(group, direction)`, then the
  same `animation_name` (+ `animation_group_id`). The importer merges
  same-named groups. Then `reimport --force`.
- **Bad frames**: `--skip 'attack-south:4;walk-east:2'`. Stray pixels
  (pixminimax): `--despeckle`.
- **Loops**: v3 clips often end far from their first frame, so loops hitch.
  Always run `art loops <key>`. Fixes: re-roll, pixminimax, an end frame
  equal to the start (below), or set the tag to ping-pong if the motion
  allows it.
- **Long / chained clips** (50-100 frames, invisible seams), one direction
  per call:
  1. Clip 1: pixminimax, `keep_first_frame=false`.
  2. `art frame <key|char-id> <clip1>:last --dir <d> --upload <url>` ->
     `upload:<id>` = next clip's `custom_start_frame_url`.
  3. Last clip also gets `end_frame_url` = the standing pose padded to the
     clip size: `art frame <key> still --dir <d> --size-of <prev>:last --upload <url>`.
     Then it blends back into idle.
  4. `import character <key> <id> --chain idle_afk=<c1>+<c2>+<c3> --despeckle`.

  `art frame` reads straight from PixelLab and fails (423) while that
  character has any animation generating.
- Typical monster (walk + attack + idle + death, 8 directions): v3 ~30 gen,
  skeleton-v3 ~90 gen.

### 5.3a Newer animation helpers (not tested here yet)

- `mirror_animation(asset_id, animation_group_id, source_direction)`: free,
  instant; makes the opposite direction by flipping (east <-> west and the
  diagonals). Exact for symmetric sprites; a weapon ends up in the other
  hand. Cheaper than generating, and better than the game filling a missing
  direction from a neighbour.
- `edit_animation(frames, description)`: the same text edit on every frame of
  a clip, poses kept (10 gen up to 128px frames; 16 frames per call up to
  64px, 9 to 80, 4 above). The result is not stored on the character:
  `save_to_asset` writes it back, or import the frames.
- `set_canvas_size(asset_id, w, h)`: free; adds margin around a character or
  object before animating (wide swings, jumps) so nothing is cut off.
- `export_asset(asset_id, format)`: PixelLab's own zip, spritesheet,
  .aseprite or GIF of a character or object. The importer builds its own
  .aseprite files (tags and slices this tool relies on); PixelLab's
  .aseprite export is not that format.

### 5.4 Floors, walls, terrain, paths, buildings (isometric)

Isometric grid used below: cell (i, j) has its centre on screen at
`((i-j)*32, (i+j)*16)` for 64x32 diamonds. Neighbour N = (i, j-1) (the
upper-right edge), E = (i+1, j) (lower-right), S = (i, j+1) (lower-left),
W = (i-1, j) (upper-left).

- **Floors / walls**: `create_tiles_pro(tile_type isometric, tile_size 64,
  tile_view_angle 30, tile_depth_ratio 0)`, 16 tiles, 10 gen. Walls:
  `tile_height 128` (15 gen), import with `--anchor 32,88`. Number variants in
  the prompt ("1). plain ... 2). cracked ..."). `--plain` picks the common
  tiles.
- **Terrain transitions** (lava pools, carpets, wide roads): `create_tiles_pro(
  tile_feature 'tileset', description '<A> to <B>', ...)`, 16 corner tiles,
  10 gen. `get_tiles_pro` lists `tile_N: mask=M` (the zip has only PNGs).
  - Mask = NW<<3 | NE<<2 | SW<<1 | SE, bit set = terrain A.
  - On a diamond: NW = top, NE = right, SE = bottom, SW = left. These are the
    grid points (i,j), (i+1,j), (i+1,j+1), (i,j+1) of cell (i,j).
  - Put terrain on grid points, not cells (the "dual grid"). Mask 15 = all A.
  - Other seeds give the same tile order: import 2-3 with `--variants`.
  - Edges are blocky diamond halves: fine for pools and carpets, not for
    organic shores.
  - A wide path = mark all 4 corners of every route cell.
- **Narrow paths**: `create_path_tiles` (18 tiles, 10 gen at 64px).
  - Edge mask = N | E<<1 | S<<2 | W<<3, bit set = the path crosses that edge.
  - Masks are not in tile order and some repeat: give
    `--rule edge --masks ...`, with `x` for stamp-only tiles.
  - Route on 4-connected cells with a turn penalty.
  - The default path is thin; describe its width.
- **One shade per area**:
  - A transition set made separately from the area's floor looks out of
    place in game.
  - Transition sets can't take style references. So generate the transition
    set first, then the plain floors and decor with tiles-pro
    `style_images` = the set's all-A tile (c15). Or use c15 as the floor, or
    palette-lock both.
  - Linked tilesets (one set's lower terrain = another's upper) exist only
    for top-down (`create_topdown_tileset` with `lower_base_tile_id` /
    `upper_base_tile_id`), not isometric.
- **Buildings and rooms**: `create_building_kit(wall_description,
  floor_description, tile_type isometric, tile_size 64, wall_tiles 2,
  layout grid)`.
  - Charged 15 gen (keep 25 free); 58 pieces in one style.
  - Pieces are stamped per cell, not a Wang set. All of them share one canvas
    around the same floor diamond, so one anchor fits all.
  - `import kit` names the tags by role. The role -> index map is only in
    `get_tiles_pro`'s text: check it against `KIT_ROLES` in `art.mjs`, and
    pass `--roles` if it differs.
  - Placement per floor cell:
    - `side_<d>` on each edge facing a non-floor cell;
    - `corner_<d>` where two sides meet;
    - `outer_<d>` where both sides are floor but the diagonal isn't;
    - `door_<d>a/b` instead of a side, `pillar` free-standing;
    - `partition_*` / `pwall_*` / `pmulti_*` for thin interior walls,
      `omulti_*` for solid blocks.
  - Draw floors first, then pieces in (i + j) order. Usually draw only N / W
    walls (front walls hide the room).
  - Whole wall pieces join better than pillars.
- **Check joins without the game**: `art preview <key>` (kit room, corner
  blobs or a path loop) renders the exported sheet with the masks and pivots,
  as a game would. Use it after every tileset / kit import.
- Rooms / maps (`create_room`, `create_map`): finished pictures and layout
  tools for PixelLab's own builder. Use them as reference art only; keep
  layouts in your own data.

### 5.5 Objects and props

- **1 direction**: `create_1_direction_object`, 10 gen for a review pack (64
  candidates at 32px, 16 at 64px, 4 at 128px, 1 above 170px). Generate items
  separately (one per candidate); don't cut items out of one image.
  - `item_descriptions` shorter than the pack: the rest become free extras
    in the same style.
  - Pick with `select_object_frames`: new ids come back in the order of the
    indices given.
  - Prompts: props "isometric three-quarter view from above, on transparent
    background"; inventory icons "RPG inventory item icon, single item
    centered" at 32px.
- **8 directions** (turrets, statues, vehicles): `create_8_direction_object`
  (10 gen to 84px, 15 to 112, 25 to 168); `style_object_id` matches another.
  An existing 1-direction object becomes 8-direction (same id, tags,
  animations) with `expand_object_to_8_directions` (10-25 gen, review with
  `select_object_frames` / `dismiss_review`).
  Tags `<name>-<dir>` in screen directions: world east on an iso map is
  screen south-east.
- **States** (`create_object_state`, 10 gen): open / closed, broken, lit. Each
  state is its own object id. Convention: one objects file, a tag per state;
  the game swaps the tag.
- **Animated objects**: `animate_object` v3 (~1 gen for 8 frames at 64px; 5 at
  192px).
  - Start each description with `<name>:`: the folder name becomes the tag
    `<object>_<name>`, and several animations per object work.
  - Idle loops: "subtle seamless loop, brightness and colours stay the same
    as the first frame throughout, ends exactly as it starts". Check with
    `art loops`; a pulsing glow can simply be set to ping-pong.
- **Big multi-part things** (boss with hands, siege engine): generate the
  parts together in one review pack (they share a look), one objects file.
  Place them with rig points: `art points <key> hand_l=-90,60 ...` -> slices
  `point:<name>`, which the export passes on for the game to read.
- **Small creatures** (bat, ghost, wisp): one image (`create_image_pixflux`
  64x64, 1 gen, set `view` / `direction` / `outline`), then
  `animate_image_pixminimax(first_frame_url, description, frame_count 8,
  direction, view, subject_description, initial_pose)` (1 gen).
  - Strong motion; `animate_image` is weaker.
  - Download `?index=N`: 0 = the input, 1..N generated. The last frame comes
    back to the input, so frames 1..N loop.
  - `import images <key> fly=anim:<job> still=job:<image-job>`.

### 5.6 Effects

`vfx_workbench` (free): `describe start`, ~150 parts plus your own layers,
recolour with a ramp, `retime` then set `fps`, `scale`. It exports an atlas
with a JSON origin. `import fx <key> <image-id>/<file>`, plus `--once` for
one-shot impacts and explosions.

### 5.7 UI

- `create_ui_asset` (10 gen up to 256px, 15 above). Pieces come out much
  larger than asked and off-centre: the importer trims them.
- Stretchable panels: ask for "ornaments only in the corners, perfectly plain
  uniform straight edges", then `import ui <key> <id> --nine auto` (`--tile`
  to repeat the edges). Small thick-framed pieces (slots) can't 9-slice
  small: scale them instead.
- Several pieces in one generation via `pieces`; cut each with
  `@x,y,w,h`. `--states` derives hover (x1.25 brightness) and pressed (x0.78,
  1px down).
- **Newer flow, not tested here yet** (the MCP gained it after the tests):
  a generated template is split into elements with
  `update_ui_asset(split=True)` (free; `get_ui_asset(template)` shows the cuts
  first), and `create_ui_states(element_ids, states)` draws real states
  (hover, pressed, disabled, selected, anything described) for every element
  in one generation, so a set stays consistent (10 gen up to a 256px grid,
  15 to 341, 25 above; it takes `palette`). Elements and states are UI
  assets with their own ids, so `import ui <key> normal=<element-id>
  hover=<state-id> pressed=<state-id> ...` should take them; states are
  trimmed to what they draw and the importer trims every state, so they
  line up on their centres. Prefer this over `--states` when the states
  should differ in more than brightness.
- `update_ui_asset(nine_slice={left,right,top,bottom})` stores 9-slice insets
  on PixelLab's side (free). `--nine l,t,r,b` takes the same numbers, but on
  the trimmed piece: subtract any transparent margin of the element first.
  `--nine auto` needs no numbers.

### 5.8 Fonts

`create_font(description, glyph_px 8-64, weight, font_name)`, 15 gen.
- `get_font` gives the atlas once post-processing ends (minutes later):
  8 columns x 10 rows of glyph_px cells (the docs say 10x8), 80 glyphs
  `A-Z a-z .,!?:;'"-+()0-9/%*=_$`. No space; the colours asked for are
  ignored.
- `import font` recolours the glyphs white with a 1px dark outline (tint them
  in game); the export writes a font the engine loads.
- Gothic prompts make great title fonts. For body text ask for "readable",
  16px.

### 5.9 Portraits and talking heads

- `create_portrait_character(direction 'character_to_portrait', image_url =
  the character's south rotation, result_size 64 (10 gen) | 128 (15 gen))`.
  It keeps the identity. Import as `images`.
- Talking: `set_character_portrait` (free), then `create_vocal_animation(
  character_id, mood, viseme_count 7)`, ~6 gen per mood at 128px.
  - The grid has a row per mood and columns rest, closed, small_open,
    medium_open, wide_open, round, teeth.
  - Import the grid with `images` + `@x,y,w,h` per cell, tags
    `<mood>-<shape>`.
  - The game maps text to mouth shapes (PixelLab's `get_lip_sync` has the
    mapping; the Phaser runtime has `lipSync`).

### 5.10 Pictures

`create_image_pro` (10-25 gen; many candidates at small sizes, 1 at 688x384)
for title art and backdrops. Concept art -> pixel art:
`image_to_pixelart_pro_flash` (6 gen, clean) beats `image_to_pixelart`;
`image_to_pixelart_pro` (20 gen) is the most careful redraw when pro_flash
isn't good enough. `create_image_pro_from_style` draws new images in the
style of 1-4 given images (10 gen for 16 candidates at 64px): useful for
sprites that must match existing art. `remove_background` (1 gen, max
400x400 area) cuts a subject out of an image that came back on a backdrop.
Import any picture: `images <key> name=job:<id>`.

### 5.11 Normal maps and lighting

`art normals-prep <key> --upload <url>` -> `create_normal_map(image=<ref>,
kind, mode lite)` per strip (0.1 gen) -> `art normals-apply <key> <jobs>`.
Animations go in as animated GIFs (the prep does that). Space the calls:
bursts get throttled. Normals live in a hidden `normal` layer; the export
writes `<key>_n.png`, laid out like the colour sheet. Keep effects unlit.
Lighting costs frame rate: measure.

### 5.12 Fixing art

- **Remove something from a frame** (a flash, a stray effect):
  1. `art frames <key> <tag> --only <n> --mask --upload <url>`.
  2. `inpaint_image(image_url, mask_image_url, description "nothing: empty
     transparent background ...")` (10 gen, ~1.5 min). Pixels outside the
     mask stay exact.
  3. `art patch <key> <frame>=<job>`. The old frame is kept in the `before`
     layer and the patch survives `reimport`.
- `edit_image` redraws the whole image (~20% of pixels change). Never use it
  on animation frames.
- `pixelart_workbench` (free): `lint`, `score`, `inspect --region`,
  `repair --ops stray`, exact `edit` (patch_pixels, map_colors). Result URL
  -> `art patch`.
- `correct_pixelart` / `reduce_colors` (0.1 gen) tidy, `unzoom_image` (0.1)
  recovers upscaled pixel art.
- **Hand edits** in Aseprite (or by script) on the `.aseprite` file, then
  `art export`. `reimport --force` discards them, so use `art patch` for
  fixes that must survive a rebuild.
- A loop that drifts (glow pulsing): set its tag to ping-pong instead of
  redrawing.
- A flaw in every tile of a generated set: fix it at the source (re-roll, or
  drop that set / variant), not pixel by pixel.

## 6. Costs (generations)

| Tool | Cost |
| --- | --- |
| create_character v3 / pro | 2 / 10 |
| create_character_state | 10 (64px), 15, 25 by art size |
| animate_character v3 / skeleton-v3 / pixminimax 8 fr / pixminimax 40 fr | 1 / 3 / 1 / 3 per direction |
| transfer_outfit | ~10 per call |
| create_tiles_pro 64px (16 tiles) / walls 64x128 / tileset / path tiles | 10 / 15 / 10 / 10 |
| create_building_kit iso 64 grid | 15 charged (25 reserve) |
| create_1_direction_object pack / create_8_direction_object | 10 / 10-25 |
| create_object_state | 10 |
| animate_object 64px 8 frames | ~1 |
| create_image_pixflux / animate_image(_pixminimax) 64px 8 fr | 1 / 1 |
| create_ui_asset | 10 (<=256px), 15 |
| create_ui_states (whole set, by grid side) | 10 (<=256px), 15 (<=341), 25 |
| update_ui_asset, mirror_animation, set_canvas_size, export_asset | free |
| edit_animation (by frame size) | 10 (<=128px), 15, 25 |
| expand_object_to_8_directions | 10-25 |
| remove_background | 1 |
| image_to_pixelart_pro | 20 |
| create_image_pro_from_style | 10-25 per call |
| create_font | 15 |
| create_portrait_character | 10-15 |
| create_vocal_animation (128px, per mood) | ~6 |
| create_image_pro | 10-25 |
| inpaint_image | 10 |
| create_normal_map lite, correct_pixelart, reduce_colors, unzoom_image | 0.1 |
| vfx_workbench, pixelart_workbench, wait_for_jobs, get_*, get_upload_url, search_help | free |

For scale: a full platformer level took ~115 generations. A 64px 8-direction
monster with 4 clips ~30 (v3).

## 7. Pitfalls

- Aseprite CLI: `--frame-range` / `--frame-tag` must come before the file.
  A long batch run outlives a tool timeout. Stop it with
  `pkill -f "aseprite -b <project path>"` (not the user's own Aseprite).
- The export uses `--sheet-type rows`: packed sheets take minutes at ~500
  frames.
- Engine-specific pitfalls are in `engines/<engine>/README.md`.
- PixelLab downloads:
  - Characters: a zip, with files nested under the state name (`Idle/...`).
  - Still objects: a PNG; animated objects: a zip.
  - UI: a PNG. Tiles: a zip of `tile_N.png` with no metadata (masks and roles
    are only in `get_tiles_pro`'s text).
  - Images: `/mcp/images/<job>/download?index=N`.
- macOS zsh: unquoted `$var` doesn't word-split. Run loops over several
  files under `bash`, or quote the arguments.
- Frame indexes: Aseprite's UI counts from 1, the export from 0.
