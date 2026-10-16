// A group of objects (port of C++ `GroupObject`, `L/object/GroupObject.{h,cpp}`). It derives from
// `TemplatedObject` and answers no template. Each member is held with the factors that put it back
// in the group's box when the group is transformed (`ContainedObject`).
//
// Ported as is (KB document-model "GroupObject"):
// - constructing a group over live objects writes to them (`setRect` → `generateData` assigns each
//   member's rect and angle);
// - `index` is the order within the group and `order` the stacking order: distinct;
// - the live style is a `GroupStyle` copying member 0 (OQ-13: a group restyle's group-level style
//   is never read);
// - the member sort is C++'s exchange sort, which is not stable for equal orders.
// `performClone` (undo manager, clone displacement) belongs to `edit/`.
import { Point, Rect, getDistance, getMidPoint, normalizeInHalfPI, rotate, scaleAnchored } from '../geometry';
import type { DrawingPlatform } from '../render';
import { GroupStyle, type Style } from '../style';
import { INT_MAX } from '../base';
import type { InterestingPoint } from '../template';
import { BoundsPlatform } from './bounds-platform';
import type { LayoutEnv, LayoutGeometry, LekhObject, ModificationContext, PaintEnv } from './lekh-object';
import { ObjectKind } from './lekh-object';
import type { ObjectEnv } from './object-env';
import { TemplatedObject } from './templated-object';

/** C++ `GroupObject::ContainedObject`. */
export interface ContainedObject {
  xfactor: number;
  yfactor: number;
  origAngle: number;
  origRect: Rect;
  /** The member's order within the group (C++ stores the member's `order()` here at grouping). */
  index: number;
  object: TemplatedObject;
}

const AngleType = Object.freeze({ Zero: 0, Perpendicular: 1, Tilted: 2 } as const);
type AngleType = (typeof AngleType)[keyof typeof AngleType];

