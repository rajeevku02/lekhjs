// Closed hexagons (port of C++ `regularizer::SixLineRegularizer`): pointed left-right (0) or
// up-down (1). Accepted below 3.5e-3; open paths have no features (PolyLine fallback).
import { Point } from '../../geometry';
import { PolyRegularizer, type Feature } from './PolyRegularizer';

export class SixLineRegularizer extends PolyRegularizer {
  protected override getFeatures(result: Feature[]): void {
    if (!this.closed) return;
    const r = this.rect;
    const P = (x: number, y: number): Point => new Point(this.xval(x), this.yval(y));
    result.push([
      this.mid(r.p1(), r.p4()),
      P(0, 2.0 / 8),
      P(0, 6.0 / 8),
      this.mid(r.p2(), r.p3()),
      P(1, 6.0 / 8),
      P(1, 2.0 / 8),
    ]);
    result.push([
      this.mid(r.p1(), r.p2()),
      P(2.0 / 8, 1),
      P(6.0 / 8, 1),
      this.mid(r.p3(), r.p4()),
      P(6.0 / 8, 0),
      P(2.0 / 8, 0),
    ]);
  }

  protected override canAccept(_fid: number, cost: number): boolean {
    return cost * 1000 < 3.5;
  }
}
