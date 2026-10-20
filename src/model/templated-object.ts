// A shape driven by a `ShapeTemplate` and a `DataStore` (port of C++ `TemplatedObject`,
// `L/object/TemplatedObject.{h,cpp}`, and its `IArrowObject` half): titles, text slots, containers,
// alignment snapping while dragged, arrowheads on open shapes.
//
// Differences from C++, each from the spec:
// - `draw` is `layout()` + `paint()` (spec 03 §5.1): `layout` lays the template out and computes
//   the extent; `paint` only draws. The arrowheads are restyled in `layout`, not per draw.
// - The page and the document arrive in the `ModificationContext` at `startModification`
//   (C++ `LekhGlobal::activeObjectStore()` and `document()->snapStep()`).
// - Alignment candidates are binary-searched within the snap step (B7: the ys sorted by y);
//   equal-distance candidates keep a stable order (DR-ENG-09).
// - The implicit-container check asks the page through the spatial index (B16).
// - Every change of geometry calls `invalidate()` (the store re-lays out and re-indexes it).
import { INT_MAX } from '../base';
import {
  Point,
  PointType,
  Quadrilateral,
  Rect,
  getPointsBound,
  intersectionWithPolygon,
  rectDistance,
  rotate,
  rotateAboutMid,
  getMidPoint,
  type LineEquation,
  type PointAndSlope,
  type Size,
} from '../geometry';
import type { DrawingPlatform } from '../render';
import type { Length, Style } from '../style';
import {
  BezierCurveTemplate,
  DataStore,
  PathTemplate,
  PolygonTemplate,
  type ArrowInfo,
  type InterestingPoint,
  type ShapeTemplate,
  type ShapeTextElement,
  TextSide,
} from '../template';
import { ArrowHeads } from './arrow-heads';
import { BoundsPlatform } from './bounds-platform';
import type {
  Delta2,
  LayoutEnv,
  LayoutGeometry,
  ModificationContext,
  PaintEnv,
  SceneQuery,
  TextEditResult,
} from './lekh-object';
import { LekhObject, ObjectKind } from './lekh-object';
import { lowZoomTextFilter } from './low-zoom';
import type { ObjectEnv } from './object-env';
import { snapNumber, snapRectToGrid } from './snap';

/** C++ `std::tuple<number_t, Point, Point, bool>` of `getAlignmentDists`. */
interface AlignDist {
  readonly d: number;
  readonly from: Point;
  readonly to: Point;
  /** Aligned with another shape (true) or with the grid (false). */
  readonly withShape: boolean;
}

const ZERO_DIFF = 0.0001;

