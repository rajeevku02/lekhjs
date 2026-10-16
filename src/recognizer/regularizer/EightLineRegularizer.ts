// Closed octagons (port of C++ `regularizer::EightLineRegualizer`, spelling fixed): the bounds
// with each corner cut at 2/8. Accepted below 3e-3; open paths have no features (PolyLine
// fallback).
import { Point } from '../../geometry';
import { PolyRegularizer, type Feature } from './PolyRegularizer';

export class EightLineRegularizer extends PolyRegularizer {
  protected override getFeatures(result: Feature[]): void {
    if (!this.closed) return;
    const P = (x: number, y: number): Point => new Point(this.xval(x), this.yval(y));
    result.push([
      P(2.0 / 8, 0),
      P(0, 2.0 / 8),
      P(0, 6.0 / 8),
      P(2.0 / 8, 1),
      P(6.0 / 8, 1),
      P(1, 6.0 / 8),
      P(1, 2.0 / 8),
      P(6.0 / 8, 0),
    ]);
  }

  protected override canAccept(_fid: number, cost: number): boolean {
    return cost * 1000 < 3.0;
  }
}
