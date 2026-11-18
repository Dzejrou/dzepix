// The art pipeline: PixelLab -> editable .aseprite -> a game engine
// ("engine" in art.config.json: phaser, godot). Docs: docs/pixellab-mcp.md
// and engines/<engine>/README.md in this tool's folder.
//
//   node tools/art/art.mjs import character <key> <character-id> [--skip <tag>:<i>,<i>;...] [--chain <name>=<anim>+<anim>...]
//   node tools/art/art.mjs import tiles     <key> <tiles-id> [--plain 0,6,8] [--pick 0,1,2] [--anchor x,y]
//   node tools/art/art.mjs import objects   <key> <name>=<object-id> [<name>=<object-id>...]
//   node tools/art/art.mjs import tileset   <key> <tiles-id> [--rule corner|edge] [--terrains 'first|second'] [--masks m0,m1,x,...] [--variants <id>,<id>]
//   node tools/art/art.mjs import kit       <key> <tiles-id> [--roles floor=0,side_N=1,...]   building kit pieces
//   node tools/art/art.mjs import fx        <key> <image-id>/<file> [--once]
//   node tools/art/art.mjs import font      <key> <font-job-id> [--color '#ffffff'] [--outline '#140c0a'|none]
//   node tools/art/art.mjs import images    <key> <name>=<https-url | job:<image-job-id> | anim:<animate-image-job-id>>[@x,y,w,h] [...]
//   node tools/art/art.mjs import ui        <key> [<state>=]<ui-asset-id>[@x,y,w,h] [...] [--states] [--nine auto|l,t,r,b] [--tile]
//   node tools/art/art.mjs reimport <key>|--all     re-download from art/<key>/<key>.pixellab.json
//   node tools/art/art.mjs export [<key>...]        export all (or some) to <out> (art.config.json)
//   node tools/art/art.mjs list                     list the art and what it was made from
//   node tools/art/art.mjs palette <name> --from <key,...> [--colors 32] | --hex '#..,#..'
//   node tools/art/art.mjs colors <key> [--palette <name>]   colour count / palette check
//   node tools/art/art.mjs loops <key>              looping tags with a hitch at the loop point
//   node tools/art/art.mjs preview <key> [--out f.png] [--seed N]   demo map from an exported kit / tileset (offline, no game)
//   node tools/art/art.mjs frames <key> <tag> [--only 4,5] [--mask] --upload <url>   frames (+ inpaint masks) to fix
//   node tools/art/art.mjs patch <key> <frame>=<image-job[:n] | https-url | file.png> ...
//                                                   fixed frames back in ("before" layer kept, copies in art/<key>/patches/)
//   node tools/art/art.mjs points <key> <name>=<x>,<y> ...   named attachment points (slices "point:<name>")
//   node tools/art/art.mjs normals-prep <key> [--tags a,b] --upload <url>   strips for create_normal_map
//   node tools/art/art.mjs normals-apply <key> <job-id>...                 maps -> "normal" layer, <key>_n.png
//   node tools/art/art.mjs frame <id|key> <still|anim:last|anim:N> [--dir d] [--size-of spec] [--upload url]
//                                                   a frame to chain clips from (see docs/pixellab-mcp.md)
//   node tools/art/art.mjs clip <id|key> <anim> [--dir d] [--fit 80] [--upload url]   a clip's frames cut to one window, uploaded (transfer_outfit)
// Any import takes --despeckle: remove isolated stray pixels (pixminimax).
// Any import takes --palette <name> (art/palettes/<name>.json): the .aseprite
// file then carries that palette for hand edits; add --snap to also move
// every off-palette pixel onto it (needed for animations, see docs/pixellab-mcp.md).
// Any import also takes --recipe '<json>': the PixelLab tool and parameters
// the asset was made with (prompt, mode, palette, style references), stored
// in the record so it can be regenerated the same way.
//
// Every asset lives in art/<key>/: <key>.aseprite is the art (edit it freely)
// and <key>.pixellab.json records where it came from, so `reimport` can
// rebuild it. Import refuses to overwrite an existing .aseprite (it may have
// hand edits) unless --force is given.
//
// Conventions inside the .aseprite files, which the game relies on:
//   - tags name animations / pieces; a tag with no repeat count loops, a tag
//     with repeat 1 plays once (set it in Aseprite's tag properties);
//   - a slice called "anchor" marks the ground point (characters, tiles) or
//     the effect's origin (fx); objects without one stand on the bottom of
//     their pixels;
//   - characters: "<anim>-<direction>" tags plus one-frame "still-<dir>" tags;
//   - tiles: "plain" and "decor" tags (decor is placed more rarely);
//   - kit: one tag per building-kit piece, named by role (see importers.kit);
//   - tileset: "c<mask>" tags, one per corner combination (see importers.tileset);
//   - objects: one tag per object, named by the object; 8-direction objects
//     get "<name>-<dir>" (and "<name>_<anim>-<dir>") tags;
//   - font: one tag per character (frame = glyph);
//   - ui: one piece per file, one tag per state ("normal", "hover", "pressed",
//     "on"...); origin at the centre of its pixels; a slice called "nine"
//     with a 9-slice centre makes it stretchable (slice user data "tile":
//     repeat the edges instead of stretching).
//
// Every command works on a built sheet per asset in <art>/.build/ (made from
// the .aseprite file when missing or older; ignored by git): <key>.png +
// <key>.json, trimmed and packed, frames named by index, tags renamed
// "<key>-<tag>", each frame with its origin as a "pivot" (fractions of the
// untrimmed frame), ui frames with "scale9Borders", jump tags with "air",
// meta.kind = the asset kind. The engine's exporter (engines/<engine>/
// export.mjs) turns built sheets into the files that engine loads, in <out>.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { PNG } from 'pngjs';
import { airborne } from './airborne.mjs';

// The tool lives in its own folder (usually a submodule at tools/art/) and
// works on the project it is run from: paths come from art.config.json in the
// current directory.
const TOOL = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
// Defaults; a project overrides any of them in art.config.json.
const CONFIG = {
  engine: 'phaser', // which exporter writes <out>: a folder in engines/
  art: 'art', // where the .aseprite files live
  out: 'public/assets/gfx', // where exports go
  frameMs: { walk: 83, idle: 140, attack: 71, death: 100, jump: 83 }, // by animation base name
  defaultFrameMs: 100,
  looping: ['walk', 'idle'], // animation base names that loop; the rest play once
  footOffset: 2, // character anchor: this many px above the lowest pixel of the still poses
  uiStates: { hover: 1.25, pressed: 0.78 }, // brightness of --states derived frames
  sheetWidth: 2048, // starting export sheet width (doubles while taller than wide)
  asepriteUserFolder: '~/.aseprite-headless', // clean Aseprite settings for batch runs (null = your own)
};
if (fs.existsSync(path.join(ROOT, 'art.config.json'))) Object.assign(CONFIG, JSON.parse(fs.readFileSync(path.join(ROOT, 'art.config.json'), 'utf8')));
// Run Aseprite with its own clean settings folder: no user extensions in
// batch mode (they cost start-up time and some print errors without a UI,
// e.g. PixelLab's handle-pose.lua). Your normal Aseprite is untouched.
// Children inherit process.env, so every execFileSync(ASEPRITE) uses it.
// "asepriteUserFolder": null in art.config.json keeps your own settings.
if (CONFIG.asepriteUserFolder && !process.env.ASEPRITE_USER_FOLDER) {
  process.env.ASEPRITE_USER_FOLDER = CONFIG.asepriteUserFolder.replace(/^~(?=\/|$)/, os.homedir());
}
const FRAME_MS = CONFIG.frameMs;
// create_font's atlas: 80 glyphs, row-major, 8 per row, in this order (no space).
const FONT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,!?:;\'"-+()0123456789/%*=_$';
const LOOPING = new Set(CONFIG.looping);
const ART = path.resolve(ROOT, CONFIG.art);
const OUT = path.resolve(ROOT, CONFIG.out);
const BUILD = path.join(ART, '.build');
// PIXELLAB_API: another server with the same download routes (the smoke test).
const API = process.env.PIXELLAB_API ?? 'https://api.pixellab.ai/mcp';
// Building-kit piece indices (create_building_kit, isometric grid layout, as
// get_tiles_pro listed them); override per kit with --roles.
const KIT_ROLES = {
  floor: 0, side_N: 1, side_E: 2, side_S: 3, side_W: 4,
  corner_NE: 5, corner_SE: 6, corner_SW: 7, corner_NW: 8,
  outer_NE: 9, outer_SE: 10, outer_SW: 11, outer_NW: 12,
  partition_hub: 13, partition_N: 14, partition_E: 15, partition_S: 16, partition_W: 17,
  pwall_N: 18, pwall_E: 19, pwall_S: 20, pwall_W: 21,
  pmulti_NE: 22, pmulti_NW: 23, pmulti_ES: 24, pmulti_SW: 25, pmulti_NES: 26, pmulti_NSW: 27, pmulti_NEW: 28, pmulti_ESW: 29, pmulti_NESW: 30,
  pillar: 31, door_Na: 32, door_Nb: 33, door_Ea: 34, door_Eb: 35, door_Sa: 36, door_Sb: 37, door_Wa: 38, door_Wb: 39,
  stairs_1: 40, stairs_2: 41, stairs_east_1: 42, stairs_east_2: 43, roof: 44,
  pdoor_Va: 45, pdoor_Vb: 46, pdoor_Ha: 47, pdoor_Hb: 48,
  omulti_NES: 49, omulti_NEW: 50, omulti_NSW: 51, omulti_ESW: 52, omulti_NESW: 53, omulti_NS: 54, omulti_EW: 55,
};
const ASEPRITE = process.env.ASEPRITE ?? `${os.homedir()}/Applications/Aseprite.app/Contents/MacOS/aseprite`;
const DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

const recordFile = (key) => path.join(ART, key, `${key}.pixellab.json`);
const aseFile = (key) => path.join(ART, key, `${key}.aseprite`);
const readPng = (file) => PNG.sync.read(fs.readFileSync(file));

async function fetchBuf(url, tries = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    // 423: the asset is still generating on PixelLab's side.
    if (i + 1 >= tries || !(res.status === 423 || res.status >= 500)) {
      throw new Error(`${res.status} ${res.statusText} for ${url}${res.status === 423 ? ' (still generating, try again later)' : ''}`);
    }
    console.warn(`  ${res.status}, retrying in 20s...`);
    await new Promise((r) => setTimeout(r, 20000));
  }
}

const unzip = (buf, dir) => { new AdmZip(buf).extractAllTo(dir, true); };
// A character's download holds every state of its group (the original
// "Idle" and each create_character_state variant, in their own folders):
// take the one whose id was asked for.
const pickState = (meta, id) => meta.states.find((s) => s.character.id === id) ?? meta.states[0];
const list = (s) => (s ? String(s).split(',').map(Number) : null);

// ---- importers: each returns a plan for build_aseprite.lua ----------------
// plan = { width, height, anchor?, frames: [{ file, ms, x, y }], tags: [{ name, from, to, repeats? }] }
// plus `info`, extra fields for the .pixellab.json record.

