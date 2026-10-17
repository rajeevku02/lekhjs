// The recognizer parity corpus (spec 07 §7.2): synthetic, seeded strokes over a few scene boards,
// written as JSON into test/recognizer/corpus/ (committed; no user data). Deterministic: the same
// seeds give byte-identical files.
//
//   node parity/tools/rec-parity/corpus.mjs            writes test/recognizer/corpus/{strokes,scenes}.json
//
// A case is `{ name, origin, scene, view: {zoom, tx, ty}, strokeWidth, points: [x0, y0, x1, y1, …] }`
// in view px with the canvas displacement removed (what `__lekhTest.recognizeStroke` and the TS
// `recognizeStroke` both take). `scene` names a board in scenes.json. `origin` is `synthetic` for
// generated strokes and `seed` for the two strokes taken from the C++ sources. Developer-drawn
// strokes (`dev`, OQ-48) are added as their own files under test/recognizer/corpus/dev/ by the
// developer who recorded them; none exist yet.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const OUT = path.join(PKG, 'test', 'recognizer', 'corpus');

/** @typedef {[number, number]} Pt */
/** @typedef {{ zoom?: number, tx?: number, ty?: number, step?: number, wobble?: number, noise?: number }} SceneOpts */

/** Park-Miller LCG, as test/recognizer/support/lineSets.ts. */
class Lcg {
  /** @param {number} seed */
  constructor(seed) {
    this.s = seed % 2147483647 || 1;
  }
  next() {
    this.s = (this.s * 48271) % 2147483647;
    return this.s / 2147483647;
  }
  /** @param {number} a @param {number} b */
  range(a, b) {
    return a + (b - a) * this.next();
  }
}

const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// Scene boards (format 4.2, as the C++ apps write them). Ids are short and fixed.

/** @param {number} order @param {number} cx @param {number} cy @param {number} w @param {number} h */
function rectObject(order, cx, cy, w, h, angle = 0) {
  return {
    name: '',
    order,
    params: { angle, cx, cy, height: h, width: w },
    template: {
      data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
      default: { angle: 0, height: 10, width: 10 },
      draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 0 1' }],
      flags: 31,
      id: 'avabodh.basic.rectangle',
      polygon: true,
    },
    type: 'templated',
  };
}

/** @param {number} order @param {number} cx @param {number} cy @param {number} w @param {number} h */
function ellipseObject(order, cx, cy, w, h) {
  return {
    name: '',
    order,
    params: { angle: 0, cx, cy, height: h, width: w },
    template: {
      default: { angle: 0, height: 10, width: 10 },
      draw: [{ ellipse: { cx: '0', cy: '0', rx: 'w/2', ry: 'h/2' } }],
      flags: 31,
      id: 'avabodh.basic.ellipse',
    },
    type: 'templated',
  };
}

