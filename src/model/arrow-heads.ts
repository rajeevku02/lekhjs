// Arrowheads at the two ends of an open shape or a connector (port of C++ `IArrowObject`,
// `L/Arrow.{h,cpp}`; spec 02 `ArrowObject`). Each end holds its own loaded copy of an arrowhead
// template and the `DataStore` that places it: centred `width / 2` back from the end point, along
// the end's direction.
//
// The layout/paint split: C++ `drawArrows` regenerated the data and restyled the templates on every
// draw; here `layout` does both and `paint` only draws. Indexing C++ read `pts[0]`/`pts[1]` of a
// possibly shorter vector; here a missing end has no arrow.
import { getPointAtDistance, type Point } from '../geometry';
import type { DrawingPlatform } from '../render';
import { Color, type Style } from '../style';
import { DataStore, type ArrowInfo, type ShapeTemplate } from '../template';
import type { ObjectEnv } from './object-env';
import { OPEN_ARROW_ID, SOLID_ARROW_ID } from './object-env';

/** C++ `IArrowObject::ArrowLocation`. */
export const ArrowLocation = Object.freeze({ None: 0, Start: 1, End: 2 } as const);
export type ArrowLocation = (typeof ArrowLocation)[keyof typeof ArrowLocation];

/** C++ `IArrowObject::ArrowInfo`. */
export interface ArrowAt {
  readonly template: ShapeTemplate | null;
  readonly location: ArrowLocation;
}

/** C++ `samePoint`: within 0.01 on both axes. */
function samePoint(p1: Point, p2: Point): boolean {
  const delta = 0.01;
  return Math.abs(p2.x - p1.x) < delta && Math.abs(p2.y - p1.y) < delta;
}

export class ArrowHeads {
  private readonly env_: ObjectEnv;
  private start_: ShapeTemplate | null = null;
  private end_: ShapeTemplate | null = null;
  readonly startDs = new DataStore();
  readonly endDs = new DataStore();

  constructor(env: ObjectEnv) {
    this.env_ = env;
  }

  start(): ShapeTemplate | null {
    return this.start_;
  }
  end(): ShapeTemplate | null {
    return this.end_;
  }

  arrowAt(pts: readonly ArrowInfo[], pt: Point): ArrowAt {
    if (pts[0] !== undefined && samePoint(pts[0][0], pt))
      return { template: this.start_, location: ArrowLocation.Start };
    if (pts[1] !== undefined && samePoint(pts[1][0], pt)) return { template: this.end_, location: ArrowLocation.End };
    return { template: null, location: ArrowLocation.None };
  }

  hasArrowAt(pts: readonly ArrowInfo[], pt: Point): boolean {
    if (pts[0] !== undefined && samePoint(pts[0][0], pt)) return this.start_ !== null;
    if (pts[1] !== undefined && samePoint(pts[1][0], pt)) return this.end_ !== null;
    return false;
  }

  /** C++ `addAt`: false when `pt` is no end or the end already has one. */
  addAt(pts: readonly ArrowInfo[], pt: Point, isSolid: boolean): boolean {
    if (pts[0] !== undefined && samePoint(pts[0][0], pt)) {
      if (this.start_ !== null) return false;
      this.setStartKind(true, isSolid);
      return true;
    }
    if (pts[1] !== undefined && samePoint(pts[1][0], pt)) {
      if (this.end_ !== null) return false;
      this.setEndKind(true, isSolid);
      return true;
    }
    return false;
  }

  removeAt(pts: readonly ArrowInfo[], pt: Point): boolean {
    if (pts[0] !== undefined && samePoint(pts[0][0], pt)) {
      if (this.start_ === null) return false;
      this.start_ = null;
      return true;
    }
    if (pts[1] !== undefined && samePoint(pts[1][0], pt)) {
      if (this.end_ === null) return false;
      this.end_ = null;
      return true;
    }
    return false;
  }