function planner() {
  const frames = [], tags = [];
  return {
    frames, tags,
    add(name, files, ms, repeats) {
      tags.push({ name, from: frames.length, to: frames.length + files.length - 1, ...(repeats ? { repeats } : {}) });
      for (const f of files) { const p = readPng(f); frames.push({ file: f, ms, w: p.width, h: p.height }); }
    },
    // One canvas big enough for every frame, frames centred on it.
    layout() {
      const w = Math.max(...frames.map((f) => f.w)), h = Math.max(...frames.map((f) => f.h));
      for (const f of frames) { f.x = Math.floor((w - f.w) / 2); f.y = Math.floor((h - f.h) / 2); }
      return { width: w, height: h };
    },
  };
}

// A w x h window of img at (x, y); outside the image is transparent.
function crop(img, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = x + i, sy = y + j;
    if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
    img.data.copy(out.data, (j * w + i) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
  }
  return out;
}

// Cut away the transparent border.
function trim(img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return x1 < 0 ? img : crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

// The same picture with every colour scaled by k (lighter above 1).
function shade(img, k) {
  const out = crop(img, 0, 0, img.width, img.height);
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(255, Math.round(out.data[i + c] * k));
  return out;
}

// The flat middle of a framed piece, found by walking out from the centre
// along many rows and columns until the colour changes sharply (the inner
// edge of the frame); the median stop on each side wins, so a gap in the
// trim or an odd pixel doesn't matter. Its bounds become the 9-slice centre:
// the frame (corners and edges) is everything around it.
function flatMiddle(img) {
  const { width: w, height: h, data } = img;
  const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  const cx = w >> 1, cy = h >> 1;
  const ref = [0, 0, 0];
  let n = 0;
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { const p = px(x, y); for (let c = 0; c < 3; c++) ref[c] += p[c]; n++; }
  for (let c = 0; c < 3; c++) ref[c] /= n;
  const edge = (x, y) => { const p = px(x, y); return p[3] === 0 || Math.hypot(p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]) > 70; };
  const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  // Walk from (x, y) by (dx, dy) to the first edge pixel; returns its coordinate.
  const walk = (x, y, dx, dy) => { while (x > 0 && y > 0 && x < w - 1 && y < h - 1 && !edge(x, y)) { x += dx; y += dy; } return dx ? x : y; };
  const rows = [], cols = [];
  for (let k = 0.3; k <= 0.7001; k += 0.05) { rows.push(Math.round(h * k)); cols.push(Math.round(w * k)); }
  const left = median(rows.map((y) => walk(cx, y, -1, 0))) + 1;
  const right = median(rows.map((y) => walk(cx, y, 1, 0))) - 1;
  const top = median(cols.map((x) => walk(x, cy, 0, -1))) + 1;
  const bottom = median(cols.map((x) => walk(x, cy, 0, 1))) - 1;
  // A couple of pixels in from the frame, away from its shading.
  const pad = 2;
  let l = left + pad, t = top + pad, r = w - 1 - (right - pad), b = h - 1 - (bottom - pad); // border widths
  // Grow the corners over any ornament: walking from the middle of each edge
  // strip toward a corner, the corner starts at the first sharp change.
  const diff = (ax, ay, bx, by) => { const p = px(ax, ay), q = px(bx, by); return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) + Math.abs(p[3] - q[3]); };
  const lineDiff = (vertical, at, mid, from, to) => { // mean difference between line `at` and line `mid` over [from, to)
    let sum = 0;
    for (let k = from; k < to; k++) sum += vertical ? diff(k, at, k, mid) : diff(at, k, mid, k);
    return sum / Math.max(1, to - from);
  };
  // The last line, walking from `start` by `step`, before one that differs
  // sharply from the line before it (slow shading along an edge doesn't count).
  const reach = (vertical, from, to, start, step) => {
    for (let at = start + step; at > 0 && at < (vertical ? h : w) - 1; at += step) {
      if (lineDiff(vertical, at, at - step, from, to) > 60) return at - step;
    }
    return start;
  };
  const cornerTop = Math.max(reach(true, 0, l, cy, -1), reach(true, w - r, w, cy, -1));
  const cornerBottom = Math.min(reach(true, 0, l, cy, 1), reach(true, w - r, w, cy, 1));
  const cornerLeft = Math.max(reach(false, 0, t, cx, -1), reach(false, h - b, h, cx, -1));
  const cornerRight = Math.min(reach(false, 0, t, cx, 1), reach(false, h - b, h, cx, 1));
  t = Math.max(t, cornerTop + 1); b = Math.max(b, h - cornerBottom);
  l = Math.max(l, cornerLeft + 1); r = Math.max(r, w - cornerRight);
  return { x: l, y: t, w: Math.max(1, w - l - r), h: Math.max(1, h - t - b) };
}

// Lowest opaque row of a PNG, or -1 if it is empty.
// ---- palettes ----------------------------------------------------------------
// art/palettes/<name>.json = { colors: ["#rrggbb", ...], from: [...] } (plus a
// .gpl Aseprite / GIMP can load). Pass its colours to PixelLab's `palette`
// so new art uses only them; `import --palette <name>` puts them in the
// .aseprite file's palette, so hand edits pick from the same colours.

const paletteFile = (name) => path.join(ART, 'palettes', `${name}.json`);
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

export function readPalette(name) {
  if (!fs.existsSync(paletteFile(name))) throw new Error(`no palette "${name}" (art/palettes/${name}.json)`);
  return JSON.parse(fs.readFileSync(paletteFile(name), 'utf8')).colors;
}

// Median cut over the opaque pixels of exported sheets, weighted by how
// often each colour is used.
function extractPalette(name, keys, n) {
  const counts = new Map();
  for (const key of keys) {
    const p = readPng(sheet(key).png);
    for (let i = 0; i < p.data.length; i += 4) {
      if (p.data[i + 3] < 128) continue;
      const k = (p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const all = [...counts].map(([k, w]) => ({ c: [k >> 16, (k >> 8) & 255, k & 255], w }));
  let boxes = [all];
  // Mean colour of a box; boxes whose means are near-identical (e.g. three
  // shades of outline black) count once, so keep splitting until n distinct.
  const mean = (b) => { const w = b.reduce((s, e) => s + e.w, 0), m = [0, 0, 0]; for (const e of b) for (let a = 0; a < 3; a++) m[a] += e.c[a] * e.w; return m.map((v) => v / w); };
  const distinct = () => { const ms = []; for (const b of boxes) { const m = mean(b); if (!ms.some((o) => Math.hypot(o[0] - m[0], o[1] - m[1], o[2] - m[2]) < 14)) ms.push(m); } return ms.length; };
  while (distinct() < n) {
    // Split the box with the widest colour range (times its weight) at its weighted median.
    let best = -1, bestScore = 0, axis = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255, hi = 0, w = 0;
        for (const e of b) { lo = Math.min(lo, e.c[a]); hi = Math.max(hi, e.c[a]); w += e.w; }
        const score = (hi - lo) * Math.sqrt(w);
        if (score > bestScore) { bestScore = score; best = i; axis = a; }
      }
    });
    if (best < 0) break;
    const b = boxes[best].sort((p, q) => p.c[axis] - q.c[axis]);
    const total = b.reduce((s, e) => s + e.w, 0);
    let acc = 0, cut = 1;
    for (; cut < b.length - 1; cut++) { acc += b[cut - 1].w; if (acc >= total / 2) break; }
    boxes.splice(best, 1, b.slice(0, cut), b.slice(cut));
  }
  // Merge the near-duplicates (weighted), keeping the heavier colour.
  const merged = [];
  for (const b of boxes.map((b) => ({ c: mean(b), w: b.reduce((s, e) => s + e.w, 0), b })).sort((p, q) => q.w - p.w)) {
    const o = merged.find((m) => Math.hypot(m.c[0] - b.c[0], m.c[1] - b.c[1], m.c[2] - b.c[2]) < 14);
    if (o) o.b.push(...b.b); else merged.push({ ...b, b: [...b.b] });
  }
  boxes = merged.map((m) => m.b);
  const colors = boxes.map((b) => {
    const w = b.reduce((s, e) => s + e.w, 0), m = [0, 0, 0];
    for (const e of b) for (let a = 0; a < 3; a++) m[a] += e.c[a] * e.w;
    return { c: m.map((v) => Math.round(v / w)), w };
  }).sort((p, q) => (p.c[0] * 0.3 + p.c[1] * 0.59 + p.c[2] * 0.11) - (q.c[0] * 0.3 + q.c[1] * 0.59 + q.c[2] * 0.11));
  writePalette(name, colors.map((e) => hex(e.c)), keys);
}

