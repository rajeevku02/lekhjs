// The library-shape test's pure parts (verification 02 §B.3, §C.2, §C.4): layout, batch plan,
// coverage, the image bar, cell attribution and the register's image rules. No oracle, no browser.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { bar, blobs, diffImages, identical } from '../image/diff.mjs';
import { buildSet, coverage } from '../library/build-batches.mjs';
import { MAX_CELLS, footprint, shelfPack, splitCategory } from '../library/layout.mjs';
import { alignRules, attribute, cellRules } from '../library/run-batch.mjs';

test('footprint of a quarter-turned box swaps its sides', () => {
  assert.deepEqual(footprint(400, 600, -Math.PI / 2), { w: 600, h: 400 });
  assert.deepEqual(footprint(10, 20, 0), { w: 10, h: 20 });
});

test('shelf packing wraps at the row width with 40 pt gutters', () => {
  const p = shelfPack([
    { w: 1000, h: 50 },
    { w: 1000, h: 80 },
    { w: 1000, h: 30 },
  ]);
  assert.deepEqual(p.rects[0], { x: 40, y: 40, w: 1000, h: 50 });
  assert.deepEqual(p.rects[1], { x: 1080, y: 40, w: 1000, h: 80 });
  assert.deepEqual(p.rects[2], { x: 40, y: 160, w: 1000, h: 30 });
  assert.equal(p.height, 230);
});

test('a category splits into near-equal chunks of at most 100 cells', () => {
  const shapes = Array.from({ length: 257 }, (_, i) => ({ gen: i % 7 === 0 }));
  const chunks = splitCategory(
    shapes,
    (s) => (s.gen ? 2 : 1),
    () => ({ width: 100, height: 100 }),
  );
  assert.ok(chunks.every((c) => c.reduce((n, s) => n + (s.gen ? 2 : 1), 0) <= MAX_CELLS));
  assert.equal(chunks.flat().length, 257);
  const sizes = chunks.map((c) => c.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
});

test('batch plan matches verification 02 §C.6: v3 62, v4 74 with 32 run, core 3, v5 3 to run', () => {
  const v3 = buildSet('v3').batches;
  const v4 = buildSet('v4').batches;
  const v5 = buildSet('v5').batches;
  assert.equal(v3.length, 62);
  assert.equal(
    v3.reduce((n, b) => n + b.shapes.length, 0),
    4652,
  );
  assert.equal(
    v3.reduce((n, b) => n + b.manifest.cells.length, 0),
    4705,
  );
  assert.equal(v4.length, 74);
  assert.equal(coverage(v4, v3).filter((c) => c.covered_by === null).length, 32);
  assert.deepEqual(
    coverage(v5, v4)
      .filter((c) => c.covered_by === null)
      .map((c) => c.id),
    ['v5-ui-wireframe-01', 'v5-ui-wireframe-02', 'v5-ui-wireframe-03'],
  );
  assert.deepEqual(
    buildSet('core').batches.map((b) => [b.id, b.manifest.cells.length]),
    [
      ['core-flowchart-01', 27],
      ['core-arrowheads-01', 26],
      ['core-templates-01', 2],
    ],
  );
  // Byte-identical inputs give a byte-identical batch.
  assert.equal(buildSet('v3').batches[0]?.srcSha, v3[0]?.srcSha);
});

/** @param {number} w @param {number} h */
const white = (w, h) => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(255) });
/** @param {{ width: number, data: Uint8Array }} img @param {number} x @param {number} y */
const ink = (img, x, y) => img.data.set([0, 0, 0, 255], (y * img.width + x) * 4);

test('the bar: fraction under 0.1 %, no blob over 16 px; blobs are 8-connected', () => {
  const a = white(100, 100);
  const b = white(100, 100);
  assert.ok(identical(a, b));
  for (let i = 0; i < 5; i++) ink(b, 10 + i, 10 + i); // one diagonal blob of 5
  ink(b, 50, 50);
  const d = diffImages(a, b);
  const bl = blobs(d.mask, d.width, d.height);
  assert.equal(d.count, 6);
  assert.deepEqual(bl.map((x) => x.pixels).sort(), [1, 5]);
  assert.equal(bar(d, bl).pass, true);
  for (let y = 70; y < 75; y++) for (let x = 70; x < 75; x++) ink(b, x, y); // a 25 px blob
  const d2 = diffImages(a, b);
  const r = bar(d2, blobs(d2.mask, d2.width, d2.height));
  assert.equal(r.pass, false);
  assert.equal(r.largestBlob, 25);
});

test('blobs are attributed to the cell whose grown rectangle they meet', () => {
  const a = white(200, 100);
  const b = white(200, 100);
  for (let y = 30; y < 36; y++) for (let x = 130; x < 136; x++) ink(b, x, y);
  const d = diffImages(a, b);
  const bl = blobs(d.mask, d.width, d.height);
  const cells = [
    { n: 1, object: 'c1', shape: 'left', file: 'f', params: 'default', rect: { x: 20, y: 20, w: 50, h: 50 } },
    { n: 2, object: 'c2', shape: 'right', file: 'f', params: 'default', rect: { x: 120, y: 20, w: 50, h: 50 } },
  ];
  const att = attribute(d, bl, cells, { x: 0, y: 0 }, 1);
  assert.deepEqual(
    att.per.filter((p) => p.fails).map((p) => p.cell.shape),
    ['right'],
  );
  assert.equal(att.orphans.length, 0);
});

test('register image rules: DR-ENG-17 re-frames on the C++ origin; cells are claimed by shape id', () => {
  const dir = path.resolve(import.meta.dirname, '..', 'register');
  assert.ok(alignRules(dir, false).includes('DR-ENG-17'));
  const cells = cellRules(dir, false);
  assert.ok(cells.get('avabodh.wireframe.androiddatepicker')?.includes('DR-GEN-08'));
  assert.ok(cells.get('avabodh.bpmn.dataobject')?.includes('DR-TXT-03'));
});
