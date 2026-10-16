// AC-REC-12: the port of lekhcore test/recognizer/SelfLoopRecognizerTest.cpp (23 cases), driving
// SelfLoopRecognizer against SnapshotCanvasDelegate (wrapped in RecordingCanvasDelegate) over a
// geometry SceneStore instead of LekhCanvasDelegate over the real ObjectStore. Same strokes, same
// assertions, same tolerances. Config boundary moves go through recognizerConfigWith (cumulative
// within a case, as the C++ Config edits are); zoom and scroll through the ViewTransform.
//
// Deferred: three cases also check the laid-out ROUTE of the created connection against the stroke
// (C++ `drawnRoute` via ConnectionObject::updateConnection) and the undo step. That needs the model's
// ConnectionObject (task E6) and the MutationApplier (task R3); those assertions are `it.todo`s
// below. Everything else in those cases (recognised, one connection added, a self-loop on S, its
// type and param count) is asserted here on the recorded `connect` mutation.
import { describe, expect, it } from 'vitest';
import { isPointInsidePolygon, getDistance, Point, SimplePath } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS, recognizerConfigWith, type RecognizerConfig } from '../../../src/recognizer/core';
import {
  snapshotDelegate,
  type ParamMap,
  type RecMutation,
  type RecordingCanvasDelegate,
  type ViewTransform,
} from '../../../src/recognizer/delegate';
import {
  SelfLoopKind,
  SelfLoopRecognizer,
  SelfLoopRule,
  type SelfLoopResult,
} from '../../../src/recognizer/specialists';
import { GeoScene, geoRect } from '../support/geoScene';

const kPi = Math.PI;
/** C++ ConnectionObject::Type. */
const Type = { Curve: 0, MultiLine: 2 } as const;

// S: 200 x 100 centred at (300, 300): x 200..400, y 250..350.
const kCentre = new Point(300, 300);
const kTopMid = new Point(300, 250);
const S = 'S';

/** Half an ellipse above (ry > 0) c: from (c.x - rx, c.y) over (c.x, c.y - ry) to (c.x + rx, c.y). */
function arch(c: Point, rx: number, ry: number, n = 48): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (kPi * i) / n;
    pts.push(new Point(c.x - rx * Math.cos(t), c.y - ry * Math.sin(t)));
  }
  return pts;
}

