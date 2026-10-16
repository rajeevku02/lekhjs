// A candidate shape built from a poly, with its attributes (port of C++ `recognizer::Shape`,
// renamed `RecShape` so it does not clash with `geometry::Shape`; spec 07 §2.1). The C++ friends
// (`ShapeExtender`, …) write its fields directly; here they are public and documented.
// Dropped: the never-set `segAttrs`/`eqAttrs` maps, and `removeFromPolyColl` (only the dead
// `ShapeColl::remove` called it, R8).
import { BezierCurve, Ellipse, getDistance, Quadrilateral, Rect, toDegree, TurnDir, type Point } from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import { canClose } from '../lines/RecognizerUtil';
import type { CxPoly } from '../polys/CxPoly';
import type { PolyColl } from '../polys/PolyColl';
import { BasicType } from '../polys/PolyFeatures';

/** C++ `ShapeAttrs`: the attribute names. */
export const ShapeAttrs = Object.freeze({
  numLines: 'numLines',
  closed: 'closed',
  dir: 'dir',
  firstPoint: 'firstPoint',
  lastPoint: 'lastPoint',
  midPoint: 'midPoint',
  turn: 'turn',
  width: 'width',
  height: 'height',
  perimeter: 'perimeter',
  center: 'center',
  type: 'type',
  side: 'side',
  segment: 'segment',
} as const);

/** C++ `ShapeNames`. */
export const ShapeNames = Object.freeze({
  poly: 'poly',
  polygon: 'polygon',
  curve: 'curve',
  circle: 'circle',
  ellipse: 'ellipse',
  arrow: 'arrow',
} as const);

/** The direction of the chord from `p1` to `p2`, degrees. */
function chordAngle(p1: Point, p2: Point): number {
  return toDegree(Math.atan2(p2.y - p1.y, p2.x - p1.x));
}

/** C++ `nameFromPoly`. */
function nameFromPoly(poly: CxPoly): string {
  switch (poly.shape().type()) {
    case BasicType.Curve:
      return ShapeNames.curve;
    case BasicType.Poly:
      return ShapeNames.poly;
    case BasicType.Polygon:
      return ShapeNames.polygon;
    case BasicType.Ellipse:
      return ShapeNames.ellipse;
    default:
      return 'Unknown';
  }
}

export class RecShape {
  name = '';
  id = 0;
  readonly numberAttrs = new Map<string, number>();
  readonly pointAttrs = new Map<string, Point>();
  readonly boolAttrs = new Map<string, boolean>();
  points: Point[] = [];
  /** The poly collection the shape's polys belong to; null for a shape made by joining others. */
  polyColl: PolyColl | null = null;
  polys: CxPoly[] = [];
  children: RecShape[] = [];
  basicType: BasicType = BasicType.NotBasic;
  ellipse: Ellipse = new Ellipse();
  curve: BezierCurve = new BezierCurve();
  bound: Rect = new Rect();
  extensible = true;
  final = false;

  /** C++ `Shape(CxPoly::Ptr, PolyColl*)`. */
  static fromPoly(poly: CxPoly, coll: PolyColl): RecShape {
    const s = new RecShape();
    s.name = nameFromPoly(poly);
    s.polyColl = coll;
    s.polys.push(poly);
    s.final = false;
    s.updateFromPoly();
    s.extensible = true;
    return s;
  }

  /** The `perimeter` attribute, if set (what closed-shape detection reads). */
  get perimeter(): number | undefined {
    return this.numberAttrs.get(ShapeAttrs.perimeter);
  }

  isFinal(): boolean {
    return this.final;
  }

