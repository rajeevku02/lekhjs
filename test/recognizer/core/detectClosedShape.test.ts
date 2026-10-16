// Closed-shape detection (C++ Recognizer::detectClosedShape): its early returns (V-R2 of the C++
// CxPolyBudgetTest, through `detectClosedShape` instead of the C++ test seam), the R7 early exit
// (AC-REC-09) and the 80 %-of-length rule. The shape stage (task R2) is a stub here that records
// whether it ran.
import { describe, expect, it } from 'vitest';
import {
  BUDGET_LOG_LINE,
  createRecognizerContext,
  detectClosedShape,
  recognizerConfigWith,
  RECOGNIZER_CONFIG_DEFAULTS,
  type ClosedShapeCandidate,
  type ClosedShapeStage,
} from '../../../src/recognizer/core';
import { LineColl, stubLineAggregatorModule } from '../../../src/recognizer/lines';
import { PolyColl, type CxPoly } from '../../../src/recognizer/polys';
import { ORDER_CASES } from '../support/cases';
import {
  ellipse,
  overtrace,
  randomSet,
  rect,
  rectTwice,
  scribble,
  spiral,
  triangle,
  zigzag,
  type LineSet,
} from '../support/lineSets';

interface Shape extends ClosedShapeCandidate {
  readonly name: string;
}

/** A stand-in for ShapeAggregator: one shape per call (or none), made from the longest split poly. */
class StubStage implements ClosedShapeStage<Shape> {
  runs = 0;
  resets = 0;
  private readonly perimeter: (polys: readonly CxPoly[]) => number | undefined;
  private readonly none: boolean;

  constructor(opts: { perimeter?: (polys: readonly CxPoly[]) => number | undefined; none?: boolean } = {}) {
    this.perimeter = opts.perimeter ?? ((polys) => Math.max(0, ...polys.map((p) => p.features().perimeter)));
    this.none = opts.none ?? false;
  }

  run(polyColl: PolyColl): readonly Shape[] {
    this.runs++;
    if (this.none) return [];
    return [{ name: 'shape', perimeter: this.perimeter(polyColl.polys()) }];
  }

  reset(): void {
    this.resets++;
  }
}

function setUp(set: LineSet, config = RECOGNIZER_CONFIG_DEFAULTS) {
  const ctx = createRecognizerContext({ config, lineAggregator: stubLineAggregatorModule });
  const lc = new LineColl(config);
  lc.addLines(set.lines());
  const pc = new PolyColl({ config, lineAggregator: stubLineAggregatorModule, quirks: ctx.quirks });
  return { ctx, lc, pc };
}

describe('detectClosedShape: early returns', () => {
  it('skips the search above closedShapeMaxLines', () => {
    const { ctx, lc, pc } = setUp(zigzag(RECOGNIZER_CONFIG_DEFAULTS.closedShapeMaxLines + 1));
    const stage = new StubStage();
    const r = detectClosedShape(lc, pc, ctx, stage);
    expect(r).toMatchObject({ detected: false, overLineCap: true, budgetExceeded: false });
    expect(pc.budgetExceeded()).toBe(false); // the search never ran
    expect(pc.polys()).toEqual([]);
    expect(stage.runs).toBe(0);
  });

  it('falls back on the budget, logging the C++ line', () => {
    const config = recognizerConfigWith({ cxPolyMaxPolys: 50 });
    const { ctx, lc, pc } = setUp(overtrace(16), config);
    const stage = new StubStage();
    const r = detectClosedShape(lc, pc, ctx, stage);
    expect(r).toMatchObject({ detected: false, budgetExceeded: true });
    expect(pc.budgetExceeded()).toBe(true);
    expect(ctx.logs).toEqual([BUDGET_LOG_LINE]);
    expect(ctx.counters.budgetExceeded).toBe(1);
    expect(stage.runs).toBe(0);
  });

  it('runs the search at exactly the line cap', () => {
    const config = recognizerConfigWith({ cxPolyMaxPolys: 1 });
    const { ctx, lc, pc } = setUp(zigzag(config.closedShapeMaxLines), config);
    const r = detectClosedShape(lc, pc, ctx, new StubStage());
    expect(r.detected).toBe(false);
    expect(r.overLineCap).toBe(false);
    expect(pc.budgetExceeded()).toBe(true); // the search ran
  });
});

