// The image comparison's pure parts (verification 02 §B.3, §B.6): the row-streamed blob labelling
// of tiled pages, and the object flags and blob claims the register's image rules use. No oracle,
// no browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BlobStream, blobs } from '../image/diff.mjs';
import { flagsByObject, halfPixelEdgeBlob, rotatedEllipseEndIds, wrapCandidates } from '../image/attribute.mjs';

/** @param {{ x: number, y: number, w: number, h: number, pixels: number }[]} bl */
const sorted = (bl) => [...bl].sort((a, b) => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h || a.pixels - b.pixels);

test('BlobStream labels a mask fed row by row as blobs() labels it whole', () => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (const { w, h, density } of [
    { w: 1, h: 1, density: 1 },
    { w: 17, h: 9, density: 0.3 },
    { w: 64, h: 40, density: 0.45 },
    { w: 5, h: 120, density: 0.6 },
    { w: 200, h: 3, density: 0.5 },
  ]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = rnd() < density ? 1 : 0;
    const s = new BlobStream(w);
    for (let y = 0; y < h; y++) s.row(mask.subarray(y * w, (y + 1) * w));
    assert.deepEqual(sorted(s.result()), sorted(blobs(mask, w, h)), `${w}x${h}`);
  }
});

test('BlobStream joins a U shape whose arms meet only on a later row', () => {
  // ▌  ▌
  // ▌  ▌
  // ▙▄▄▟
  const w = 4;
  const rows = [
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 1, 1, 1],
  ];
  const s = new BlobStream(w);
  for (const r of rows) s.row(Uint8Array.from(r));
  assert.deepEqual(s.result(), [{ x: 0, y: 0, w: 4, h: 3, pixels: 8 }]);
});

test('DR-ENG-26 claims only a one-pixel line on an edge that lies on a pixel centre line', () => {
  const img = { flags: ['image'], px: { x: 20.5, y: 20.5, w: 224.927, h: 81.8544 } };
  // the top edge's row, within its span
  assert.equal(halfPixelEdgeBlob({ x: 21, y: 20, w: 224, h: 1 }, [img], 'image'), true);
  // the left edge's column
  assert.equal(halfPixelEdgeBlob({ x: 20, y: 30, w: 1, h: 40 }, [img], 'image'), true);
  // the bottom edge (102.3544) is not on a centre line
  assert.equal(halfPixelEdgeBlob({ x: 21, y: 102, w: 100, h: 1 }, [img], 'image'), false);
  // two pixels thick, another row, past the span, another flag, rotated
  assert.equal(halfPixelEdgeBlob({ x: 21, y: 20, w: 50, h: 2 }, [img], 'image'), false);
  assert.equal(halfPixelEdgeBlob({ x: 21, y: 21, w: 50, h: 1 }, [img], 'image'), false);
  assert.equal(halfPixelEdgeBlob({ x: 200, y: 20, w: 60, h: 1 }, [img], 'image'), false);
  assert.equal(halfPixelEdgeBlob({ x: 21, y: 20, w: 50, h: 1 }, [img], 'ink'), false);
  assert.equal(
    halfPixelEdgeBlob({ x: 21, y: 20, w: 50, h: 1 }, [{ ...img, flags: ['image', 'rotated'] }], 'image'),
    false,
  );
});

/** @param {Record<string, any>} objects */
const board = (objects) => ({ pages: { p1: { name: 'Page one', order: 1, objects } } });

test('DR-ENG-05 flags a template that measures an empty text, not one that measures a filled one', () => {
  const cls = (/** @type {string[]} */ texts) => ({
    type: 'templated',
    params: { cx: 0, cy: 0, width: 240, height: 200, angle: 0 },
    template: {
      id: 'avabodh.uml.class',
      data: ['5', 'th(0) + d(0)', 'th(1) + d(0)', 'th(2) + d(0)'],
      texts: texts.map((text) => ({ location: 'default', text })),
    },
  });
  const f = flagsByObject(board({ a: cls(['one', '', 'two']), b: cls(['one', 'two', 'three']) }));
  assert.equal(f.get('a')?.includes('empty-text-measure'), true);
  assert.equal(f.get('b')?.includes('empty-text-measure'), false);
  // an empty text no expression measures
  const c = cls(['one', 'two', 'three']);
  c.template.texts.push({ location: 'default', text: '' });
  assert.equal(flagsByObject(board({ c })).get('c')?.includes('empty-text-measure'), false);
});

