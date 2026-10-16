// The recognizer pipeline against the C++ (task R2, spec 07 §7.3/§7.5): synthetic line sets through
// `Recognizer.process()` against an empty scene, compared with test/recognizer/golden/pipeline.json,
// which parity/tools/pipeline-golden/regen.mjs captures from the C++ `Recognizer::process()` built
// with doubles and PI = π. Every stage after line segmentation runs: in-order polys and paths
// (shapes/, paths/), the specialists (which find nothing to attach to in an empty scene), closed-shape
// detection (ShapeAggregator, C1), path extension, PathProcessor, PolyMatcher and the regularizer.
//
// Variants: `fixed` (C1 and C2 fixed: the TS default), `legacy` (the C++ as is: TS with both
// quirks), and `chordCost` (`fixed` with a chord-distance `getCost` in place of the stub's 0,
// which reaches the polygon and regularizer branches the stub's all-smooth polys skip).
// Discrete outcomes are exact; coordinates within the §7.5 tolerance.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GeoShapeType, LineEquation, Point, type GeoShape, type Rect, type SimplePath } from '../../../src/geometry';
import {
  createRecognizerContext,
  RECOGNIZER_CONFIG_DEFAULTS,
  type RecognizerConfig,
  type RecognizerQuirks,
} from '../../../src/recognizer/core';
import { Recognizer } from '../../../src/recognizer/core/Recognizer';
import type {
  ExistingShape,
  ObjectForConnection,
  ArrowObjectInfo,
} from '../../../src/recognizer/delegate/CanvasDelegate';
import type { RecShapeDTO } from '../../../src/recognizer/delegate/RecMutation';
import {
  RecordingCanvasDelegate,
  shapeToDTO,
  type SceneQueries,
} from '../../../src/recognizer/delegate/RecordingCanvasDelegate';
import { RangeNumber, stubLineAggregatorModule, type LineAggregatorModule } from '../../../src/recognizer/lines';
import type { Points, StrokeLine } from '../../../src/recognizer/lines/StrokeLine';
import {
  closedPolygon,
  ellipse,
  hatch,
  openPolyline,
  overtrace,
  rect,
  rectTwice,
  scribble,
  spiral,
  triangle,
  zigzag,
  type LineSet,
} from '../support/lineSets';

type XY = [number, number];
interface GPath {
  closed: boolean;
  c: { curve: boolean; p: XY[] }[];
}
type GShape =
  | { kind: 'ellipse'; center: XY; width: number; height: number; rotation: number; snap: boolean }
  | { kind: 'path'; path: GPath; snap: boolean };
interface GCase {
  name: string;
  lines: number;
  mutations: { op: string; shapes: GShape[] }[];
  convex: boolean;
  needRegularization: boolean;
  matcherPoints: XY[];
  paths: GPath[];
  shapes: GShape[];
}
interface Golden {
  fixed: GCase[];
  legacy: GCase[];
  chordCost: GCase[];
}

const golden = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'golden', 'pipeline.json'), 'utf8'),
) as Golden;

// ---- the case sets (harness.cpp `main`)
const P = (x: number, y: number): Point => new Point(x, y);