/** C++ `isLineObject`: one path segment, and it is a line. */
function isLineObject(obj: TemplatedObject): boolean {
  const paths = obj.paths();
  if (paths === null || paths.length === 0) return false;
  let lineCount = 0;
  for (const path of paths) {
    for (const shape of path.shapes()) {
      if (shape.command === 'M') continue;
      if (shape.command === 'L' || shape.command === 'H' || shape.command === 'V') {
        lineCount++;
        if (lineCount > 1) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

export class GroupObject extends TemplatedObject {
  override readonly kind: ObjectKind = ObjectKind.Group;
  private objects_: ContainedObject[] = [];
  private readonly groupStyle_ = new GroupStyle();
  private origWidth_ = 0;
  private origHeight_ = 0;

  /** C++ `GroupObject(shapes)`: the members' box; members sorted by `order`; writes to them. */
  constructor(env: ObjectEnv, shapes: readonly TemplatedObject[] = [], id?: string) {
    super(env, null, new Rect(), 0, null, id);
    const first = shapes[0];
    if (first === undefined) return;
    let rect = first.selectionRect();
    for (const obj of shapes) {
      this.objects_.push({ xfactor: 0, yfactor: 0, origAngle: 0, origRect: new Rect(), index: obj.order, object: obj });
      rect = rect.includeRect(obj.selectionRect());
    }
    const o = this.objects_;
    for (let i = 0; i < o.length; i++) {
      for (let j = i + 1; j < o.length; j++) {
        if ((o[i] as ContainedObject).index > (o[j] as ContainedObject).index) {
          const tmp = o[i] as ContainedObject;
          o[i] = o[j] as ContainedObject;
          o[j] = tmp;
        }
      }
    }
    const rc = rect.center();
    for (const co of o) {
      const center = co.object.getCenter();
      co.xfactor = (center.x - rc.x) / rect.width;
      co.yfactor = (center.y - rc.y) / rect.height;
      co.origRect = co.object.unrotatedRect();
      co.origAngle = co.object.rotation();
    }
    this.ds.setAngle(0);
    this.origHeight_ = rect.height;
    this.origWidth_ = rect.width;
    this.setRect(rect);
    this.initDrawingProfile();
  }

  /** The io codec's constructor: members and factors as stored. */
  static fromStored(
    env: ObjectEnv,
    objects: readonly ContainedObject[],
    rect: Rect,
    angle: number,
    origWidth: number,
    origHeight: number,
    id?: string,
  ): GroupObject {
    const g = new GroupObject(env, [], id);
    g.objects_ = objects.map((c) => ({ ...c }));
    g.origWidth_ = origWidth;
    g.origHeight_ = origHeight;
    g.ds.setRect(rect);
    g.ds.setAngle(angle);
    g.generateData();
    g.initDrawingProfile();
    return g;
  }

  override name(): string {
    return 'Group';
  }

  /** C++ `objects()`. */
  objects(): readonly ContainedObject[] {
    return this.objects_;
  }

  override members(): readonly LekhObject[] {
    return this.objects_.map((c) => c.object);
  }

  origWidth(): number {
    return this.origWidth_;
  }
  origHeight(): number {
    return this.origHeight_;
  }

  private initDrawingProfile(): void {
    this.groupStyle_.setProfiles(this.objects_.map((c) => c.object.getDrawingProfile()));
  }

  override getDrawingProfile(): Style {
    return this.groupStyle_;
  }

  override styleRevision(): number {
    let sum = 0;
    for (const c of this.objects_) sum += c.object.styleRevision();
    return sum;
  }

  private newAngleFor(index: number): { angle: number; type: AngleType } {
    const co = this.objects_[index] as ContainedObject;
    const sa = co.origAngle;
    const aa = Math.abs(normalizeInHalfPI(sa));
    const tol = 0.0001;
    if (aa < tol) return { angle: sa, type: AngleType.Zero };
    if (Math.abs(aa - Math.PI / 2) < tol) return { angle: sa, type: AngleType.Perpendicular };
    const dx = this.ds.width() / this.origWidth_;
    const dy = this.ds.height() / this.origHeight_;
    return { angle: Math.atan2(Math.sin(sa) * dy, Math.cos(sa) * dx), type: AngleType.Tilted };
  }

  /** C++ `generateData`: every member's rect and angle from the group's box and its factors. */
  override generateData(): void {
    const objs = this.objects_;
    const rect = this.ds.rect();
    const rc = rect.center();
    for (let i = 0; i < objs.length; i++) {
      const co = objs[i] as ContainedObject;
      const xo = rect.width * co.xfactor;
      const yo = rect.height * co.yfactor;
      const rad = Math.sqrt(xo * xo + yo * yo);
      const ang = Math.atan2(yo, xo) + this.ds.angle();
      const x = rc.x + rad * Math.cos(ang);
      const y = rc.y + rad * Math.sin(ang);
      const dx = this.ds.width() / this.origWidth_;
      const dy = this.ds.height() / this.origHeight_;
      let w = dx * co.origRect.width;
      let h = dy * co.origRect.height;
      const na = this.newAngleFor(i);
      let angle = na.angle;
      const type = na.type;
      if (type === AngleType.Perpendicular) {
        w = dy * co.origRect.width;
        h = dx * co.origRect.height;
      } else if (type === AngleType.Tilted) {
        if (isLineObject(co.object)) {
          // w·cos(a) = new horizontal width = old horizontal width · cos(ao) · dx
          w = (co.origRect.width * Math.cos(co.origAngle) * dx) / Math.cos(angle);
        } else {
          let pts = co.origRect.getPoints();
          let topLeft = 0;
          let topRight = 0;
          let botLeft = 0;
          let left = pts[0] as Point;
          let right = pts[0] as Point;
          let bot = pts[0] as Point;
          for (let k = 1; k < pts.length; k++) {
            const p = pts[k] as Point;
            if (p.x <= left.x && p.y >= left.y) {
              topLeft = k;
              left = p;
            }
            if (p.x >= right.x && p.y >= right.y) {
              topRight = k;
              right = p;
            }
            if (p.x <= bot.x && p.y <= bot.y) {
              botLeft = k;
              bot = p;
            }
          }
          pts = rotate(pts, getMidPoint(pts), co.origAngle);
          pts = scaleAnchored(pts, dx, dy, -1);
          const at = (k: number) => pts[k] as Point;
          const dist1 = getDistance(at(topLeft), at(topRight));
          const dist2 = getDistance(at(botLeft), at(topLeft));
          angle = Math.atan2(at(topRight).y - at(topLeft).y, at(topRight).x - at(topLeft).x);
          let actualAngle = angle;
          if (dist1 < dist2) {
            angle = Math.atan2(at(topLeft).y - at(botLeft).y, at(topLeft).x - at(botLeft).x);
            actualAngle = angle - Math.PI / 2;
          }
          pts = rotate(pts, getMidPoint(pts), -angle);
          angle = actualAngle;
          const xp = pts.map((p) => p.x).sort((a, b) => a - b);
          const yp = pts.map((p) => p.y).sort((a, b) => a - b);
          w = Math.abs((xp[1] as number) - (xp[2] as number));
          h = Math.abs((yp[1] as number) - (yp[2] as number));
          if (dist1 < dist2) [w, h] = [h, w];
        }
      }
      if (isLineObject(co.object)) h = co.object.ds.height();
      angle += this.ds.angle();
      co.object.ds.setAngle(angle);
      co.object.setRect(Rect.fromCenter(new Point(x, y), w, h)); // runs the member's generateData
    }
    this.invalidate();
  }

  override saveDataExprs(): void {
    /* C++: empty */
  }

  override updatePoints(): void {
    for (const c of this.objects_) c.object.updatePoints();
  }

  // ---- layout / paint ----

  protected override computeLayout(env: LayoutEnv): LayoutGeometry {
    const bp = new BoundsPlatform();
    for (const c of this.objects_) {
      env.ensureLayout(c.object);
      bp.addRect(c.object.extent());
    }
    const visualBounds = this.getVisualBounds();
    bp.addRect(visualBounds);
    return { visualBounds, extent: bp.bounds() ?? visualBounds };
  }

  override paint(dp: DrawingPlatform, env: PaintEnv): void {
    for (const c of this.objects_) c.object.paint(dp, env);
  }

  // ---- geometry ----

  override distanceFrom(point: Point): number {
    let dist = INT_MAX;
    for (const c of this.objects_) {
      const d = c.object.distanceFrom(point);
      if (d < dist) dist = d;
    }
    return dist;
  }

  override getIntersection(): [] {
    return [];
  }

  override isPointInside(pt: Point): boolean {
    return this.objects_.some((c) => c.object.isPointInside(pt));
  }

  override isPointInsideTitle(pt: Point): boolean {
    return this.objects_.some((c) => c.object.isPointInsideTitle(pt));
  }

  /** C++ `getVisualBounds`: the group's box, grown by what a member draws outside its selection rect. */
  override getVisualBounds(): Rect {
    let rect = this.selectionRect();
    for (const c of this.objects_) {
      const sel = c.object.selectionRect();
      const vis = c.object.getVisualBounds();
      if (!vis.equals(sel)) rect = rect.includeRect(vis);
    }
    return rect;
  }

  override getInterestingPoints(): InterestingPoint[] {
    return [];
  }
  override getArrowPoints(): [] {
    return [];
  }
  override canFlip(): boolean {
    return false;
  }
  override canEditText(): boolean {
    return false;
  }
  override canEditTextAt(): boolean {
    return false;
  }

  /** C++ `getAlignmentPointsOf` for a group: its members'. */
  override collectAlignmentPoints(xs: Point[], ys: Point[]): void {
    for (const c of this.objects_) c.object.collectAlignmentPoints(xs, ys);
  }

  /** C++ `GroupObject::getAlignmentPoints`: excludes the group and every member. */
  protected override loadAlignmentPoints(ctx: ModificationContext): void {
    const a = ctx.scene.alignmentPoints(TemplatedObject.flatGroup(this));
    this.alignmentx = a.xs;
    this.alignmenty = a.ys;
  }

  // ---- clone ----

  /**
   * C++ `clone(objSet)`: members cloned (groups recursively), `objSet` mapping each cloned
   * non-group original to its copy. The copies' `index` counts down from
   * `storeSize + members − 1`, where `storeSize` is the page's top-level object count (C++ read it
   * from the active store).
   */
  cloneMapped(objSet: Map<LekhObject, LekhObject>, storeSize = 0): GroupObject {
    let index = storeSize + this.objects_.length - 1;
    const go = new GroupObject(this.env);
    for (const c of this.objects_) {
      const co: ContainedObject = { ...c, index: index-- };
      if (c.object instanceof GroupObject) {
        co.object = c.object.cloneMapped(objSet, storeSize);
      } else {
        const tmp = c.object.clone() as TemplatedObject;
        objSet.set(c.object, tmp);
        co.object = tmp;
      }
      go.objects_.push(co);
    }
    go.origHeight_ = this.origHeight_;
    go.origWidth_ = this.origWidth_;
    go.ds.setRect(this.ds.rect());
    go.ds.setAngle(this.ds.angle());
    go.generateData();
    go.initDrawingProfile();
    return go;
  }

  override clone(): GroupObject {
    return this.cloneMapped(new Map());
  }
}
