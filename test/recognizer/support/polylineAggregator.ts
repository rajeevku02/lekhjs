// The test-only `PolylineLineAggregator` (spec 07 §5.2): Ramer-Douglas-Peucker over the
// pre-processed stroke, one `StrokeLine` per kept segment, with the chord-distance cost. It lets
// the downstream stages run end to end before the owner's LineAggregator (H-REC-1). Never bundled
// into an app (AC-REC-04): it lives under test/.
import { Span } from '../../../src/base';
import { LineEquation, type Point } from '../../../src/geometry';
import {
  RangeNumber,
  StrokeLine,
  stubLineAggregatorModule,
  type LineAggregator,
  type LineAggregatorModule,
} from '../../../src/recognizer/lines';
import type { LinePart, Points } from '../../../src/recognizer/lines/StrokeLine';

/** Farthest-point split tolerance, view px. */
const EPSILON = 6;

function rdp(pts: readonly Point[], a: number, b: number, out: number[]): void {
  if (b <= a + 1) return;
  const pa = pts[a] as Point;
  const pb = pts[b] as Point;
  const eq = LineEquation.through(pa, pb);
  let worst = -1;
  let idx = -1;
  for (let i = a + 1; i < b; i++) {
    const q = pts[i] as Point;
    const d = pa.x === pb.x && pa.y === pb.y ? Math.hypot(q.x - pa.x, q.y - pa.y) : eq.getDistanceFrom(q);
    if (d > worst) {
      worst = d;
      idx = i;
    }
  }
  if (worst > EPSILON && idx > a) {
    rdp(pts, a, idx, out);
    out.push(idx);
    rdp(pts, idx, b, out);
  }
}

/** The chord-distance cost of one straight line through `pts`. */
export function chordCost(pts: Points): RangeNumber {
  let d = 0;
  if (pts.size > 2) {
    const eq = LineEquation.through(pts.first(), pts.last());
    for (let i = 1; i + 1 < pts.size; i++) d = Math.max(d, eq.getDistanceFrom(pts.at(i)));
  }
  return new RangeNumber(d, d);
}

class PolylineLineAggregator implements LineAggregator {
  private pts: Points | null = null;
  private out: StrokeLine[] = [];
  private cost = 7;

  setPoints(points: Points): void {
    this.reset();
    this.pts = points;
  }
  process(): void {
    const p = this.pts;
    if (p === null || p.size < 2) return;
    const s = p.startIndex;
    const e = p.endIndex;
    const cuts = [s];
    rdp(p.items, s, e, cuts);
    cuts.push(e);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const span = new Span(p.items, cuts[i], cuts[i + 1]);
      this.out.push(new StrokeLine(span, chordCost(span)));
    }
  }
  lines(): readonly StrokeLine[] {
    return this.out;
  }
  reset(): void {
    this.pts = null;
    this.out = [];
  }
  minCost(): number {
    return this.cost;
  }
  setMinCost(cost: number): void {
    this.cost = cost;
  }
}

export const polylineLineAggregatorModule: LineAggregatorModule = Object.freeze({
  id: 'test-polyline',
  create: () => new PolylineLineAggregator(),
  getCost: chordCost,
  isSingleLine: (a: LinePart, b: LinePart) => stubLineAggregatorModule.isSingleLine(a, b),
});
