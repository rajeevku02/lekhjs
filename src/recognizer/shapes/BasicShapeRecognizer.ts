// Classifies a convex poly by its main-angle count into a line, polyline/polygon, curve or ellipse
// (port of C++ `recognizer::BasicShapeRecognizer` and `RecognitionConfig`). The three threshold
// sets are frozen constants, not C++ globals. The C++ trace `log()` calls are compiled out there
// (the body is commented) and are dropped.
import { CurveFitter, EllipseFitter, getDistance, type Point } from '../../geometry';
import { at, getConnectDistance } from '../lines/RecognizerUtil';
import type { LinePart } from '../lines/StrokeLine';
import type { CxPoly } from '../polys/CxPoly';
import { BasicShape, type BasicShapeInit } from '../polys/PolyFeatures';

/** C++ `RecognitionConfig::RecognitionContext`. */
export const RecognitionContext = Object.freeze({ Regular: 0, Path: 1, Connection: 2 } as const);
export type RecognitionContext = (typeof RecognitionContext)[keyof typeof RecognitionContext];

/** C++ `RecognitionConfig`: the smoothness thresholds of one recognition context. */
export interface RecognitionConfig {
  readonly context: RecognitionContext;
  readonly smoothness: number;
  readonly smoothnessOneTurnSmallAngle: number;
  readonly smoothnessOneTurnRegular: number;
  readonly smoothnessTwoTurnsRegular: number;
  readonly smoothnessForCircle: number;
  readonly smoothnessForEllipse: number;
}

/** C++ `recognitionConfigRegular`. */
export const recognitionConfigRegular: RecognitionConfig = Object.freeze({
  context: RecognitionContext.Regular,
  smoothness: 0.2,
  smoothnessOneTurnSmallAngle: 0.35,
  smoothnessOneTurnRegular: 0.5,
  smoothnessTwoTurnsRegular: 0.35,
  smoothnessForCircle: 0.4,
  smoothnessForEllipse: 0.35,
});

/** C++ `recognitionConfigForPath`. */
export const recognitionConfigForPath: RecognitionConfig = Object.freeze({
  context: RecognitionContext.Path,
  smoothness: 0.2,
  smoothnessOneTurnSmallAngle: 0.2,
  smoothnessOneTurnRegular: 0.2,
  smoothnessTwoTurnsRegular: 0.2,
  smoothnessForCircle: 0.4,
  smoothnessForEllipse: 0.35,
});

/** C++ `recognitionConfigForConnection`. */
export const recognitionConfigForConnection: RecognitionConfig = Object.freeze({
  context: RecognitionContext.Connection,
  smoothness: 0.2,
  smoothnessOneTurnSmallAngle: 0.4,
  smoothnessOneTurnRegular: 0.5,
  smoothnessTwoTurnsRegular: 0.4,
  smoothnessForCircle: 0.4,
  smoothnessForEllipse: 0.35,
});

/** The mutable working copy a check builds before freezing it into a `BasicShape`. */
interface Draft extends BasicShapeInit {
  points: Point[];
}

function draft(): Draft {
  return { points: [] };
}

function done(d: Draft): BasicShape {
  return new BasicShape(d);
}

export class BasicShapeRecognizer {
  /** C++ `recognize(poly, rconf)`. */
  recognize(poly: CxPoly, rconf: RecognitionConfig): BasicShape {
    const features = poly.features();
    const n = features.mainAngles.length;
    if (n === 0) {
      // 0.1: one line
      const d = draft();
      d.points.push(this.firstPoint(poly), this.lastPoint(poly));
      return done(d);
    }
    const regular = rconf.context === RecognitionContext.Regular;
    if (n === 1)
      return regular ? this.checkOneAnglePattern(poly, rconf) : this.checkOneAnglePatternForPath(poly, rconf);
    if (n === 2)
      return regular ? this.checkTwoAnglesPattern(poly, rconf) : this.checkTwoAnglesPatternForPath(poly, rconf);
    if (n === 3) return this.checkThreeAnglesPattern(poly, rconf);
    if (n === 4) return this.checkManyAngles(poly, rconf, 4);
    if (n === 5) return this.checkManyAngles(poly, rconf, 5);
    if (n === 6) return this.checkManyAngles(poly, rconf, 6);
    return this.checkManyAngles(poly, rconf, 7);
  }

  private firstPoint(poly: CxPoly): Point {
    return at(poly.features().segments, 0).point1();
  }

  private lastPoint(poly: CxPoly): Point {
    const segs = poly.features().segments;
    return at(segs, segs.length - 1).point2();
  }

