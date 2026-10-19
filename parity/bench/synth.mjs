// Synthetic boards for the perf runs (verification 03 §2, S-syn; Work 01M4X7TCHFB862XGT68GPY071C,
// F2 for P-07a). Deterministic from a seed (mulberry32), no customer data. A first cut: the mixes
// P-07a needs, written as JSON in the C++ 4.2 shape the readers accept.
//
//   basic    rectangles (plain and dashed) with one-line labels, 10 % of objects connectors
//   image    the basic mix with one synthetic PNG image (256–2,048 px, base64, offline-board style)
//            per 20 objects
//   diagram  rectangles (plain and dashed) and text boxes with multi-line labels, connectors (generic line
//            and multi-line, labelled) between 40 % of the shapes
//   ink      the basic mix with 30 % of the shapes as freehand strokes (unrecognised ink, as the
//            C++ apps write it) of 50–400 points, a seeded random walk normalised to the stroke's box
//
// Not yet: groups and the 5 % Lua wireframe shapes of verification 03 §2's diagram mix.
//
// Usage: node parity/bench/synth.mjs <mix> <objects> [--pages N] [--seed S] > board.lekh
//        import { synthBoard } from './synth.mjs'
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// pngjs ships no types; required untyped.
/** @type {any} */
const { PNG } = createRequire(import.meta.url)('pngjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @param {number} seed */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RECT = {
  data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
  default: { angle: 0, height: 10, width: 10 },
  draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 0 1' }],
  flags: 31,
  id: 'avabodh.basic.rectangle',
  polygon: true,
};
const ARROW = {
  data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', '0'],
  default: { angle: 0, height: 9, width: 6 },
  draw: [{ path: 'M 0 1 L 2 3 L 4 5 Z' }],
  id: 'avabodh.arrow.str',
  style: { fillpaint: { color: -1, type: 2 } },
};
const WORDS = (
  'server client queue cache store gateway user order invoice payment report audit token stream ' +
  'worker index search shard backup replica router policy review approve ship deliver'
).split(' ');

/** A signed ARGB integer, opaque. @param {() => number} rnd */
const color = (rnd) => 0xff000000 | (Math.floor(rnd() * 0xffffff) & 0xffffff) | 0;

/** @param {() => number} rnd @param {number} n */
const words = (rnd, n) => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)] ?? 'node').join(' ');

/** A blocky PNG (compresses well) of `w × h`, base64. @param {() => number} rnd @param {number} w @param {number} h */
function pngBase64(rnd, w, h) {
  const png = new PNG({ width: w, height: h });
  const block = 32 + Math.floor(rnd() * 96);
  const cols = Array.from({ length: 6 }, () => [rnd() * 255, rnd() * 255, rnd() * 255].map(Math.floor));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cols[(Math.floor(x / block) + 2 * Math.floor(y / block)) % cols.length] ?? [0, 0, 0];
      const i = (y * w + x) * 4;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png).toString('base64');
}

/**
 * A freehand stroke of 50–400 points: a smooth random walk, normalised to 0..1 in its box (the
 * unrecognised-ink form of a C++ board). @param {() => number} rnd
 */
function inkPoints(rnd) {
  const n = 50 + Math.floor(rnd() * 351);
  let x = 0;
  let y = 0;
  let a = rnd() * 2 * Math.PI;
  const raw = [];
  for (let i = 0; i < n; i++) {
    a += (rnd() - 0.5) * 0.6;
    x += Math.cos(a);
    y += Math.sin(a);
    raw.push([x, y]);
  }
  const xs = raw.map((p) => p[0] ?? 0);
  const ys = raw.map((p) => p[1] ?? 0);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const r6 = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
  return raw.map(([px = 0, py = 0]) => ({ x: r6((px - x0) / (x1 - x0 || 1)), y: r6((py - y0) / (y1 - y0 || 1)) }));
}

/**
 * @param {'basic' | 'image' | 'diagram' | 'ink'} mix
 * @param {number} objects   objects in all (connectors included), split evenly over the pages
 * @param {{ seed?: number, pages?: number, size?: number }} [opts]  size: page side in points (6,000)
 */
