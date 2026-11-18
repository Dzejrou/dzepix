// Phaser 4 exporter: <out>/<key>.png + <key>.json (Aseprite json-hash, which
// Phaser's load.aseprite reads; frame pivots become origins, scale9Borders
// make NineSlice pieces), <key>_n.png (normal map, same layout),
// <key>.xml (BMFont, font assets) and index.json (key -> kind), which is all
// the game loads. See README.md here and art-runtime.js for the game side.
import fs from 'node:fs';
import path from 'node:path';

export function exportAsset(asset, { out }) {
  const { key, kind, data, png, normal } = asset;
  fs.copyFileSync(png, path.join(out, `${key}.png`));
  const json = structuredClone(data);
  json.meta.image = `${key}.png`;
  fs.writeFileSync(path.join(out, `${key}.json`), JSON.stringify(json));
  if (normal) fs.copyFileSync(normal, path.join(out, `${key}_n.png`));
  else fs.rmSync(path.join(out, `${key}_n.png`), { force: true });
  if (kind === 'font') writeBmFont(key, data, out);
}

// index.json: key -> kind, or { kind, normal: true } when <key>_n.png exists.
// Only assets that have been exported are listed.
export function exportIndex(assets, { out }) {
  const index = {};
  for (const { key, kind } of assets) {
    if (!fs.existsSync(path.join(out, `${key}.json`))) continue;
    index[key] = fs.existsSync(path.join(out, `${key}_n.png`)) ? { kind, normal: true } : kind;
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
}

// A BMFont (text-format XML) for a font asset: one char per tag, trimmed so
// spacing is proportional; yoffset keeps every glyph on the shared baseline.
function writeBmFont(key, data, out) {
  const frames = Object.values(data.frames);
  const cell = frames[0].sourceSize;
  const esc = (c) => c.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const chars = data.meta.frameTags.map((t) => {
    const f = frames[t.from], c = t.name.slice(key.length + 1);
    return `  <char id="${c.codePointAt(0)}" x="${f.frame.x}" y="${f.frame.y}" width="${f.frame.w}" height="${f.frame.h}" xoffset="0" yoffset="${f.spriteSourceSize.y}" xadvance="${f.frame.w}" page="0" chnl="15" letter="${esc(c)}"/>`;
  });
  // Space: no glyph in PixelLab fonts; a third of the cell.
  chars.push(`  <char id="32" x="0" y="0" width="0" height="0" xoffset="0" yoffset="0" xadvance="${Math.round(cell.w / 3)}" page="0" chnl="15" letter="space"/>`);
  const xml = `<?xml version="1.0"?>
<font>
  <info face="${key}" size="${cell.h}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="0" aa="1" padding="0,0,0,0" spacing="1,1"/>
  <common lineHeight="${cell.h + 2}" base="${cell.h}" scaleW="${data.meta.size.w}" scaleH="${data.meta.size.h}" pages="1" packed="0"/>
  <pages><page id="0" file="${key}.png"/></pages>
  <chars count="${chars.length}">
${chars.join('\n')}
  </chars>
</font>
`;
  fs.writeFileSync(path.join(out, `${key}.xml`), xml);
}
