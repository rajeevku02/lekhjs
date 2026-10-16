// Joins a new path to an existing path on the canvas at either end (port of C++
// `recognizer::PathExtender`). The candidates come from `CanvasDelegate.getPathsNear` for the
// first and the last segment; the nearest acceptable one per end is spliced in and its object is
// deleted.
import {
  angleWithHorizontal,
  getDistance,
  normalizeInHalfPI,
  type LineSegment,
  type PathComponent,
  type SimplePath,
} from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { CanvasDelegate, ExistingShape, ObjectId } from '../delegate/CanvasDelegate';
import { at } from '../lines/RecognizerUtil';
import { Path } from './Path';

/** Nearest first, then the smaller trim; ties keep the delegate's order (B8). */
function byDistThenTrim(x: ExistingShape, y: ExistingShape): number {
  if (x.dist === y.dist) return x.trim() - y.trim();
  return x.dist - y.dist;
}

export class PathExtender {
  private readonly path: SimplePath;
  private readonly canvas: CanvasDelegate;
  private readonly config: RecognizerConfig;
  private readonly deleted: ObjectId[] = [];

  constructor(path: SimplePath, canvas: CanvasDelegate, config: RecognizerConfig) {
    this.path = path;
    this.canvas = canvas;
    this.config = config;
  }

  deletedObjects(): readonly ObjectId[] {
    return this.deleted;
  }

  /** C++ `extend()`: rewrites the path in place; true when an existing path was joined. */
  extend(): boolean {
    const lines1 = this.path.at(0).lines();
    const lines2 = this.path.back().lines();
    const line1 = at(lines1, 0);
    const line2 = at(lines2, lines2.length - 1).reversed();

    const eshapes1 = this.canvas.getPathsNear(line1).slice().sort(byDistThenTrim);
    const eshapes2 = this.canvas.getPathsNear(line2).slice().sort(byDistThenTrim);

    const es1 = this.findShape(eshapes1);
    const es2 = this.findShape(eshapes2);
    let obj1 = es1?.object ?? null;
    let obj2 = es2?.object ?? null;
    if (obj1 === null && obj2 === null) return false;

    if (obj1 === obj2 && es1 !== null && es2 !== null) {
      if (es1.dist < es2.dist) obj2 = null;
      else obj1 = null;
    }

    if (es1 !== null && obj1 !== null) {
      const p = es1.path.clone();
      if (es1.side === 0) Path.reverse(p);
      p.back().setLastPoint(es1.at);
      this.path.front().setFirstPoint(es1.at);
      this.path.insert(0, p);
      this.deleted.push(obj1);
    }
    if (es2 !== null && obj2 !== null) {
      const p = es2.path.clone();
      if (es2.side === 1) Path.reverse(p);
      this.path.back().setLastPoint(es2.at);
      p.front().setFirstPoint(es2.at);
      this.path.insert(this.path.size, p);
      this.deleted.push(obj2);
    }
    return true;
  }

  /** C++ `findShape`: the first candidate (in sorted order) whose trims are acceptable. */
  private findShape(shapes: readonly ExistingShape[]): ExistingShape | null {
    const pathLen = this.path.length();
    const trimFactor = this.config.multiStrokeTrimFactor;
    const trimFactor2 = this.config.multiStrokeTrimFactorSingle;
    for (const shape of shapes) {
      if (this.areParallel(this.path, shape.path)) continue;
      const len1 = shape.path.length();
      if (shape.trimNew > pathLen * trimFactor2) continue;
      if (shape.trimExisting > len1 * trimFactor2) continue;
      if (shape.trimExisting > trimFactor2 * this.endSegmentLen(shape)) continue;
      if (shape.trim() > (len1 + pathLen) * trimFactor) continue;
      return shape;
    }
    return null;
  }

  private endSegmentLen(es: ExistingShape): number {
    if (es.side === 0) return at(es.path.front().lines(), 0).length();
    const segs = es.path.back().lines();
    return at(segs, segs.length - 1).length();
  }

  private areParallel(path1: SimplePath, path2: SimplePath): boolean {
    if (path1.size !== path2.size) return false;
    let parallel = true;
    for (let i = 0; i < path1.size; i++) {
      if (!this.areParallelLines(path1.at(i), path2.at(i))) {
        parallel = false;
        break;
      }
    }
    if (parallel) return true;
    const tmp = path2.clone();
    tmp.reverse();
    for (let i = 0; i < path1.size; i++) {
      if (!this.areParallelLines(path1.at(i), tmp.at(i))) return false;
    }
    return true;
  }

  private areParallelLines(pc1: PathComponent, pc2: PathComponent): boolean {
    if (pc1.isCurve || pc2.isCurve) return false;
    const seg1: LineSegment = pc1.segment;
    const seg2: LineSegment = pc2.segment;
    const ang1 = normalizeInHalfPI(angleWithHorizontal(seg1.point1(), seg1.point2()));
    const ang2 = normalizeInHalfPI(angleWithHorizontal(seg2.point1(), seg2.point2()));
    if (Math.abs(ang1 - ang2) > 0.1) return false; // about 6 degrees

    let dist1 = getDistance(seg1.point1(), seg2.point1());
    let dist2 = getDistance(seg1.point1(), seg2.point2());
    if (dist1 < dist2) dist2 = getDistance(seg1.point2(), seg2.point2());
    else dist1 = getDistance(seg1.point2(), seg2.point1());
    if (dist1 < 4 && dist2 < 4) return true; // very close
    const maxGap = 2 * this.config.multiStrokePathJoinDist;
    if (dist1 > maxGap && dist2 > maxGap) return false;
    const big = Math.max(dist1, dist2);
    const small = Math.min(dist1, dist2);
    return big * 0.14 < small;
  }
}
