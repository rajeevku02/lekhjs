// Local contact sheets for human review (verification 02 §B.1, §B.5 item 3): for each saved page of
// an image run (run.mjs --save), one PNG with the C++ render, the TS render and the diff side by
// side, scaled down to at most --width px, written to <run dir>/contact/. Customer boards: the
// sheets stay on the box (under corpus/out/), never published.
//
//   node parity/image/contact.mjs <run dir> [--width 1800] [--only fail|all]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { decodePng, encodePng, sideBySide } from './diff.mjs';

const { values: opt, positionals } = parseArgs({
  options: { width: { type: 'string', default: '1800' }, only: { type: 'string', default: 'all' } },
  allowPositionals: true,
});
const dir = positionals[0];
if (!dir) {
  process.stderr.write('usage: contact.mjs <run dir> [--width 1800]\n');
  process.exit(2);
}
const png = path.join(dir, 'png');
const out = path.join(dir, 'contact');
mkdirSync(out, { recursive: true });
const maxW = Number(opt.width);

/** Box-filter downscale by an integer factor. @param {import('./diff.mjs').Rgba} img @param {number} f */
function shrink(img, f) {
  if (f <= 1) return img;
  const w = Math.max(1, Math.floor(img.width / f));
  const h = Math.max(1, Math.floor(img.height / f));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * img.width + (x * f + dx)) * 4;
          for (let k = 0; k < 4; k++) acc[k] = (acc[k] ?? 0) + (img.data[i + k] ?? 0);
        }
      for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = Math.round((acc[k] ?? 0) / (f * f));
    }
  return { width: w, height: h, data };
}

let n = 0;
for (const f of readdirSync(png).filter((x) => x.endsWith('-cpp.png'))) {
  const base = f.slice(0, -'-cpp.png'.length);
  const parts = ['cpp', 'ts', 'diff'].map((k) => path.join(png, `${base}-${k}.png`));
  if (!parts.every((p) => existsSync(p))) continue;
  const imgs = parts.map((p) => decodePng(readFileSync(p)));
  const total = imgs.reduce((s, i) => s + i.width, 0) + 8;
  const factor = Math.max(1, Math.ceil(total / maxW));
  writeFileSync(path.join(out, `${base}.png`), encodePng(sideBySide(imgs.map((i) => shrink(i, factor)))));
  n++;
}
process.stdout.write(`contact sheets: ${n} in ${out}\n`);
