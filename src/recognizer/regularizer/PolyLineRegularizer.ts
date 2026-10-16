// Snaps the near-horizontal and near-vertical segments of a polyline (port of C++
// `regularizer::PolyLineRegularizer`). Each segment of length >= 1 within 15° of an axis is
// redrawn along that axis from the previous (already snapped) vertex, keeping its direction and
// its length; other segments keep their end point. The path is rebuilt as plain lines.
//
// C++ holds the snapped length in an `int` (`auto segLen = 0`), so it is truncated toward zero:
// replicated with `Math.trunc`.
import { PathComponent, Point, toDegree, type LineSegment, type SimplePath } from '../../geometry';
import { at } from '../lines/RecognizerUtil';

const delta = 15;

/** C++ `PolyLineRegularizer::Kind`. */
export const SegmentKind = Object.freeze({ Horizontal: 0, Vertical: 1, Other: 2 } as const);
export type SegmentKind = (typeof SegmentKind)[keyof typeof SegmentKind];

/** The segment's angle in degrees in (-90, 90], measured from its left (or upper) end. */
export function axisAngle(segment: LineSegment): number {
  const startPoint = segment.point1();
  const endPoint = segment.point2();
  let p1 = startPoint;
  let p2 = endPoint;
  if (endPoint.x < startPoint.x) {
    p1 = endPoint;
    p2 = startPoint;
  } else if (endPoint.x === startPoint.x) {
    if (endPoint.y < startPoint.y) {
      p1 = endPoint;
      p2 = startPoint;
    }
  }
  return toDegree(Math.atan2(p2.y - p1.y, p2.x - p1.x));
}

export class PolyLineRegularizer {
  regularize(path: SimplePath): void {
    const points: Point[] = [at(path.components, 0).segment.point1()];

    for (const cmp of path.components) {
      const len = cmp.segment.length();
      if (len < 1.0) {
        points.push(cmp.segment.point2());
        continue;
      }
      const kind = this.getKind(cmp.segment);
      const last = at(points, points.length - 1);
      if (kind === SegmentKind.Horizontal) {
        const segLen = Math.trunc(cmp.segment.point1().x < cmp.segment.point2().x ? len : -len);
        points.push(new Point(last.x + segLen, last.y));
      } else if (kind === SegmentKind.Vertical) {
        const segLen = Math.trunc(cmp.segment.point1().y < cmp.segment.point2().y ? len : -len);
        points.push(new Point(last.x, last.y + segLen));
      } else {
        points.push(cmp.segment.point2());
      }
    }

    path.clear();
    for (let i = 0; i + 1 < points.length; i++) {
      path.push(PathComponent.line(at(points, i), at(points, i + 1)));
    }
  }

  getKind(segment: LineSegment): SegmentKind {
    const angle = axisAngle(segment);
    if (angle < delta && angle > -delta) return SegmentKind.Horizontal;
    if ((angle > 90 - delta && angle < 90 + delta) || (angle > -90 - delta && angle < -90 + delta)) {
      return SegmentKind.Vertical;
    }
    return SegmentKind.Other;
  }
}
