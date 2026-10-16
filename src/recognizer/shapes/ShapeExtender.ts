// Closes or extends candidate shapes (port of C++ `recognizer::ShapeExtender`). A closed shape
// becomes final; an open poly whose ends meet a two-point poly is joined with it into a polygon.
import { getDistance, type Point } from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import { RecShape, ShapeAttrs, ShapeNames } from './RecShape';

/** C++ `ShapeExtension`. */
export interface ShapeExtension {
  readonly keepOrig: boolean;
  readonly shape: RecShape;
}

/** The id sequence shared with the `ShapeColl` (C++ `int* idSeq`). */
export interface IdSeq {
  value: number;
}

export class ShapeExtender {
  private readonly config: RecognizerConfig;

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  /** C++ `extend(coll, shape, idSeq)`; `shapes` is the collection's current list. */
  extend(shapes: readonly RecShape[], curShape: RecShape, idSeq: IdSeq): ShapeExtension[] {
    const ex: ShapeExtension[] = [];
    if (curShape.boolAttrs.get(ShapeAttrs.closed) === true) {
      curShape.final = true;
      return ex;
    }
    if (!curShape.final && curShape.name === ShapeNames.poly) {
      const shape = this.extendToClosePoly(shapes, curShape, idSeq);
      if (shape !== null) ex.push({ keepOrig: false, shape });
    }
    return ex;
  }

  private extendToClosePoly(shapes: readonly RecShape[], curShape: RecShape, idSeq: IdSeq): RecShape | null {
    const pts = curShape.points;
    if (pts.length <= 2) return null;
    const first = pts[0] as Point;
    const last = pts[pts.length - 1] as Point;
    const closeDist = this.config.lineCollConnectDist;
    const canClose = (p0: Point, p1: Point): boolean =>
      (getDistance(first, p0) < closeDist && getDistance(last, p1) < closeDist) ||
      (getDistance(first, p1) < closeDist && getDistance(last, p0) < closeDist);

    for (const sp of shapes) {
      if (sp.id === curShape.id || sp.name !== ShapeNames.poly || sp.points.length !== 2) continue;
      // (R9: the cheap name/size tests run before the poly-overlap test; all are pure.)
      if (curShape.polysOverlap(sp)) continue;
      if (canClose(sp.points[0] as Point, sp.points[1] as Point)) {
        const newShape = new RecShape();
        newShape.copyFrom(curShape);
        newShape.id = idSeq.value;
        idSeq.value++;
        newShape.final = true;
        newShape.polyColl = null;
        newShape.polys = [];
        newShape.boolAttrs.set(ShapeAttrs.closed, true);
        newShape.name = ShapeNames.polygon;
        newShape.children.push(curShape, sp);
        return newShape;
      }
    }
    return null;
  }
}