function arc(name: string, c: Point, r: number, a0: number, a1: number, k: number, closeIt: boolean): LineSet {
  const v: Point[] = [];
  for (let i = 0; i <= k; i++) {
    const a = a0 + ((a1 - a0) * i) / k;
    v.push(P(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  }
  return closeIt ? closedPolygon(name, v.slice(0, -1)) : openPolyline(name, v);
}

function regular(n: number, c: Point, r: number, rot: number): Point[] {
  const v: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (2 * Math.PI * i) / n;
    v.push(P(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  }
  return v;
}

const PI = Math.PI;
const CASES: (() => LineSet)[] = [
  rect,
  triangle,
  () => ellipse(8),
  () => ellipse(12),
  () => ellipse(16),
  rectTwice,
  () => spiral(10),
  () => spiral(15),
  () => overtrace(10),
  () => scribble(12, 1234),
  () => zigzag(6),
  () => zigzag(25),
  () => hatch(8),
  () => closedPolygon('square', [P(100, 100), P(200, 100), P(200, 200), P(100, 200)]),
  () => closedPolygon('parallelogram', [P(100, 100), P(240, 100), P(200, 180), P(60, 180)]),
  () => closedPolygon('diamond', [P(200, 100), P(280, 180), P(200, 260), P(120, 180)]),
  () => closedPolygon('nearRect', [P(101, 99), P(243, 103), P(240, 191), P(98, 186)]),
  () => closedPolygon('pentagon', regular(5, P(300, 300), 80, -PI / 2)),
  () => closedPolygon('hexagon', regular(6, P(300, 300), 80, 0)),
  () => closedPolygon('octagon', regular(8, P(300, 300), 80, PI / 8)),
  () => closedPolygon('tri2', [P(100, 100), P(260, 120), P(150, 230)]),
  () => arc('circle10', P(300, 300), 60, 0, 2 * PI, 10, true),
  () => arc('smallCircle7', P(300, 300), 18, 0, 2 * PI, 7, true),
  () => openPolyline('line', [P(100, 100), P(260, 140)]),
  () => openPolyline('L', [P(100, 100), P(100, 220), P(220, 220)]),
  () => openPolyline('U', [P(100, 100), P(100, 220), P(220, 220), P(220, 100)]),
  () => openPolyline('Z', [P(100, 100), P(220, 100), P(100, 220), P(220, 220)]),
  () => openPolyline('gapRect', [P(110, 100), P(220, 100), P(220, 180), P(100, 180), P(100, 112)]),
  () => openPolyline('gapTriangle', [P(100, 200), P(160, 96), P(220, 200), P(112, 200)]),
  () => openPolyline('star5', [P(100, 300), P(200, 50), P(300, 300), P(60, 140), P(340, 140), P(100, 300)]),
  () => openPolyline('chevron', [P(100, 100), P(180, 160), P(100, 220)]),
  () => arc('arc6', P(300, 300), 100, PI, 2 * PI, 6, false),
  () => arc('arc12', P(300, 300), 100, PI, 1.8 * PI, 12, false),
  () => arc('arc270', P(300, 300), 80, 0, 1.5 * PI, 12, false),
  () => arc('nearlyClosedArc', P(300, 300), 80, 0.1, 2 * PI - 0.15, 14, false),
];

// ---- the line aggregators: the set's lines as given; the stub's statics, or the chord cost
function setModule(set: LineSet, getCost: LineAggregatorModule['getCost']): LineAggregatorModule {
  return {
    id: 'test-lineset',
    create: () => {
      const lines: StrokeLine[] = set.lines();
      return {
        setPoints: () => undefined,
        process: () => undefined,
        lines: () => lines,
        reset: () => undefined,
        minCost: () => 0,
        setMinCost: () => undefined,
      };
    },
    getCost,
    isSingleLine: (a, b) => stubLineAggregatorModule.isSingleLine(a, b),
  };
}

/** The C++ patched `LineAggregator::getCost` of the chordCost variant. */
function chordCost(pts: Points): RangeNumber {
  let d = 0;
  if (pts.size > 2) {
    const eq = LineEquation.through(pts.first(), pts.last());
    for (let i = 1; i + 1 < pts.size; i++) d = Math.max(d, eq.getDistanceFrom(pts.at(i)));
  }
  return new RangeNumber(d, d);
}

// ---- the empty scene
const emptyScene: SceneQueries = {
  getExistingShapes: (): ExistingShape[] => [],
  getPathsNear: (): ExistingShape[] => [],
  getShapesForConnection: (): ObjectForConnection[] => [],
  isAutoConnectionPresent: () => false,
  getArrowObjects: (): ArrowObjectInfo[] => [],
  getIntersections: (): Point[] => [],
  currentStrokeWidth: () => 2,
  getZoom: () => 1,
  getShapeForSelfLoop: () => null,
  distanceToOutline: () => 1e9,
  isInsideShape: () => false,
  projectToOutline: (_o, p) => p,
  isInsideTitle: () => false,
  isInsideOtherObject: () => false,
  shapeCentre: () => new Point(),
  shapeBounds: (): Rect => {
    throw new Error('no objects');
  },
  placePath: () => false,
};

function run(set: LineSet, variant: keyof Golden): { rec: Recognizer; delegate: RecordingCanvasDelegate } {
  const quirks: RecognizerQuirks = variant === 'legacy' ? { legacyTakeOut: true, legacyWidthBug: true } : {};
  const config: RecognizerConfig = RECOGNIZER_CONFIG_DEFAULTS;
  const module = setModule(
    set,
    variant === 'chordCost' ? chordCost : (pts: Points) => stubLineAggregatorModule.getCost(pts),
  );
  const ctx = createRecognizerContext({ config, lineAggregator: module, quirks });
  const delegate = new RecordingCanvasDelegate(emptyScene);
  const rec = new Recognizer(ctx, delegate);
  rec.addPoints(set.points);
  rec.process();
  return { rec, delegate };
}

// ---- comparison (§7.5)
const PT_TOL = 0.05;
const CTRL_TOL = 0.25;
const ROT_TOL = 1e-3;

function expectNear(actual: number, expected: number, tol: number, where: string): void {
  if (!(Math.abs(actual - expected) <= tol)) {
    expect.fail(`${where}: ${String(actual)} vs ${String(expected)} (tolerance ${String(tol)})`);
  }
}

function expectPt(a: { x: number; y: number }, e: XY, tol: number, where: string): void {
  expectNear(a.x, e[0], tol, `${where}.x`);
  expectNear(a.y, e[1], tol, `${where}.y`);
}

function comparePath(a: Extract<RecShapeDTO, { kind: 'path' }>, e: GPath, where: string): void {
  expect(a.closed, `${where} closed`).toBe(e.closed);
  expect(a.components.map((c) => (c.curve ? 'C' : 'L')).join(''), `${where} components`).toBe(
    e.c.map((c) => (c.curve ? 'C' : 'L')).join(''),
  );
  a.components.forEach((c, i) => {
    const ec = e.c[i] as { curve: boolean; p: XY[] };
    if (c.curve) {
      expectPt(c.p1, ec.p[0] as XY, PT_TOL, `${where}[${String(i)}].p1`);
      expectPt(c.c1, ec.p[1] as XY, CTRL_TOL, `${where}[${String(i)}].c1`);
      expectPt(c.c2, ec.p[2] as XY, CTRL_TOL, `${where}[${String(i)}].c2`);
      expectPt(c.p2, ec.p[3] as XY, PT_TOL, `${where}[${String(i)}].p2`);
    } else {
      expectPt(c.p1, ec.p[0] as XY, PT_TOL, `${where}[${String(i)}].p1`);
      expectPt(c.p2, ec.p[1] as XY, PT_TOL, `${where}[${String(i)}].p2`);
    }
  });
}

function compareShape(a: RecShapeDTO, e: GShape, where: string): void {
  expect(a.kind, `${where} kind`).toBe(e.kind);
  expect(a.snap, `${where} snap`).toBe(e.snap);
  if (a.kind === 'ellipse' && e.kind === 'ellipse') {
    expectPt(a.center, e.center, PT_TOL, `${where}.center`);
    expectNear(a.width, e.width, PT_TOL, `${where}.width`);
    expectNear(a.height, e.height, PT_TOL, `${where}.height`);
    expectNear(a.rotation, e.rotation, ROT_TOL, `${where}.rotation`);
  } else if (a.kind === 'path' && e.kind === 'path') {
    comparePath(a, e.path, where);
  }
}

function pathDTO(p: SimplePath): Extract<RecShapeDTO, { kind: 'path' }> {
  const dto = shapeToDTO(asShape(p));
  if (dto.kind !== 'path') throw new Error('not a path');
  return dto;
}

function asShape(p: SimplePath): GeoShape {
  return { type: () => GeoShapeType.Path, path: () => p, snap: () => true } as unknown as GeoShape;
}

describe.each(['fixed', 'legacy', 'chordCost'] as const)('recognizer pipeline vs C++ (%s)', (variant) => {
  const cases = golden[variant];

  it('has every harness case', () => {
    expect(cases.length).toBe(CASES.length);
  });

  describe.each(CASES.map((make, i) => ({ make, i, name: (cases[i] as GCase).name })))('$name', ({ make, i }) => {
    const g = cases[i] as GCase;
    const set = make();

    it('is the same line set', () => {
      expect(set.name).toBe(g.name);
      expect(set.lines().length).toBe(g.lines);
    });

    it('emits the same mutations', () => {
      const { delegate } = run(set, variant);
      const muts = delegate.mutations();
      expect(muts.map((m) => m.op)).toEqual(g.mutations.map((m) => m.op));
      muts.forEach((m, k) => {
        const em = g.mutations[k] as { op: string; shapes: GShape[] };
        const shapes = m.op === 'add' ? m.shapes : m.op === 'convert' ? [m.shape] : [];
        expect(shapes.length, `mutation ${String(k)} shapes`).toBe(em.shapes.length);
        shapes.forEach((s, j) => {
          compareShape(s, em.shapes[j] as GShape, `${g.name} m${String(k)}s${String(j)}`);
        });
      });
    });

    it('leaves the same stage state', () => {
      const { rec } = run(set, variant);
      expect(rec.isConvex()).toBe(g.convex);
      expect(rec.regularizationNeeded()).toBe(g.needRegularization);
      expect(rec.matcherPoints().length).toBe(g.matcherPoints.length);
      rec.matcherPoints().forEach((p, k) => {
        expectPt(p, g.matcherPoints[k] as XY, PT_TOL, `matcher[${String(k)}]`);
      });
      expect(rec.paths().length).toBe(g.paths.length);
      rec.paths().forEach((p, k) => {
        comparePath(pathDTO(p), g.paths[k] as GPath, `path${String(k)}`);
      });
      expect(rec.shapes().length).toBe(g.shapes.length);
      rec.shapes().forEach((s, k) => {
        compareShape(shapeToDTO(s), g.shapes[k] as GShape, `shape${String(k)}`);
      });
    });
  });
});

describe('the stub and the empty-lines guard (B2)', () => {
  it('a stroke with no lines is plain ink of the pre-processed points', () => {
    const ctx = createRecognizerContext({
      config: RECOGNIZER_CONFIG_DEFAULTS,
      lineAggregator: stubLineAggregatorModule,
    });
    const delegate = new RecordingCanvasDelegate(emptyScene);
    const rec = new Recognizer(ctx, delegate);
    rec.addPoints([P(0, 0), P(10, 0), P(20, 5), P(30, 10)]);
    rec.process();
    const muts = delegate.mutations();
    expect(muts.map((m) => m.op)).toEqual(['ink']);
    const ink = muts[0];
    if (ink?.op !== 'ink') throw new Error('expected ink');
    expect(ink.points.length).toBe(rec.strokePoints().length * 2);
  });

  it('more than 25 lines is plain ink', () => {
    const set = zigzag(26);
    const ctx = createRecognizerContext({
      config: RECOGNIZER_CONFIG_DEFAULTS,
      lineAggregator: setModule(set, (pts) => stubLineAggregatorModule.getCost(pts)),
    });
    const delegate = new RecordingCanvasDelegate(emptyScene);
    const rec = new Recognizer(ctx, delegate);
    rec.addPoints(set.points);
    rec.process();
    expect(delegate.mutations().map((m) => m.op)).toEqual(['ink']);
  });
});
