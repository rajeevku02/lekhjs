// Closed pentagons (port of C++ `regularizer::FiveLineRegularizer`): a regular-looking pentagon
// pointing up (0), left (1), down (2) and right (3) in the bounds. Accepted below 4e-3; open
// paths have no features (PolyLine fallback).
import { Point } from '../../geometry';
import { PolyRegularizer, type Feature } from './PolyRegularizer';

export class FiveLineRegularizer extends PolyRegularizer {
  protected override getFeatures(result: Feature[]): void {
    if (!this.closed) return;
    const r = this.rect;
    const P = (x: number, y: number): Point => new Point(this.xval(x), this.yval(y));
    result.push([this.mid(r.p1(), r.p4()), P(0, 3.0 / 8), P(1.5 / 8, 1), P(6.5 / 8, 1), P(1, 3.0 / 8)]);
    result.push([this.mid(r.p1(), r.p2()), P(3.0 / 8, 1), P(1, 6.5 / 8), P(1, 1.5 / 8), P(3.0 / 8, 0)]);
    result.push([this.mid(r.p2(), r.p3()), P(1, 5.0 / 8), P(6.5 / 8, 0), P(1.5 / 8, 0), P(0, 5.0 / 8)]);
    result.push([this.mid(r.p3(), r.p4()), P(5.0 / 8, 0), P(0, 1.5 / 8), P(0, 6.5 / 8), P(5.0 / 8, 1)]);
  }

  protected override canAccept(_fid: number, cost: number): boolean {
    return cost * 1000 < 4.0;
  }
}
