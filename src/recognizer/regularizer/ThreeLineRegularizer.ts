// Three lines (port of C++ `regularizer::ThreeLineRegularizer`). Closed: the four right
// triangles on the bounds' corners and the four isosceles ones with the apex at an edge's
// midpoint, always accepted. Open: the four "U"s round the bounds, accepted below 2.6e-3 unless
// the two end strokes differ too much in length.
import { getDistance } from '../../geometry';
import { at } from '../lines/RecognizerUtil';
import { PolyRegularizer, type Feature } from './PolyRegularizer';

export class ThreeLineRegularizer extends PolyRegularizer {
  protected override getFeatures(result: Feature[]): void {
    const r = this.rect;
    if (this.closed) {
      result.push([r.p1(), r.p2(), r.p3()]);
      result.push([r.p2(), r.p3(), r.p4()]);
      result.push([r.p3(), r.p4(), r.p1()]);
      result.push([r.p4(), r.p1(), r.p2()]);
      result.push([this.mid(r.p1(), r.p2()), r.p3(), r.p4()]);
      result.push([this.mid(r.p2(), r.p3()), r.p4(), r.p1()]);
      result.push([this.mid(r.p3(), r.p4()), r.p1(), r.p2()]);
      result.push([this.mid(r.p4(), r.p1()), r.p2(), r.p3()]);
    } else {
      result.push([r.p1(), r.p2(), r.p3(), r.p4()]);
      result.push([r.p2(), r.p3(), r.p4(), r.p1()]);
      result.push([r.p3(), r.p4(), r.p1(), r.p2()]);
      result.push([r.p4(), r.p1(), r.p2(), r.p3()]);
    }
  }

  protected override canAccept(_fid: number, cost: number): boolean {
    if (!this.closed) {
      const dist1 = getDistance(at(this.points, 0), at(this.points, 1));
      const dist2 = getDistance(at(this.points, 2), at(this.points, 3));
      const big = Math.max(dist1, dist2);
      const small = Math.min(dist1, dist2);
      if (small > 1) {
        if (small < big * 0.4) return false;
      }
      return cost * 1000 < 2.6;
    }
    return true;
  }
}