  /** The two-line shape: first point, the start of segment `segId`, last point. */
  private twoLines(d: Draft, poly: CxPoly, segId: number): BasicShape {
    d.points.length = 0;
    d.points.push(this.firstPoint(poly), at(poly.features().segments, segId).point1(), this.lastPoint(poly));
    return done(d);
  }

  private checkOneAnglePattern(poly: CxPoly, rconf: RecognitionConfig): BasicShape {
    const d = draft();
    const features = poly.features();
    if (features.totalAngle < 20) {
      // 1.1: one line
      d.points.push(this.firstPoint(poly), this.lastPoint(poly));
      return done(d);
    }
    if (features.totalAngle < 40 && this.isSmooth(poly, rconf.smoothnessOneTurnSmallAngle)) {
      // 1.2: curve
      this.makeCurve(d, poly);
      return done(d);
    }
    if (this.isSmooth(poly, rconf.smoothnessOneTurnRegular)) {
      // 1.2.1: curve
      this.makeCurve(d, poly);
      return done(d);
    }
    // 1.3: two lines
    return this.twoLines(d, poly, at(features.mainAngles, 0).segId);
  }

  private checkOneAnglePatternForPath(poly: CxPoly, rconf: RecognitionConfig): BasicShape {
    const d = draft();
    const features = poly.features();
    if (this.isSmooth(poly, rconf.smoothnessOneTurnRegular)) {
      // 1p.1: curve
      this.makeCurve(d, poly);
      return done(d);
    }
    if (features.totalAngle < 20) {
      // 11.2: one line
      d.points.push(this.firstPoint(poly), this.lastPoint(poly));
      return done(d);
    }
    // 1p.3: two lines
    return this.twoLines(d, poly, at(features.mainAngles, 0).segId);
  }

  private checkTwoAnglesPattern(poly: CxPoly, rconf: RecognitionConfig): BasicShape {
    const features = poly.features();
    const d = draft();
    const a0 = at(features.mainAngles, 0);
    const a1 = at(features.mainAngles, 1);
    if (features.totalAngle >= 60) {
      const min = Math.min(a0.angle, a1.angle);
      const max = Math.max(a0.angle, a1.angle);
      if (min > 0 && max / min > 3.0) {
        // 2.1: two lines, at the bigger turn
        return this.twoLines(d, poly, a0.angle < a1.angle ? a1.segId : a0.segId);
      }
    }

    this.setPoints(d, poly);
    const minSegmentLen = 15;
    if (features.angles.length === 2) {
      for (let i = 0; i < features.segments.length; i++) {
        if (at(features.segments, i).length() <= minSegmentLen) {
          // 2.2: two lines, skipping the short segment's corner
          return this.twoLines(d, poly, a0.segId === i ? a1.segId : a0.segId);
        }
      }
      if (this.isStrictLine(at(poly.lines, 1), 1)) {
        // 2.3: three lines
        return done(d);
      }
    }
    if (this.isSmooth(poly, rconf.smoothnessTwoTurnsRegular)) {
      if (this.smallCirclePrecondition(poly, 3)) {
        // 2.4.1: circle/ellipse
        this.makeEllipse(d, poly);
        return done(d);
      }
      // 2.4: curve
      this.makeCurve(d, poly);
      return done(d);
    }
    // 2.5: three lines
    return done(d);
  }

  private checkTwoAnglesPatternForPath(poly: CxPoly, rconf: RecognitionConfig): BasicShape {
    const d = draft();
    this.setPoints(d, poly);
    if (this.isSmooth(poly, rconf.smoothnessTwoTurnsRegular)) {
      if (this.smallCirclePrecondition(poly, 3)) {
        this.makeEllipse(d, poly);
        return done(d);
      }
      this.makeCurve(d, poly);
      return done(d);
    }
    return done(d);
  }

  /**
   * C++ `for (i = 0; i <= angles.size(); i++) isStrickLine(poly->lines()[i], 2.0)`: every part a
   * strict line. The C++ reads past the end of `lines()` (undefined behaviour) when a part
   * produced more than one segment; here a missing part counts as not strict.
   */
  private allPartsStrict(poly: CxPoly): boolean {
    const n = poly.features().angles.length;
    for (let i = 0; i <= n; i++) {
      const lp = poly.lines[i];
      if (lp === undefined || !this.isStrictLine(lp, 2.0)) return false;
    }
    return true;
  }

