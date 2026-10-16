// recognizer/lines: RangeNumber/Probability, StrokeLine/LinePart/Parts, LineColl's two searches,
// Line2Line, RecognizerUtil, and LineRelation through an injected module (AC-REC-06).
import { describe, expect, it } from 'vitest';
import { Span } from '../../../src/base';
import { Point, type LineSegment } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS as CFG } from '../../../src/recognizer/core';
import {
  areAlmostEqual,
  areComparableLength,
  at,
  canClose,
  Line2Line,
  LineColl,
  LinePart,
  LinePoint,
  LineRelation,
  Parts,
  Probability,
  ProbabilityType,
  RangeNumber,
  RecInternalError,
  SegmentDir,
  StrokeLine,
  stubLineAggregatorModule,
  type LineAggregatorModule,
} from '../../../src/recognizer/lines';
import { zigzag } from '../support/lineSets';

describe('RangeNumber and Probability', () => {
  it('compares mid-points crisply', () => {
    const a = new RangeNumber(1, 3);
    const b = new RangeNumber(0, 2);
    expect(a.greaterThan(b).boolValue()).toBe(true);
    expect(a.lessThan(b).boolValue()).toBe(false);
    expect(a.equalsTo(new RangeNumber(2, 2)).boolValue()).toBe(true);
    expect(new RangeNumber(5, 0).isZero().boolValue()).toBe(true);
    expect(new RangeNumber(0, 1).isZero().boolValue()).toBe(false);
    const s = a.add(b).divide(2);
    expect([s.start, s.end]).toEqual([0.5, 2.5]);
    expect([a.start, a.end]).toEqual([1, 3]);
  });

  it('classifies probabilities', () => {
    expect(new Probability(0).type()).toBe(ProbabilityType.Crisp);
    expect(new Probability(1).type()).toBe(ProbabilityType.Crisp);
    expect(new Probability(0.3).type()).toBe(ProbabilityType.Fuzzy);
    expect(new Probability(NaN).type()).toBe(ProbabilityType.Indeterminate);
    expect(new Probability(Infinity).type()).toBe(ProbabilityType.Indeterminate);
    expect(new Probability(0.5).boolValue()).toBe(false);
    expect(new Probability(0.51).boolValue()).toBe(true);
  });
});

describe('StrokeLine and LinePart', () => {
  const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => new Point(i * 10, 0));

  it('copies its span and merges', () => {
    const span = new Span(pts, 0, 3);
    const l1 = new StrokeLine(span, new RangeNumber(1, 1));
    span.setEndIndex(1);
    expect(l1.lastPoint()).toEqual(new Point(30, 0));
    const l2 = new StrokeLine(new Span(pts, 3, 6));
    const m = StrokeLine.merge(l1, l2, new RangeNumber(2, 2));
    expect([m.firstPoint().x, m.lastPoint().x]).toEqual([0, 60]);
    expect(m.subLines).toEqual([l1, l2]);
    expect(l1.getSegmentDir(new Point(0, 0), new Point(30, 0))).toBe(SegmentDir.Forward);
    expect(l1.getSegmentDir(new Point(30, 0), new Point(0, 0))).toBe(SegmentDir.Backward);
  });

  it('LinePart.points maps a reversed part to its point range', () => {
    const line = new StrokeLine(new Span(pts, 1, 5));
    const part = new LinePart(line, new Point(41, 0), new Point(19, 0));
    const { points, reverse } = part.points();
    expect(reverse).toBe(true);
    expect(points.toArray().map((p) => p.x)).toEqual([20, 30, 40]);
    expect([part.t1, part.t2]).toEqual([(41 - 10) / 40, (19 - 10) / 40]);
  });

  it('LinePart.equals needs the same line and both ends within delta', () => {
    const line = new StrokeLine(new Span(pts, 0, 6));
    line.id = 1;
    const other = new StrokeLine(new Span(pts, 0, 6));
    other.id = 2;
    const a = new LinePart(line, new Point(0, 0), new Point(60, 0));
    expect(a.equals(new LinePart(line, new Point(57, 0), new Point(3, 0)), 4)).toBe(true);
    expect(a.equals(new LinePart(line, new Point(0, 0), new Point(55, 0)), 4)).toBe(false);
    expect(a.equals(new LinePart(other, new Point(0, 0), new Point(60, 0)), 4)).toBe(false);
  });

  it('getSegments descends into sub-lines whose cost start exceeds the cut', () => {
    const l1 = new StrokeLine(new Span(pts, 0, 3), new RangeNumber(1, 1));
    const l2 = new StrokeLine(new Span([new Point(30, 0), new Point(30, 30)], 0, 1), new RangeNumber(1, 1));
    const m = StrokeLine.merge(l1, l2, new RangeNumber(20, 20));
    const out: LineSegment[] = [];
    new LinePart(m, new Point(0, 0), new Point(30, 30)).getSegments(out, 9);
    expect(out.map((s) => [s.p1.x, s.p1.y, s.p2.x, s.p2.y])).toEqual([
      [0, 0, 30, 0],
      [30, 0, 30, 30],
    ]);
    const out2: LineSegment[] = [];
    new LinePart(m, new Point(0, 0), new Point(30, 30)).getSegments(out2, 25);
    expect(out2.length).toBe(1);
  });

  it('Parts.split cuts the used ranges out of a part', () => {
    const line = new StrokeLine(new Span(pts, 0, 6));
    const used = new Parts();
    used.parts.push([new Point(40, 0), new Point(20, 0)]);
    const res = used.split(new LinePart(line));
    expect(res.map((p) => [p.start.x, p.end.x])).toEqual([
      [0, 20],
      [40, 60],
    ]);
    expect(new Parts().split(new LinePart(line)).length).toBe(1);
  });

  it('LinePoint parameter', () => {
    const line = new StrokeLine(new Span(pts, 0, 6));
    expect(new LinePoint(line, new Point(15, 0)).t).toBe(0.25);
    expect(new LinePoint(line).point).toEqual(new Point(0, 0));
  });
});

