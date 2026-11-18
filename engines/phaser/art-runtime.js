// Phaser 4 side of the art pipeline (tools/art/art.mjs). Copy into the game.
//
//   preload():  loadArt(this)                    // reads <base>/index.json, queues every asset
//   create():   setupArt(this)                   // animations, character tables
//   anywhere:   sprite.play(animOf('warrior', 'walk-south'))
//               scene.add.image(x, y, 'props', frameOf('props', 'barrel'))
//
// Everything about an asset's behaviour comes from its .aseprite file: tag
// names, loop / play once (tag repeat), ping-pong, frame durations, origin
// (exported as each frame's pivot, which Phaser applies on every setFrame),
// 9-slice borders, rig points (slices "point:<name>").
import Phaser from 'phaser';

export const ART = {
  kinds: {}, // key -> 'character' | 'tiles' | 'tileset' | 'kit' | 'objects' | 'fx' | 'ui' | 'font' | 'images'
  tags: {}, // key -> { tag -> [frame names] }
};

export const DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

export const hasArt = (key) => key in ART.kinds;
export const tagNames = (key) => Object.keys(ART.tags[key] ?? {});
export const tagFrames = (key, tag) => ART.tags[key]?.[tag] ?? [];
// First frame of a tag: the picture for a still object, tile or UI state.
export const frameOf = (key, tag) => tagFrames(key, tag)[0];
// A random frame of a tag (tile / tileset variants).
export const anyFrameOf = (key, tag) => Phaser.Utils.Array.GetRandom(tagFrames(key, tag));
// Animation key for a tag.
export const animOf = (key, tag) => `${key}-${tag}`;
// A rig point ("point:<name>" slice) as a pixel offset from the origin of the
// given tag's first frame (default: the file's first frame). Null if the file
// has no such point.
export function pointOf(scene, key, name, tag) {
  const data = scene.cache.json.get(key);
  const b = data?.meta.slices?.find((s) => s.name === `point:${name}`)?.keys[0].bounds;
  if (!b) return null;
  const f = data.frames[tag ? frameOf(key, tag) : Object.keys(data.frames)[0]];
  return { x: b.x - f.pivot.x * f.sourceSize.w, y: b.y - f.pivot.y * f.sourceSize.h };
}

export function loadArt(scene, base = 'assets/gfx') {
  scene.load.json('art-index', `${base}/index.json`);
  scene.load.once('filecomplete-json-art-index', (key, type, index) => {
    for (const [k, entry] of Object.entries(index)) {
      const kind = entry.kind ?? entry; // an entry is the kind, or { kind, normal: true }
      if (kind === 'font') scene.load.bitmapFont(k, `${base}/${k}.png`, `${base}/${k}.xml`);
      else if (entry.normal) scene.load.aseprite({ key: k, textureURL: `${base}/${k}.png`, atlasURL: `${base}/${k}.json`, normalMap: `${base}/${k}_n.png` });
      else scene.load.aseprite(k, `${base}/${k}.png`, `${base}/${k}.json`);
    }
  });
}

export function setupArt(scene) {
  const index = scene.cache.json.get('art-index');
  for (const [k, entry] of Object.entries(index)) {
    const kind = entry.kind ?? entry;
    if (!scene.textures.exists(k)) continue;
    ART.kinds[k] = kind;
    if (kind === 'font') continue;
    makeAnims(scene, k);
    if (kind === 'character') makeCharacter(scene, k);
  }
}

// One animation per tag ("<key>-<tag>"). createFromAseprite ignores the tag's
// repeat count, so set it here: none = loop, N = play N times. Ping-pong tags
// come through as yoyo.
function makeAnims(scene, k) {
  const data = scene.cache.json.get(k);
  scene.anims.createFromAseprite(k);
  const tags = (ART.tags[k] = {});
  for (const tag of data.meta.frameTags) {
    const name = tag.name.slice(k.length + 1);
    tags[name] = [];
    for (let i = tag.from; i <= tag.to; i++) tags[name].push(String(i));
    const anim = scene.anims.get(tag.name);
    if (anim) anim.repeat = tag.repeat ? Number(tag.repeat) - 1 : -1;
  }
}

