// npm test: an offline smoke test of import -> built sheet -> export.
// A local server stands in for PixelLab (PIXELLAB_API) and serves a small
// made-up character (zip) and UI piece (PNG); the tool runs in a throwaway
// project in test/tmp/. Needs Aseprite (ASEPRITE, PATH or ~/Applications).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { PNG } from 'pngjs';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(TOOL, 'test', 'tmp');
const PROJ = path.join(TMP, 'game');

function findAseprite() {
  if (process.env.ASEPRITE) return process.env.ASEPRITE;
  const r = spawnSync('which', ['aseprite'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim();
  const mac = `${process.env.HOME}/Applications/Aseprite.app/Contents/MacOS/aseprite`;
  return fs.existsSync(mac) ? mac : null;
}

// ---- fixtures -----------------------------------------------------------

function png(w, h, paint) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = paint(x, y);
    if (c) p.data.set(c, (y * w + x) * 4);
  }
  return PNG.sync.write(p);
}

// A 32x32 figure: a body that bobs by `dy`, feet on row 28.
const figure = (dy, tint) => png(32, 32, (x, y) => {
  if (x >= 12 && x < 20 && y >= 10 + dy && y < 24 + dy) return [tint, 60, 60, 255];
  if ((x === 13 || x === 18) && y >= 24 + dy && y <= 28) return [30, 30, 30, 255];
  return null;
});

function characterZip() {
  const zip = new AdmZip();
  const rotations = {}, animations = { walk: {} };
  for (const d of ['south', 'east']) {
    rotations[d] = `rotations/${d}.png`;
    zip.addFile(rotations[d], figure(0, d === 'south' ? 200 : 120));
    animations.walk[d] = [];
    for (let i = 0; i < 4; i++) {
      const f = `animations/walk/${d}/frame_00${i}.png`;
      zip.addFile(f, figure(i % 2, d === 'south' ? 200 : 120));
      animations.walk[d].push(f);
    }
  }
  zip.addFile('metadata.json', Buffer.from(JSON.stringify({ states: [{ character: { id: 'c1' }, frames: { rotations, animations } }] })));
  return zip.toBuffer();
}

// A 48x40 panel with a 4px border, centred on a transparent 64x56 canvas.
const panel = () => png(64, 56, (x, y) => {
  const px = x - 8, py = y - 8;
  if (px < 0 || py < 0 || px >= 48 || py >= 40) return null;
  const edge = px < 4 || py < 4 || px >= 44 || py >= 36;
  return edge ? [210, 170, 110, 255] : [40, 30, 20, 255];
});

const routes = { '/characters/c1/download': characterZip(), '/ui-assets/u1/download': panel() };

// ---- run ----------------------------------------------------------------

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const aseprite = findAseprite();
if (!aseprite) {
  console.log('skipped: no Aseprite found (set ASEPRITE=/path/to/aseprite)');
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const body = routes[req.url.split('?')[0]];
  res.writeHead(body ? 200 : 404).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, ASEPRITE: aseprite, PIXELLAB_API: `http://127.0.0.1:${server.address().port}` };

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(PROJ, { recursive: true });
const config = (extra) => fs.writeFileSync(path.join(PROJ, 'art.config.json'), JSON.stringify({ out: 'out', ...extra }));
config({});
// Async: the fake PixelLab server runs in this process, so the tool must not
// block its event loop.
const art = (...args) => new Promise((resolve) => {
  const p = spawn('node', [path.join(TOOL, 'art.mjs'), ...args], { cwd: PROJ, env });
  let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d));
  p.stderr.on('data', (d) => (stderr += d));
  p.on('close', (status) => resolve({ status, stdout, stderr }));
});
const run = async (...args) => {
  const r = await art(...args);
  if (r.status !== 0) throw new Error(`art ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
};
const json = (f) => JSON.parse(fs.readFileSync(path.join(PROJ, f), 'utf8'));

try {
  await run('import', 'character', 'hero', 'c1');
  await run('import', 'ui', 'panel', 'u1', '--nine', 'auto', '--states');

  check(fs.existsSync(path.join(PROJ, 'art/hero/hero.aseprite')), 'character .aseprite file written');
  check(fs.existsSync(path.join(PROJ, 'art/hero/hero.pixellab.json')), 'character record written');
  check(fs.readFileSync(path.join(PROJ, 'art/.build/.gitignore'), 'utf8').trim() === '*', 'built sheets are git-ignored');

  const hero = json('out/hero.json');
  const tags = hero.meta.frameTags.map((t) => t.name);
  check(['hero-still-south', 'hero-still-east', 'hero-walk-south', 'hero-walk-east'].every((t) => tags.includes(t)), 'character tags');
  check(Object.values(hero.frames).every((f) => f.pivot && f.pivot.y > 0.5), 'character frames carry a foot pivot');
  check(hero.meta.kind === 'character', 'meta.kind');
  check(hero.meta.image === 'hero.png', 'meta.image names the exported sheet');

  const ui = json('out/panel.json');
  check(['panel-normal', 'panel-hover', 'panel-pressed'].every((t) => ui.meta.frameTags.some((x) => x.name === t)), 'ui states');
  const b = Object.values(ui.frames)[0].scale9Borders;
  check(b && b.x >= 4 && b.x <= 7 && b.y >= 4 && b.y <= 7 && b.w >= 30 && b.h >= 22, `9-slice found past the 4px border (${JSON.stringify(b)})`);

  const index = json('out/index.json');
  check(index.hero === 'character' && index.panel === 'ui', 'index.json lists both');

  const loops = await run('loops', 'hero');
  check(/walk-south/.test(loops), 'loops reads the built sheet');

  const again = await art('import', 'ui', 'panel', 'u1');
  check(again.status !== 0 && /--force/.test(again.stdout + again.stderr), 'import refuses to overwrite without --force');

  // Built sheets are the source for every engine: removing the export
  // doesn't break commands, and a re-export gives the same files.
  const before = fs.readFileSync(path.join(PROJ, 'out/hero.png'));
  fs.rmSync(path.join(PROJ, 'out'), { recursive: true });
  await run('colors', 'hero');
  await run('export');
  check(Buffer.compare(before, fs.readFileSync(path.join(PROJ, 'out/hero.png'))) === 0, 're-export is identical');

  config({ engine: 'godot' });
  const godot = await art('export', 'hero');
  check(godot.status !== 0 && /not implemented/.test(godot.stderr), 'godot engine reports it is not implemented');
  config({ engine: 'nope' });
  const bad = await art('export', 'hero');
  check(bad.status !== 0 && /unknown engine/.test(bad.stderr), 'unknown engine is refused');
} catch (e) {
  console.log(`FAIL ${e.message}`);
  failures++;
} finally {
  server.close();
}

if (failures) {
  console.log(`\n${failures} failed; the test project is kept in ${path.relative(process.cwd(), PROJ)}`);
  process.exit(1);
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nall passed');
