// Build a contact sheet from PNGs for quick visual review.
// Usage: node tools/art/contact.mjs out.png [--cols N] [--scale S] img1.png img2.png ...
import fs from 'node:fs';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const out = args.shift();
let cols = 8, scale = 2;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cols') cols = +args[++i];
  else if (args[i] === '--scale') scale = +args[++i];
  else files.push(args[i]);
}
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(f)));
const cw = Math.max(...imgs.map((i) => i.width)) * scale + 4;
const ch = Math.max(...imgs.map((i) => i.height)) * scale + 4;
const rows = Math.ceil(imgs.length / cols);
const sheet = new PNG({ width: cw * Math.min(cols, imgs.length), height: ch * rows });
// Checkerboard background so transparency is visible.
for (let y = 0; y < sheet.height; y++)
  for (let x = 0; x < sheet.width; x++) {
    const o = (y * sheet.width + x) * 4;
    const c = ((x >> 3) + (y >> 3)) & 1 ? 70 : 90;
    sheet.data[o] = c; sheet.data[o + 1] = c; sheet.data[o + 2] = c + 10; sheet.data[o + 3] = 255;
  }
imgs.forEach((img, n) => {
  const ox = (n % cols) * cw + 2, oy = Math.floor(n / cols) * ch + 2;
  for (let y = 0; y < img.height * scale; y++)
    for (let x = 0; x < img.width * scale; x++) {
      const s = ((Math.floor(y / scale) * img.width) + Math.floor(x / scale)) * 4;
      const a = img.data[s + 3] / 255;
      if (!a) continue;
      const d = ((oy + y) * sheet.width + ox + x) * 4;
      for (let k = 0; k < 3; k++) sheet.data[d + k] = Math.round(img.data[s + k] * a + sheet.data[d + k] * (1 - a));
    }
});
fs.writeFileSync(out, PNG.sync.write(sheet));
console.log(`${out}: ${imgs.length} images, ${sheet.width}x${sheet.height}`);