describe('detectClosedShape: R7 early exit (AC-REC-09)', () => {
  const sets = [scribble(14, 1234), scribble(14, 98765), spiral(14), zigzag(14), overtrace(14)];
  it.each(sets.map((s) => [s.name, s] as const))('%s returns false without building a candidate shape', (_n, set) => {
    const { ctx, lc, pc } = setUp(set);
    const stage = new StubStage();
    const r = detectClosedShape(lc, pc, ctx, stage);
    expect(r.detected).toBe(false);
    // Either the budget or R7 stops it; no candidate shape is ever built.
    expect(r.earlyExit !== r.budgetExceeded).toBe(true);
    expect(stage.runs).toBe(0);
    expect(ctx.counters.shapeStageRuns).toBe(0);
    expect(ctx.counters.earlyExits + ctx.counters.budgetExceeded).toBe(1);
  });

  it.each([scribble(14, 1234), spiral(14), zigzag(14)].map((s) => [s.name, s] as const))(
    '%s is under the budget and stopped by R7 itself',
    (_n, set) => {
      const { ctx, lc, pc } = setUp(set);
      const stage = new StubStage();
      const r = detectClosedShape(lc, pc, ctx, stage);
      expect(r).toMatchObject({ detected: false, budgetExceeded: false, earlyExit: true });
      expect(stage.runs).toBe(0);
      expect(stage.resets).toBe(1);
      expect(ctx.counters.earlyExits).toBe(1);
    },
  );

  it.each([rect(), triangle(), ellipse(8), ellipse(12), rectTwice()].map((s) => [s.name, s] as const))(
    'closed shape %s reaches the shape stage and is detected',
    (_n, set) => {
      const { ctx, lc, pc } = setUp(set);
      const stage = new StubStage();
      const r = detectClosedShape(lc, pc, ctx, stage);
      expect(r.earlyExit).toBe(false);
      expect(stage.runs).toBe(1);
      expect(r.detected).toBe(true);
      expect(r.shapes.length).toBe(1);
      expect(stage.resets).toBe(1);
    },
  );

  it('the bound R7 relies on: no split poly is longer than the longest searched poly', () => {
    const sets = [
      ...ORDER_CASES.map((c) => c.make()),
      ...Array.from({ length: 300 }, (_, i) => randomSet(5000 + i, 3 + (i % 14))),
    ];
    let checked = 0;
    for (const set of sets) {
      if (set.lines().length > RECOGNIZER_CONFIG_DEFAULTS.closedShapeMaxLines) continue;
      const { lc, pc } = setUp(set);
      lc.setLineSearchInOrder(false);
      pc.setLines(lc);
      pc.process();
      if (pc.budgetExceeded()) continue;
      const before = Math.max(0, ...pc.polys().map((p) => p.features().perimeter));
      pc.splitExtensions();
      const after = Math.max(0, ...pc.polys().map((p) => p.features().perimeter));
      expect(after, set.name).toBeLessThanOrEqual(before);
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });
});

describe('detectClosedShape: the 80 %-of-length rule', () => {
  it('drops a shape that uses under 80 % of the stroke', () => {
    const { ctx, lc, pc } = setUp(rect());
    const total = rect()
      .lines()
      .reduce((s, l) => s + Math.hypot(l.lastPoint().x - l.firstPoint().x, l.lastPoint().y - l.firstPoint().y), 0);
    const r = detectClosedShape(lc, pc, ctx, new StubStage({ perimeter: () => 0.79 * total }));
    expect(r.detected).toBe(false);
    expect(r.shapes).toEqual([]);
  });

  it('keeps a shape at 80 % or more, and one without a perimeter attribute', () => {
    const total = rect()
      .lines()
      .reduce((s, l) => s + Math.hypot(l.lastPoint().x - l.firstPoint().x, l.lastPoint().y - l.firstPoint().y), 0);
    let s = setUp(rect());
    expect(detectClosedShape(s.lc, s.pc, s.ctx, new StubStage({ perimeter: () => 0.81 * total })).detected).toBe(true);
    s = setUp(rect());
    expect(detectClosedShape(s.lc, s.pc, s.ctx, new StubStage({ perimeter: () => undefined })).detected).toBe(true);
  });

  it('no shape: false', () => {
    const s = setUp(rect());
    const r = detectClosedShape(s.lc, s.pc, s.ctx, new StubStage({ none: true }));
    expect(r.detected).toBe(false);
  });

  it('leaves the line search in all-nearby mode, as C++ does', () => {
    const s = setUp(rect());
    s.lc.setLineSearchInOrder(true);
    detectClosedShape(s.lc, s.pc, s.ctx, new StubStage());
    expect(s.lc.lineSearchInOrder()).toBe(false);
  });
});
