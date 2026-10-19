#!/usr/bin/env node
// The synthetic fixture boards of the device checklist (verification 06; back-handover §7). Every
// board is generated here from a semantic description through lekhjs's own generator (the same
// `generate` the MCP `board_create_content` uses) and serialized as an on-device board (format
// 5.0 offline stamp), so nothing is copied from a customer board and nothing here is user data.
//
//   scripts.lekh          DEV-18, DEV-56   zh/ja/ko/ar/hi/emoji in Noto Sans shapes, a CJK paragraph
//                                          without spaces in a fixed-width box
//   export-matrix.lekh    DEV-52…54, -58   3 fixed (A4) pages: fonts, styles, connectors, scripts
//   wrap-corpus.lekh      DEV-75 (H-TXT-2) CJK, Thai, mixed Latin/CJK, kinsoku, over-long words,
//   wrap-corpus.json                       hyphenated words, URLs, each at 6 widths; the JSON lists
//                                          the cases for the "dump wrap" replay (AC-TXT-31)
//   perf.lekh             DEV-74           a dense board: 24 × 20 shapes, connectors, text
//   export-folder/        DEV-55           4 boards for a folder export, one of them malformed
//   malformed.lekh        DEV-55           truncated JSON (the on-device read must fail cleanly)
//   huge-image.png        DEV-60           30000 × 30000 px (1-bit, ~150 KB): decodable headers,
//                                          too large for the WebView to decode
//
// Run from lekhjs after `npm run build` (it imports dist/node/headless.js):
//   node parity/device-checklist/fixtures/build-fixtures.mjs [--check]
// --check regenerates in memory and fails when a committed file differs (ids are fixed).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const lib = await import(path.join(root, 'dist/node/headless.js'));
const { createCanvas } = require('@napi-rs/canvas');

const check = process.argv.includes('--check');

// ---------------------------------------------------------------- engine