  private checkThreeAnglesPattern(poly: CxPoly, rconf: RecognitionConfig): BasicShape {
    const features = poly.features();
    const d = draft();
    this.setPoints(d, poly);

    if (this.isSmooth(poly, rconf.smoothness) && this.smallCirclePrecondition(poly, 4)) {
      // 3.1.1: circle/ellipse
      this.makeEllipse(d, poly);
      return done(d);
    }
    if (poly.closed()) {
      // 3.1: three lines, closed
      d.isClosed = true;
      return done(d);
    }
    if (
      features.angles.length === features.mainAngles.length &&
      rconf.context === RecognitionContext.Regular &&
      this.allPartsStrict(poly)
    ) {
      // 3.2: four lines
      return done(d);
    }
    if (this.checkClosedForCircle(poly) && this.isCircle(poly, rconf)) {
      // 3.3.1: circle/ellipse
      this.makeEllipse(d, poly);
      return done(d);
    }
    if (!this.checkClosedForCircle(poly) && this.isSmooth(poly, rconf.smoothness)) {
      // 3.3: curve
      this.makeCurve(d, poly);
      return done(d);
    }
    // 3.4: four lines
    return done(d);
  }

  /**
   * C++ `checkFourAnglesPattern` (n = 4), `checkFiveAnglesPattern` (5), `checkSixAnglesPattern`
   * (6) and `checkManyAnglesPattern` (7 = more): the same order of tests; only four angles also
   * try the all-strict-lines open figure.
   */
  private checkManyAngles(poly: CxPoly, rconf: RecognitionConfig, n: 4 | 5 | 6 | 7): BasicShape {
    const features = poly.features();
    const d = draft();
    this.setPoints(d, poly);

    if (this.checkClosedForCircle(poly) && this.isCircle(poly, rconf)) {
      this.makeEllipse(d, poly);
      return done(d);
    }
    if (poly.closed()) return done(d);
    if (
      n === 4 &&
      features.angles.length === features.mainAngles.length &&
      rconf.context === RecognitionContext.Regular &&
      this.allPartsStrict(poly)
    ) {
      // 4.2: five lines
      return done(d);
    }
    if (!this.checkClosedForCircle(poly) && this.isSmooth(poly, rconf.smoothness)) {
      this.makeCurve(d, poly);
      return done(d);
    }
    return done(d);
  }

  /** C++ `makeCurve`: one cubic through the raw points; when the fit fails, not a curve. */
  private makeCurve(d: Draft, poly: CxPoly): void {
    d.isCurve = true;
    const curves = CurveFitter.fitSingle(poly.getRawPoints(), 70);
    const c = curves[0];
    if (curves.length === 1 && c !== undefined && c.numPoints === 4) {
      d.points = c.getPoints();
      d.bezier = c;
    } else {
      d.isCurve = false;
    }
    d.bound = poly.bound();
  }

  /** C++ `makeEllipse`: the ellipse fitted to the raw points; the points are kept. */
  private makeEllipse(d: Draft, poly: CxPoly): void {
    d.isEllipse = true;
    d.isClosed = true;
    d.ellipse = new EllipseFitter(poly.getRawPoints()).fit();
  }

  /** C++ `setPoints`: the main-angle vertices (plus the ends when open). */
  private setPoints(d: Draft, poly: CxPoly): void {
    const features = poly.features();
    d.points.push(...features.getPoints(poly.closed(), features.mainAngles));
    d.isClosed = poly.closed();
  }

  private isSmooth(poly: CxPoly, factor: number): boolean {
    return poly.smoothness() >= factor;
  }

  private isCircle(poly: CxPoly, conf: RecognitionConfig): boolean {
    const ellipse = new EllipseFitter(poly.getRawPoints()).fit();
    const big = Math.max(ellipse.width, ellipse.height);
    const small = Math.min(ellipse.width, ellipse.height);
    if (small > 0.1 && big / small > 2) return poly.smoothness() >= conf.smoothnessForEllipse;
    return poly.smoothness2() >= conf.smoothnessForCircle;
  }

  /** C++ `isStrickLine`. */
  private isStrictLine(lp: LinePart, cost: number): boolean {
    return lp.line.cost.start <= cost;
  }

  private checkClosedForCircle(poly: CxPoly): boolean {
    const bound = poly.bound();
    const allowed = getConnectDistance(bound.height + bound.width, poly.env.config);
    return getDistance(poly.firstPoint(), poly.lastPoint()) <= allowed;
  }

  private smallCirclePrecondition(poly: CxPoly, numLines: number): boolean {
    const angle = numLines === 3 ? 200 : 225;
    const bound = poly.bound();
    if (bound.width < 50 && bound.height < 50 && poly.features().totalAngle >= angle) {
      const allowed = getConnectDistance(bound.height + bound.width, poly.env.config);
      return getDistance(poly.firstPoint(), poly.lastPoint()) <= allowed;
    }
    return false;
  }
}