// Characters: "<anim>-<dir>" tags and one-frame "still-<dir>" poses; jump
// tags carry an airborne window ("air": [from, to] as fractions of the clip).
// Missing directions are filled from the nearest existing one.
function makeCharacter(scene, k) {
  const data = scene.cache.json.get(k);
  const have = {};
  for (const tag of data.meta.frameTags) {
    const [anim, ...rest] = tag.name.slice(k.length + 1).split('-');
    const dir = rest.join('-');
    if (anim === 'still') { scene.registry.set(`${k}-still-${dir}`, String(tag.from)); continue; }
    if (tag.air) scene.registry.set(`${k}-air-${dir}`, tag.air);
    (have[anim] ??= new Set()).add(dir);
  }
  for (const [anim, dirs] of Object.entries(have)) {
    for (let i = 0; i < 8; i++) {
      if (dirs.has(DIRS[i])) continue;
      for (const off of [1, -1, 2, -2, 3, -3, 4]) {
        const alt = DIRS[(i + off + 8) % 8];
        if (!dirs.has(alt)) continue;
        const src = scene.anims.get(`${k}-${anim}-${alt}`);
        scene.anims.create({ key: `${k}-${anim}-${DIRS[i]}`, frames: src.frames.map((f) => ({ key: k, frame: f.frame.name, duration: f.duration })), frameRate: src.frameRate, repeat: src.repeat, yoyo: src.yoyo });
        break;
      }
    }
  }
  scene.registry.set(`${k}-anims`, Object.keys(have));
}

// A UI piece in a state. A piece with a 9-slice ("nine" slice) becomes a
// NineSlice of any size; others are plain images. Origin: the piece's middle.
export function addPiece(scene, x, y, key, state = 'normal', width, height) {
  const frame = frameOf(key, state);
  if (!scene.textures.getFrame(key, frame).scale9) return scene.add.image(x, y, key, frame);
  const tile = !!scene.cache.json.get(key)?.meta.nineTile;
  return scene.add.nineslice(x, y, key, frame, width, height, undefined, undefined, undefined, undefined, tile, tile);
}

// Switch a UI piece to another state, keeping its size.
export function setPieceState(piece, key, state) {
  piece.setFrame(frameOf(key, state));
  if (piece.setSlices) piece.setSlices(piece.width, piece.height);
  return piece;
}

// Text in an imported pixel font (white glyphs + dark outline, so the tint
// colours the letters). Keep `scale` a whole number.
export function addText(scene, x, y, text, { font = 'font_body', color = '#ffffff', scale = 1, center = false } = {}) {
  const t = scene.add.bitmapText(x, y, font, text).setScale(scale);
  if (center) t.setCenterAlign();
  return t.setTint(Number.parseInt(color.replace('#', ''), 16));
}

// Lip sync for a talking portrait ("<mood>-<shape>" tags): text -> mouth
// shapes, the same mapping as PixelLab's get_lip_sync. `offset` = characters
// spoken so far (to reveal the text as it plays).
const SHAPE = { a: 'wide_open', e: 'medium_open', b: 'closed', m: 'closed', p: 'closed', f: 'teeth', v: 'teeth', s: 'teeth', z: 'teeth', o: 'round', u: 'round', w: 'round' };
export function lipSync(text, frameMs = 90, holdMs = 600) {
  const frames = [{ shape: 'rest', ms: frameMs, offset: 0 }];
  [...text.toLowerCase()].forEach((c, i) => {
    const shape = /[a-z]/.test(c) ? (SHAPE[c] ?? 'small_open') : 'rest';
    const last = frames[frames.length - 1];
    if (shape === last.shape) last.offset = i + 1;
    else frames.push({ shape, ms: frameMs, offset: i + 1 });
  });
  const last = frames[frames.length - 1];
  if (last.shape === 'rest') last.ms += holdMs;
  else frames.push({ shape: 'rest', ms: frameMs + holdMs, offset: text.length });
  return frames;
}
