// Closed quadrilaterals (port of C++ `regularizer::FourLineRegularizer`): the bounds (0), the
// diamond on the edge midpoints (1), two trapezoids leaning out (2, 3) and in (4, 5), and two
// "pentagon-less" houses with one corner cut to an edge midpoint (6, 7). Every feature is
// accepted; the winner is then adjusted: a big figure (bounds over 200 × 200) that fills at least
// 80 % of its bounds becomes the rectangle, so do thin houses (aspect >= 3), and 4–7 are
// redrawn in their final proportions. Open paths have no features (PolyLine fallback).
import { areaOfConvexPolygon, Point } from '../../geometry';
import { PolyRegularizer, type Feature } from './PolyRegularizer';

export class FourLineRegularizer extends PolyRegularizer {
  protected override getFeatures(result: Feature[]): void {
    if (!this.closed) return;
    const r = this.rect;
    const P = (x: number, y: number): Point => new Point(this.xval(x), this.yval(y));
    result.push([r.p1(), r.p2(), r.p3(), r.p4()]);
    result.push([
      this.mid(r.p1(), r.p4()),
      this.mid(r.p1(), r.p2()),
      this.mid(r.p2(), r.p3()),
      this.mid(r.p3(), r.p4()),
    ]);
    result.push([P(1.7 / 8, 0), P(0, 1), P(6.3 / 8, 1), P(1, 0)]);
    result.push([P(0, 0), P(1.7 / 8, 1), P(1, 1), P(6.3 / 8, 0)]);
    result.push([P(0, 0), P(0.3, 1), P(0.7, 1), P(1, 0)]);
    result.push([P(0.3, 0), P(0, 1), P(1, 1), P(0.7, 0)]);
    result.push([this.mid(r.p1(), r.p2()), P(0, 1), P(1, 1), P(1, 0)]);
    result.push([P(0, 0), P(0, 1), P(1, 1), this.mid(r.p3(), r.p4())]);
  }

  protected override canAccept(): boolean {
    return true;
  }

  protected override convertAfterDetection(fid: number, feature: Feature): void {
    const r = this.rect;
    const P = (x: number, y: number): Point => new Point(this.xval(x), this.yval(y));
    const replace = (pts: Point[]): void => {
      feature.length = 0;
      feature.push(...pts);
    };

    if (fid !== 0 && this.width > 200 && this.height > 200) {
      const area =
        this.origPolyPoints.length > 0 ? areaOfConvexPolygon(this.origPolyPoints) : areaOfConvexPolygon(this.points);
      const rectArea = this.width * this.height;
      if (rectArea > 0) {
        const ratio = area / rectArea;
        if (ratio * 100 >= 80) {
          replace([r.p1(), r.p2(), r.p3(), r.p4()]);
          return;
        }
      }
    }

    if (fid === 6 || fid === 7) {
      if (this.height < 1 || this.width / this.height >= 3) {
        replace([r.p1(), r.p2(), r.p3(), r.p4()]);
        return;
      }
    }

    if (fid === 4) {
      replace([P(0, 0), P(1.7 / 8, 1), P(6.3 / 8, 1), P(1, 0)]);
    } else if (fid === 5) {
      replace([P(1.7 / 8, 0), P(0, 1), P(1, 1), P(6.3 / 8, 0)]);
    } else if (fid === 6) {
      replace([P(0, 1.0 / 6), P(0, 1), P(1, 1), P(1, 0)]);
    } else if (fid === 7) {
      replace([P(0, 0), P(0, 1), P(1, 1), P(1, 1.0 / 6)]);
    }
  }
}