describe('LineColl', () => {
  it('numbers lines, and the in-order search only joins drawing-order neighbours', () => {
    const lc = new LineColl(CFG);
    const lines = zigzag(4).lines();
    lc.addLines(lines);
    expect(lc.lines().map((l) => l.id)).toEqual([1, 2, 3, 4]);
    const l2 = lines[1] as StrokeLine;
    lc.setLineSearchInOrder(true);
    const next = lc.getLinesNear({ linePoint: new LinePoint(l2, l2.lastPoint()), towards: 1 }, 1 << 1);
    expect(next.map((lp) => lp.line.id)).toEqual([3]);
    expect(lc.getLinesNear({ linePoint: new LinePoint(l2, l2.lastPoint()), towards: 1 }, (1 << 1) | (1 << 2))).toEqual(
      [],
    );
    const prev = lc.getLinesNear({ linePoint: new LinePoint(l2, l2.firstPoint()), towards: -1 }, 1 << 1);
    expect(prev.map((lp) => lp.line.id)).toEqual([1]);
    lc.setLineSearchInOrder(false);
    const near = lc.getLinesNear({ linePoint: new LinePoint(l2, l2.lastPoint()), towards: 1 }, 1 << 1);
    expect(near.map((lp) => lp.line.id)).toEqual([3]);
    expect(lc.lenSum()).toBeCloseTo(160, 9);
    expect(lc.bound().width).toBeCloseTo(80, 9);
  });

  it('reset restarts the ids', () => {
    const lc = new LineColl(CFG);
    lc.addLines(zigzag(3).lines());
    lc.reset();
    lc.addLines(zigzag(2).lines());
    expect(lc.lines().map((l) => l.id)).toEqual([1, 2]);
  });
});

describe('Line2Line', () => {
  it('connected, parallel and intersecting segments', () => {
    const c = new Line2Line(new Point(0, 0), new Point(100, 0), new Point(110, 5), new Point(200, 50), 28);
    expect(c.connected).toBe(true);
    expect(c.connectionPoint).toEqual(new Point(105, 2.5));
    const both = new Line2Line(new Point(0, 0), new Point(100, 0), new Point(5, 5), new Point(95, 5), 28);
    expect([both.connected, both.parallel]).toEqual([true, true]);
    const x = new Line2Line(new Point(0, 0), new Point(100, 100), new Point(0, 100), new Point(100, 0), 28);
    expect([x.connected, x.parallel, x.intersects]).toEqual([false, false, true]);
    const p = new Line2Line(new Point(0, 0), new Point(100, 0), new Point(0, 50), new Point(100, 50), 28);
    expect([p.connected, p.parallel, p.intersects]).toEqual([false, true, false]);
  });
});

describe('RecognizerUtil', () => {
  it('ports the C++ helpers', () => {
    expect(canClose(20, 70, CFG)).toBe(true); // 20 < 70/7 + 15
    expect(canClose(26, 70, CFG)).toBe(false);
    expect(canClose(151, 7000, CFG)).toBe(false); // over maxDistForPolygonClosing
    expect(areAlmostEqual(100, 108, 1)).toBe(true);
    expect(areAlmostEqual(100, 110, 1)).toBe(false);
    expect(areComparableLength(100, 120, 5)).toBe(true);
    expect(areComparableLength(100, 130, 5)).toBe(false);
    expect(() => at([1, 2], 2)).toThrow(RecInternalError);
    expect(at([1, 2], 1)).toBe(2);
  });
});

describe('LineRelation (through the injected module)', () => {
  const pts = Array.from({ length: 21 }, (_, i) => (i <= 10 ? new Point(i * 10, 0) : new Point(100, (i - 10) * 10)));
  const l1 = new StrokeLine(new Span(pts, 0, 10), new RangeNumber(1, 1));
  const l2 = new StrokeLine(new Span(pts, 10, 20), new RangeNumber(1, 1));
  l1.id = 1;
  l2.id = 2;
  const parts = [new LinePart(l1), new LinePart(l2)];

  it('uses the module it is given, never a concrete aggregator', () => {
    const calls: number[] = [];
    const fake: LineAggregatorModule = {
      id: 'fake',
      create: (c) => stubLineAggregatorModule.create(c),
      // A join of more than 6 points no longer fits one line.
      getCost: (p) => {
        calls.push(p.size);
        return p.size > 6 ? new RangeNumber(5, 5) : new RangeNumber(0, 0);
      },
      isSingleLine: () => false,
    };
    const sm = LineRelation.getSmoothingFactor(parts, fake);
    expect(calls.length).toBeGreaterThan(0);
    // minp = 11, step = 1: window inc takes inc points of part 1 and inc + 1 of part 2, so sizes
    // 3, 5, 7…: two steps fit.
    expect(sm).toBeCloseTo(2 / 12, 12);
    expect(LineRelation.getSmoothingFactor(parts, { ...fake, isSingleLine: () => true })).toBe(1);
    expect(LineRelation.getSmoothingFactor2(parts, fake)).toBeGreaterThan(0);
  });

  it('with the stub (cost 0 never exceeds the lines’ cost) the whole corner joins', () => {
    expect(LineRelation.getSmoothingFactor(parts, stubLineAggregatorModule)).toBeCloseTo(11 / 12, 12);
    expect(LineRelation.getSmoothingFactor([parts[0] as LinePart], stubLineAggregatorModule)).toBe(1);
  });
});
