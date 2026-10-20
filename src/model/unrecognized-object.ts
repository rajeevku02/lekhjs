// A free-hand stroke kept as ink (port of C++ `UnrecognizedObject`, `L/object/TemplatedObject.cpp`;
// spec 02: canonical name `UnrecognizedObject`, kind `freehand`, stored type unchanged). It has no
// template: its points are stored normalised to its box (`points_`) and regenerated into canvas
// coordinates (`actualPoints_`) by `generateData`.
//
// Ported as is, including: the paint loop runs over `points_.length` while reading
// `actualPoints_`; it is never "inside" (only near); it cannot flip although `flip` works. One
// guard: C++ `getDistanceFrom` underflowed `size() - 1` on an empty stroke; here an empty or
// one-point stroke is `INT_MAX` away.
import { INT_MAX } from '../base';
import { distanceToSegment, Point, Rect, getDistance, getMidPoint, getPointsBound, rotateAboutMid } from '../geometry';
import type { DrawingPlatform } from '../render';
import type { InterestingPoint } from '../template';
import type { LayoutGeometry, PaintEnv } from './lekh-object';
import { ObjectKind } from './lekh-object';
import { BoundsPlatform } from './bounds-platform';
import type { ObjectEnv } from './object-env';
import { TemplatedObject } from './templated-object';

export class UnrecognizedObject extends TemplatedObject {
  override readonly kind: ObjectKind = ObjectKind.Freehand;
  /** The stroke, each point as a fraction of the box (C++ `points_`). */
  private points_: Point[] = [];
  /** The stroke in canvas coordinates (C++ `actualPoints_`). */
  private actualPoints_: Point[] = [];
  closed = false;

  /** C++ `UnrecognizedObject(pts)`: closed when its ends are nearer than `closeDistForUnrecognized`. */
  constructor(env: ObjectEnv, pts: readonly Point[] = [], id?: string) {
    super(env, null, new Rect(), 0, null, id);
    this.ds.setAngle(0);
    this.ds.setRect(new Rect());
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first !== undefined && last !== undefined) {
      this.initWithPoints(pts);
      this.closed = getDistance(first, last) < env.config.closeDistForUnrecognized;
      this.generateData();
    }
  }

  /** The io codec's constructor: normalised points and a box as stored. */
  static fromStored(
    env: ObjectEnv,
    normalized: readonly Point[],
    rect: Rect,
    angle: number,
    closed: boolean,
    id?: string,
  ): UnrecognizedObject {
    const o = new UnrecognizedObject(env, [], id);
    o.points_ = normalized.slice();
    o.ds.setRect(rect);
    o.ds.setAngle(angle);
    o.closed = closed;
    o.generateData();
    return o;
  }

  override name(): string {
    return 'Unrecognized';
  }

  /** The normalised points (what the file stores). */
  normalizedPoints(): readonly Point[] {
    return this.points_;
  }

  /** The stroke in canvas coordinates. */
  actualPoints(): readonly Point[] {
    return this.actualPoints_;
  }

  private initWithPoints(pts: readonly Point[]): void {
    const rect = getPointsBound(pts).checkMinDimension(1, 1);
    this.points_ = pts.map((p) => new Point((p.x - rect.x) / rect.width, (p.y - rect.y) / rect.height));
    this.ds.setRect(rect);
  }

  /** C++ `add`: appends a drawn point, replacing the last one when it is too close; true when it did. */
  add(point: Point): boolean {
    let cleared = false;
    const n = this.actualPoints_.length;
    if (n > 2) {
      const last = this.actualPoints_[n - 2] as Point;
      if (getDistance(last, point) < this.env.config.minDistBetweenDrawnPoints) {
        this.actualPoints_.pop();
        cleared = true;
      }
    }
    this.actualPoints_.push(point);
    this.invalidate();
    return cleared;
  }

  override generateData(): void {
    const pts = this.points_;
    const rect = this.ds.rect();
    const actual = pts.map((p) => new Point(p.x * rect.width + rect.x, p.y * rect.height + rect.y));
    this.actualPoints_ = rotateAboutMid(actual, this.ds.angle());
    this.invalidate();
  }

  override saveDataExprs(): void {
    /* C++: empty */
  }
  override updatePoints(): void {
    /* C++: empty */
  }

  override distanceFrom(point: Point): number {
    let dist = INT_MAX;
    const a = this.actualPoints_;
    for (let i = 0; i + 1 < a.length; i++) {
      const d = distanceToSegment(a[i] as Point, a[i + 1] as Point, point);
      if (d < dist) dist = d;
    }
    return dist;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the base signature
  override isPointInside(_p: Point): boolean {
    return false;
  }
  override getIntersection(): [] {
    return [];
  }
  override getInterestingPoints(): InterestingPoint[] {
    return [];
  }
  override getArrowPoints(): [] {
    return [];
  }
  override canEditText(): boolean {
    return false;
  }
  override canEditTextAt(): boolean {
    return false;
  }
  override canFlip(): boolean {
    return false;
  }
  override isConnectableKind(): boolean {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the base signature
  override collectAlignmentPoints(_xs: Point[], _ys: Point[]): void {
    /* C++ `getAlignmentPointsOf` skips free-hand strokes */
  }

  /** C++ `flip`: mirrored about the unrotated points' mean (1: horizontally, 2: vertically). */
  override flip(type: number): void {
    const pts = rotateAboutMid(this.actualPoints_, -this.ds.angle());
    const center = getMidPoint(pts);
    const flipped = pts.map((p) =>
      type === 1
        ? new Point(center.x + (center.x - p.x), p.y)
        : type === 2
          ? new Point(p.x, center.y + (center.y - p.y))
          : p,
    );
    this.initWithPoints(flipped);
    this.generateData();
  }

  override flipShape(type: number): null {
    this.flip(type);
    return null;
  }

  protected override computeLayout(): LayoutGeometry {
    const visualBounds = this.getVisualBounds();
    const bp = new BoundsPlatform();
    // The stroke's start point is not reported to the bounds platform: grow the box by the reach.
    bp.addRect(visualBounds.inflate(this.drawingProfile.effectiveStrokeWidth() * 1.5));
    this.paintContent(bp);
    return { visualBounds, extent: bp.bounds() ?? visualBounds };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the base signature
  override paint(dp: DrawingPlatform, _env: PaintEnv): void {
    this.paintContent(dp);
  }

  protected override paintContent(dp: DrawingPlatform): void {
    const a = this.actualPoints_;
    const first = a[0];
    if (first === undefined) return;
    dp.startDrawing(first, this.drawingProfile);
    for (let i = 1; i < this.points_.length; i++) {
      const p = a[i];
      if (p !== undefined) dp.addLineTo(p);
    }
    if (this.closed) dp.closePath();
    dp.endDrawing();
  }

  override clone(): UnrecognizedObject {
    const obj = UnrecognizedObject.fromStored(this.env, this.points_, this.ds.rect(), this.ds.angle(), false);
    this.copyBaseTo(obj);
    obj.generateData();
    return obj;
  }
}
