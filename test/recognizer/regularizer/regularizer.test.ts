// Unit checks of the regularizer port beyond the C++ golden: the API contract, the B5/B6/B7
// port rules (spec 07), the C++ dispatch chain and the int truncation in PolyLine.
import { describe, expect, it } from 'vitest';
import { BezierCurve, PathComponent, Point, SimplePath } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core/RecognizerConfig';
import { RecInternalError } from '../../../src/recognizer/lines/RecognizerUtil';
import {
  FourLineRegularizer,
  NO_FEATURES,
  PolyLineRegularizer,
  Regularizer,
  SegmentKind,
} from '../../../src/recognizer/regularizer';

const P = (x: number, y: number): Point => new Point(x, y);
function polyPath(pts: Point[], closed: boolean): SimplePath {
  const p = new SimplePath();
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) p.addLine(pts[i] as Point, pts[(i + 1) % pts.length] as Point);
  p.setClosed(closed);
  return p;
}
const ends = (p: SimplePath): number[][] =>
  p.components.map((c) => [c.segment.p1.x, c.segment.p1.y, c.segment.p2.x, c.segment.p2.y]);
const reg = (): Regularizer => new Regularizer(RECOGNIZER_CONFIG_DEFAULTS);

describe('Regularizer', () => {
  it('keeps the pipeline contract: regularize(path, points, convex) rewrites the path and returns nothing', () => {
    const p = polyPath([P(0, 0), P(100, 3)], false);
    const contract: (path: SimplePath, points: readonly Point[], convex: boolean) => void = (a, b, c) => {
      reg().regularize(a, b, c);
    };
    contract(p, [], true);
    expect(ends(p)).toEqual([[0, 0, 100, 0]]);
  });

  it('snaps a single line within 9° of an axis and leaves others', () => {
    const r = reg();
    const near = polyPath([P(10, 10), P(10 + 5, 110)], false);
    r.regularize(near, [], true);
    expect(ends(near)).toEqual([[10, 10, 10, 110]]);
    const far = polyPath([P(0, 0), P(100, 20)], false);
    r.regularize(far, [], true);
    expect(ends(far)).toEqual([[0, 0, 100, 20]]);
  });

  it('chains like the C++ ifs: a closed two-line path becomes a triangle that ThreeLine then sees', () => {
    const p = polyPath([P(0, 0), P(300, 0.5)], true);
    expect(reg().regularizeTraced(p, [], true)).toEqual(['two:2', 'three:0']);
    expect(p.size).toBe(3);
    expect(p.closed()).toBe(true);
  });

  it('sends a non-convex path with lines to PolyLine, and leaves curves, empty paths and 7 lines alone', () => {
    const r = reg();
    expect(r.regularizeTraced(polyPath([P(0, 0), P(50, 2), P(52, 60)], false), [], false)).toEqual(['polyline']);
    expect(r.regularizeTraced(new SimplePath(), [], false)).toEqual([]);
    expect(r.regularizeTraced(new SimplePath(), [], true)).toEqual([]);
    const seven = polyPath(
      Array.from({ length: 7 }, (_, k) => P(100 * Math.cos(k), 100 * Math.sin(k))),
      true,
    );
    const before = ends(seven);
    expect(r.regularizeTraced(seven, [], true)).toEqual([]);
    expect(ends(seven)).toEqual(before);
    const curved = polyPath([P(0, 0), P(50, 0), P(50, 50)], false);
    curved.push(PathComponent.ofCurve(new BezierCurve(P(50, 50), P(40, 70), P(20, 70), P(0, 50))));
    expect(r.regularizeTraced(curved, [], true)).toEqual(['curve']);
    expect(r.regularizeTraced(curved, [], false)).toEqual([]);
  });
});

describe('PolyLineRegularizer', () => {
  it('redraws near-axis segments with the C++ int-truncated length', () => {
    const p = polyPath([P(0, 0), P(100.9, 3), P(103, 50.75)], false);
    new PolyLineRegularizer().regularize(p);
    // |(100.9, 3)| = 100.94… → 100; |(2.1, 47.75)| = 47.79… → 47
    expect(ends(p)).toEqual([
      [0, 0, 100, 0],
      [100, 0, 100, 47],
    ]);
  });

  it('truncates toward zero for leftward and upward segments', () => {
    const p = polyPath([P(0, 0), P(-50.5, 1), P(-50, -30.5)], false);
    new PolyLineRegularizer().regularize(p);
    expect(ends(p)).toEqual([
      [0, 0, -50, 0],
      [-50, 0, -50, -31],
    ]);
  });

  it('keeps sub-pixel and diagonal segments as they are', () => {
    const p = polyPath([P(0, 0), P(0.5, 0.5), P(40, 40)], false);
    new PolyLineRegularizer().regularize(p);
    expect(ends(p)).toEqual([
      [0, 0, 0.5, 0.5],
      [0.5, 0.5, 40, 40],
    ]);
    expect(new PolyLineRegularizer().getKind(p.at(1).segment)).toBe(SegmentKind.Other);
  });

  it('throws RecInternalError on an empty path (C++ reads front() of nothing)', () => {
    expect(() => {
      new PolyLineRegularizer().regularize(new SimplePath());
    }).toThrow(RecInternalError);
  });
});

describe('PolyRegularizer port rules', () => {
  it('B6: when no unused pair is left, match throws instead of looping forever', () => {
    // a NaN first vertex makes the bounds, so every feature point and every distance, NaN
    const p = polyPath([P(NaN, 0), P(0, 100), P(100, 100), P(100, 0)], true);
    expect(() => new FourLineRegularizer().regularize(p, [])).toThrow(RecInternalError);
  });

  it('below 80 % the trapezoid stays, redrawn in its final proportions', () => {
    const trapezoid = [P(100, 0), P(0, 400), P(400, 400), P(300, 0)];
    const p = polyPath(trapezoid, true);
    expect(new FourLineRegularizer().regularize(p, trapezoid)).toBe(5);
    expect(ends(p)).toEqual([
      [85, 0, 0, 400],
      [0, 400, 400, 400],
      [400, 400, 315, 0],
      [315, 0, 85, 0],
    ]);
  });

  it('an open four-line path has no features and goes to PolyLine', () => {
    const p = polyPath([P(0, 0), P(100, 2), P(102, 100), P(0, 101), P(-3, 30)], false);
    expect(new FourLineRegularizer().regularize(p, [])).toBe(NO_FEATURES);
    expect(ends(p)[0]).toEqual([0, 0, 100, 0]);
  });

  it('a big quadrilateral that fills >= 80 % of its bounds becomes the rectangle (corner points from the matcher)', () => {
    // nearest to trapezoid 5 (top inset 0.3), but it covers 82.5 % of its 400 × 400 bounds
    const trapezoid = [P(70, 0), P(0, 400), P(400, 400), P(330, 0)];
    const p = polyPath(trapezoid, true);
    const fid = new FourLineRegularizer().regularize(p, trapezoid);
    expect(fid).toBe(5);
    expect(ends(p)).toEqual([
      [0, 0, 0, 400],
      [0, 400, 400, 400],
      [400, 400, 400, 0],
      [400, 0, 0, 0],
    ]);
  });
});