function writePalette(name, colors, from) {
  fs.mkdirSync(path.dirname(paletteFile(name)), { recursive: true });
  fs.writeFileSync(paletteFile(name), JSON.stringify({ colors, from }, null, 1));
  const gpl = ['GIMP Palette', `Name: ${name}`, '#', ...colors.map((c) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c}`;
  })];
  fs.writeFileSync(path.join(ART, 'palettes', `${name}.gpl`), gpl.join('\n') + '\n');
  // A swatch strip to look at.
  const sw = new PNG({ width: colors.length * 16, height: 16 });
  colors.forEach((c, i) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const o = (y * sw.width + i * 16 + x) * 4; sw.data[o] = r; sw.data[o + 1] = g; sw.data[o + 2] = b; sw.data[o + 3] = 255; }
  });
  fs.writeFileSync(path.join(ART, 'palettes', `${name}.png`), PNG.sync.write(sw));
  console.log(`palette ${name}: ${colors.length} colours`);
  console.log(JSON.stringify(colors));
}

// Remove stray pixels: opaque pixels with no opaque neighbour (8 around).
// pixminimax clips leave a few specks around the character.
function despeckle(file) {
  const p = readPng(file), { width: w, height: h, data } = p;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    let alone = true;
    for (let dy = -1; dy <= 1 && alone; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && on(x + dx, y + dy)) { alone = false; break; }
    if (alone) { data[(y * w + x) * 4 + 3] = 0; n++; }
  }
  if (n) fs.writeFileSync(file, PNG.sync.write(p));
  return n;
}

// Rewrite a PNG so every opaque pixel is a palette colour (nearest by a
// perceptual-ish weighted RGB distance); returns how many pixels moved.
function snapToPalette(file, colors) {
  const pal = colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  const p = readPng(file);
  const cache = new Map();
  let moved = 0, total = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i + 3] === 0) continue;
    total++;
    const k = (p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2];
    let best = cache.get(k);
    if (!best) {
      let d0 = Infinity;
      for (const c of pal) {
        const dr = p.data[i] - c[0], dg = p.data[i + 1] - c[1], db = p.data[i + 2] - c[2];
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < d0) { d0 = d; best = c; }
      }
      cache.set(k, best);
    }
    if (best[0] !== p.data[i] || best[1] !== p.data[i + 1] || best[2] !== p.data[i + 2]) moved++;
    p.data[i] = best[0]; p.data[i + 1] = best[1]; p.data[i + 2] = best[2];
    p.data[i + 3] = p.data[i + 3] < 128 ? 0 : 255; // no half-transparent edges in pixel art
  }
  fs.writeFileSync(file, PNG.sync.write(p));
  return { moved, total };
}

function lowestRow(p) {
  for (let y = p.height - 1; y >= 0; y--) for (let x = 0; x < p.width; x++) if (p.data[(y * p.width + x) * 4 + 3] > 0) return y;
  return -1;
}

const importers = {
  // PixelLab character: rotations + every animation, all directions.
  async character(tmp, { id, skip = {}, chains = {}, frames: extra = {} }) {
    unzip(await fetchBuf(`${API}/characters/${id}/download`), tmp);
    const state = pickState(JSON.parse(fs.readFileSync(path.join(tmp, 'metadata.json'), 'utf8')), id);
    const pl = planner();
    for (const d of DIRS) if (state.frames.rotations[d]) pl.add(`still-${d}`, [path.join(tmp, state.frames.rotations[d])], 200);
    // Same-named animations from different groups come as "<name>-<8 hex of
    // the group id>" (e.g. one direction re-rolled in a new group): merge
    // them back into <name>, direction by direction.
    const anims = {};
    for (const [name, byDir] of Object.entries(state.frames.animations)) {
      const base = name.replace(/-[0-9a-f]{8}$/, '');
      anims[base] ??= {};
      for (const [d, files] of Object.entries(byDir)) {
        if (anims[base][d]) console.warn(`  ${name}: ${d} also in another "${base}" group, keeping the first`);
        else anims[base][d] = files;
      }
    }
    const addAnim = (anim, d) => {
      const bad = skip[`${anim}-${d}`] ?? [];
      const files = anims[anim][d].filter((_, i) => !bad.includes(i)).map((f) => path.join(tmp, f));
      // Timing and looping by the animation's base name: "attack_slam" is an attack.
      const base = anim.split('_')[0];
      pl.add(`${anim}-${d}`, files, FRAME_MS[base] ?? CONFIG.defaultFrameMs, LOOPING.has(base) ? undefined : 1);
    };
    // Chains: clips generated one after another (each starting from the last
    // frame of the one before) laid out back to back, plus one tag over all
    // of them, "<chain>-<dir>", in every direction that has every part.
    const chained = new Set(Object.values(chains).flat());
    const seams = []; // [frame index of a part's first frame, its part's last frame index]
    for (const [chain, parts] of Object.entries(chains)) {
      for (const d of DIRS) {
        if (!parts.every((a) => anims[a]?.[d])) continue;
        const from = pl.frames.length;
        parts.forEach((a, k) => {
          const start = pl.frames.length;
          addAnim(a, d);
          if (k) seams.push([start, pl.frames.length - 1]);
        });
        const base = chain.split('_')[0];
        pl.tags.push({ name: `${chain}-${d}`, from, to: pl.frames.length - 1, ...(LOOPING.has(base) ? {} : { repeats: 1 }) });
      }
    }
    for (const anim of Object.keys(anims)) {
      if (chained.has(anim)) continue;
      for (const d of DIRS) if (anims[anim][d]) addAnim(anim, d);
    }
    // Frames from an image job (e.g. transfer_outfit), as a tag: "<anim>-<dir>"
    // = "<job-id>[@x,y,w,h]" where x,y,w,h says the frames were cut at x,y
    // out of w x h clip frames (art clip --fit), so they are padded back.
    for (const [tag, spec] of Object.entries(extra)) {
      const [job, rect] = spec.split('@');
      const files = [];
      for (let n = 0; ; n++) {
        const res = await fetch(`${API}/images/${job}/download?index=${n}`);
        if (!res.ok) { if (n === 0) throw new Error(`image job ${job}: ${res.status} ${res.statusText}`); break; }
        let img = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
        if (rect) {
          const [x, y, w, h] = rect.split(',').map(Number);
          const out = new PNG({ width: w, height: h });
          PNG.bitblt(img, out, 0, 0, img.width, img.height, x, y);
          img = out;
        }
        const file = path.join(tmp, `${tag}-${n}.png`);
        fs.writeFileSync(file, PNG.sync.write(img));
        files.push(file);
        if (n > 64) break;
      }
      const base = tag.split('-')[0].split('_')[0];
      pl.add(tag, files, FRAME_MS[base] ?? CONFIG.defaultFrameMs, LOOPING.has(base) ? undefined : 1);
    }
    let size = pl.layout();
    // PixelLab re-measures the canvas of clips made from custom frames, so a
    // chained part can land a pixel or two off: slide each part so its first
    // frame best overlaps the previous part's last frame, then refit.
    if (seams.length) {
      const mask = (f) => { const p = readPng(f.file); return { p, f }; };
      for (const [start, end] of seams) {
        const a = mask(pl.frames[start - 1]), b = mask(pl.frames[start]);
        let best = { d: Infinity, dx: 0, dy: 0 };
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          let d = 0;
          for (let y = 0; y < b.p.height; y++) for (let x = 0; x < b.p.width; x++) {
            const X = x + b.f.x + dx - a.f.x, Y = y + b.f.y + dy - a.f.y;
            const A = X >= 0 && Y >= 0 && X < a.p.width && Y < a.p.height && a.p.data[(Y * a.p.width + X) * 4 + 3] > 0;
            if (A !== (b.p.data[(y * b.p.width + x) * 4 + 3] > 0)) d++;
          }
          if (d < best.d || (d === best.d && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { d, dx, dy };
        }
        if (best.dx || best.dy) {
          console.log(`chain seam at frame ${start}: part shifted by ${best.dx},${best.dy}`);
          for (let i = start; i <= end; i++) { pl.frames[i].x += best.dx; pl.frames[i].y += best.dy; }
        }
      }
      const minX = Math.min(...pl.frames.map((f) => f.x)), minY = Math.min(...pl.frames.map((f) => f.y));
      for (const f of pl.frames) { f.x -= minX; f.y -= minY; }
      size = { width: Math.max(...pl.frames.map((f) => f.x + f.w)), height: Math.max(...pl.frames.map((f) => f.y + f.h)) };
    }
    // Ground point: the lowest opaque row over all standing poses.
    let foot = 0;
    for (const f of pl.frames.slice(0, DIRS.length)) foot = Math.max(foot, lowestRow(readPng(f.file)) + f.y);
    return {
      ...size, anchor: { x: Math.floor(size.width / 2), y: foot - CONFIG.footOffset }, frames: pl.frames, tags: pl.tags,
      info: {
        name: state.character.name, prompt: state.character.prompt, size: state.character.size, view: state.character.view,
        animations: Object.fromEntries(Object.entries(anims).map(([a, byDir]) => [a, Object.keys(byDir)])),
      },
    };
  },

  // PixelLab tiles-pro set: one frame per tile. `plain` tiles go first under
  // a "plain" tag, the rest under "decor"; `pick` keeps only those tiles.
  async tiles(tmp, { id, plain, pick, anchor }) {
    unzip(await fetchBuf(`${API}/tiles-pro/${id}/download`), tmp);
    const tiles = fs.readdirSync(tmp, { recursive: true }).filter((f) => /_(\d+)\.png$/.test(f))
      .map((f) => ({ n: +f.match(/_(\d+)\.png$/)[1], file: path.join(tmp, f) })).sort((a, b) => a.n - b.n);
    const keep = pick ? pick.map((n) => tiles.find((t) => t.n === n)) : tiles;
    const isPlain = (t) => (plain ?? keep.map((k) => k.n)).includes(t.n);
    const pl = planner();
    const plainTiles = keep.filter(isPlain), decor = keep.filter((t) => !isPlain(t));
    if (plainTiles.length) pl.add('plain', plainTiles.map((t) => t.file), 100);
    if (decor.length) pl.add('decor', decor.map((t) => t.file), 100);
    const size = pl.layout();
    // Default anchor: the canvas centre, where PixelLab puts a flat tile's
    // diamond. Tall tiles (walls) need --anchor at their ground diamond.
    const [ax, ay] = anchor ?? [size.width / 2, size.height / 2];
    return { ...size, anchor: { x: ax, y: ay }, frames: pl.frames, tags: pl.tags, info: { tiles: [...plainTiles, ...decor].map((t) => t.n) } };
  },

  // A building kit (create_building_kit): walls, corners, doorways, pillar,
  // stairs as separate pieces, each drawn on one shared canvas around the
  // same floor diamond, so every piece stamps onto its cell with one anchor
  // (the diamond's centre). One tag per piece, named by its role from
  // get_tiles_pro's placement_rules: floor, side_N, corner_NE, outer_NE,
  // door_Na, partition_N, pwall_N, pmulti_ES, omulti_NESW, pdoor_Ha, pillar,
  // stairs_1, stairs_east_1, roof; unlisted tiles become extra_<n>.
  // --roles '<role>=<idx>,...' when a kit's indices differ from KIT_ROLES.
  async kit(tmp, { id, roles }) {
    unzip(await fetchBuf(`${API}/tiles-pro/${id}/download`), tmp);
    const files = new Map(fs.readdirSync(tmp, { recursive: true }).filter((f) => /_(\d+)\.png$/.test(f))
      .map((f) => [+f.match(/_(\d+)\.png$/)[1], path.join(tmp, f)]));
    const map = roles ?? KIT_ROLES;
    const named = new Map(Object.entries(map).map(([r, n]) => [n, r]));
    const pl = planner();
    for (const n of [...files.keys()].sort((a, b) => a - b)) pl.add(named.get(n) ?? `extra_${n}`, [files.get(n)], 100);
    const size = pl.layout();
    // Anchor: the centre of the floor piece's diamond.
    const floor = PNG.sync.read(fs.readFileSync(files.get(map.floor)));
    let x0 = 1e9, y0 = 1e9;
    for (let y = 0; y < floor.height; y++) for (let x = 0; x < floor.width; x++) if (floor.data[(y * floor.width + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
    const half = (floor.width - 2 * x0 + 1) >> 1; // diamond half-width
    return {
      ...size, anchor: { x: x0 + half, y: y0 + (half >> 1) }, frames: pl.frames, tags: pl.tags,
      info: { rule: 'kit: stamp pieces per cell (side_<dir> on each edge facing outside, corner_<dir> where two sides meet, outer_<dir> on a convex corner); N = cell (i,j-1) = upper-right edge, E = (i+1,j) lower-right, S lower-left, W upper-left' },
    };
  },

  // A tiles-pro transition set (tile_feature 'tileset', corner rule): one
  // tag per tile, "c<mask>". Corner mask = NW<<3 | NE<<2 | SW<<1 | SE, a set
  // bit = the FIRST terrain at that corner. For isometric tiles NW is the
  // diamond's top, NE its right, SE its bottom, SW its left; on an iso map
  // cell (i, j) those are the grid points (i, j), (i+1, j), (i+1, j+1),
  // (i, j+1). get_tiles_pro lists each tile's mask; --masks gives them in
  // tile order when they aren't simply tile N = mask N.
  // --variants: more sets made with the same prompt (other seeds); each tag
  // then holds one frame per set and the game picks one at random.
  // --rule edge: path / road sets (create_path_tiles): mask = edges the path
  // crosses, bit0 N, bit1 E, bit2 S, bit3 W; tags "e<mask>". Tiles with the
  // same mask become variants of one tag; "x" in --masks skips a tile.
  async tileset(tmp, { id, masks, terrains, variants = [], rule = 'corner' }) {
    const prefix = rule === 'edge' ? 'e' : 'c';
    const byMask = new Map();
    for (const [v, setId] of [id, ...variants].entries()) {
      const dir = path.join(tmp, `set${v}`);
      unzip(await fetchBuf(`${API}/tiles-pro/${setId}/download`), dir);
      const tiles = fs.readdirSync(dir, { recursive: true }).filter((f) => /_(\d+)\.png$/.test(f))
        .map((f) => ({ n: +f.match(/_(\d+)\.png$/)[1], file: path.join(dir, f) })).sort((a, b) => a.n - b.n);
      tiles.forEach((t, k) => {
        const m = masks ? masks[k] : t.n;
        if (m === 'x' || Number.isNaN(m)) return;
        if (!byMask.has(m)) byMask.set(m, []);
        byMask.get(m).push(t.file);
      });
    }
    const pl = planner();
    for (const [m, files] of [...byMask].sort((a, b) => a[0] - b[0])) pl.add(`${prefix}${m}`, files, 100);
    const size = pl.layout();
    return {
      ...size, anchor: { x: size.width / 2, y: size.height / 2 }, frames: pl.frames, tags: pl.tags,
      info: {
        rule: rule === 'edge'
          ? 'edge: mask = N | E<<1 | S<<2 | W<<3, set bit = the path crosses that edge'
          : 'corner: mask = NW<<3 | NE<<2 | SW<<1 | SE, set bit = first terrain (isometric tiles: NW = top quadrant, NE right, SE bottom, SW left)',
        terrains: terrains ?? null,
      },
    };
  },

  // Any pictures (portraits, title screens, concept art): one tag each,
  // trimmed, origin in the middle. A source is an https URL (a download link
  // from a get_* tool) or "job:<id>" for an image-tool job.
  async images(tmp, { images }) {
    const pl = planner();
    // "@x,y,w,h" after a source cuts that rectangle out (a grid of cells,
    // e.g. a vocal animation's mouth-shape sheet); a cut piece keeps its
    // size so cells stay aligned.
    const cache = {};
    for (const [name, spec] of Object.entries(images)) {
      // "anim:<job-id>": an animate_image / animate_image_pixminimax job, one
      // looping tag. Its image 0 is the input frame and the last generated
      // frame comes back to it, so frames 1..N loop; frames stay untrimmed
      // (aligned).
      if (spec.startsWith('anim:')) {
        const files = [];
        for (let k = 1; ; k++) {
          const res = await fetch(`${API}/images/${spec.slice(5)}/download?index=${k}`);
          if (res.status === 404) break;
          if (!res.ok) throw new Error(`${res.status} for ${spec} frame ${k}${res.status === 423 ? ' (still generating)' : ''}`);
          const file = path.join(tmp, `${name}_${k}.png`);
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          files.push(file);
        }
        pl.add(name, files, CONFIG.frameMs?.[name] ?? CONFIG.defaultFrameMs ?? 100);
        continue;
      }
      const at = spec.lastIndexOf('@');
      const src = at > 0 && /^\d+,\d+,\d+,\d+$/.test(spec.slice(at + 1)) ? spec.slice(0, at) : spec;
      const rect = src === spec ? null : spec.slice(at + 1).split(',').map(Number);
      const url = src.startsWith('job:') ? `${API}/images/${src.slice(4)}/download` : src;
      cache[url] ??= PNG.sync.read(await fetchBuf(url));
      const img = rect ? crop(cache[url], ...rect) : trim(cache[url]);
      const file = path.join(tmp, `${name}.png`);
      fs.writeFileSync(file, PNG.sync.write(img));
      pl.add(name, [file], 100, 1);
    }
    return { ...pl.layout(), frames: pl.frames, tags: pl.tags, info: {} };
  },

  // A PixelLab font (create_font): the glyph atlas, one frame per glyph,
  // tagged with its character. Glyphs are recoloured to --color (default
  // white, so the game can tint text) with a 1px --outline (default near
  // black; "none" for no outline). Export adds a BMFont XML for the engine.
  async font(tmp, { job, color = '#ffffff', outline = '#140c0a' }) {
    const atlas = PNG.sync.read(await fetchBuf(`${API}/font/${job}/download`));
    const cols = 8, rows = FONT_CHARS.length / cols;
    const cw = atlas.width / cols, ch = atlas.height / rows;
    const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const fill = hex(color), line = outline === 'none' ? null : hex(outline);
    const pad = line ? 1 : 0;
    const pl = planner();
    [...FONT_CHARS].forEach((c, n) => {
      // Cut exactly the cell (a bigger cut catches the neighbouring glyphs'
      // edges), then pad it for the outline.
      const cell = crop(atlas, (n % cols) * cw, Math.floor(n / cols) * ch, cw, ch);
      const g = new PNG({ width: cw + 2 * pad, height: ch + 2 * pad });
      PNG.bitblt(cell, g, 0, 0, cw, ch, pad, pad);
      const on = (x, y) => x >= 0 && y >= 0 && x < g.width && y < g.height && g.data[(y * g.width + x) * 4 + 3] > 0;
      const out = new PNG({ width: g.width, height: g.height });
      for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
        let col = null;
        if (on(x, y)) col = fill;
        else if (line && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => on(x + dx, y + dy))) col = line;
        if (!col) continue;
        const o = (y * g.width + x) * 4;
        out.data[o] = col[0]; out.data[o + 1] = col[1]; out.data[o + 2] = col[2]; out.data[o + 3] = 255;
      }
      const file = path.join(tmp, `g${n}.png`);
      fs.writeFileSync(file, PNG.sync.write(out));
      pl.add(c, [file], 100);
    });
    return { ...pl.layout(), frames: pl.frames, tags: pl.tags, info: { chars: FONT_CHARS, cell: { width: cw + 2 * pad, height: ch + 2 * pad } } };
  },

  // PixelLab 1-direction objects: one tag each, named by the object. An
  // object with an animation contributes its (looping) animation frames.
  async objects(tmp, { objects }) {
    const pl = planner();
    const info = {};
    for (const [name, id] of Object.entries(objects)) {
      const dir = path.join(tmp, name);
      // A still object downloads as its PNG; an animated one as a zip.
      const buf = await fetchBuf(`${API}/objects/${id}/download`);
      if (buf.subarray(1, 4).toString() === 'PNG') {
        fs.mkdirSync(path.join(dir, 'rotations'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'rotations', 'unknown.png'), buf);
      } else unzip(buf, dir);
      // The zip may nest everything under a state folder ("base/").
      const root = fs.existsSync(path.join(dir, 'rotations')) ? dir : path.join(dir, fs.readdirSync(dir).find((f) => fs.existsSync(path.join(dir, f, 'rotations'))) ?? '');
      const rots = fs.readdirSync(path.join(root, 'rotations')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
      const animDir = path.join(root, 'animations');
      const anim = fs.existsSync(animDir) ? fs.readdirSync(animDir).sort()[0] : null;
      if (rots.some((r) => DIRS.includes(r))) {
        // An 8-direction object: "<name>-<dir>" stills, "<name>_<anim>-<dir>" loops.
        for (const d of DIRS) if (rots.includes(d)) pl.add(`${name}-${d}`, [path.join(root, 'rotations', `${d}.png`)], 100, 1);
        for (const a of fs.existsSync(animDir) ? fs.readdirSync(animDir).sort() : []) {
          for (const d of DIRS) {
            const fdir = path.join(animDir, a, d);
            if (fs.existsSync(fdir)) pl.add(`${name}_${a}-${d}`, fs.readdirSync(fdir).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(fdir, f)), 100);
          }
        }
      } else if (anim && fs.readdirSync(animDir).length > 1) {
        // Several animations: "<name>" = the still, "<name>_<anim>" each.
        // PixelLab names animation folders after the description, so start
        // descriptions with a one-word name and a colon ("slam: the hand
        // rises...") - that word becomes the tag.
        pl.add(name, [path.join(root, 'rotations', 'unknown.png')], 100, 1);
        for (const a of fs.readdirSync(animDir).sort()) {
          const fdir = path.join(animDir, a, 'unknown');
          const short = a.split(/[^a-zA-Z0-9]/)[0].toLowerCase();
          const base = short.split('_')[0];
          pl.add(`${name}_${short}`, fs.readdirSync(fdir).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(fdir, f)), FRAME_MS[base] ?? CONFIG.defaultFrameMs, LOOPING.has(base) ? undefined : 1);
        }
      } else if (anim) {
        const fdir = path.join(animDir, anim, 'unknown');
        pl.add(name, fs.readdirSync(fdir).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(fdir, f)), 100);
      } else {
        pl.add(name, [path.join(root, 'rotations', 'unknown.png')], 100, 1);
      }
      info[name] = { id, animation: anim };
    }
    return { ...pl.layout(), frames: pl.frames, tags: pl.tags, info: { objects: info } };
  },

  // One PixelLab UI piece (a panel, a button...) per file, trimmed to its
  // pixels. Its states are tags: `<state>=<ui-id>[@x,y,w,h]` (a bare id is
  // "normal"; `@x,y,w,h` cuts the piece out of a bigger image). --states
  // derives "hover" (lighter) and "pressed" (darker, 1px down) from normal.
  // --nine marks a 9-slice: "auto" finds the frame around the flat middle,
  // or give the border widths l,t,r,b; --tile repeats the edges instead of
  // stretching them.
  async ui(tmp, { states, derive, nine, tile }) {
    const cache = {};
    const imgs = {};
    for (const [state, spec] of Object.entries(states)) {
      const [id, rect] = spec.split('@');
      cache[id] ??= PNG.sync.read(await fetchBuf(`${API}/ui-assets/${id}/download`));
      const [x, y, w, h] = rect ? rect.split(',').map(Number) : [0, 0, cache[id].width, cache[id].height];
      imgs[state] = trim(crop(cache[id], x, y, w, h));
    }
    if (derive) {
      // Every state gets one spare row at the bottom so "pressed" can sink 1px.
      const n = imgs.normal;
      imgs.normal = crop(n, 0, 0, n.width, n.height + 1);
      imgs.hover = shade(imgs.normal, CONFIG.uiStates.hover);
      imgs.pressed = crop(shade(n, CONFIG.uiStates.pressed), 0, -1, n.width, n.height + 1);
    }
    const pl = planner();
    for (const [state, img] of Object.entries(imgs)) {
      const file = path.join(tmp, `${state}.png`);
      fs.writeFileSync(file, PNG.sync.write(img));
      pl.add(state, [file], 100, 1);
    }
    const size = pl.layout();
    const base = pl.frames[0];
    let center = null;
    if (nine === 'auto') center = flatMiddle(imgs.normal ?? Object.values(imgs)[0]);
    else if (nine) { const [l, t, r, b] = nine; center = { x: l, y: t, w: base.w - l - r, h: base.h - t - b }; }
    if (center) center = { ...center, x: center.x + base.x, y: center.y + base.y };
    return {
      ...size, frames: pl.frames, tags: pl.tags,
      ...(center ? { nine: { center, tile: !!tile } } : {}),
      info: center ? { nine: { left: center.x, top: center.y, right: size.width - center.x - center.w, bottom: size.height - center.y - center.h, tile: !!tile } } : {},
    };
  },

  // A PixelLab VFX workbench export (strip PNG + JSON): one tag, "play".
  async fx(tmp, { image, file, once }) {
    const base = `${API}/pixel-tools/${image}/${file}`;
    const strip = PNG.sync.read(await fetchBuf(`${base}.png`));
    const data = JSON.parse((await fetchBuf(`${base}.json`)).toString('utf8'));
    const list = Array.isArray(data.frames) ? data.frames : Object.values(data.frames);
    const files = list.map((f, i) => {
      const out = new PNG({ width: f.frame.w, height: f.frame.h });
      PNG.bitblt(strip, out, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0);
      const name = path.join(tmp, `f${String(i).padStart(3, '0')}.png`);
      fs.writeFileSync(name, PNG.sync.write(out));
      return name;
    });
    const pl = planner();
    pl.add('play', files, list[0].duration ?? 80, once ? 1 : undefined);
    list.forEach((f, i) => { pl.frames[i].ms = f.duration ?? 80; });
    const size = pl.layout();
    const pv = list[0].pivot ?? { x: 0.5, y: 0.5 };
    const anchor = data.meta?.anchor ?? { x: pv.x * size.width, y: pv.y * size.height };
    return { ...size, anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) }, frames: pl.frames, tags: pl.tags, info: {} };
  },
};

async function runImport(kind, key, source, force) {
  if (!importers[kind]) throw new Error(`unknown kind "${kind}" (${Object.keys(importers).join(', ')})`);
  if (fs.existsSync(aseFile(key)) && !force) {
    throw new Error(`art/${key}/${key}.aseprite exists and may have hand edits; pass --force to replace it`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `art-${key}-`));
  try {
    const plan = await importers[kind](tmp, source);
    if (source.despeckle) {
      let n = 0;
      for (const f of plan.frames) n += despeckle(f.file);
      console.log(`despeckle: removed ${n} stray pixels`);
    }
    if (source.palette) {
      plan.palette = readPalette(source.palette);
      // --snap: move every off-palette pixel to its nearest palette colour
      // (PixelLab animations ignore the palette the character was made with).
      if (source.snap) {
        let moved = 0, total = 0;
        for (const f of plan.frames) { const r = snapToPalette(f.file, plan.palette); moved += r.moved; total += r.total; }
        console.log(`snapped ${moved} of ${total} pixels (${(100 * moved / Math.max(1, total)).toFixed(1)}%) to palette ${source.palette}`);
      }
    }
    fs.mkdirSync(path.join(ART, key), { recursive: true });
    const planFile = path.join(tmp, 'plan.json');
    fs.writeFileSync(planFile, JSON.stringify({ ...plan, out: aseFile(key) }));
    execFileSync(ASEPRITE, ['-b', '--script-param', `plan=${planFile}`, '--script', path.join(TOOL, 'build_aseprite.lua')], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.writeFileSync(recordFile(key), JSON.stringify({
      kind, source, fetched_at: new Date().toISOString(),
      canvas: { width: plan.width, height: plan.height }, anchor: plan.anchor ?? null,
      tags: plan.tags.map((t) => t.name), ...plan.info,
    }, null, 2));
    console.log(`imported ${kind} ${key}: ${plan.frames.length} frames, ${plan.tags.length} tags, ${plan.width}x${plan.height} canvas`);
    if (source.normals?.length) await applyNormals(key, source.normals);
    if (source.points) {
      const plan2 = path.join(tmp, 'points.json');
      fs.writeFileSync(plan2, JSON.stringify({ points: source.points }));
      execFileSync(ASEPRITE, ['-b', '--script-param', `file=${aseFile(key)}`, '--script-param', `plan=${plan2}`, '--script', path.join(TOOL, 'points.lua')], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
    if (source.patches) {
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'art-repatch-'));
      const frames = [];
      for (const [f, src] of Object.entries(source.patches)) {
        // Local copies (art/<key>/patches/); older records may hold job ids.
        const local = path.join(ART, key, src);
        let file = local;
        if (!fs.existsSync(local)) {
          const [job, n] = src.split(':');
          file = path.join(tmp2, `p${f}.png`);
          fs.writeFileSync(file, await fetchBuf(`${API}/images/${job}/download${n ? `?index=${n}` : ''}`));
        }
        frames.push({ frame: Number(f), file });
      }
      const plan = path.join(tmp2, 'plan.json');
      fs.writeFileSync(plan, JSON.stringify({ frames }));
      execFileSync(ASEPRITE, ['-b', '--script-param', `file=${aseFile(key)}`, '--script-param', `plan=${plan}`, '--script', path.join(TOOL, 'patch_frames.lua')], { stdio: ['ignore', 'ignore', 'pipe'] });
      fs.rmSync(tmp2, { recursive: true, force: true });
      console.log(`re-applied ${frames.length} patched frames`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- normal maps -------------------------------------------------------------
// PixelLab's create_normal_map takes up to 32 frames per call as a strip of
// frames side by side. The tool cuts the chosen frames (padded to squares so
// the strip splits unambiguously), uploads them, and later puts the returned
// maps into a hidden "normal" layer; export builds <key>_n.png on the colour
// sheet's layout. The jobs are kept in the record's source.normals, so
// reimport re-applies them.

// Every frame of one layer at full canvas size: { w, h, frame(i) -> PNG }.
function layerFrames(key, layer) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-layer-'));
  const png = path.join(tmp, 's.png'), json = path.join(tmp, 's.json');
  execFileSync(ASEPRITE, ['-b', '--layer', layer, aseFile(key), '--sheet', png, '--data', json, '--format', 'json-array',
    '--sheet-type', 'rows', '--sheet-columns', '32', '--filename-format', '{frame}'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const data = JSON.parse(fs.readFileSync(json, 'utf8')), sheet = readPng(png);
  fs.rmSync(tmp, { recursive: true, force: true });
  const { w, h } = data.frames[0].sourceSize;
  return { w, h, count: data.frames.length, frame: (i) => { const r = data.frames[i].frame; return crop(sheet, r.x, r.y, r.w, r.h); } };
}

// Fetch normal-map strips (image jobs) and write them into the normal layer.
async function applyNormals(key, strips) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-normals-'));
  try {
    const { w, h } = layerFrames(key, 'art');
    const S = Math.max(w, h), frames = [];
    for (const strip of strips) {
      const img = PNG.sync.read(await fetchBuf(`${API}/images/${strip.job}/download`));
      const cell = img.height; // square cells side by side
      if (img.width !== cell * strip.frames.length) console.warn(`  normal strip ${strip.job}: ${img.width}x${img.height} for ${strip.frames.length} frames`);
      strip.frames.forEach((f, n) => {
        let m = crop(img, n * cell, 0, cell, cell);
        if (cell !== S) { // scale back to the padded size if PixelLab resized
          const r = new PNG({ width: S, height: S });
          for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) m.data.copy(r.data, (y * S + x) * 4, (Math.floor(y * cell / S) * cell + Math.floor(x * cell / S)) * 4, (Math.floor(y * cell / S) * cell + Math.floor(x * cell / S)) * 4 + 4);
          m = r;
        }
        const file = path.join(tmp, `n${f}.png`);
        fs.writeFileSync(file, PNG.sync.write(crop(m, (S - w) >> 1, (S - h) >> 1, w, h)));
        frames.push({ frame: f, file });
      });
    }
    const plan = path.join(tmp, 'plan.json');
    fs.writeFileSync(plan, JSON.stringify({ frames }));
    execFileSync(ASEPRITE, ['-b', '--script-param', `file=${aseFile(key)}`, '--script-param', `plan=${plan}`, '--script', path.join(TOOL, 'normal_layer.lua')], { stdio: ['ignore', 'ignore', 'pipe'] });
    console.log(`normals: ${frames.length} frames in the "normal" layer of ${key}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// <key>_n.png: the normal layer cut and placed exactly like the colour sheet
// (same trimmed rects); pixels without a normal face the viewer.
function writeNormalSheet(key, data) {
  const n = layerFrames(key, 'normal');
  const out = new PNG({ width: data.meta.size.w, height: data.meta.size.h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 128; out.data[i + 1] = 128; out.data[i + 2] = 255; out.data[i + 3] = 255; }
  Object.values(data.frames).forEach((f, i) => {
    const src = n.frame(i), s = f.spriteSourceSize, r = f.frame;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const si = ((s.y + y) * src.width + s.x + x) * 4;
      if (src.data[si + 3] === 0) continue;
      src.data.copy(out.data, ((r.y + y) * out.width + r.x + x) * 4, si, si + 4);
    }
  });
  fs.writeFileSync(path.join(BUILD, `${key}_n.png`), PNG.sync.write(out));
}

const hasNormals = (key) => fs.existsSync(recordFile(key)) && !!JSON.parse(fs.readFileSync(recordFile(key), 'utf8')).source.normals?.length;

// ---- export ----------------------------------------------------------------

const allKeys = () => {
  if (!fs.existsSync(ART)) throw new Error(`no art folder at ${ART}: run from the project root, or set "art" in art.config.json`);
  return listKeys();
};
const listKeys = () => fs.readdirSync(ART).filter((k) => fs.existsSync(aseFile(k))).sort();
const kindOf = (key) => (fs.existsSync(recordFile(key)) ? JSON.parse(fs.readFileSync(recordFile(key), 'utf8')).kind : 'objects');

// The built sheet of one asset (see the header): <art>/.build/<key>.png|.json
// (+ <key>_n.png with normals).
function buildSheet(key) {
  fs.mkdirSync(BUILD, { recursive: true });
  const ignore = path.join(BUILD, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  const png = path.join(BUILD, `${key}.png`), jsonFile = path.join(BUILD, `${key}.json`);
  // Trimmed frames in rows of a fixed width. Aseprite's "packed" layout is
  // tighter but slows down badly with frame count (minutes at ~500 frames);
  // rows take a second. Widen the sheet while it comes out taller than wide,
  // keeping it within GPU texture limits.
  let data;
  for (let width = CONFIG.sheetWidth; ; width *= 2) {
    execFileSync(ASEPRITE, [
      '-b', aseFile(key),
      '--sheet', png, '--data', jsonFile,
      '--format', 'json-hash', '--sheet-type', 'rows', '--sheet-width', String(width),
      '--trim', '--merge-duplicates',
      '--border-padding', '1', '--shape-padding', '1',
      '--filename-format', '{frame}', '--tagname-format', `${key}-{tag}`,
      '--list-tags', '--list-slices',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    if (data.meta.size.h <= width || width >= 8192) break;
  }
  if (data.meta.size.w > 4096 || data.meta.size.h > 4096) console.warn(`  ${key}: ${data.meta.size.w}x${data.meta.size.h} sheet is over 4096, too big for some GPUs`);
  const kind = kindOf(key);
  const frames = Object.values(data.frames);
  const anchor = data.meta.slices.find((s) => s.name === 'anchor')?.keys[0];
  if (anchor) {
    // One ground point for the whole file.
    const pivot = { x: anchor.pivot.x / anchor.bounds.w, y: anchor.pivot.y / anchor.bounds.h };
    for (const f of frames) f.pivot = pivot;
  } else if (kind === 'images') {
    // Pictures: the middle of the canvas (single pictures are trimmed at
    // import; cells cut from a grid keep their place, so faces don't jitter).
    for (const f of frames) f.pivot = { x: 0.5, y: 0.5 };
  } else if (kind === 'ui') {
    // UI pieces: the origin is the middle of their pixels.
    for (const tag of data.meta.frameTags) {
      for (let i = tag.from; i <= tag.to; i++) {
        const f = frames[i], s = f.spriteSourceSize;
        f.pivot = { x: (s.x + s.w / 2) / f.sourceSize.w, y: (s.y + s.h / 2) / f.sourceSize.h };
      }
    }
  } else {
    // No anchor: each tag stands on the lowest pixel of its frames.
    for (const tag of data.meta.frameTags) {
      let bottom = 0;
      for (let i = tag.from; i <= tag.to; i++) { const s = frames[i].spriteSourceSize; bottom = Math.max(bottom, s.y + s.h); }
      for (let i = tag.from; i <= tag.to; i++) frames[i].pivot = { x: 0.5, y: bottom / frames[i].sourceSize.h };
    }
  }
  // 9-slice (ui): the slice's centre, relative to each trimmed frame
  // ("scale9Borders", the name Phaser's NineSlice reads).
  const nine = data.meta.slices.find((sl) => sl.name === 'nine' && sl.keys[0].center);
  if (nine) {
    const { bounds: b, center: c } = nine.keys[0];
    for (const f of frames) {
      const s = f.spriteSourceSize;
      f.scale9Borders = { x: b.x + c.x - s.x, y: b.y + c.y - s.y, w: c.w, h: c.h };
    }
    data.meta.nineTile = nine.data === 'tile';
  }
  if (kind === 'character' && anchor) {
    // Jump tags get an "air" window (see airborne.mjs) from the trimmed bounds.
    const foot = anchor.pivot.y + CONFIG.footOffset;
    for (const tag of data.meta.frameTags) {
      if (!tag.name.startsWith(`${key}-jump-`)) continue;
      const bottoms = [];
      for (let i = tag.from; i <= tag.to; i++) { const s = frames[i].spriteSourceSize; bottoms.push(s.y + s.h - 1); }
      tag.air = airborne(bottoms, foot);
    }
  }
  if (hasNormals(key)) writeNormalSheet(key, data);
  else fs.rmSync(path.join(BUILD, `${key}_n.png`), { force: true });
  data.meta.kind = kind;
  fs.writeFileSync(jsonFile, JSON.stringify(data));
  return data;
}

// The built sheet, rebuilt first if the .aseprite file (or its record) is newer.
function sheet(key) {
  const jsonFile = path.join(BUILD, `${key}.json`), png = path.join(BUILD, `${key}.png`);
  if (!fs.existsSync(aseFile(key))) throw new Error(`no art "${key}" (${path.relative(ROOT, aseFile(key))})`);
  const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  const fresh = fs.existsSync(jsonFile) && mtime(jsonFile) >= Math.max(mtime(aseFile(key)), mtime(recordFile(key)));
  const data = fresh ? JSON.parse(fs.readFileSync(jsonFile, 'utf8')) : buildSheet(key);
  const normal = path.join(BUILD, `${key}_n.png`);
  return { key, kind: data.meta.kind, data, png, normal: fs.existsSync(normal) ? normal : null };
}

// The engine's exporter: engines/<engine>/export.mjs, with
//   exportAsset(asset, ctx)   asset = sheet(key); write what the engine loads
//   exportIndex(assets, ctx)  after a run, with every exported asset
// ctx = { out, config, root }. Asset keys and kinds: assets = [{ key, kind }].
let engine;
async function loadEngine() {
  if (engine) return engine;
  const file = path.join(TOOL, 'engines', CONFIG.engine, 'export.mjs');
  if (!fs.existsSync(file)) throw new Error(`unknown engine "${CONFIG.engine}" in art.config.json (engines/: ${fs.readdirSync(path.join(TOOL, 'engines')).join(', ')})`);
  engine = await import(pathToFileURL(file));
  return engine;
}

async function runExport(keys) {
  const eng = await loadEngine();
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = { out: OUT, config: CONFIG, root: ROOT };
  for (const key of keys) {
    buildSheet(key);
    const asset = sheet(key);
    eng.exportAsset(asset, ctx);
    const { w, h } = asset.data.meta.size;
    console.log(`exported ${asset.kind} ${key}: ${Object.keys(asset.data.frames).length} frames, ${asset.data.meta.frameTags.length} tags, ${w}x${h} sheet (${CONFIG.engine})`);
  }
  eng.exportIndex(allKeys().map((key) => ({ key, kind: kindOf(key) })), ctx);
}

// ---- command line ------------------------------------------------------------

function parseImport(kind, args) {
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args.splice(i, 2)[1]; };
  const flag = (name) => { const i = args.indexOf(`--${name}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const force = flag('force');
  const palette = opt('palette'); // any kind: the .aseprite file gets this palette
  const snap = flag('snap'); // ... and off-palette pixels are moved onto it
  const despeck = flag('despeckle'); // remove isolated stray pixels
  // How the asset was generated (PixelLab tool + parameters: mode, palette,
  // style references, prompt...), kept in the record so it can be redone.
  const recipe = opt('recipe');
  let source;
  if (kind === 'character') {
    const skip = {};
    for (const part of (opt('skip') ?? '').split(';').filter(Boolean)) { const [tag, idx] = part.split(':'); skip[tag] = list(idx); }
    // --chain idle_afk=afk_1+afk_2+afk_3 (repeatable): clips played as one
    const chains = {};
    for (let c; (c = opt('chain'));) { const [name, parts] = c.split('='); chains[name] = parts.split('+'); }
    // --frames walk_tr-south=<image-job-id>@3,4,88,88 (repeatable)
    const frames = {};
    for (let f; (f = opt('frames'));) { const i = f.indexOf('='); frames[f.slice(0, i)] = f.slice(i + 1); }
    source = { id: args[1], skip, chains, ...(Object.keys(frames).length ? { frames } : {}) };
  } else if (kind === 'tiles') {
    source = { id: args[1], plain: list(opt('plain')), pick: list(opt('pick')), anchor: list(opt('anchor')) };
  } else if (kind === 'kit') {
    const r = opt('roles');
    source = { id: args[1], ...(r ? { roles: Object.fromEntries(r.split(',').map((p) => { const [k, v] = p.split('='); return [k, +v]; })) } : {}) };
  } else if (kind === 'objects') {
    source = { objects: Object.fromEntries(args.slice(1).map((a) => a.split('='))) };
  } else if (kind === 'images') {
    source = { images: Object.fromEntries(args.slice(1).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; })) };
  } else if (kind === 'font') {
    source = { job: args[1], ...(opt('color') ? { color: opt('color') } : {}), ...(opt('outline') ? { outline: opt('outline') } : {}) };
  } else if (kind === 'tileset') {
    const m = opt('masks');
    source = { id: args[1], rule: opt('rule') ?? 'corner', masks: m ? m.split(',').map((v) => (v === 'x' ? 'x' : Number(v))) : null, terrains: opt('terrains')?.split('|'), variants: opt('variants')?.split(',') ?? [] };
  } else if (kind === 'ui') {
    const derive = flag('states'), tile = flag('tile');
    const nineArg = opt('nine');
    const nine = nineArg === 'auto' ? 'auto' : list(nineArg);
    const states = Object.fromEntries(args.slice(1).map((a) => (a.includes('=') ? a.split('=') : ['normal', a])));
    source = { states, derive, nine, tile };
  } else if (kind === 'fx') {
    const once = flag('once');
    const [image, file] = args[1].split('/');
    source = { image, file, once };
  }
  if (palette) source.palette = palette;
  if (palette && snap) source.snap = true;
  if (despeck) source.despeckle = true;
  if (recipe) source.recipe = JSON.parse(recipe);
  return { key: args[0], source, force };
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'import') {
    const [kind, ...args] = rest;
    const { key, source, force } = parseImport(kind, args);
    if (!key) throw new Error('usage: node tools/art/art.mjs import <kind> <key> ... (see the top of tools/art/art.mjs)');
    await runImport(kind, key, source, force);
    await runExport([key]);
  } else if (cmd === 'reimport') {
    const force = rest.includes('--force');
    const keys = rest.includes('--all') ? allKeys() : rest.filter((a) => !a.startsWith('--'));
    for (const key of keys) {
      const rec = JSON.parse(fs.readFileSync(recordFile(key), 'utf8'));
      await runImport(rec.kind, key, rec.source, force);
    }
    await runExport(keys);
  } else if (cmd === 'export') {
    await runExport(rest.length ? rest : allKeys());
  } else if (cmd === 'palette') {
    // art palette <name> --from <key,key,...> [--colors 32]   extract from existing art
    // art palette <name> --hex '#000000,#ffffff,...'          from a list (e.g. Lospec)
    // art palette <name>                                       print its colours
    const opt = (n) => { const i = rest.indexOf(`--${n}`); return i < 0 ? undefined : rest[i + 1]; };
    const name = rest[0];
    if (opt('from')) extractPalette(name, opt('from').split(','), Number(opt('colors') ?? 32));
    else if (opt('hex')) writePalette(name, opt('hex').split(','), ['hex']);
    else console.log(JSON.stringify(readPalette(name)));
  } else if (cmd === 'frame') {
    // art frame <character-id|key> <still|anim:first|anim:last|anim:N> [--dir south]
    //   [--size WxH | --size-of <spec>] [--out file.png] [--upload <upload-url>]
    // One frame of a PixelLab character, straight from PixelLab, for chaining
    // clips: the last frame of one clip is the next clip's start
    // (custom_start_frame_url), a pose padded to the same size its end
    // (end_frame_url). --upload sends it to a get_upload_url URL and prints
    // the upload:<id> to pass on.
    const opt = (n) => { const i = rest.indexOf(`--${n}`); return i < 0 ? undefined : rest.splice(i, 2)[1]; };
    const dir = opt('dir') ?? 'south', out = opt('out'), upload = opt('upload'), size = opt('size'), sizeOf = opt('size-of');
    const [who, spec] = rest;
    if (!who || !spec) throw new Error('usage: art frame <character-id|key> <still|anim:last|anim:first|anim:N> [--dir south] [--size WxH | --size-of <spec>] [--out f.png] [--upload <url>]');
    const id = fs.existsSync(recordFile(who)) ? JSON.parse(fs.readFileSync(recordFile(who), 'utf8')).source.id : who;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-frame-'));
    try {
      unzip(await fetchBuf(`${API}/characters/${id}/download`), tmp);
      const frames = pickState(JSON.parse(fs.readFileSync(path.join(tmp, 'metadata.json'), 'utf8')), id).frames;
      const pick = (sp) => {
        if (sp === 'still') return readPng(path.join(tmp, frames.rotations[dir]));
        const [anim, which = 'last'] = sp.split(':');
        const list = frames.animations[anim]?.[dir];
        if (!list) throw new Error(`no animation "${anim}" facing ${dir} (have: ${Object.keys(frames.animations).join(', ')})`);
        const n = which === 'last' ? list.length - 1 : which === 'first' ? 0 : Number(which);
        return readPng(path.join(tmp, list[n]));
      };
      let img = pick(spec);
      const target = size ? size.split('x').map(Number) : sizeOf ? (({ width, height }) => [width, height])(pick(sizeOf)) : null;
      if (target) {
        // Pad (or crop) around the centre: PixelLab centres poses in clip frames.
        const [w, h] = target;
        img = crop(img, (img.width - w) >> 1, (img.height - h) >> 1, w, h);
      }
      const file = out ?? path.join(os.tmpdir(), `${who}-${spec.replace(/[:]/g, '-')}-${dir}.png`);
      fs.writeFileSync(file, PNG.sync.write(img));
      console.log(`${file} (${img.width}x${img.height})`);
      if (upload) {
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
        const res = await fetch(upload, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()} (upload URLs from get_upload_url last 15 min)`);
        console.log((await res.json()).ref);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else if (cmd === 'clip') {
    // art clip <character-id|key> <anim> [--dir south] [--fit 80] [--upload <url>]
    // Every frame of a clip, cut to one shared window around the motion (at
    // most --fit px a side: transfer_outfit takes 8 frames up to 80px, 15 up
    // to 64px, only 3 above 80px), uploaded; prints the refs and the
    // "@x,y,w,h" to give `import --frames` to put the results back in place.
    const opt = (n) => { const i = rest.indexOf(`--${n}`); return i < 0 ? undefined : rest.splice(i, 2)[1]; };
    const dir = opt('dir') ?? 'south', fit = Number(opt('fit') ?? 80), upload = opt('upload');
    const [who, anim] = rest;
    if (!who || !anim) throw new Error('usage: art clip <character-id|key> <anim> [--dir south] [--fit 80] [--upload <url>]');
    const id = fs.existsSync(recordFile(who)) ? JSON.parse(fs.readFileSync(recordFile(who), 'utf8')).source.id : who;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-clip-'));
    try {
      unzip(await fetchBuf(`${API}/characters/${id}/download`), tmp);
      const list = pickState(JSON.parse(fs.readFileSync(path.join(tmp, 'metadata.json'), 'utf8')), id).frames.animations[anim]?.[dir];
      if (!list) throw new Error(`no animation "${anim}" facing ${dir}`);
      const imgs = list.map((f) => readPng(path.join(tmp, f)));
      const { width: W, height: H } = imgs[0];
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (const p of imgs) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p.data[(y * W + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 - x0 + 1 > fit || y1 - y0 + 1 > fit) console.warn(`  the motion spans ${x1 - x0 + 1}x${y1 - y0 + 1}, more than ${fit}: parts will be cut off`);
      const s = Math.min(fit, W, H), ox = Math.max(0, Math.min(W - s, Math.round((x0 + x1 + 1 - s) / 2))), oy = Math.max(0, Math.min(H - s, Math.round((y0 + y1 + 1 - s) / 2)));
      const refs = [];
      for (const [i, p] of imgs.entries()) {
        const file = path.join(tmp, `clip-${i}.png`);
        fs.writeFileSync(file, PNG.sync.write(crop(p, ox, oy, s, s)));
        if (upload) {
          const form = new FormData();
          form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
          const res = await fetch(upload, { method: 'POST', body: form });
          if (!res.ok) throw new Error(`upload failed: ${res.status}`);
          refs.push((await res.json()).ref);
        }
      }
      console.log(`${imgs.length} frames ${W}x${H}, window ${s}x${s} at ${ox},${oy}`);
      console.log(`import with: --frames <tag>=<job-id>@${ox},${oy},${W},${H}`);
      if (refs.length) console.log(JSON.stringify(refs));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else if (cmd === 'normals-prep') {
    // art normals-prep <key> [--tags a,b] --upload <url>: strips of <= 32
    // frames for create_normal_map; prints one upload ref per strip.
    const opt = (n) => { const i = rest.indexOf(`--${n}`); return i < 0 ? undefined : rest.splice(i, 2)[1]; };
    const tags = opt('tags')?.split(','), upload = opt('upload'), key = rest[0];
    if (!key || !upload) throw new Error('usage: art normals-prep <key> [--tags a,b] --upload <get_upload_url URL>');
    const { data } = sheet(key);
    const want = new Set();
    for (const t of data.meta.frameTags) {
      const name = t.name.slice(key.length + 1);
      if (tags && !tags.some((x) => name === x || name.startsWith(`${x}-`))) continue;
      for (let i = t.from; i <= t.to; i++) want.add(i);
    }
    const list = [...want].sort((a, b) => a - b);
    const lf = layerFrames(key, 'art'), S = Math.max(lf.w, lf.h);
    const strips = [];
    for (let k = 0; k < list.length; k += 32) {
      // An animated GIF (the MCP tool takes animations as GIFs; a PNG strip
      // over 512px is refused), frames padded to S x S squares.
      const frames = list.slice(k, k + 32), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-strip-'));
      const files = frames.map((f, n) => {
        const img = new PNG({ width: S, height: S });
        PNG.bitblt(lf.frame(f), img, 0, 0, lf.w, lf.h, (S - lf.w) >> 1, (S - lf.h) >> 1);
        const file = path.join(tmp, `f${n}.png`);
        fs.writeFileSync(file, PNG.sync.write(img));
        return file;
      });
      const gif = path.join(tmp, `${key}-${k}.gif`), planFile = path.join(tmp, 'plan.json');
      fs.writeFileSync(planFile, JSON.stringify({ out: gif, size: S, files }));
      execFileSync(ASEPRITE, ['-b', '--script-param', `plan=${planFile}`, '--script', path.join(TOOL, 'frames_to_gif.lua')], { stdio: ['ignore', 'ignore', 'pipe'] });
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(gif)], { type: 'image/gif' }), path.basename(gif));
      fs.rmSync(tmp, { recursive: true, force: true });
      const res = await fetch(upload, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      strips.push({ frames, ref: (await res.json()).ref });
    }
    fs.writeFileSync(path.join(ART, key, `${key}.normals-pending.json`), JSON.stringify(strips));
    for (const st of strips) console.log(`${st.ref}  frames ${st.frames[0]}..${st.frames.at(-1)} (${st.frames.length}, ${S}px squares)`);
    console.log(`next: create_normal_map(image=<ref>) for each, then art normals-apply ${key} <job-id> ...`);
  } else if (cmd === 'normals-apply') {
    // art normals-apply <key> <job-id> [<job-id> ...] (in normals-prep order)
    const [key, ...jobs] = rest;
    const pending = path.join(ART, key, `${key}.normals-pending.json`);
    const strips = JSON.parse(fs.readFileSync(pending, 'utf8'));
    if (jobs.length !== strips.length) throw new Error(`${strips.length} strips need ${strips.length} job ids`);
    strips.forEach((st, i) => { st.job = jobs[i]; delete st.ref; });
    const rec = JSON.parse(fs.readFileSync(recordFile(key), 'utf8'));
    const done = new Set(strips.flatMap((st) => st.frames));
    rec.source.normals = [...(rec.source.normals ?? []).filter((st) => !st.frames.some((f) => done.has(f))), ...strips];
    fs.writeFileSync(recordFile(key), JSON.stringify(rec, null, 2));
    await applyNormals(key, strips);
    fs.rmSync(pending);
    await runExport([key]);
  } else if (cmd === 'frames') {
    // art frames <key> <tag> [--only 4,5] [--mask] --upload <url>
    // Full-canvas frames of a tag from the .aseprite (hand edits included),
    // uploaded for PixelLab's repair tools (inpaint_image, edit_image,
    // correct_pixelart...). --mask also uploads an inpaint mask per frame:
    // white where a pixel's colour appears in none of the tag's other
    // (non --only) frames - stray effects, flashes, specks - grown by 1px.
    const opt = (n) => { const i = rest.indexOf(`--${n}`); return i < 0 ? undefined : rest.splice(i, 2)[1]; };
    const flag = (n) => { const i = rest.indexOf(`--${n}`); if (i >= 0) rest.splice(i, 1); return i >= 0; };
    const only = list(opt('only')), upload = opt('upload'), wantMask = flag('mask');
    const [key, tag] = rest;
    const { data } = sheet(key);
    const t = data.meta.frameTags.find((x) => x.name === `${key}-${tag}`);
    if (!t) throw new Error(`no tag "${tag}" in ${key}`);
    const lf = layerFrames(key, 'art'), idx = [];
    for (let i = t.from; i <= t.to; i++) idx.push(i);
    const pick = only ? only.map((n) => t.from + n) : idx;
    const known = new Set();
    for (const i of idx.filter((i) => !pick.includes(i))) { const p = lf.frame(i); for (let j = 0; j < p.data.length; j += 4) if (p.data[j + 3]) known.add((p.data[j] << 16) | (p.data[j + 1] << 8) | p.data[j + 2]); }
    const send = async (png, name) => {
      if (!upload) { const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, PNG.sync.write(png)); return f; }
      const form = new FormData();
      form.append('file', new Blob([PNG.sync.write(png)], { type: 'image/png' }), name);
      const res = await fetch(upload, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      return (await res.json()).ref;
    };
    for (const i of pick) {
      const p = lf.frame(i);
      let line = `frame ${i} (${tag} #${i - t.from}): ${await send(p, `${key}-${i}.png`)}`;
      if (wantMask) {
        const { width: W, height: H } = p, odd = (x, y) => { const o = (y * W + x) * 4; return p.data[o + 3] > 0 && !known.has((p.data[o] << 16) | (p.data[o + 1] << 8) | p.data[o + 2]); };
        const m = new PNG({ width: W, height: H });
        let n = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let hit = false;
          for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && odd(X, Y)) { hit = true; break; } }
          const o = (y * W + x) * 4; m.data[o] = m.data[o + 1] = m.data[o + 2] = hit ? 255 : 0; m.data[o + 3] = 255; if (hit) n++;
        }
        line += `  mask (${n} px): ${await send(m, `${key}-${i}-mask.png`)}`;
      }
      console.log(line);
    }
  } else if (cmd === 'patch') {
    // art patch <key> <frame>=<image-job-id>[:index] ...
    // Fixed frames (full canvas, e.g. from inpaint_image) back into the art
    // layer; the old pixels go to a hidden "before" layer. Recorded in
    // source.patches so reimport re-applies them, then exported.
    const [key, ...specs] = rest;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-patch-'));
    try {
      const frames = [];
      // Sources: an image job (`<job>[:n]`), an https URL (e.g. a gallery
      // download link, which expires) or a local PNG. Every patch is copied
      // to art/<key>/patches/<frame>.png, which is what the record (and so
      // reimport) uses - nothing depends on links staying alive.
      const dir = path.join(ART, key, 'patches');
      fs.mkdirSync(dir, { recursive: true });
      for (const spec of specs) {
        const i = spec.indexOf('='), f = spec.slice(0, i), src = spec.slice(i + 1);
        let buf;
        if (/^https?:/.test(src)) buf = await fetchBuf(src);
        else if (fs.existsSync(src)) buf = fs.readFileSync(src);
        else { const [job, n] = src.split(':'); buf = await fetchBuf(`${API}/images/${job}/download${n ? `?index=${n}` : ''}`); }
        const file = path.join(dir, `${f}.png`);
        fs.writeFileSync(file, PNG.sync.write(PNG.sync.read(buf)));
        frames.push({ frame: Number(f), file, job: path.relative(path.join(ART, key), file) });
      }
      const plan = path.join(tmp, 'plan.json');
      fs.writeFileSync(plan, JSON.stringify({ frames }));
      execFileSync(ASEPRITE, ['-b', '--script-param', `file=${aseFile(key)}`, '--script-param', `plan=${plan}`, '--script', path.join(TOOL, 'patch_frames.lua')], { stdio: ['ignore', 'ignore', 'pipe'] });
      const rec = JSON.parse(fs.readFileSync(recordFile(key), 'utf8'));
      rec.source.patches = { ...(rec.source.patches ?? {}), ...Object.fromEntries(frames.map((f) => [f.frame, f.job])) };
      fs.writeFileSync(recordFile(key), JSON.stringify(rec, null, 2));
      console.log(`patched ${frames.length} frames of ${key} (old pixels in the hidden "before" layer)`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    await runExport([key]);
  } else if (cmd === 'points') {
    // art points <key> <name>=<x>,<y> ... : named points in the art file, as
    // slices "point:<name>" (1x1, pivot at the point) - where other parts of a
    // multi-part thing attach (a boss's hands relative to its head). Drag
    // them in Aseprite; the export lists them in meta.slices, the game reads
    // them as pixel offsets from the asset's origin. Recorded in
    // source.points so reimport keeps them.
    const [key, ...specs] = rest;
    const points = Object.fromEntries(specs.map((sp) => { const [n, xy] = sp.split('='); return [n, xy.split(',').map(Number)]; }));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-points-'));
    const plan = path.join(tmp, 'plan.json');
    fs.writeFileSync(plan, JSON.stringify({ points }));
    execFileSync(ASEPRITE, ['-b', '--script-param', `file=${aseFile(key)}`, '--script-param', `plan=${plan}`, '--script', path.join(TOOL, 'points.lua')], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.rmSync(tmp, { recursive: true, force: true });
    const rec = JSON.parse(fs.readFileSync(recordFile(key), 'utf8'));
    rec.source.points = { ...(rec.source.points ?? {}), ...points };
    fs.writeFileSync(recordFile(key), JSON.stringify(rec, null, 2));
    console.log(`points in ${key}: ${Object.keys(points).join(', ')}`);
    await runExport([key]);
  } else if (cmd === 'loops') {
    // art loops <key> [--max 300]: looping tags whose last frame doesn't lead
    // back into the first (a visible hitch every cycle)
    const key = rest[0];
    const i = rest.indexOf('--max'), max = i >= 0 ? Number(rest[i + 1]) : 300;
    const { data, png } = sheet(key);
    const img = readPng(png);
    const frames = Object.values(data.frames);
    const full = (f) => {
      const { w, h } = f.sourceSize, o = new Uint8Array(w * h * 4), s = f.spriteSourceSize, r = f.frame;
      for (let y = 0; y < r.h; y++) img.data.copy(o, ((s.y + y) * w + s.x) * 4, ((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4);
      return o;
    };
    const diff = (a, b) => { let n = 0; for (let j = 0; j < a.length; j += 4) if (Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]) + Math.abs(a[j + 3] - b[j + 3]) > 40) n++; return n; };
    for (const t of data.meta.frameTags) {
      if (t.repeat || t.to === t.from) continue; // plays once, or a still
      if (t.direction?.startsWith('pingpong')) { console.log(`ok    ${t.name.slice(key.length + 1).padEnd(24)} pingpong (seamless by construction)`); continue; }
      const seam = diff(full(frames[t.to]), full(frames[t.from]));
      let step = 0;
      for (let j = t.from + 1; j <= t.to; j++) step += diff(full(frames[j - 1]), full(frames[j]));
      step /= t.to - t.from;
      const bad = seam > Math.max(max, step * 1.5);
      console.log(`${bad ? 'HITCH' : 'ok   '} ${t.name.slice(key.length + 1).padEnd(24)} last->first ${String(seam).padStart(5)} px, average step ${step.toFixed(0)} px`);
    }
  } else if (cmd === 'preview') {
    // art preview <key> [--out file.png] [--seed N]: lay a small iso map out
    // of an exported kit or tileset, the way a game would (pivots, masks,
    // draw order), to check how pieces join without running the game.
    const key = rest[0];
    const oi = rest.indexOf('--out'), out = oi >= 0 ? rest[oi + 1] : path.join(ART, key, `preview_${key}.png`);
    const si = rest.indexOf('--seed'); let seed = si >= 0 ? Number(rest[si + 1]) : 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rec = JSON.parse(fs.readFileSync(recordFile(key), 'utf8'));
    const built = sheet(key), data = built.data;
    const sheetImg = readPng(built.png);
    const frames = Object.values(data.frames);
    const tags = Object.fromEntries(data.meta.frameTags.map((t) => [t.name.slice(key.length + 1), t]));
    const pick = (tag) => { const t = tags[tag]; return t && frames[t.from + Math.floor(rnd() * (t.to - t.from + 1))]; };
    const N = 10;
    const ref = pick(rec.kind === 'kit' ? 'floor' : rec.source.rule === 'edge' ? 'e0' : 'c15') ?? frames[0];
    const hw = ref.frame.w / 2, hh = hw / 2; // 2:1 iso cell
    const tall = Math.max(...frames.map((f) => f.pivot.y * f.sourceSize.h));
    const W = Math.ceil(2 * N * hw + 2 * hw), H = Math.ceil(2 * N * hh + tall + 2 * hh);
    const can = new PNG({ width: W, height: H });
    for (let j = 0; j < can.data.length; j += 4) can.data.set([40, 38, 48, 255], j);
    const ox = N * hw + hw, oy = tall + hh;
    const put = (i, j, f) => {
      if (!f) return;
      const x0 = Math.round(ox + (i - j) * hw - f.pivot.x * f.sourceSize.w) + f.spriteSourceSize.x;
      const y0 = Math.round(oy + (i + j) * hh - f.pivot.y * f.sourceSize.h) + f.spriteSourceSize.y;
      for (let y = 0; y < f.frame.h; y++) for (let x = 0; x < f.frame.w; x++) {
        const s = ((f.frame.y + y) * sheetImg.width + f.frame.x + x) * 4, a = sheetImg.data[s + 3];
        const X = x0 + x, Y = y0 + y;
        if (!a || X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const d = (Y * W + X) * 4;
        for (let c = 0; c < 3; c++) can.data[d + c] = (sheetImg.data[s + c] * a + can.data[d + c] * (255 - a)) / 255;
      }
    };
    const cells = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cells.push([i, j]);
    cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    let missing = new Set();
    const get = (tag) => { const f = pick(tag); if (!f) missing.add(tag); return f; };
    if (rec.kind === 'kit') {
      // An L-shaped room with a pillar and a door; back walls only (N / W),
      // as an iso game shows a room.
      const floor = (i, j) => i >= 1 && i <= 8 && j >= 1 && j <= 8 && !(i >= 6 && j <= 3);
      for (const [i, j] of cells) if (floor(i, j)) put(i, j, get('floor'));
      for (const [i, j] of cells) {
        if (!floor(i, j)) continue;
        const n = !floor(i, j - 1), w = !floor(i - 1, j);
        if (n) put(i, j, get(i === 3 && j === 1 ? 'door_Na' : 'side_N'));
        if (w) put(i, j, get('side_W'));
        if (n && w) put(i, j, get('corner_NW'));
        if (!n && !w && !floor(i - 1, j - 1)) put(i, j, get('outer_NW'));
        if (!floor(i + 1, j - 1) && !n && floor(i + 1, j)) put(i, j, get('outer_NE'));
        if (!floor(i - 1, j + 1) && !w && floor(i, j + 1)) put(i, j, get('outer_SW'));
        if (i === 3 && j === 5) put(i, j, get('pillar'));
      }
    } else if (rec.source.rule === 'edge') {
      // A path loop with a spur: mask = N | E<<1 | S<<2 | W<<3 (path neighbours).
      const path_ = (i, j) => ((i === 2 || i === 7) && j >= 2 && j <= 7) || ((j === 2 || j === 7) && i >= 2 && i <= 7) || (j === 5 && i >= 7);
      for (const [i, j] of cells) {
        if (!path_(i, j)) { put(i, j, get('e0')); continue; }
        const m = (path_(i, j - 1) || j === 0 ? 1 : 0) | (path_(i + 1, j) || i === N - 1 && j === 5 ? 2 : 0) | (path_(i, j + 1) ? 4 : 0) | (path_(i - 1, j) ? 8 : 0);
        put(i, j, get(`e${m}`));
      }
    } else {
      // Two blobs of the first terrain on grid points (cell corners).
      const a = (x, y) => Math.hypot(x - 3.5, y - 3.5) < 2.3 || Math.hypot(x - 7, y - 6.5) < 1.8;
      for (const [i, j] of cells) put(i, j, get(`c${(a(i, j) << 3) | (a(i + 1, j) << 2) | (a(i, j + 1) << 1) | a(i + 1, j + 1)}`));
    }
    fs.writeFileSync(out, PNG.sync.write(can));
    console.log(`preview ${key} (${rec.kind}${rec.source.rule ? ' ' + rec.source.rule : ''}) -> ${path.relative(ROOT, out)}${missing.size ? `; missing tags: ${[...missing].join(', ')}` : ''}`);
  } else if (cmd === 'colors') {
    // art colors <key> [--palette <name>]: colours used, and how much is off the palette
    const key = rest[0];
    const i = rest.indexOf('--palette');
    const pal = i >= 0 ? readPalette(rest[i + 1]).map((c) => parseInt(c.slice(1), 16)) : null;
    const p = readPng(sheet(key).png);
    const used = new Map();
    let total = 0, off = 0;
    for (let j = 0; j < p.data.length; j += 4) {
      if (p.data[j + 3] < 128) continue;
      const c = (p.data[j] << 16) | (p.data[j + 1] << 8) | p.data[j + 2];
      used.set(c, (used.get(c) ?? 0) + 1);
      total++;
      if (pal && !pal.includes(c)) off++;
    }
    console.log(`${key}: ${used.size} colours over ${total} px${pal ? `, ${(100 * off / total).toFixed(1)}% of pixels off the palette` : ''}`);
  } else if (cmd === 'list') {
    for (const key of allKeys()) {
      const rec = fs.existsSync(recordFile(key)) ? JSON.parse(fs.readFileSync(recordFile(key), 'utf8')) : { kind: 'objects (hand-made)' };
      console.log(`${key.padEnd(14)} ${rec.kind.padEnd(10)} ${rec.tags ? rec.tags.length + ' tags' : ''}`);
    }
  } else {
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd && cmd !== 'help' ? 2 : 0);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