  /** C++ `copyFrom`: every field but the id. */
  copyFrom(other: RecShape): void {
    copyMap(other.numberAttrs, this.numberAttrs);
    copyMap(other.pointAttrs, this.pointAttrs);
    copyMap(other.boolAttrs, this.boolAttrs);
    this.points = other.points.slice();
    this.polyColl = other.polyColl;
    this.polys = other.polys.slice();
    this.children = other.children.slice();
    this.basicType = other.basicType;
    this.ellipse = other.ellipse.clone();
    this.curve = other.curve.clone();
    this.bound = other.bound;
    this.extensible = other.extensible;
    this.final = other.final;
    this.name = other.name;
  }

  private updateFromPoly(): void {
    const poly = this.polys[0] as CxPoly;
    const basic = poly.shape();
    this.points = basic.points.slice();
    this.basicType = basic.type();
    this.bound = basic.bound;
    if (this.basicType === BasicType.Ellipse) this.ellipse = basic.ellipse.clone();
    else if (this.basicType === BasicType.Curve) this.curve = basic.bezier.clone();

    this.boolAttrs.set(ShapeAttrs.closed, basic.isClosed);
    // C++ assigns `size() - 1` as size_t (huge when empty); the attribute is never read.
    this.numberAttrs.set(ShapeAttrs.numLines, basic.isClosed ? basic.points.length : basic.points.length - 1);

    const f = poly.features();
    this.numberAttrs.set(ShapeAttrs.turn, f.totalAngle);
    this.numberAttrs.set(ShapeAttrs.width, f.width);
    this.numberAttrs.set(ShapeAttrs.height, f.height);
    this.numberAttrs.set(ShapeAttrs.perimeter, f.perimeter);

    this.pointAttrs.set(ShapeAttrs.firstPoint, poly.firstPoint());
    this.pointAttrs.set(ShapeAttrs.lastPoint, poly.lastPoint());

    const dir =
      poly.turnDir === TurnDir.Left
        ? chordAngle(poly.firstPoint(), poly.lastPoint())
        : chordAngle(poly.lastPoint(), poly.firstPoint());
    this.numberAttrs.set(ShapeAttrs.dir, dir);
  }

  /** C++ `tryClose`: an open poly whose ends can meet after turning > 180° becomes a polygon. */
  tryClose(config: RecognizerConfig): void {
    if (this.name !== ShapeNames.poly || this.points.length <= 3) return;
    const turn = this.numberAttrs.get(ShapeAttrs.turn) ?? 0;
    const first = this.points[0] as Point;
    const last = this.points[this.points.length - 1] as Point;
    const gap = getDistance(first, last);
    const size = Math.min(this.numberAttrs.get(ShapeAttrs.width) ?? 0, this.numberAttrs.get(ShapeAttrs.height) ?? 0);
    if (canClose(gap, size, config) && turn > 180) {
      this.name = ShapeNames.polygon;
      this.points.pop();
      this.boolAttrs.set(ShapeAttrs.closed, true);
      this.numberAttrs.set(ShapeAttrs.numLines, this.points.length);
      this.final = true;
    }
  }

  /** C++ `polysOverlap`: both from the same poly collection and some parts overlap by 5. */
  polysOverlap(other: RecShape): boolean {
    if (this.polys.length === 0 || other.polys.length === 0 || this.polyColl === null || other.polyColl === null) {
      return false;
    }
    if (other.polyColl !== this.polyColl) return false;
    return this.polyColl.hasOverlap(this.polys, other.polys, 5);
  }

  /** C++ `regualize`: a four-vertex polygon is regularised as a quadrilateral. */
  regularize(config: RecognizerConfig): void {
    if (this.name !== ShapeNames.polygon || this.points.length !== 4) return;
    const [p0, p1, p2, p3] = this.points as [Point, Point, Point, Point];
    const quad = new Quadrilateral(p0, p1, p2, p3);
    quad.regularize(config);
    this.points[0] = quad.p1();
    this.points[1] = quad.p2();
    this.points[2] = quad.p3();
    this.points[3] = quad.p4();
  }
}

function copyMap<V>(from: ReadonlyMap<string, V>, to: Map<string, V>): void {
  to.clear();
  for (const [k, v] of from) to.set(k, v);
}