const SKIP = new Set(['_index.json', '_text_syntax.json', 'libnames.json']);
const stencilFiles = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !SKIP.has(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const catalog = lib.buildCatalog([
  ...stencilFiles(path.join(root, 'stencils/core')),
  ...stencilFiles(path.join(root, 'stencils/builtin')),
]);

let seq = 0;
const ids = { next: () => `fx-${String(++seq).padStart(5, '0')}` };
const clock = { now: () => Date.UTC(2026, 9, 19) };
const runtime = lib.createNodeRuntime({ canvas: { createCanvas: (w, h) => createCanvas(w, h) }, catalog, ids, clock });
const scheduler = {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  requestFrame: () => 0,
  cancelFrame: () => undefined,
};
const images = {
  request: () => undefined,
  ensure: (urls) => Promise.resolve({ loaded: [], missing: urls }),
  pin: () => () => undefined,
  get: () => undefined,
  decodeInline: () => Promise.reject(new Error('no images')),
};

/** One board: the semantic content → a serialized on-device `.lekh`. */
function board(content) {
  seq = 0;
  const s = new lib.BoardSession(runtime, { images, scheduler });
  const answer = lib.generate(s, content);
  if (answer.ok !== true) throw new Error(`generate refused ${content.name}: ${JSON.stringify(answer)}`);
  return s.serialize({ stamp: 'offline' });
}

// ---------------------------------------------------------------- content

const RECT = 'avabodh.basic.rectangle';
const A4 = { type: 'fixed', width: 21, height: 29.7, unit: 'cm' };

const node = (ref, cx, cy, width, height, text, style = {}, shape = RECT) => ({
  ref,
  shape,
  cx,
  cy,
  width,
  height,
  ...(text !== undefined ? { text } : {}),
  ...(Object.keys(style).length > 0 ? { style } : {}),
});

const SCRIPT_SAMPLES = [
  ['zh', '中文：快速的棕色狐狸跳过懒狗。'],
  ['ja', '日本語：いろはにほへと ちりぬるを'],
  ['ko', '한국어: 다람쥐 헌 쳇바퀴에 타고파'],
  ['ar', 'العربية: نص تجريبي للاختبار'],
  ['hi', 'हिन्दी: यह एक परीक्षण पाठ है'],
  ['emoji', 'Emoji: 😀 👍🏽 🇯🇵 👨‍👩‍👧 ✅'],
];
const CJK_PARAGRAPH =
  '这是一个没有空格的中文段落用于检查固定宽度的文本框是否在框内正确换行并且不会溢出到框外面去这一行应该被折成好几行';

function scriptsBoard() {
  const nodes = SCRIPT_SAMPLES.map(([id, text], i) =>
    node(id, 220, 60 + i * 80, 360, 60, text, { font_family: 'Noto Sans', font_size: 18 }),
  );
  nodes.push(node('cjk_box', 220, 620, 180, 200, CJK_PARAGRAPH, { font_family: 'Noto Sans', font_size: 16 }));
  nodes.push(
    node('mixed', 220, 800, 360, 80, 'Latin + 中文 + العربية + हिन्दी + 😀 in one shape', {
      font_family: 'Noto Sans',
      font_size: 16,
    }),
  );
  return { name: 'scripts', pages: [{ name: 'Scripts', nodes }] };
}

function exportMatrixBoard() {
  const fonts = ['Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'Caveat'];
  const page1 = fonts.map((f, i) =>
    node(`font${i}`, 300, 120 + i * 110, 420, 80, `${f}: The quick brown fox 0123`, { font_family: f, font_size: 20 }),
  );
  page1.push(
    node('bold', 300, 600, 420, 60, 'Bold italic underline', {
      font_weight: 'bold',
      font_style: 'italic',
      text_decoration: ['underline'],
      font_size: 20,
    }),
  );
  const page2 = [];
  const colors = ['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#00acc1'];
  for (let i = 0; i < 6; i++) {
    page2.push(
      node(`s${i}`, 120 + (i % 3) * 180, 140 + Math.floor(i / 3) * 200, 140, 100, `Shape ${i + 1}`, {
        fill: colors[i],
        stroke: '#212121',
        stroke_width: 1 + i,
        ...(i % 2 === 1 ? { dash_array: [8, 4] } : {}),
      }),
    );
  }
  const edges = [
    { from: 's0', to: 's1', texts: [{ text: 'a → b' }] },
    { from: 's1', to: 's2' },
    { from: 's3', to: 's4', edge_type: 'orthogonal' },
    { from: 's0', to: 's4', texts: [{ text: 'diagonal' }] },
  ];
  const page3 = SCRIPT_SAMPLES.map(([id, text], i) =>
    node(`p3_${id}`, 300, 100 + i * 90, 440, 64, text, { font_family: 'Noto Sans', font_size: 18 }),
  );
  return {
    name: 'export-matrix',
    pages: [
      { name: 'Fonts', canvas: A4, nodes: page1 },
      { name: 'Shapes', canvas: A4, nodes: page2, edges },
      { name: 'Scripts', canvas: A4, nodes: page3 },
    ],
  };
}

/** The wrap corpus (DEV-75): each case at each width, in Noto Sans 16. */
export const WRAP_WIDTHS = [60, 90, 120, 180, 240, 360];
export const WRAP_CASES = [
  ['cjk', '日本語の文章は単語の間に空白がないので任意の文字の間で改行できます。中文也是一样的。'],
  ['thai', 'ภาษาไทยไม่มีการเว้นวรรคระหว่างคำจึงต้องตัดคำตามพจนานุกรม'],
  ['mixed', 'Lekh は whiteboard アプリ with 中文 text and English words mixed together.'],
  ['kinsoku', '「これは括弧の中です。」句読点、は行頭に来てはいけません！（括弧）も同じです。'],
  ['overlong', 'Supercalifragilisticexpialidocious pneumonoultramicroscopicsilicovolcanoconiosis end'],
  ['hyphen', 'state-of-the-art well-known self-explanatory long-term up-to-date words'],
  ['url', 'See https://example.com/a/very/long/path/that/keeps/going?query=1&other=two for details'],
];

function wrapCorpusBoard() {
  const nodes = [];
  WRAP_CASES.forEach(([id, text], row) => {
    let x = 20;
    WRAP_WIDTHS.forEach((w) => {
      nodes.push(
        node(`${id}_${w}`, x + w / 2, 180 + row * 380, w, 340, text, { font_family: 'Noto Sans', font_size: 16 }),
      );
      x += w + 20;
    });
  });
  return { name: 'wrap-corpus', pages: [{ name: 'Wrap corpus', nodes }] };
}

function wrapCorpusJson() {
  return {
    note: 'Synthetic wrap corpus (verification 06 DEV-75, H-TXT-2). One object per case and width on wrap-corpus.lekh, ref <case>_<width>; font Noto Sans 16 px.',
    font: { family: 'Noto Sans', size: 16 },
    widths: WRAP_WIDTHS,
    cases: WRAP_CASES.map(([id, text]) => ({ id, text })),
  };
}

function perfBoard() {
  const nodes = [];
  const edges = [];
  const COLS = 24;
  const ROWS = 20;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ref = `n${r}_${c}`;
      nodes.push(node(ref, 80 + c * 140, 60 + r * 110, 100, 60, `Node ${r * COLS + c + 1}`, { font_size: 12 }));
      if (c > 0 && (r + c) % 2 === 0) edges.push({ from: `n${r}_${c - 1}`, to: ref });
      if (r > 0 && c % 3 === 0) edges.push({ from: `n${r - 1}_${c}`, to: ref });
    }
  }
  return { name: 'perf', pages: [{ name: 'Perf', nodes, edges }] };
}