/** The polyline through `vertices`, a point every `step`. */
function polyline(vertices: readonly Point[], step = 4): Point[] {
  const v0 = vertices[0];
  if (v0 === undefined) return [];
  const pts: Point[] = [v0];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1] as Point;
    const b = vertices[i] as Point;
    const n = Math.max(1, Math.ceil(getDistance(a, b) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      pts.push(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  return pts;
}

/** The recognizer's path for a polyline stroke: one line per segment. */
function linesThrough(vertices: readonly Point[]): SimplePath {
  const sp = new SimplePath();
  for (let i = 1; i < vertices.length; i++) sp.addLine(vertices[i - 1] as Point, vertices[i] as Point);
  return sp;
}

function param(pm: ParamMap | undefined, name: string, def = -12345): number {
  return pm?.[name] ?? def;
}

function connects(mutations: readonly RecMutation[]): Extract<RecMutation, { op: 'connect' }>[] {
  return mutations.filter((m): m is Extract<RecMutation, { op: 'connect' }> => m.op === 'connect');
}

/** The C++ fixture: S in the store, the active view, and the Config. */
class Fixture {
  readonly scene = new GeoScene([geoRect(S, kCentre.x, kCentre.y, 200, 100)]);
  private overrides: Partial<RecognizerConfig> = {};
  private readonly zoom: number;
  private readonly scroll: Point;

  /** C++ `ActiveView(doc, zoom percent, scroll)`. */
  constructor(zoomPercent = 100, scroll = new Point(0, 0)) {
    this.zoom = zoomPercent / 100;
    this.scroll = scroll;
  }

  /** `Config::instance().x = v` (edits accumulate within a case, as there). */
  setConfig(o: Partial<RecognizerConfig>): void {
    this.overrides = { ...this.overrides, ...o };
  }

  config(): RecognizerConfig {
    return Object.keys(this.overrides).length === 0 ? RECOGNIZER_CONFIG_DEFAULTS : recognizerConfigWith(this.overrides);
  }

  viewTransform(): ViewTransform {
    return { zoom: this.zoom, tx: this.scroll.x * this.zoom, ty: this.scroll.y * this.zoom };
  }

  /** Canvas to view, as the recognizer receives points (the C++ test's `view`). */
  view(p: Point): Point {
    return new Point((p.x + this.scroll.x) * this.zoom, (p.y + this.scroll.y) * this.zoom);
  }
  viewAll(pts: readonly Point[]): Point[] {
    return pts.map((p) => this.view(p));
  }

  delegate(): RecordingCanvasDelegate {
    return snapshotDelegate({ store: this.scene, view: this.viewTransform(), strokeWidth: 2, config: this.config() });
  }

  recognizer(): SelfLoopRecognizer {
    return new SelfLoopRecognizer(this.config());
  }

  /** The C++ fixture's `evaluate(canvasStroke, path)`: the stroke mapped to view, the path as given. */
  evaluate(canvasStroke: readonly Point[], path: SimplePath | null = null): SelfLoopResult {
    return this.recognizer().evaluate(this.viewAll(canvasStroke), path, new Set(), this.delegate());
  }
}

describe('SelfLoopRecognizerTest (AC-REC-12)', () => {
  // ------------------------------------------------------------------ all pass

  it('SmoothLoopOnTheTopIsACurveLoop', () => {
    const fx = new Fixture();
    const r = fx.evaluate(arch(kTopMid, 40, 70));
    expect(r.failed).toBe(SelfLoopRule.None);
    expect(r.kind).toBe(SelfLoopKind.Curve);
    expect(r.detail.obj1).toBe(S);
    expect(r.detail.obj2).toBe(S);
    expect(r.detail.type).toBe(Type.Curve);
    expect(r.detail.params).toHaveLength(2);
    for (const pm of r.detail.params) {
      expect(param(pm, 'angleauto')).toBe(0);
      expect(param(pm, 'cdistauto')).toBe(0);
      expect(param(pm, 'cdist1')).toBeGreaterThan(0);
    }
    expect(Math.abs(param(r.detail.params[0], 'angle1') - Math.atan2(250 - 300, 260 - 300))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(param(r.detail.params[1], 'angle1') - Math.atan2(250 - 300, 340 - 300))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(r.excursion - 70)).toBeLessThanOrEqual(1);
  });

  describe('SmoothLoopIsAddedAndFollowsTheStroke', () => {
    it('is added as one self-loop curve connection on S', () => {
      const fx = new Fixture();
      const delegate = fx.delegate();
      expect(fx.recognizer().recognize(fx.viewAll(arch(kTopMid, 40, 70)), null, new Set(), delegate)).toBe(true);
      const cons = connects(delegate.mutations());
      expect(delegate.mutations()).toHaveLength(1);
      expect(cons).toHaveLength(1);
      const con = cons[0];
      expect(con?.obj1Id).toBe(S); // con->first() == shape
      expect(con?.obj2Id).toBe(S); // isSelfLoop()
      expect(con?.type).toBe(Type.Curve);
      expect(con?.deletedIds).toEqual([]);
    });
    // Needs ConnectionObject (task E6) and the MutationApplier + undo (task R3).
    it.todo(
      'E6/R3: the drawn route follows the stroke (mean distance <= 0.15 * 70) and the add is one undoable action',
    );
  });

  describe('SmoothLoopRoundACornerFollowsTheStrokeAtZoomTwo', () => {
    it('is added as one self-loop curve connection on S at zoom 2, scroll (-40, 25)', () => {
      const fx = new Fixture(200, new Point(-40, 25));
      // leaves the top near the right, round the top-right corner, into the right side
      const stroke: Point[] = [];
      for (let i = 0; i <= 48; i++) {
        const t = kPi + (1.5 * kPi * i) / 48; // from the left of the circle, clockwise
        stroke.push(new Point(400 + 45 * Math.cos(t), 250 + 45 * Math.sin(t)));
      }
      const delegate = fx.delegate();
      expect(fx.recognizer().recognize(fx.viewAll(stroke), null, new Set(), delegate)).toBe(true);
      const cons = connects(delegate.mutations());
      expect(cons).toHaveLength(1);
      expect(cons[0]?.obj1Id).toBe(S);
      expect(cons[0]?.obj2Id).toBe(S);
      expect(cons[0]?.type).toBe(Type.Curve);
    });
    // Needs ConnectionObject (task E6) and the MutationApplier (task R3).
    it.todo('E6/R3: the drawn route follows the stroke (mean distance <= 0.15 * 45)');
  });

  it('SquareLoopOnTheTopIsThreeStoredSegments', () => {
    const fx = new Fixture();
    const v = [new Point(260, 250), new Point(260, 200), new Point(340, 200), new Point(340, 250)];
    const r = fx.evaluate(polyline(v), linesThrough(v));
    expect(r.failed).toBe(SelfLoopRule.None);
    expect(r.kind).toBe(SelfLoopKind.Orthogonal);
    expect(r.detail.type).toBe(Type.MultiLine);
    expect(r.detail.autoType).toBe(0);
    expect(r.detail.params).toHaveLength(3);
    const p = r.detail.params;
    expect(param(p[0], 'autotype')).toBe(0);
    expect(param(p[0], 'dx')).toBe(0);
    expect(param(p[0], 'dy')).toBe(-1);
    expect(Math.abs(param(p[0], 'step') - 50)).toBeLessThanOrEqual(1);
    expect(param(p[1], 'dx')).toBe(1);
    expect(param(p[1], 'dy')).toBe(0);
    expect(Math.abs(param(p[1], 'step') - 80)).toBeLessThanOrEqual(1);
    expect(param(p[2], 'dx')).toBe(0);
    expect(param(p[2], 'dy')).toBe(1);
    expect(Math.abs(param(p[2], 'step') - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(param(p[0], 'angle') - Math.atan2(-50, -40))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(param(p[2], 'angle') - Math.atan2(-50, 40))).toBeLessThanOrEqual(0.02);
  });

  describe('SquareLoopRoundACornerIsFourSegmentsAndFollowsTheStroke', () => {
    // leaves the top, rounds the top-right corner, enters the right side
    const v = [new Point(360, 250), new Point(360, 210), new Point(440, 210), new Point(440, 290), new Point(400, 290)];
    it('is added as one self-loop MultiLine connection on S with four stored segments', () => {
      const fx = new Fixture();
      const delegate = fx.delegate();
      expect(fx.recognizer().recognize(fx.viewAll(polyline(v)), linesThrough(v), new Set(), delegate)).toBe(true);
      const cons = connects(delegate.mutations());
      expect(cons).toHaveLength(1);
      expect(cons[0]?.obj1Id).toBe(S);
      expect(cons[0]?.obj2Id).toBe(S);
      expect(cons[0]?.type).toBe(Type.MultiLine);
      expect(cons[0]?.params).toHaveLength(4);
    });
    // Needs ConnectionObject (task E6) and the MutationApplier (task R3).
    it.todo('E6/R3: the drawn route follows the stroke (mean distance <= 0.15 * 56.6)');
  });

  it('ParamsAreCanvasUnitsAtAnyZoomAndScroll', () => {
    const fx = new Fixture(200, new Point(15, -30));
    const v = [new Point(260, 250), new Point(260, 200), new Point(340, 200), new Point(340, 250)];
    const path = linesThrough(fx.viewAll(v));
    const r = fx.recognizer().evaluate(fx.viewAll(polyline(v)), path, new Set(), fx.delegate());
    expect(r.failed).toBe(SelfLoopRule.None);
    expect(r.kind).toBe(SelfLoopKind.Orthogonal);
    expect(r.detail.params).toHaveLength(3);
    expect(Math.abs(param(r.detail.params[0], 'step') - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(param(r.detail.params[1], 'step') - 80)).toBeLessThanOrEqual(1);
  });

  // ------------------------------------------------------------------ per rule

  it('R1EndsOnTwoShapesIsNotALoop', () => {
    const fx = new Fixture();
    fx.scene.add(geoRect('other', 560, 300, 100, 100)); // x 510..610
    // from S's top, over, down to the other shape's top
    const stroke = arch(new Point(455, 250), 115, 70);
    stroke[0] = new Point(340, 250);
    stroke[stroke.length - 1] = new Point(570, 250);
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R1);
  });

  it('R1EndInEmptySpaceIsNotALoop', () => {
    const fx = new Fixture();
    const stroke = arch(new Point(380, 250), 80, 70); // ends at (460, 250), 60 off S
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R1);
  });

  it('R2StartDeepInsideIsNotALoop', () => {
    const fx = new Fixture();
    const stroke = polyline([new Point(260, 300), new Point(260, 250)]);
    stroke.push(...arch(kTopMid, 40, 70).slice(1));
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R2);
    fx.setConfig({ connectObjectDistThreshold: 60 }); // the start is 50 from the outline
    expect(fx.evaluate(stroke).failed).not.toBe(SelfLoopRule.R2);
  });

  it('R3StrokeInsideTheShapeIsNotALoop', () => {
    const fx = new Fixture();
    // from just inside the top edge, down and across inside, back up
    const v = [new Point(220, 260), new Point(220, 320), new Point(380, 320), new Point(380, 260)];
    expect(fx.evaluate(polyline(v)).failed).toBe(SelfLoopRule.R3);
  });

  it('R4TinyFlickIsNotALoopAndTheBoundaryIsConfig', () => {
    const fx = new Fixture();
    const stroke = arch(kTopMid, 40, 12);
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R4);
    fx.setConfig({ selfLoopMinExcursion: 5, selfLoopMinExcursionRatio: 0.05 });
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.None);
  });

  it('R4HugeSweepIsNotALoop', () => {
    const fx = new Fixture();
    const stroke = arch(kTopMid, 60, 320); // h 320 > 1.5 * 200
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R4);
    fx.setConfig({ selfLoopMaxExcursionRatio: 2 });
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.None);
  });

  it('R4ShortStrokeIsNotALoop', () => {
    const fx = new Fixture();
    const stroke = arch(kTopMid, 22, 22); // ~ 69 long
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.None);
    fx.setConfig({ selfLoopMinStrokeLength: 80 });
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R4);
  });

  it('R5EndsTooCloseIsNotALoopAndTheBoundaryIsConfig', () => {
    const fx = new Fixture();
    const stroke = arch(kTopMid, 15, 70); // ends 30 apart
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R5);
    fx.setConfig({ selfLoopMinEndDistance: 20 });
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.None);
  });

  it('R6LassoRoundTheShapeIsNotALoop', () => {
    const fx = new Fixture();
    // up from the top, round the whole shape (an ellipse that contains it), back down to the top
    const rx = 150;
    const ry = 80;
    const t0 = -kPi / 2 - Math.asin(20 / rx); // above x = 280
    const stroke = polyline([new Point(280, 250), new Point(280, 300 + ry * Math.sin(t0))]);
    for (let i = 1; i <= 96; i++) {
      const t = t0 - ((2 * kPi - 0.6) * i) / 96.0;
      stroke.push(new Point(300 + rx * Math.cos(t), 300 + ry * Math.sin(t)));
    }
    const back = stroke[stroke.length - 1] as Point;
    stroke.push(...polyline([back, new Point(back.x, 250)]).slice(1));
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R6);
  });

  it('R6SquareLassoWithEndsOnTheBottomIsNotALoop', () => {
    const fx = new Fixture();
    // down from the bottom edge, round all four corners, back up to the bottom edge 40 px along:
    // the closed region holds the whole shape
    const stroke = polyline([
      new Point(280, 350),
      new Point(280, 380),
      new Point(170, 380),
      new Point(170, 220),
      new Point(430, 220),
      new Point(430, 380),
      new Point(320, 380),
      new Point(320, 350),
    ]);
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R6);
  });

  it('R6OppositeSideLoopRoundTheTopIsALoop', () => {
    const fx = new Fixture();
    // left side to right side round the top, both ends below the centre: the chord passes below the
    // centre (the region contains it) but the bottom corners are outside the region: not a lasso
    const vertices = [
      new Point(200, 320),
      new Point(170, 320),
      new Point(170, 220),
      new Point(430, 220),
      new Point(430, 320),
      new Point(400, 320),
    ];
    const stroke = polyline(vertices);
    expect(isPointInsidePolygon(stroke, kCentre)).toBe(true); // the old R6 rejected it
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.None);
    const r = fx.evaluate(stroke, linesThrough(fx.viewAll(vertices)));
    expect(r.failed).toBe(SelfLoopRule.None);
    expect(r.kind).toBe(SelfLoopKind.Orthogonal);
    expect(r.detail.params).toHaveLength(5);
  });

  it('R6OppositeSideLoopRoundTheBottomIsALoop', () => {
    const fx = new Fixture();
    // mirrored: round the bottom, both ends above the centre
    const stroke = polyline([
      new Point(200, 280),
      new Point(170, 280),
      new Point(170, 380),
      new Point(430, 380),
      new Point(430, 280),
      new Point(400, 280),
    ]);
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.None);
  });

  it('R7ZigZagIsNotALoop', () => {
    const fx = new Fixture();
    const v = [new Point(260, 250), new Point(280, 190), new Point(300, 240), new Point(320, 190), new Point(340, 250)];
    const path = linesThrough(v);
    expect(fx.evaluate(polyline(v), path).failed).toBe(SelfLoopRule.R7);
    fx.setConfig({ selfLoopMinCornerAngle: 30 });
    expect(fx.evaluate(polyline(v), path).failed).toBe(SelfLoopRule.None);
  });

  it('R7TooManyCornersIsNotALoopAndTheBoundaryIsConfig', () => {
    const fx = new Fixture();
    // a staircase over the top: 6 right-angle corners
    const v = [
      new Point(230, 250),
      new Point(230, 220),
      new Point(260, 220),
      new Point(260, 190),
      new Point(340, 190),
      new Point(340, 220),
      new Point(370, 220),
      new Point(370, 250),
    ];
    const path = linesThrough(v);
    let r = fx.evaluate(polyline(v), path);
    expect(r.failed).toBe(SelfLoopRule.R7);
    expect(r.corners).toBe(6);
    fx.setConfig({ selfLoopMaxCorners: 6 });
    r = fx.evaluate(polyline(v), path);
    expect(r.failed).toBe(SelfLoopRule.None);
    // more than 4 corners is never fitted as orthogonal
    expect(r.kind).toBe(SelfLoopKind.Curve);
  });

  it('R8StrokeAcrossANeighbourIsNotALoop', () => {
    const fx = new Fixture();
    fx.scene.add(geoRect('neighbour', 300, 185, 30, 20)); // the arch's apex is at y 180
    const stroke = arch(kTopMid, 40, 70);
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.R8);
    fx.scene.remove('neighbour');
    expect(fx.evaluate(stroke).failed).toBe(SelfLoopRule.None);
  });

  // ------------------------------------------------------------------ fit choice

  it('SlantedPolylineIsFittedAsACurve', () => {
    const fx = new Fixture();
    // near-right corners, but the first segment is ~22 degrees off the vertical
    const v = [new Point(260, 250), new Point(240, 200), new Point(320, 170), new Point(340, 250)];
    const r = fx.evaluate(polyline(v), linesThrough(v));
    expect(r.failed).toBe(SelfLoopRule.None);
    expect(r.kind).toBe(SelfLoopKind.Curve);
  });

  it('GetShapesForConnectionStillRefusesOneShape', () => {
    const fx = new Fixture();
    const delegate = fx.delegate();
    const found = delegate.getShapesForConnection(
      fx.view(new Point(260, 250)),
      fx.view(new Point(340, 250)),
      new Set(),
    );
    expect(found).toEqual([]);
    expect(delegate.getShapeForSelfLoop(fx.view(new Point(260, 250)), fx.view(new Point(340, 250)))).toBe(S);
  });
});