/** The index of the first point whose coordinate is ≥ `v` (the points are sorted by it). */
function lowerBound(pts: readonly Point[], v: number, coord: (p: Point) => number): number {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (coord(pts[mid] as Point) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class TemplatedObject extends LekhObject {
  readonly kind: ObjectKind = ObjectKind.Templated;
  readonly env: ObjectEnv;
  readonly ds = new DataStore();
  protected template_: ShapeTemplate | null;
  readonly arrows: ArrowHeads;
  nameInLibraryView = '';

  protected textEditIndex_ = 0;
  protected origTextT_ = '';
  /** C++ `containerGroup_`: the container and the shapes inside it, while it is dragged. */
  protected containerGroup_: TemplatedObject | null = null;
  protected undoRedoMode_ = false;
  protected ctx_: ModificationContext | null = null;

  protected alignmentx: readonly Point[] = [];
  protected alignmenty: readonly Point[] = [];
  /** The alignment guide lines to draw while dragged (C++ `alignmentxDraw` / `alignmentyDraw`). */
  alignmentxDraw: [Point, Point][] = [];
  alignmentyDraw: [Point, Point][] = [];

  /**
   * C++ `TemplatedObject(tmpl, rect, angle, snapToGrid)`. `snap` is the document's snap step when
   * the rect snaps to the grid (and the config's `snapToGrid` is on). A null template is the
   * group and freehand forms (C++ protected constructor).
   */
  constructor(
    env: ObjectEnv,
    tmpl: ShapeTemplate | null,
    rect: Rect = new Rect(),
    angle = 0,
    snap: Length | null = null,
    id?: string,
  ) {
    super(id ?? env.newId());
    this.env = env;
    this.arrows = new ArrowHeads(env);
    this.template_ = tmpl;
    if (tmpl === null) return;
    let r = rect;
    if (snap !== null) r = snapRectToGrid(r, snap, env.config.snapToGrid);
    r = r.checkMinDimension(1, 1);
    this.ds.setAngle(angle);
    this.ds.setRect(r);
    this.generateData();
    tmpl.setDefaults(this.ds);
  }

  override name(): string {
    return 'Templated';
  }

  override interactionKeys(): readonly string[] {
    const t = this.template_;
    return t !== null && t.id() !== '' ? [t.id(), this.name()] : [this.name()];
  }

  /**
   * The image URLs this shape's template references (its image slots and those of the templates
   * embedded in it), inline (base64) images excluded: they are not URLs (spec 03 §7). What the
   * session asks the `ImagePort` for at load, and what kashi's "unresolved image" note lists
   * (`BoardSession.missingResources`).
   */
  override imageUrls(): readonly string[] {
    const t = this.template_;
    if (t === null) return super.imageUrls();
    const out: string[] = [];
    const add = (tmpl: ShapeTemplate, depth: number): void => {
      for (const el of tmpl.images()) {
        if (el.inlineImage() !== null) continue;
        const url = el.resourceUrl();
        if (url !== '' && !out.includes(url)) out.push(url);
      }
      if (depth < 8) for (const e of tmpl.embeds()) add(e.template, depth + 1);
    };
    add(t, 0);
    return out;
  }

  /** The inline images' cache keys of this shape's template and its embeds (see `imageUrls`). */
  override inlineImageKeys(): readonly string[] {
    const t = this.template_;
    if (t === null) return super.inlineImageKeys();
    const out: string[] = [];
    const add = (tmpl: ShapeTemplate, depth: number): void => {
      for (const el of tmpl.images()) {
        if (el.inlineImage() === null) continue;
        const key = el.imageKey();
        if (key !== '' && !out.includes(key)) out.push(key);
      }
      if (depth < 8) for (const e of tmpl.embeds()) add(e.template, depth + 1);
    };
    add(t, 0);
    return out;
  }

  /** C++ `shapeTemplate()`: null for groups and freehand strokes. */
  shapeTemplate(): ShapeTemplate | null {
    return this.template_;
  }

  /** C++ `paths()`. */
  paths(): ReturnType<ShapeTemplate['paths']> | null {
    return this.template_?.paths() ?? null;
  }

  // ---- data ----

  /** C++ `generateData`: the template's data, then the arrowheads; the object re-lays out. */
  generateData(): void {
    const t = this.template_;
    if (t !== null) {
      t.generateData(this.ds);
      this.arrows.generateData(this.getArrowPoints());
    }
    this.invalidate();
  }

  saveDataExprs(): void {
    if (this.template_ !== null) this.ds.saveDataExprs(this.template_.dataExprs());
  }

  /** C++ `setRect`: at least 1 × 1, then `generateData`. */
  setRect(r: Rect): void {
    this.ds.setRect(r.checkMinDimension(1, 1));
    this.generateData();
  }

  /** C++ `updateShapeTemplate`: the live template takes `tmpl`'s definition and reloads. */
  updateShapeTemplate(tmpl: ShapeTemplate): void {
    const t = this.template_;
    if (t === null) return;
    t.copyFrom(tmpl);
    t.load();
    this.generateData();
  }

  /** C++ `updatePoints`. */
  updatePoints(): void {
    for (const p of this.template_?.paths() ?? []) p.updatePoints(this.ds);
  }

  /** C++ `isLaidOut`: a layout has computed the outline points (`ShapeTemplate.isLaidOut`). */
  isLaidOut(): boolean {
    return this.template_ !== null && this.template_.isLaidOut();
  }

  setUndoRedoModificationMode(val: boolean): void {
    this.undoRedoMode_ = val;
  }

  override styleRevision(): number {
    return this.template_ !== null ? this.template_.getStyle().revisionSum() : this.drawingProfile.revisionSum();
  }

  // ---- layout / paint ----

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- groups use the environment
  protected computeLayout(_env: LayoutEnv): LayoutGeometry {
    const t = this.template_;
    if (t !== null) {
      t.layout(this.ds);
      if (t.paths().length > 0) this.arrows.layout(this.getArrowPoints(), t.getStyle());
    }
    const visualBounds = this.getVisualBounds();
    const bp = new BoundsPlatform();
    bp.addRect(visualBounds);
    this.paintContent(bp, -1);
    return { visualBounds, extent: bp.bounds() ?? visualBounds };
  }

  paint(dp: DrawingPlatform, env: PaintEnv): void {
    this.paintContent(lowZoomTextFilter(dp, env), this.editingText_ ? this.textEditIndex_ : -1);
  }

  /** C++ `draw` from the current layout. */
  protected paintContent(dp: DrawingPlatform, textEditIndex: number): void {
    const t = this.template_;
    if (t === null) return;
    t.paint(dp, this.ds, textEditIndex);
    if (t.paths().length > 0) this.arrows.paint(dp, this.getArrowPoints());
  }

  // ---- arrows (C++ IArrowObject) ----

  /** C++ `getArrowPoints`: the open ends and the points they point away from. */
  getArrowPoints(): readonly ArrowInfo[] {
    return this.ds.arrowLocations;
  }

  copyArrowFrom(other: TemplatedObject): void {
    this.arrows.copyFrom(other.arrows);
    this.generateData();
  }

  // ---- geometry ----

  selectionRect(): Rect {
    let r = this.ds.rect();
    if (this.ds.angle() !== 0) r = getPointsBound(rotateAboutMid(r.getPoints(), this.ds.angle()));
    return r;
  }

  override unrotatedRect(): Rect {
    return this.ds.rect();
  }

  override rotation(): number {
    return this.ds.angle();
  }

  override boxSize(): Size | null {
    return this.ds.rect().size();
  }

  override getCenter(): Point {
    return new Point(this.ds.cx(), this.ds.cy());
  }

  override connectionCentre(): Point {
    const t = this.template_;
    if (t instanceof PolygonTemplate && t.textInCentroid) return getMidPoint(t.vertices(this.ds));
    return this.getCenter();
  }

  override getDrawingProfile(): Style {
    return this.template_?.getStyle() ?? this.drawingProfile;
  }

  override effectiveStrokeWidth(): number {
    return this.getDrawingProfile().effectiveStrokeWidth();
  }

  distanceFrom(pt: Point): number {
    const t = this.template_;
    if (t !== null && t.usePathForDistance()) {
      let ret = INT_MAX;
      for (const p of t.paths()) {
        const d = p.distanceFrom(pt, this.ds);
        if (d < ret) ret = d;
      }
      return ret;
    }
    const p = this.unrotatePoint(pt);
    return rectDistance(this.ds.rect(), p);
  }

  override getIntersection(eq: LineEquation): PointAndSlope[] {
    const t = this.template_;
    if (t !== null && t.usePathForIntersection()) {
      const pts: PointAndSlope[] = [];
      for (const p of t.paths()) {
        const tmp: PointAndSlope[] = [];
        p.intersectionWith(eq, this.ds, tmp);
        pts.push(...tmp);
      }
      return pts;
    }
    let pts = this.ds.rect().getPoints();
    if (this.ds.angle() !== 0) pts = rotateAboutMid(pts, this.ds.angle());
    return intersectionWithPolygon(pts, eq);
  }

  isPointInside(point: Point): boolean {
    const t = this.template_;
    if (t !== null && t.usePathForInsideCheck()) {
      const bp = t.boundPath();
      if (bp !== null) return bp.isPointInside(point, this.ds);
      return t.paths().some((p) => p.isPointInside(point, this.ds));
    }
    return this.ds.rect().contains(this.unrotatePoint(point));
  }

  /** The title, when it has text (C++ `nonEmptyTitle`). */
  protected nonEmptyTitle(): ShapeTextElement | null {
    const title = this.shapeTemplate()?.titleElement() ?? null;
    return title === null || title.text() === '' ? null : title;
  }

  override isPointInsideTitle(point: Point): boolean {
    const title = this.nonEmptyTitle();
    return title !== null && title.isPointInside(point, this.ds);
  }

  /** C++ `getVisualBounds`: the selection rect plus the title's (rotated) box. */
  getVisualBounds(): Rect {
    let rect = this.selectionRect();
    const title = this.nonEmptyTitle();
    if (title !== null) {
      const ct = title.center(this.ds);
      const sz = title.getSize(this.ds);
      let pts = Rect.fromCenter(ct, sz.width, sz.height).getPoints();
      if (this.ds.angle() !== 0) pts = rotate(pts, ct, this.ds.angle());
      rect = rect.includeRect(getPointsBound(pts));
    }
    return rect;
  }

  protected unrotatePoint(pt: Point): Point {
    if (this.ds.angle() === 0) return pt;
    return rotate([pt], this.getCenter(), -this.ds.angle())[0] ?? pt;
  }

  override getInterestingPoints(): InterestingPoint[] {
    const t = this.template_;
    if (t === null) return [];
    const pts: InterestingPoint[] = [];
    t.getInterestingPoints(this.ds, pts);
    if (!this.env.config.enableVertexEditing) {
      return pts.filter(
        (p) => p.type !== PointType.Vertex && p.type !== PointType.Control && p.type !== PointType.Focus,
      );
    }
    return pts;
  }

  override moveVertexTo(vid: number, pt: Point): Point {
    const t = this.template_;
    if (t === null) return pt;
    const point = t.moveVertexTo(vid, pt, this.ds);
    this.generateData();
    return point;
  }

  endVertexEditing(): void {
    this.template_?.afterVertexEditing(this.ds);
    this.invalidate();
  }

  /** C++ `ObjectStore::isConnectableKind`: not an open path or polygon, nor a Bézier curve. */
  override isConnectableKind(): boolean {
    const t = this.template_;
    if (t instanceof PathTemplate && !t.closedPath()) return false;
    if (t instanceof PolygonTemplate && !t.isClosed()) return false;
    if (t instanceof BezierCurveTemplate) return false;
    return super.isConnectableKind();
  }

  // ---- containers ----

  override isInContainerArea(p: Point, scene: SceneQuery): boolean {
    const t = this.template_;
    if (t !== null && t.isPointInsideContainer(p, this.ds)) return true;
    return this.isImplicitContainerFor(p, scene);
  }

  override isRectInContainerArea(rect: Rect, scene: SceneQuery): boolean {
    const t = this.template_;
    if (t !== null && t.isRectInsideContainer(rect, this.ds)) return true;
    if (!this.isImplicitContainer(scene)) return false;
    return rect.getPoints().every((pt) => this.isPointInside(pt));
  }

  /**
   * C++ `ObjectStore::isImplicitContainer` (`ObjectStore.cpp:967-1008`): a closed rectangular
   * polygon wider or taller than `implicitContainerSmallSize`, and either larger than
   * `implicitContainerSize` both ways or holding another top-level object's selection rect (shrunk
   * by `implicitContainerContainsCheckAdjust` per side). The holding test asks the index (B16).
   */
  override isImplicitContainer(scene: SceneQuery): boolean {
    const cfg = this.env.config;
    if (!cfg.enableImplicitContainer) return false;
    const poly = this.template_;
    if (!(poly instanceof PolygonTemplate) || !poly.isClosed()) return false;
    const v = poly.vertices(this.ds);
    if (v.length !== 4) return false;
    if (!new Quadrilateral(v[0] as Point, v[1] as Point, v[2] as Point, v[3] as Point).isRectangle()) return false;
    const w = this.ds.width();
    const h = this.ds.height();
    if (!(w > cfg.implicitContainerSmallSize || h > cfg.implicitContainerSmallSize)) return false;
    if (w > cfg.implicitContainerSize && h > cfg.implicitContainerSize) return true;
    const trect = Rect.fromCenter(this.getCenter(), w, h);
    const adjust = cfg.implicitContainerContainsCheckAdjust;
    const holds = (o: LekhObject) => o !== this && trect.containsRect(o.selectionRect().inflate(adjust * -2));
    return scene.objectsWhere(trect.inflate(adjust * 2 + 2), holds).length > 0;
  }

  /** C++ `isImplicitContainerFor(tobj, pt)`: farther than a tap from the outline. */
  protected isImplicitContainerFor(p: Point, scene: SceneQuery): boolean {
    if (!this.isImplicitContainer(scene)) return false;
    return this.distanceFrom(p) > this.env.config.tapToSelectDistance;
  }

  /**
   * C++ `initializeContainerObjects`: when the template has containers, the top-level shapes whose
   * selection rect is inside one, plus this, become the group dragged with it.
   */
  protected initializeContainerObjects(ctx: ModificationContext): void {
    this.containerGroup_ = null;
    const t = this.template_;
    if (t === null || t.containers().length === 0) return;
    const inside = (o: LekhObject): boolean =>
      o instanceof TemplatedObject && o !== this && t.isRectInsideContainer(o.selectionRect(), this.ds);
    const cobjs = ctx.scene.objectsWhere(this.extent(), inside);
    if (cobjs.length === 0) return;
    cobjs.push(this);
    this.containerGroup_ = ctx.makeGroup(cobjs) as TemplatedObject;
  }

  /** The container group of the current drag (C++ `containerGroup_`), if any. */
  containerGroup(): TemplatedObject | null {
    return this.containerGroup_;
  }

  /** C++ `flatGroupObject`: a group and every member at every depth. */
  protected static flatGroup(group: LekhObject): Set<LekhObject> {
    const excluded = new Set<LekhObject>([group]);
    let objs = [...group.members()];
    while (objs.length > 0) {
      const tmp: LekhObject[] = [];
      for (const item of objs) {
        if (item.kind === ObjectKind.Group) tmp.push(...item.members());
        excluded.add(item);
      }
      objs = tmp;
    }
    return excluded;
  }

  // ---- alignment ----

  /** C++ `getAlignmentPoints` (protected): the candidates for this drag. */
  protected loadAlignmentPoints(ctx: ModificationContext): void {
    const excluded = this.containerGroup_ !== null ? TemplatedObject.flatGroup(this.containerGroup_) : new Set([this]);
    const a = ctx.scene.alignmentPoints(excluded);
    this.alignmentx = a.xs;
    this.alignmenty = a.ys;
  }

  /** C++ `ObjectStore::getAlignmentPointsOf` for a templated object (`ObjectStore.cpp:709-768`). */
  override collectAlignmentPoints(xpts: Point[], ypts: Point[]): void {
    const t = this.template_;
    let xs: Point[] = [];
    let ys: Point[] = [];
    if (t instanceof PolygonTemplate || t instanceof BezierCurveTemplate) {
      xs = t.paths()[0]?.getVertexPointsForSimplePath(this.ds) ?? [];
      ys = xs.slice();
    }
    if (xs.length === 0 || ys.length === 0) {
      xs = this.ds.rect().getPoints();
      if (this.ds.angle() !== 0) xs = rotateAboutMid(xs, this.ds.angle());
      ys = xs.slice();
    }
    if (t !== null) {
      const ap = t.getAlignPoints(this.ds);
      xs.push(...ap);
      ys.push(...ap);
    }
    const c = this.ds.getCenter();
    xs.push(c);
    ys.push(c);
    xpts.push(...xs);
    ypts.push(...ys);
  }

  /**
   * C++ `getAlignmentDists`: for each of `pts`, the candidates within the snap step on `kind`'s axis
   * (0: x, 1: y), else the grid lines within the grid step; sorted by distance. The candidates
   * are binary-searched (sorted on that axis); the sort is stable.
   */
  protected alignmentDists(
    kind: 0 | 1,
    gridSnapDist: Length,
    pts: readonly Point[],
    ctx: ModificationContext,
  ): AlignDist[] {
    const step = ctx.snapStep.points();
    const res: AlignDist[] = [];
    const cands = kind === 0 ? this.alignmentx : this.alignmenty;
    const coord = kind === 0 ? (p: Point) => p.x : (p: Point) => p.y;
    for (const pt of pts) {
      const v = coord(pt);
      for (let j = lowerBound(cands, v - step, coord); j < cands.length; j++) {
        const c = cands[j] as Point;
        if (coord(c) - v >= step) break;
        const d = Math.abs(v - coord(c));
        if (d < step) res.push({ d, from: pt, to: c, withShape: true });
      }
    }
    if (res.length === 0) {
      const snapToGrid = this.env.config.snapToGrid;
      for (const pt of pts) {
        const s = snapNumber(coord(pt), gridSnapDist, snapToGrid);
        const d = Math.abs(coord(pt) - s);
        if (d < gridSnapDist.points()) {
          res.push({ d, from: pt, to: kind === 0 ? new Point(s, pt.y) : new Point(pt.x, s), withShape: false });
        }
      }
    }
    res.sort((a, b) => a.d - b.d);
    return res;
  }

  /** C++ `aggregateAlignmentDrawPoints`: one guide line per aligned coordinate. */
  protected aggregateAlignmentDrawPoints(kind: 0 | 1, tempPairs: readonly [Point, Point][]): void {
    const out: [Point, Point][] = [];
    const marked = new Set<number>();
    for (let i = 0; i < tempPairs.length; i++) {
      if (marked.has(i)) continue;
      marked.add(i);
      const [a, b] = tempPairs[i] as [Point, Point];
      const pt = kind === 0 ? a.x : a.y;
      let minv = kind === 0 ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      let maxv = kind === 0 ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      for (let j = i + 1; j < tempPairs.length; j++) {
        if (marked.has(j)) continue;
        const [c, d] = tempPairs[j] as [Point, Point];
        if (Math.abs((kind === 0 ? c.x : c.y) - pt) < ZERO_DIFF) {
          marked.add(j);
          const cv = kind === 0 ? c.y : c.x;
          const dv = kind === 0 ? d.y : d.x;
          minv = Math.min(minv, cv, dv);
          maxv = Math.max(maxv, cv, dv);
        }
      }
      out.push(kind === 0 ? [new Point(pt, minv), new Point(pt, maxv)] : [new Point(minv, pt), new Point(maxv, pt)]);
    }
    if (kind === 0) this.alignmentxDraw = out;
    else this.alignmentyDraw = out;
  }

  /** C++ `snap`: moves `v` by the best candidate's offset and collects the guides it lines up. */
  protected snapAxis(kind: 0 | 1, v: number, dists: readonly AlignDist[], ctx: ModificationContext): number {
    const first = dists[0];
    if (first === undefined) return snapNumber(v, ctx.snapStep, this.env.config.snapToGrid);
    const coord = kind === 0 ? (p: Point) => p.x : (p: Point) => p.y;
    const diff = coord(first.to) - coord(first.from);
    const shift = (p: Point) => (kind === 0 ? p.withDelta(diff, 0) : p.withDelta(0, diff));
    const tempPairs: [Point, Point][] = [];
    if (first.withShape) tempPairs.push([shift(first.from), first.to]);
    for (let i = 1; i < dists.length; i++) {
      const di = dists[i] as AlignDist;
      if (!di.withShape) continue;
      const p1 = shift(di.from);
      if (Math.abs(coord(p1) - coord(di.to)) < ZERO_DIFF) tempPairs.push([p1, di.to]);
    }
    this.aggregateAlignmentDrawPoints(kind, tempPairs);
    return v + diff;
  }

  // ---- modification ----

  override startModification(ctx?: ModificationContext): void {
    super.startModification(ctx);
    this.ds.save();
    this.alignmentx = [];
    this.alignmenty = [];
    this.alignmentxDraw = [];
    this.alignmentyDraw = [];
    this.ctx_ = ctx ?? null;
    if (ctx === undefined) {
      this.containerGroup_ = null;
      return;
    }
    this.initializeContainerObjects(ctx);
    this.loadAlignmentPoints(ctx);
    if (!this.undoRedoMode_ && this.containerGroup_ !== null) this.containerGroup_.startModification(ctx);
  }

  protected endModification(): void {
    this.containerGroup_ = null;
  }

  override translate(dx: number, dy: number): void {
    if (!this.undoRedoMode_ && this.containerGroup_ !== null) {
      this.containerGroup_.translateAligned(dx, dy, this);
      return;
    }
    this.translateAligned(dx, dy, this);
  }

  /** C++ `translate(dx, dy, alignObject)`: moves, then snaps `alignObject`'s points when snapping. */
  translateAligned(dx: number, dy: number, alignObject: LekhObject): void {
    this.ds.setTempCx(this.ds.tempCx() + dx);
    this.ds.setTempCy(this.ds.tempCy() + dy);
    let x = this.ds.tempCx();
    let y = this.ds.tempCy();
    this.alignmentxDraw = [];
    this.alignmentyDraw = [];
    const ctx = this.ctx_;
    if (this.env.config.snapToGrid && ctx !== null) {
      this.ds.setCx(x);
      this.ds.setCy(y);
      this.generateData();
      const xs: Point[] = [];
      const ys: Point[] = [];
      alignObject.collectAlignmentPoints(xs, ys);
      x = this.snapAxis(0, x, this.alignmentDists(0, ctx.snapStep, xs, ctx), ctx);
      y = this.snapAxis(1, y, this.alignmentDists(1, ctx.snapStep, ys, ctx), ctx);
    }
    this.ds.setCx(x);
    this.ds.setCy(y);
    this.generateData();
  }

  /** The objects a translate moves (C++ `getTranslateUserAction`'s list); ends the modification. */
  translatedObjects(): LekhObject[] {
    const g = this.containerGroup_;
    const list = g === null ? [this] : [...g.members()];
    this.endModification();
    return list;
  }

  override finishTranslating(): Delta2 {
    return { x: this.ds.cx() - this.ds.savedCx(), y: this.ds.cy() - this.ds.savedCy() };
  }

  override rotate(angle: number): void {
    this.ds.setAngle(
      snapNumber(this.ds.savedAngle() + angle, this.env.config.snapAngleStep, this.env.config.snapToGrid),
    );
    this.generateData();
  }

  override finishRotating(): number {
    this.template_?.afterRotation(this.ds);
    const da = this.ds.angle() - this.ds.savedAngle();
    this.endModification();
    this.invalidate();
    return da;
  }

  /** C++ `scale`: uniform (both sides by `fx`), snapped to twice the snap step keeping the ratio. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the base signature
  override scale(fx: number, _fy: number): void {
    let newWidth = this.ds.savedWidth() * fx;
    let newHeight = this.ds.savedHeight() * fx;
    const cfg = this.env.config;
    if (cfg.snapToGrid && this.ctx_ !== null) {
      const s = this.ctx_.snapStep;
      const step = s.points() * 2;
      newHeight = snapNumber(newHeight, step, true);
      newWidth = snapNumber(newWidth, step, true);
      const origWidth = Math.max(1, this.ds.savedWidth());
      const origHeight = Math.max(1, this.ds.savedHeight());
      if (origWidth > origHeight) newHeight = (origHeight / origWidth) * newWidth;
      else newWidth = (origWidth / origHeight) * newHeight;
    }
    this.ds.setWidth(newWidth);
    this.ds.setHeight(newHeight);
    this.generateData();
  }

  override finishScaling(): Delta2 {
    const f = this.ds.width() / this.ds.savedWidth();
    this.endModification();
    return { x: f, y: f };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the base signature
  override expand(dx: number, dy: number, _anchorCorner: number): void {
    const cfg = this.env.config;
    const step = (this.ctx_?.snapStep.points() ?? 8) * 2;
    const w = snapNumber(this.ds.savedWidth() + dx, step, cfg.snapToGrid);
    const h = snapNumber(this.ds.savedHeight() + dy, step, cfg.snapToGrid);
    if (w === this.ds.width() && h === this.ds.height()) return;
    const ddx = w - this.ds.savedWidth();
    const ddy = h - this.ds.savedHeight();
    this.ds.setWidth(w);
    this.ds.setHeight(h);
    this.ds.setCx(this.ds.savedCx() + ddx / 2);
    this.ds.setCy(this.ds.savedCy() + ddy / 2);
    this.generateData();
  }

  override finishExpanding(): Delta2 {
    const d = { x: this.ds.width() - this.ds.savedWidth(), y: this.ds.height() - this.ds.savedHeight() };
    this.endModification();
    return d;
  }

  override canFlip(type: number): boolean {
    return this.template_?.canFlip(type, this.ds) ?? false;
  }

  /**
   * C++ `flipShape`: flips and reports the before/after data expressions and boxes (the
   * `TemplateModificationAction` the editor records), or null without a template.
   */
  flipShape(type: number): FlipResult | null {
    const t = this.template_;
    if (t === null) return null;
    const oldRect = this.ds.rect();
    this.ds.save();
    this.ds.saveDataExprs(t.dataExprs());
    t.flip(type, this.ds);
    this.invalidate();
    return {
      oldExprs: this.ds.savedDataExprs(),
      oldRect,
      oldAngle: this.ds.savedAngle(),
      newExprs: t.dataExprs().slice(),
      newRect: this.ds.rect(),
      newAngle: this.ds.angle(),
    };
  }

  override flip(type: number): void {
    this.flipShape(type);
  }

  // ---- text editing ----

  /**
   * C++ `textSlotAt`: the title's slot when `point` is on the title, a body slot whose box holds
   * it, the title of a shape with no body slot, else the first body slot. `hit` is false when
   * the point edits no text there.
   */
  protected textSlotAt(point: Point): { index: number; hit: boolean } {
    const texts = this.template_?.texts() ?? [];
    let title = -1;
    let firstBody = -1;
    texts.forEach((t, i) => {
      if (t.external() !== TextSide.None) title = title < 0 ? i : title;
      else if (firstBody < 0) firstBody = i;
    });
    if (title >= 0 && this.isPointInsideTitle(point)) return { index: title, hit: true };
    for (let i = 0; i < texts.length; i++) {
      if (i !== title && (texts[i] as ShapeTextElement).isPointInside(point, this.ds)) {
        // A polygon's text box can reach outside the shape.
        return { index: i, hit: !(this.template_ instanceof PolygonTemplate) || this.isPointInside(point) };
      }
    }
    if (title >= 0 && firstBody < 0) return { index: title, hit: this.isPointInside(point) };
    return { index: firstBody < 0 ? 0 : firstBody, hit: false };
  }

  override getTextEditCenter(): Point {
    const t = this.template_;
    if (t === null || t.interpretText()) return this.getCenter();
    return t.texts()[this.textEditIndex_]?.center(this.ds) ?? this.getCenter();
  }

  override updateText(str: string, index: number): void {
    const t = this.template_;
    if (t === null) return;
    if (t.interpretText()) {
      t.setInterpretedText(str);
      this.generateData();
      return;
    }
    t.setText(index < 0 ? this.textEditIndex_ : index, str);
    this.invalidate();
  }

  override startTextEditing(point: Point): void {
    this.editingText_ = true;
    this.textEditIndex_ = 0;
    const t = this.template_;
    if (t === null) return;
    if (t.interpretText()) {
      this.origTextT_ = t.interpretedText();
    } else {
      this.textEditIndex_ = this.textSlotAt(point).index;
      const te = t.texts()[this.textEditIndex_];
      if (te !== undefined) this.origTextT_ = te.text();
    }
    this.invalidate();
  }

  override finishTextEditing(): TextEditResult {
    this.editingText_ = false;
    this.invalidate();
    return { text: this.origTextT_, index: this.textEditIndex_ };
  }

  override getTextForEditing(): string {
    const t = this.template_;
    if (t === null) return '';
    if (t.interpretText()) return t.interpretedText();
    return t.texts()[this.textEditIndex_]?.text() ?? '';
  }

  override canEditText(): boolean {
    const t = this.template_;
    if (t === null) return false;
    return t.interpretText() || t.texts().length > 0;
  }

  override canEditTextAt(point: Point): boolean {
    this.textEditIndex_ = 0;
    const t = this.template_;
    if (t === null) return false;
    if (t.interpretText()) return this.isPointInside(point);
    const r = this.textSlotAt(point);
    this.textEditIndex_ = r.index;
    return r.hit;
  }

  /** The slot `canEditTextAt` / `startTextEditing` chose. */
  textEditIndex(): number {
    return this.textEditIndex_;
  }

  override getEditTextStyle(): Style {
    const t = this.template_;
    if (t !== null && t.interpretText()) return t.getStyle();
    const te = t?.texts()[this.textEditIndex_];
    return te?.style() ?? this.getDrawingProfile();
  }

  /** C++ `getEditTextElement`. */
  getEditTextElement(): ShapeTextElement | null {
    const t = this.template_;
    if (t === null || t.interpretText()) return null;
    return t.texts()[this.textEditIndex_] ?? null;
  }

  // ---- clone ----

  /** C++ `clone`: a fresh id, a loaded copy of the template, the same box and arrowheads. */
  override clone(): TemplatedObject | null {
    const t = this.template_;
    if (t === null) return null;
    const tmpl = t.clone();
    tmpl.load();
    const obj = new TemplatedObject(this.env, tmpl, this.ds.rect(), this.ds.angle(), null);
    this.copyBaseTo(obj);
    obj.arrows.copyFrom(this.arrows);
    obj.generateData();
    return obj;
  }

  /** C++ `LekhObject::copyTo`. */
  protected copyBaseTo(other: LekhObject): void {
    other.text = this.text;
    other.drawingProfile.copyFrom(this.drawingProfile);
  }
}

/** What `flipShape` reports for the undo record (C++ `TemplateModificationAction`'s arguments). */
export interface FlipResult {
  readonly oldExprs: readonly string[];
  readonly oldRect: Rect;
  readonly oldAngle: number;
  readonly newExprs: readonly string[];
  readonly newRect: Rect;
  readonly newAngle: number;
}