function folderBoards() {
  const small = (name, n) => ({
    name,
    pages: [
      { nodes: Array.from({ length: n }, (_, i) => node(`a${i}`, 100 + i * 150, 100, 120, 70, `${name} ${i + 1}`)) },
    ],
  });
  return [
    ['folder-board-1.lekh', board(small('Folder board 1', 3))],
    ['folder-board-2.lekh', board(small('Folder board 2', 4))],
    ['folder-board-3.lekh', board(small('Folder board 3', 2))],
    ['folder-board-4-malformed.lekh', MALFORMED],
  ];
}

const MALFORMED = '{"info":{"version":"5.0","name":"malformed"},"pages":{"p1":{"objects":{"o1":{"type":"shape",';

// ---------------------------------------------------------------- huge image

function crc32(buf) {
  return zlib.crc32(buf) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A 1-bit grayscale PNG, all white, `w` × `h` (deflated rows of zeros compress ~1000:1). */
function hugePng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rowBytes = 1 + Math.ceil(w / 8);
  const row = Buffer.alloc(rowBytes, 0xff);
  row[0] = 0; // filter none
  const raw = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) row.copy(raw, y * rowBytes);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- write

const out = new Map([
  ['scripts.lekh', board(scriptsBoard())],
  ['export-matrix.lekh', board(exportMatrixBoard())],
  ['wrap-corpus.lekh', board(wrapCorpusBoard())],
  ['wrap-corpus.json', await require('prettier').format(JSON.stringify(wrapCorpusJson()), { parser: 'json' })],
  ['perf.lekh', board(perfBoard())],
  ['malformed.lekh', MALFORMED],
  ...folderBoards().map(([n, b]) => [`export-folder/${n}`, b]),
  ['huge-image.png', hugePng(30000, 30000)],
]);

let bad = 0;
for (const [name, body] of out) {
  const file = path.join(here, name);
  const data = typeof body === 'string' ? Buffer.from(body.endsWith('\n') ? body : body + '\n', 'utf8') : body;
  if (check) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (cur === null || !cur.equals(data)) {
      console.error(`differs: ${name}`);
      bad++;
    }
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`${name}  ${data.length} bytes`);
}
if (bad > 0) process.exit(1);
