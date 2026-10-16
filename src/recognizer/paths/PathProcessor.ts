// Final processing of an open path that might be a closed figure (port of C++
// `recognizer::PathProcessor` and `PolySideReducer`): after cutting a small trailing loop, a path
// that can be made convex becomes an ellipse (mostly curves, strictly convex) or a polygon fitted
// by `PolyMatcher` to the hull of the raw line path (or of the path itself).
import {
  EllipseFitter,
  getAngle,
  GeoShape,
  hasLoop,
  isConvex,
  LineSegment,
  PathComponent,
  SimplePath,
  SimplePolygon,
} from '../../geometry';
import type { Point } from '../../geometry';
import { at } from '../lines/RecognizerUtil';
import { PolyMatcher } from '../shapes/PolyMatcher';

/** C++ `PolySideReducer`: keeps the vertices with the biggest turns until `pct` % of the turning. */
export class PolySideReducer {
  private pts: Point[];
  private readonly pct: number;
  private angles: { angle: number; included: boolean }[] = [];
  private totalAngle = 0;

  constructor(points: readonly Point[], pct: number) {
    this.pts = points.slice();
    this.pct = pct;
  }

  points(): readonly Point[] {
    return this.pts;
  }

  process(): void {
    this.getAngles();
    let sum = 0;
    const next = (): number => {
      let val = 0;
      let idx = -1;
      let found = false;
      this.angles.forEach((a, i) => {
        if (!a.included && (!found || a.angle > val)) {
          found = true;
          idx = i;
          val = a.angle;
        }
      });
      return idx;
    };
    let idx = next();
    let count = 0;
    // (sum * 100) / 0 is NaN for an empty polygon, and the loop does not run, as in C++.
    while (idx >= 0 && (sum * 100) / this.totalAngle < this.pct) {
      const a = at(this.angles, idx);
      a.included = true;
      sum += a.angle;
      count++;
      idx = next();
    }
    if (count === this.pts.length) return;
    const tmp: Point[] = [];
    this.angles.forEach((a, i) => {
      if (a.included) tmp.push(at(this.pts, (i + 1) % this.pts.length));
    });
    this.pts = tmp;
  }

  private getAngles(): void {
    this.totalAngle = 0;
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const step = getAngle(at(this.pts, i), at(this.pts, (i + 1) % n), at(this.pts, (i + 2) % n));
      this.totalAngle += step;
      this.angles.push({ angle: step, included: false });
    }
  }
}

export class PathProcessor {
  private readonly input: SimplePath;
  private readonly rawLinePath: SimplePath;
  private readonly output = new SimplePath();
  private result: GeoShape | null = null;
  private convexPts: Point[] = [];
  private isConvexFlag = false;
  private usedAlternate = false;

  /** `input` is the recognised path; `rawLinePath` the straight path through the stroke's lines (may be empty). */
  constructor(input: SimplePath, rawLinePath: SimplePath) {
    this.input = input;
    this.rawLinePath = rawLinePath;
  }

  path(): SimplePath {
    return this.output;
  }

  shape(): GeoShape | null {
    return this.result;
  }

  convexPoints(): readonly Point[] {
    return this.convexPts;
  }

  convex(): boolean {
    return this.isConvexFlag;
  }

  usedAlternatePath(): boolean {
    return this.usedAlternate;
  }

  /** C++ `process()`: true when the path became an ellipse (`shape()`) or a closed polygon (`path()`). */
  process(): boolean {
    const paths = this.input.findFirstLoop();
    let path: SimplePath | null = null;
    if (paths.length === 2) {
      const len1 = (paths[0] as SimplePath).length();
      const len2 = (paths[1] as SimplePath).length();
      // Ignore a very small loop part.
      if (len1 > 16 && len2 / (len1 + len2) < 0.15) path = paths[0] as SimplePath;
    } else if (paths.length === 0) {
      path = this.input;
    }
    if (path === null || path.size === 0) return false;

    const poly = SimplePolygon.fromPath(path);
    if (!poly.canMakeConvex()) return false;

    // A stricter convexity test for the ellipse.
    this.checkConvex();
    if (this.isConvexFlag && this.checkEllipse()) return true;

    let vtx: Point[];
    if (this.rawLinePath.size > 0) {
      const sp = new SimplePolygon(this.rawLinePath.points());
      sp.computeHull();
      vtx = sp.vertices().slice();
      this.usedAlternate = true;
    } else {
      vtx = poly.vertices().slice();
    }
    this.convexPts = vtx;

    const polym = new PolyMatcher(vtx);
    polym.process();
    this.output.reset();
    this.output.setClosed(true);
    const vertices = polym.vertices();
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      this.output.push(PathComponent.ofSegment(new LineSegment(at(vertices, i), at(vertices, j))));
    }
    return true;
  }

  /** C++ `checkEllipse`: at least two curves carrying 90 % of the length → an ellipse. */
  private checkEllipse(): boolean {
    if (this.input.curveCount() < 2) return false;
    let lineLen = 0;
    let curveLen = 0;
    for (const pc of this.input.components) {
      if (pc.isCurve) {
        for (const seg of pc.curve.approxLines()) curveLen += seg.length();
      } else {
        lineLen += pc.segment.length();
      }
    }
    const sum = lineLen + curveLen;
    if (sum < 1) return false;
    if (curveLen / sum < 0.9) return false;
    const shape = new GeoShape();
    shape.setEllipse(new EllipseFitter(this.convexPts).fit());
    this.result = shape;
    return true;
  }

  /**
   * C++ `checkConvex`: the path's points (the closing point dropped), reduced to the main turns,
   * must not loop and must turn one way. (C++ `closed_` is never set, so `closePoint_` is unused.)
   */
  private checkConvex(): void {
    this.isConvexFlag = false;
    const reducer = new PolySideReducer(this.getPoints(), 90);
    reducer.process();
    this.convexPts = reducer.points().slice();
    if (this.convexPts.length < 3) {
      this.isConvexFlag = true;
      return;
    }
    this.isConvexFlag = hasLoop(this.convexPts) ? false : isConvex(this.convexPts);
  }

  private getPoints(): Point[] {
    const result: Point[] = [];
    for (const item of this.input.components) {
      if (item.isCurve) {
        const segs = item.curve.approxLines();
        if (result.length === 0) result.push(at(segs, 0).point1());
        for (const seg of segs) result.push(seg.point2());
      } else {
        if (result.length === 0) result.push(item.segment.point1());
        result.push(item.segment.point2());
      }
    }
    // The points of a closed figure: the last point is the first one. (B7: guarded when empty.)
    if (result.length > 0) result.pop();
    return result;
  }
}