  /** C++ `setStartArrow(ShapeTemplate*)`: a loaded copy of `tmpl`, or none. */
  setStart(tmpl: ShapeTemplate | null): void {
    this.start_ = ArrowHeads.copyOf(tmpl);
  }
  setEnd(tmpl: ShapeTemplate | null): void {
    this.end_ = ArrowHeads.copyOf(tmpl);
  }

  /** C++ `setStartArrow({has, solid})`: the solid or open catalog arrowhead, or none. */
  setStartKind(has: boolean, solid: boolean): void {
    this.setStart(has ? this.env_.arrowhead(solid ? SOLID_ARROW_ID : OPEN_ARROW_ID) : null);
  }
  setEndKind(has: boolean, solid: boolean): void {
    this.setEnd(has ? this.env_.arrowhead(solid ? SOLID_ARROW_ID : OPEN_ARROW_ID) : null);
  }

  /** C++ `copyArrowFrom`. */
  copyFrom(other: ArrowHeads): void {
    this.setStart(other.start_);
    this.setEnd(other.end_);
  }

  /** C++ `generateDataForArrow`: places each arrowhead at its end. */
  generateData(pts: readonly ArrowInfo[]): void {
    ArrowHeads.place(this.start_, this.startDs, pts[0]);
    ArrowHeads.place(this.end_, this.endDs, pts[1]);
  }

  /**
   * The computing half of C++ `drawArrows`: data regenerated, each arrowhead restyled from the
   * owner's `style` (stroke paint and width, no dash; a filled head gets the stroke colour
   * composited over white), then laid out.
   */
  layout(pts: readonly ArrowInfo[], style: Style): void {
    this.generateData(pts);
    if (pts[0] !== undefined && this.start_ !== null) {
      ArrowHeads.restyle(this.start_, style);
      this.start_.layout(this.startDs);
    }
    if (pts[1] !== undefined && this.end_ !== null) {
      ArrowHeads.restyle(this.end_, style);
      this.end_.layout(this.endDs);
    }
  }

  /** The drawing half of C++ `drawArrows`, from the last `layout`. */
  paint(dp: DrawingPlatform, pts: readonly ArrowInfo[]): void {
    if (pts[0] !== undefined && this.start_ !== null) this.start_.paint(dp, this.startDs, -1);
    if (pts[1] !== undefined && this.end_ !== null) this.end_.paint(dp, this.endDs, -1);
  }

  private static copyOf(tmpl: ShapeTemplate | null): ShapeTemplate | null {
    if (tmpl === null) return null;
    const t = tmpl.clone();
    t.load();
    return t;
  }

  private static place(tmpl: ShapeTemplate | null, ds: DataStore, end: ArrowInfo | undefined): void {
    if (tmpl === null || end === undefined) return;
    const sw = tmpl.getStyle().effectiveStrokeWidth();
    const wd = tmpl.defaultAttr.width + sw * 2;
    const ht = tmpl.defaultAttr.height + sw * 2;
    const [p1, p2] = end;
    const center = getPointAtDistance(p1, p2, wd / 2);
    ds.setCx(center.x);
    ds.setCy(center.y);
    ds.setWidth(wd);
    ds.setHeight(ht);
    ds.setAngle(Math.atan2(p1.y - p2.y, p1.x - p2.x));
    tmpl.generateData(ds);
  }

  private static restyle(target: ShapeTemplate, style: Style): void {
    const ts = target.getStyle();
    ts.setStrokePaint(style.effectiveStrokePaint());
    if (ts.isFillPaintDefined()) {
      // A transparent stroke colour: the colour it shows over white, opaque.
      const paint = style.effectiveStrokePaint();
      const c = paint.solidColor;
      const alpha = c.alpha / 255.0;
      const color = new Color(
        255 + (c.red - 255) * alpha,
        255 + (c.green - 255) * alpha,
        255 + (c.blue - 255) * alpha,
        255,
      );
      ts.setFillPaint(paint.with({ solidColor: color }));
    }
    ts.removeDashArray();
    ts.setStrokeWidth(style.effectiveStrokeWidth());
  }
}