/** @param {Record<string, unknown>} objects */
function board(objects) {
  return {
    attributes: { grid: { present: true }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: {
      p1: {
        background: { color: -1 },
        canvasname: 'Infinite',
        canvassizetype: 'infinite',
        name: 'Page 1',
        objects,
        order: 1,
      },
    },
  };
}

const SCENES = {
  empty: board({}),
  // Two boxes side by side: connectors, self-loops, closed shapes beside them.
  twoBoxes: board({ a1: rectObject(1, 250, 300, 160, 100), b1: rectObject(2, 750, 300, 160, 100) }),
  // Two boxes on a diagonal and an ellipse: curved and elbow connectors.
  diagonal: board({
    a1: rectObject(1, 200, 180, 140, 90),
    b1: rectObject(2, 700, 520, 140, 90),
    e1: ellipseObject(3, 700, 180, 150, 100),
  }),
  // A big container box: closed shapes drawn inside it.
  container: board({ c1: rectObject(1, 600, 400, 700, 500) }),
};

// ---------------------------------------------------------------------------------------------
// Stroke geometry.

/**
 * Points every `step` px along the polyline `v`.
 * @param {Pt[]} v @param {number} step @returns {Pt[]}
 */
function resample(v, step) {
  /** @type {Pt[]} */
  const out = [/** @type {Pt} */ (v[0])];
  for (let i = 1; i < v.length; i++) {
    const [ax, ay] = /** @type {Pt} */ (v[i - 1]);
    const [bx, by] = /** @type {Pt} */ (v[i]);
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/**
 * A parametric curve sampled densely (then resampled by arc length).
 * @param {(t: number) => Pt} f @returns {Pt[]}
 */
function curve(f, n = 400) {
  /** @type {Pt[]} */
  const out = [];
  for (let i = 0; i <= n; i++) out.push(f(i / n));
  return out;
}

/** @param {number} k @param {number} r @returns {Pt[]} */
function regular(k, r, rot = -Math.PI / 2) {
  /** @type {Pt[]} */
  const v = [];
  for (let i = 0; i <= k; i++) {
    const a = rot + (2 * Math.PI * i) / k;
    v.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return v;
}

/** Unit-size shapes centred at 0, as polylines (scaled later). */
/** @type {Record<string, (rnd: Lcg) => Pt[]>} */
const SHAPES = {
  line: () => [
    [-0.5, 0.1],
    [0.5, -0.1],
  ],
  vline: () => [
    [0, -0.5],
    [0.02, 0.5],
  ],
  L: () => [
    [-0.4, -0.5],
    [-0.4, 0.4],
    [0.5, 0.4],
  ],
  zig: () => [
    [-0.5, -0.3],
    [-0.1, 0.3],
    [0.2, -0.3],
    [0.5, 0.3],
  ],
  triangle: () => [
    [0, -0.5],
    [0.5, 0.4],
    [-0.5, 0.4],
    [0, -0.5],
  ],
  rightTriangle: () => [
    [-0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
  ],
  rectangle: () => [
    [-0.5, -0.3],
    [0.5, -0.3],
    [0.5, 0.3],
    [-0.5, 0.3],
    [-0.5, -0.3],
  ],
  square: () => [
    [-0.4, -0.4],
    [0.4, -0.4],
    [0.4, 0.4],
    [-0.4, 0.4],
    [-0.4, -0.4],
  ],
  parallelogram: () => [
    [-0.3, -0.3],
    [0.55, -0.3],
    [0.3, 0.3],
    [-0.55, 0.3],
    [-0.3, -0.3],
  ],
  diamond: () => [
    [0, -0.5],
    [0.45, 0],
    [0, 0.5],
    [-0.45, 0],
    [0, -0.5],
  ],
  pentagon: () => regular(5, 0.5),
  hexagon: () => regular(6, 0.5, 0),
  octagon: () => regular(8, 0.5, Math.PI / 8),
  circle: () => curve((t) => [0.5 * Math.cos(2 * Math.PI * t), 0.5 * Math.sin(2 * Math.PI * t)]),
  ellipse: () => curve((t) => [0.5 * Math.cos(2 * Math.PI * t), 0.28 * Math.sin(2 * Math.PI * t)]),
  tiltedEllipse: () =>
    curve((t) => {
      const x = 0.5 * Math.cos(2 * Math.PI * t);
      const y = 0.25 * Math.sin(2 * Math.PI * t);
      const a = 0.5;
      return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    }),
  arc: () => curve((t) => [0.5 * Math.cos(Math.PI * (1 + t)), 0.5 * Math.sin(Math.PI * (1 + t))]),
  sCurve: () => curve((t) => [t - 0.5, 0.25 * Math.sin(2 * Math.PI * t)]),
  bezier: () =>
    curve((t) => {
      const u = 1 - t;
      /** @type {Pt[]} */
      const p = [
        [-0.5, 0.3],
        [-0.2, -0.6],
        [0.2, 0.6],
        [0.5, -0.3],
      ];
      const c = (/** @type {number} */ i, /** @type {number} */ k) => /** @type {Pt} */ (p[i])[k] ?? 0;
      return /** @type {Pt} */ (
        [0, 1].map((k) => u * u * u * c(0, k) + 3 * u * u * t * c(1, k) + 3 * u * t * t * c(2, k) + t * t * t * c(3, k))
      );
    }),
  star: () => {
    /** @type {Pt[]} */
    const v = [];
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (4 * Math.PI * i) / 5;
      v.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
    }
    return v;
  },
  arrow: () => [
    [-0.5, 0],
    [0.5, 0],
    [0.35, -0.12],
    [0.5, 0],
    [0.35, 0.12],
  ],
  overtrace: () => {
    /** @type {Pt[]} */
    const v = [];
    for (let i = 0; i < 4; i++) v.push([-0.5, 0.02 * i], [0.5, -0.02 * i]);
    return v;
  },
  spiral: () => curve((t) => [0.5 * t * Math.cos(6 * Math.PI * t), 0.5 * t * Math.sin(6 * Math.PI * t)]),
  scribble: (rnd) => {
    /** @type {Pt[]} */
    const v = [];
    for (let i = 0; i < 12; i++) v.push([rnd.range(-0.5, 0.5), rnd.range(-0.5, 0.5)]);
    return v;
  },
  cloudLoop: () =>
    curve((t) => {
      const r = 0.4 + 0.08 * Math.sin(10 * Math.PI * t);
      return [r * Math.cos(2 * Math.PI * t), r * Math.sin(2 * Math.PI * t)];
    }),
};

/** Shapes that are closed (start = end): their start vertex and direction can vary. */
const CLOSED = new Set([
  'triangle',
  'rightTriangle',
  'rectangle',
  'square',
  'parallelogram',
  'diamond',
  'pentagon',
  'hexagon',
  'octagon',
  'circle',
  'ellipse',
  'tiltedEllipse',
  'star',
  'cloudLoop',
]);

/**
 * Rotate a closed polyline's start to vertex `k` (of the original vertices).
 * @param {Pt[]} v @param {number} k @returns {Pt[]}
 */
function startAt(v, k) {
  const body = v.slice(0, -1);
  const kk = k % body.length;
  const out = [...body.slice(kk), ...body.slice(0, kk)];
  out.push(/** @type {Pt} */ (out[0]));
  return out;
}

/**
 * A hand-drawn look: a slow wobble along the stroke (two sinusoids of the arc length, random
 * phases) plus per-point noise, and for closed shapes an end that overshoots or stops short.
 * @param {Pt[]} pts @param {Lcg} rnd
 * @param {{ wobble: number, noise: number, closeGap: number }} opts
 * @returns {Pt[]}
 */
function humanise(pts, rnd, { wobble, noise, closeGap }) {
  /** @type {Pt[]} */
  const out = [];
  const at = (/** @type {number} */ i) => /** @type {Pt} */ (pts[i]);
  let s = 0;
  const f1 = rnd.range(0.006, 0.012);
  const f2 = rnd.range(0.02, 0.04);
  const p1 = rnd.range(0, 2 * Math.PI);
  const p2 = rnd.range(0, 2 * Math.PI);
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(at(i)[0] - at(i - 1)[0], at(i)[1] - at(i - 1)[1]);
    const w = wobble * (Math.sin(f1 * s + p1) + 0.5 * Math.sin(f2 * s + p2));
    const n = (i === 0 ? 0 : 1) * noise;
    out.push([at(i)[0] + w + rnd.range(-n, n), at(i)[1] - w * 0.7 + rnd.range(-n, n)]);
  }
  if (closeGap !== 0 && out.length > 4) {
    const [ax, ay] = /** @type {Pt} */ (out[out.length - 2]);
    const [bx, by] = /** @type {Pt} */ (out[out.length - 1]);
    const d = Math.hypot(bx - ax, by - ay) || 1;
    out[out.length - 1] = [bx + ((bx - ax) / d) * closeGap, by + ((by - ay) / d) * closeGap];
  }
  return out;
}

/** @param {Pt[]} v @param {number} cx @param {number} cy @param {number} sx @param {number} sy @returns {Pt[]} */
function place(v, cx, cy, sx, sy) {
  return v.map(([x, y]) => [cx + x * sx, cy + y * sy]);
}

const flatten = (/** @type {Pt[]} */ pts) => pts.flatMap(([x, y]) => [r3(x), r3(y)]);

// ---------------------------------------------------------------------------------------------
// Cases.

const VARIANTS = [
  // scale (px), aspect, step (px), wobble, noise, closeGap, start vertex, reversed, zoom
  { size: 160, aspect: 1, step: 4, wobble: 0, noise: 0, gap: 0, start: 0, rev: false, zoom: 1 },
  { size: 160, aspect: 1, step: 4, wobble: 2, noise: 0.8, gap: 4, start: 1, rev: false, zoom: 1 },
  { size: 240, aspect: 1.4, step: 6, wobble: 3, noise: 1, gap: -6, start: 2, rev: true, zoom: 1 },
  { size: 90, aspect: 1, step: 3, wobble: 1.5, noise: 0.6, gap: 3, start: 0, rev: true, zoom: 1 },
  { size: 420, aspect: 0.8, step: 8, wobble: 5, noise: 1.5, gap: 10, start: 3, rev: false, zoom: 1 },
  { size: 160, aspect: 1, step: 12, wobble: 2, noise: 1, gap: 0, start: 1, rev: false, zoom: 1 },
  { size: 200, aspect: 1.2, step: 5, wobble: 2.5, noise: 1, gap: 5, start: 0, rev: false, zoom: 0.5 },
  { size: 200, aspect: 1.2, step: 5, wobble: 2.5, noise: 1, gap: -4, start: 2, rev: true, zoom: 2 },
  { size: 300, aspect: 1, step: 2, wobble: 4, noise: 0.4, gap: 8, start: 1, rev: true, zoom: 1 },
  { size: 130, aspect: 1.6, step: 5, wobble: 1, noise: 1.2, gap: -2, start: 4, rev: false, zoom: 1 },
  { size: 260, aspect: 1, step: 4, wobble: 3, noise: 0.8, gap: 6, start: 0, rev: false, zoom: 2, tx: 120, ty: -80 },
  { size: 180, aspect: 0.9, step: 6, wobble: 2, noise: 1, gap: 2, start: 3, rev: true, zoom: 0.5, tx: -60, ty: 40 },
];

/** @typedef {{ name: string, origin: string, scene: string, view: { zoom: number, tx: number, ty: number }, strokeWidth: number, points: number[] }} Case */

function strokeCases() {
  /** @type {Case[]} */
  const cases = [];
  let seed = 1000;
  for (const [shape, make] of Object.entries(SHAPES)) {
    VARIANTS.forEach((v, vi) => {
      const rnd = new Lcg(++seed * 7919);
      let base = make(rnd);
      if (CLOSED.has(shape) && v.start > 0 && base.length < 40) base = startAt(base, v.start);
      if (v.rev) base = base.slice().reverse();
      const cx = 600 + rnd.range(-80, 80);
      const cy = 400 + rnd.range(-60, 60);
      const placed = place(base, cx, cy, v.size * v.aspect, v.size);
      const pts = humanise(resample(placed, v.step), rnd, {
        wobble: v.wobble,
        noise: v.noise,
        closeGap: CLOSED.has(shape) ? v.gap : 0,
      });
      cases.push({
        name: `${shape}-v${String(vi).padStart(2, '0')}`,
        origin: 'synthetic',
        scene: 'empty',
        view: { zoom: v.zoom, tx: v.tx ?? 0, ty: v.ty ?? 0 },
        strokeWidth: 2,
        points: flatten(pts),
      });
    });
  }
  return cases;
}

/** Scene cases: strokes against existing objects (connectors, self-loops, shapes in a container). */
function sceneCases() {
  /** @type {Case[]} */
  const cases = [];
  let seed = 50000;
  /** @param {string} name @param {string} scene @param {Pt[]} poly @param {SceneOpts} opts */
  const add = (name, scene, poly, opts = {}) => {
    const rnd = new Lcg(++seed * 104729);
    const view = { zoom: opts.zoom ?? 1, tx: opts.tx ?? 0, ty: opts.ty ?? 0 };
    // Scene objects are in canvas coordinates; the stroke is drawn in view px.
    const toView = poly.map(([x, y]) => /** @type {Pt} */ ([x * view.zoom + view.tx, y * view.zoom + view.ty]));
    const pts = humanise(resample(toView, opts.step ?? 4), rnd, {
      wobble: opts.wobble ?? 1.5,
      noise: opts.noise ?? 0.6,
      closeGap: 0,
    });
    cases.push({ name, origin: 'synthetic', scene, view, strokeWidth: 2, points: flatten(pts) });
  };
  /** @type {SceneOpts[]} */
  const VIEWS = [{}, { zoom: 2, tx: -150, ty: -200 }, { zoom: 0.5, tx: 100, ty: 60 }];
  VIEWS.forEach((vw, i) => {
    const z = `z${i}`;
    // Connectors between the two boxes (centres 250,300 and 750,300; 160 x 100).
    add(
      `conn-straight-${z}`,
      'twoBoxes',
      [
        [260, 300],
        [740, 302],
      ],
      vw,
    );
    add(
      `conn-edge-to-edge-${z}`,
      'twoBoxes',
      [
        [335, 290],
        [665, 310],
      ],
      vw,
    );
    add(
      `conn-curved-${z}`,
      'twoBoxes',
      curve((t) => [260 + 480 * t, 300 - 160 * Math.sin(Math.PI * t)], 60),
      vw,
    );
    add(
      `conn-elbow-${z}`,
      'twoBoxes',
      [
        [250, 340],
        [250, 480],
        [750, 480],
        [750, 340],
      ],
      vw,
    );
    add(
      `conn-arrowhead-${z}`,
      'twoBoxes',
      [
        [260, 300],
        [740, 300],
        [715, 285],
        [740, 300],
        [715, 315],
      ],
      vw,
    );
    add(
      `conn-reverse-${z}`,
      'twoBoxes',
      [
        [745, 296],
        [255, 304],
      ],
      vw,
    );
    // Self-loops on box a1 (C++ SelfLoopRecognizer R1-R8 cases: out and back to the same box).
    add(
      `selfloop-curve-${z}`,
      'twoBoxes',
      curve(
        (t) => [300 + 110 * Math.sin(Math.PI * t), 260 - 120 * Math.sin(Math.PI * t) * Math.cos(Math.PI * t * 0.5)],
        60,
      ),
      vw,
    );
    add(
      `selfloop-ortho-${z}`,
      'twoBoxes',
      [
        [310, 250],
        [310, 170],
        [400, 170],
        [400, 280],
        [330, 280],
      ],
      vw,
    );
    add(
      `selfloop-small-${z}`,
      'twoBoxes',
      curve((t) => [320 + 40 * Math.sin(2 * Math.PI * t), 245 - 40 * Math.sin(Math.PI * t)], 40),
      vw,
    );
    // Diagonal scene: elbow, curve, box to ellipse.
    add(
      `diag-straight-${z}`,
      'diagonal',
      [
        [210, 190],
        [690, 510],
      ],
      vw,
    );
    add(
      `diag-elbow-${z}`,
      'diagonal',
      [
        [200, 230],
        [200, 520],
        [620, 520],
      ],
      vw,
    );
    add(
      `diag-to-ellipse-${z}`,
      'diagonal',
      [
        [270, 180],
        [630, 182],
      ],
      vw,
    );
    add(
      `diag-ellipse-to-box-${z}`,
      'diagonal',
      curve((t) => [700 + 30 * Math.sin(Math.PI * t), 240 + 230 * t], 40),
      vw,
    );
    // Strokes that miss the boxes: plain lines/shapes beside the scene.
    add(
      `beside-line-${z}`,
      'twoBoxes',
      [
        [200, 600],
        [800, 610],
      ],
      vw,
    );
    add(
      `beside-rect-${z}`,
      'twoBoxes',
      [
        [400, 550],
        [600, 550],
        [600, 680],
        [400, 680],
        [400, 552],
      ],
      vw,
    );
    // Shapes inside the container (600,400, 700 x 500).
    add(
      `inside-rect-${z}`,
      'container',
      [
        [400, 300],
        [560, 300],
        [560, 420],
        [400, 420],
        [400, 302],
      ],
      vw,
    );
    add(
      `inside-circle-${z}`,
      'container',
      curve((t) => [700 + 70 * Math.cos(2 * Math.PI * t), 450 + 70 * Math.sin(2 * Math.PI * t)], 80),
      vw,
    );
    add(
      `inside-line-${z}`,
      'container',
      [
        [350, 550],
        [850, 560],
      ],
      vw,
    );
    add(
      `inside-triangle-${z}`,
      'container',
      [
        [600, 250],
        [700, 420],
        [500, 420],
        [600, 252],
      ],
      vw,
    );
    add(
      `cross-container-${z}`,
      'container',
      [
        [150, 400],
        [1050, 400],
      ],
      vw,
    );
  });
  return cases;
}

/** The seeds from code (spec 07 §7.2). */
function seedCases() {
  // LekhUtil.cpp:807: the 64-point warm-up circle.
  /** @type {Pt[]} */
  const circle = [];
  for (let i = 0; i < 64; i++) {
    const a = (2 * Math.PI * i) / 64;
    circle.push([300 + 100 * Math.cos(a), 300 + 100 * Math.sin(a)]);
  }
  /** @type {Case[]} */
  const seeds = [
    {
      name: 'seed-warmup-circle',
      origin: 'seed',
      scene: 'empty',
      view: { zoom: 1, tx: 0, ty: 0 },
      strokeWidth: 2,
      points: flatten(circle),
    },
  ];
  // IntelligentDrawing.cpp:146: the commented-out "exposes bug in path aggregator" stroke.
  const src = path.join(PKG, '..', 'lekhcore', 'src', 'lekh', 'IntelligentDrawing.cpp');
  if (existsSync(src)) {
    const text = readFileSync(src, 'utf8');
    const at = text.indexOf('exposes bug in path aggregator');
    const block = at < 0 ? '' : text.slice(at, text.indexOf('*/', at));
    const pts = [...block.matchAll(/Point\((-?[\d.]+),(-?[\d.]+)\)/g)].map(
      (m) => /** @type {Pt} */ ([Number(m[1]), Number(m[2])]),
    );
    if (pts.length >= 2)
      seeds.push({
        name: 'seed-path-aggregator-bug',
        origin: 'seed',
        scene: 'empty',
        view: { zoom: 1, tx: 0, ty: 0 },
        strokeWidth: 2,
        points: flatten(pts),
      });
  }
  return seeds;
}

const cases = [...strokeCases(), ...sceneCases(), ...seedCases()];
mkdirSync(OUT, { recursive: true });
writeFileSync(
  path.join(OUT, 'strokes.json'),
  `${JSON.stringify({ about: 'Recognizer parity corpus (spec 07 §7.2), written by parity/tools/rec-parity/corpus.mjs. Synthetic and seeded only; no user strokes.', origin: 'synthetic', cases }, null, 0)}\n`,
);
writeFileSync(
  path.join(OUT, 'scenes.json'),
  `${JSON.stringify({ about: 'Scene boards of the recognizer parity corpus, written by parity/tools/rec-parity/corpus.mjs.', origin: 'synthetic', scenes: SCENES }, null, 1)}\n`,
);
console.log(
  `corpus: ${cases.length} cases (${cases.filter((c) => c.scene !== 'empty').length} on scenes) in ${path.relative(PKG, OUT)}`,
);
