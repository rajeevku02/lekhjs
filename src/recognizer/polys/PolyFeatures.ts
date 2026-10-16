// The value types around a convex poly (port of the C++ structs in `recognizer/CxPoly.h`:
// `PolyAngle`, `PolyFeatures`, `BasicShape`, `BasicType`), plus `PolyEnv`, the slice of the job
// context a poly reads.
import { BezierCurve, Ellipse, Rect, type LineSegment, type Point } from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { RecognizerQuirks } from '../core/RecognizerContext';
import type { LineAggregatorModule } from '../lines/LineAggregatorModule';
import { at } from '../lines/RecognizerUtil';
import type { CxPoly } from './CxPoly';

/**
 * What a poly reads from the job: the config, the line aggregator's static cost functions (for
 * the smoothness features), the quirk flags, and the basic-shape classifier. A
 * `RecognizerContext` is a `PolyEnv` once the classifier is added (task R2 supplies
 * `BasicShapeRecognizer` with `recognitionConfigRegular`).
 */
export interface PolyEnv {
  readonly config: RecognizerConfig;
  readonly lineAggregator: LineAggregatorModule;
  readonly quirks: RecognizerQuirks;
  /** C++ `CxPoly::shape()`'s default: `BasicShapeRecognizer.recognize(poly, regular)`. */
  readonly classifyBasicShape?: (poly: CxPoly) => BasicShape;
}

/** C++ `PolyAngle`: the turn at the start of segment `segId` (degrees), and that segment's length. */
export interface PolyAngle {
  readonly angle: number;
  readonly len: number;
  readonly segId: number;
}

/** C++ `PolyFeatures`: the measured features of one poly (filled by `CxPoly.features()`). */
export class PolyFeatures {
  segments: LineSegment[] = [];
  angles: PolyAngle[] = [];
  mainAngles: PolyAngle[] = [];
  totalAngle = 0;
  width = 0;
  height = 0;
  perimeter = 0;
  /** -1 until computed. */
  smoothness = -1;
  /** -1 until computed. */
  smoothness2 = -1;

  /**
   * C++ `PolyFeatures::getPoints`: the start points of the segments the angles name (in segment
   * order), plus the first and last ends when the poly is open.
   */
  getPoints(closed: boolean, angles: readonly PolyAngle[]): Point[] {
    const ids = angles.map((a) => (a.segId >= this.segments.length ? 0 : a.segId));
    ids.sort((a, b) => a - b);
    const result = ids.map((id) => at(this.segments, id).point1());
    if (!closed) {
      result.unshift(at(this.segments, 0).point1());
      result.push(at(this.segments, this.segments.length - 1).point2());
    }
    return result;
  }
}

/** C++ `BasicType`. */
export const BasicType = Object.freeze({ NotBasic: 0, Poly: 1, Polygon: 2, Curve: 3, Ellipse: 4 } as const);
export type BasicType = (typeof BasicType)[keyof typeof BasicType];

/** The fields of a `BasicShape` (C++ private members set by its friend `BasicShapeRecognizer`). */
export interface BasicShapeInit {
  isCurve?: boolean;
  isClosed?: boolean;
  isEllipse?: boolean;
  rotation?: number;
  width?: number;
  height?: number;
  points?: readonly Point[];
  bound?: Rect;
  bezier?: BezierCurve;
  ellipse?: Ellipse;
}

/** C++ `BasicShape`: what `BasicShapeRecognizer` made of a poly. Immutable. */
export class BasicShape {
  readonly isCurve: boolean;
  readonly isClosed: boolean;
  readonly isEllipse: boolean;
  readonly rotation: number;
  readonly width: number;
  readonly height: number;
  readonly points: readonly Point[];
  readonly bound: Rect;
  readonly bezier: BezierCurve;
  readonly ellipse: Ellipse;

  constructor(init: BasicShapeInit = {}) {
    this.isCurve = init.isCurve ?? false;
    this.isClosed = init.isClosed ?? false;
    this.isEllipse = init.isEllipse ?? false;
    this.rotation = init.rotation ?? 0;
    this.width = init.width ?? 0;
    this.height = init.height ?? 0;
    this.points = init.points ?? [];
    this.bound = init.bound ?? new Rect();
    this.bezier = init.bezier ?? new BezierCurve();
    this.ellipse = init.ellipse ?? new Ellipse();
  }

  /** C++ `BasicShape::type()`: ellipse, else curve, else polygon (closed), else poly. */
  type(): BasicType {
    if (this.isEllipse) return BasicType.Ellipse;
    if (this.isCurve) return BasicType.Curve;
    if (this.isClosed) return BasicType.Polygon;
    return BasicType.Poly;
  }
}