export function synthBoard(mix, objects, opts = {}) {
  const rnd = mulberry32(opts.seed ?? 1);
  const pages = Math.max(1, opts.pages ?? 1);
  const side = opts.size ?? 6000;
  let id = 0;
  const nextId = () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}`;
  const imageCache = [];
  /** @type {Record<string, object>} */
  const outPages = {};
  for (let p = 0; p < pages; p++) {
    const n = Math.floor(objects / pages) + (p < objects % pages ? 1 : 0);
    const connectorShare = mix === 'diagram' ? 0.4 / 1.4 : 0.1;
    const nConn = Math.floor(n * connectorShare);
    const nShapes = n - nConn;
    /** @type {Record<string, any>} */
    const objs = {};
    /** @type {string[]} */
    const shapeIds = [];
    let order = 0;
    const grid = Math.ceil(Math.sqrt(nShapes));
    const cell = side / grid;
    for (let k = 0; k < nShapes; k++) {
      const oid = nextId();
      const gx = k % grid;
      const gy = Math.floor(k / grid);
      const w = Math.min(cell * 0.7, 60 + rnd() * 120);
      const h = Math.min(cell * 0.6, 30 + rnd() * 60);
      const cx = Math.round((gx + 0.5) * cell + (rnd() - 0.5) * cell * 0.1);
      const cy = Math.round((gy + 0.5) * cell + (rnd() - 0.5) * cell * 0.1);
      const params = { angle: 0, cx, cy, width: Math.round(w), height: Math.round(h) };
      if (mix === 'image' && k % 20 === 0) {
        if (imageCache.length < 8) {
          const px = [256, 512, 1024, 2048][Math.floor(rnd() * 4)] ?? 256;
          imageCache.push({ px, data: pngBase64(rnd, px, Math.round(px * 0.75)) });
        }
        const img = imageCache[Math.floor(rnd() * imageCache.length)] ?? imageCache[0] ?? { data: '' };
        objs[oid] = {
          type: 'templated',
          name: 'Image',
          order: ++order,
          params: { ...params, width: Math.round(w * 1.4), height: Math.round(w * 1.05) },
          template: {
            id: 'avabodh.basic.image',
            texts: '',
            images: [{ location: '0 1 2 3 4 0', data: img.data, format: 'png' }],
            primitive_for_distance: false,
            primitive_for_intersection: false,
            primitive_for_inside: false,
            data: ['0', '0', 'w', 'h', '0'],
            draw: [],
          },
        };
        continue;
      }
      if (mix === 'ink' && k % 10 < 3) {
        objs[oid] = { type: 'avabodh.basic.unrecognized', order: ++order, params, text: '', points: inkPoints(rnd) };
        continue;
      }
      const kind = mix === 'diagram' ? k % 3 : k % 2;
      const label = mix === 'diagram' ? `${words(rnd, 2)}\n${words(rnd, 1 + Math.floor(rnd() * 2))}` : words(rnd, 1);
      const style = {
        fillpaint: { color: color(rnd), type: 2 },
        strokewidth: 1 + Math.floor(rnd() * 3),
        fontsize: 12 + Math.floor(rnd() * 8),
      };
      if (kind === 2) {
        objs[oid] = {
          type: 'templated',
          name: 'Text',
          order: ++order,
          params,
          style: { fontsize: style.fontsize, fontfamily: 'Noto Sans' },
          template: {
            id: 'avabodh.basic.text',
            texts: [{ location: 'default', text: label }],
            images: '',
            primitive_for_distance: false,
            primitive_for_intersection: false,
            primitive_for_inside: false,
            data: [],
            draw: [],
          },
        };
      } else {
        // Kind 1: a dashed, thicker-bordered rectangle (the embedded templates are self-contained).
        if (kind === 1) Object.assign(style, { strokewidth: 3, dasharray: [6, 3] });
        const tmpl = RECT;
        objs[oid] = {
          type: 'templated',
          name: '',
          order: ++order,
          params,
          style,
          template: { ...tmpl, texts: [{ location: 'default', text: label }] },
        };
      }
      shapeIds.push(oid);
    }
    for (let c = 0; c < nConn && shapeIds.length > 1; c++) {
      const a = Math.floor(rnd() * shapeIds.length);
      // A near neighbour (same row or the next), so connectors stay short.
      let b = a + 1 + Math.floor(rnd() * 2) * grid;
      if (b >= shapeIds.length) b = a - 1;
      const oid = nextId();
      objs[oid] = {
        arrows: { end: ARROW },
        ctype: c % 2 === 0 ? 2 : 1,
        order: ++order,
        params: [
          { angle: 0, autotype: c % 2 === 0 ? 4 : 1, dx: 0, dy: 0, step: 40 },
          { angle: 0, dx: 0, dy: 0, step: 40 },
        ],
        source: shapeIds[a],
        target: shapeIds[Math.max(0, b)],
        text: '',
        texts: mix === 'diagram' && c % 3 === 0 ? [{ param: 0.5, text: words(rnd, 1) }] : [],
        type: 'avabodh.basic.connection',
      };
    }
    outPages[`10000000-0000-4000-8000-${(p + 1).toString(16).padStart(12, '0')}`] = {
      name: `Page ${String(p + 1)}`,
      order: p + 1,
      canvassizetype: 'infinite',
      canvasname: 'Infinite',
      size: { width: 0, height: 0, unit: 'point' },
      background: { color: -1 },
      objects: objs,
    };
  }
  return {
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: `S-syn ${mix} ${String(objects)}`, version: '4.2' },
    pages: outPages,
  };
}

/** The committed sets (sets.json): name → { mix, objects, pages, seed }. */
export function sets() {
  return JSON.parse(readFileSync(path.join(HERE, 'sets.json'), 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mix, n, ...rest] = process.argv.slice(2);
  const opt = (/** @type {string} */ k, /** @type {number} */ d) => {
    const i = rest.indexOf(k);
    return i >= 0 ? Number(rest[i + 1]) : d;
  };
  if (mix === undefined || n === undefined) {
    process.stderr.write('usage: synth.mjs <basic|image|diagram|ink> <objects> [--pages N] [--seed S]\n');
    process.exit(2);
  }
  process.stdout.write(
    JSON.stringify(
      synthBoard(/** @type {any} */ (mix), Number(n), { pages: opt('--pages', 1), seed: opt('--seed', 1) }),
    ),
  );
}
