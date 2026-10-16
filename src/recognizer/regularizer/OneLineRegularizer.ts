// Snaps a single line to horizontal or vertical when within 9° (port of C++
// `regularizer::OneLineRegularizer`). The start point stays; the end point moves.
import { LineSegment, type Point, type SimplePath } from '../../geometry';
import { at } from '../lines/RecognizerUtil';
import { axisAngle } from './PolyLineRegularizer';

const delta = 9;

export class OneLineRegularizer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the C++ ignores the corner points
  regularize(path: SimplePath, _points: readonly Point[]): void {
    const segment = at(path.components, 0).segment;
    const startPoint = segment.point1();
    let endPoint = segment.point2();

    const angle = axisAngle(segment);

    if (angle < delta && angle > -delta) {
      endPoint = endPoint.withY(startPoint.y);
    }
    if ((angle > 90 - delta && angle < 90 + delta) || (angle > -90 - delta && angle < -90 + delta)) {
      endPoint = endPoint.withX(startPoint.x);
    }

    path.front().segment = new LineSegment(startPoint, endPoint);
  }
}