test('a table-v1 cell text is measured against its column, not the whole table', () => {
  const table = {
    type: 'templated',
    params: { cx: 0, cy: 0, width: 300, height: 100, angle: 0 },
    template: {
      id: 'avabodh.table.std',
      generator: { type: 'native', shape: 'table-v1', text: '' },
      params: { col0: { value: 200 }, col1: { value: 100 } },
      texts: [
        { location: '0 1 2 3 4', col: 1, row: 0, text: 'alpha/beta' },
        { location: '5 6 7 8 9', text: 'sample text' },
      ],
    },
  };
  const [c] = wrapCandidates(board({ t: table }));
  assert.equal(c?.width, 300);
  assert.deepEqual(
    c?.items.map((i) => i.width),
    [100, undefined],
  );
});

test('DR-ENG-26 claims a text drawn one whole row apart, not one drawn differently', async () => {
  const { textRowShift } = await import('../image/attribute.mjs');
  const { diffImages } = await import('../image/diff.mjs');
  const differing = (/** @type {any} */ x, /** @type {any} */ y) => diffImages(x, y).count;
  const W = 40;
  const H = 20;
  /** @param {number} top @param {number[]} cols */
  const page = (top, cols) => {
    const data = new Uint8Array(W * H * 4).fill(255);
    for (const x of cols) for (let y = top; y < top + 5; y++) data.set([0, 0, 0, 255], (y * W + x) * 4);
    return { width: W, height: H, data };
  };
  const glyphs = [10, 11, 14, 18, 19, 20];
  const r = { x: 8, y: 5, w: 16, h: 9 };
  assert.equal(textRowShift(page(7, glyphs), page(8, glyphs), r, differing), true);
  assert.equal(textRowShift(page(7, glyphs), page(7, glyphs), r, differing), false); // no difference
  assert.equal(textRowShift(page(7, glyphs), page(9, glyphs), r, differing), false); // two rows
  assert.equal(textRowShift(page(7, glyphs), page(8, [10, 11, 14, 18, 19, 21]), r, differing), false);
});

test('DR-ENG-26 flags a stored parallel route between shapes with level sides, not one between offset sides', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = JSON.parse(readFileSync(new URL('../fixtures/DR-ENG-26/route-tie.lekh', import.meta.url), 'utf8'));
  assert.equal(flagsByObject(doc).get('c')?.includes('route-tie'), true);
  doc.pages.p1.objects.t.params.cx += 1;
  assert.equal(flagsByObject(doc).get('c')?.includes('route-tie'), false);
});

test('DR-GEN-15 flags a BPMN symbol the board stores at another size or not at all', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = JSON.parse(
    readFileSync(new URL('../fixtures/DR-GEN-15/bpmn-stored-symbol.lekh', import.meta.url), 'utf8'),
  );
  let f = flagsByObject(doc);
  assert.equal(f.get('t1')?.includes('core-embed'), true); // a stored 70 x 50 copy
  assert.equal(f.get('t2')?.includes('core-embed'), true); // no stored copy
  // every symbol stored at the core size, and a task with no symbol picked
  for (const id of doc.pages.p1.objects.t1.template.generator.embedrefs)
    doc.templates[id.replace(/\./g, '_')] = { id, default: { width: 40, height: 28 } };
  doc.templates.avabodh_bpmn_syms_message.default = { width: 40, height: 28 };
  doc.pages.p1.objects.t2.template.params.tasktype.value = 'None';
  f = flagsByObject(doc);
  assert.equal(f.get('t2')?.includes('core-embed'), false);
});

test('DR-ENG-28 flags a connector with an end on a rotated ellipse only', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = JSON.parse(
    readFileSync(new URL('../fixtures/DR-ENG-28/rotated-ellipse-ends.lekh', import.meta.url), 'utf8'),
  );
  const f = flagsByObject(doc);
  const flagged = ['c1', 'c5', 'c6', 'c7'].filter((id) => f.get(id)?.includes('rotated-ellipse-end'));
  assert.deepEqual(flagged, ['c1', 'c6', 'c7']); // c5's ellipse is unrotated
  // The claim region's members: each flagged connector with its two ends, nothing else.
  const ends = rotatedEllipseEndIds(doc);
  assert.deepEqual([...ends.keys()].sort(), ['c1', 'c6', 'c7']);
  const objects = Object.values(doc.pages)[0].objects;
  for (const id of ends.keys()) {
    const c = objects[id];
    assert.deepEqual(ends.get(id), [String(c.source), String(c.target)]);
  }
});
