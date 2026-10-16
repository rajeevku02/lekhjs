// The draggers of the drawing surface (port of C++ `L/object/widget/Dragger.cpp`):
// `CanvasScaleScrollDragger` (pan and pinch-zoom of the canvas), `DrawingDragger` (a pen stroke
// into the transient ink), `EraseDragger` and `LaserDragger` (with its `LaserTrail`).
import { DeleteObjectAction } from '../../edit';
import { Point, Rect, getDistance } from '../../geometry';
import type { LekhObject } from '../../model';
import type { DrawingPlatform } from '../../render';
import { Style } from '../../style';
import type { CanvasView } from '../canvas-view';
import { BaseDragger } from '../drag-handler';
import { Movement } from '../gesture-listener';
import { drawGlyph } from '../glyphs';
import type { PointerEvent } from '../input-event';
import { OVERLAY_VALUES } from '../overlay-tokens';
import type { OverlayHost, OverlayPaint, Transient } from '../selection/types';

/** The "Zoom: N%" badge of a pinch (C++ the `lekhapp.ui.zoom_info` template). */
export class ZoomInfo implements Transient {
  text = '';
  rect = new Rect();
  draw(dp: DrawingPlatform, paint: OverlayPaint): void {
    drawGlyph(dp, 'lekhapp.ui.zoom_info', this.rect, 0, { fill: paint.tokens.zoomInfoFill });
    paint.text?.draw(dp, this.text, this.rect, {
      fontSize: OVERLAY_VALUES.zoomInfoFontSize,
      color: paint.tokens.zoomInfoText,
    });
  }
}

export class CanvasScaleScrollDragger extends BaseDragger {
  override readonly kind: string = 'CanvasScaleScrollDragger';
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private zoomInfo_: ZoomInfo | null = null;

  constructor(overlay: OverlayHost, view: CanvasView) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
  }

  override onScale(at: Point, _ev: PointerEvent, value: number, m: Movement): void {
    if (m === Movement.Start) {
      this.overlay_.beforeCanvasScaleOrScroll();
      const v = this.overlay_.board.view();
      const zi = new ZoomInfo();
      zi.rect = Rect.fromCenter(
        new Point(v.canvasW / 2, v.canvasH / 2),
        OVERLAY_VALUES.zoomInfoWidth,
        OVERLAY_VALUES.zoomInfoHeight,
      );
      this.zoomInfo_ = zi;
      this.overlay_.addTransient(zi);
    }
    this.view_.scale(at, value, m);
    if (this.zoomInfo_ !== null) {
      this.zoomInfo_.text = `Zoom: ${String(Math.round(this.overlay_.board.view().zoom * 100))}%`;
    }
    this.overlay_.refreshSelection();
    this.overlay_.board.requestPaint('grid');
    if (m === Movement.End) {
      if (this.zoomInfo_ !== null) this.overlay_.removeTransient(this.zoomInfo_);
      this.zoomInfo_ = null;
    }
    this.overlay_.invalidate();
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    if (m === Movement.Start) this.overlay_.beforeCanvasScaleOrScroll();
    this.view_.scroll(at, m);
    this.overlay_.flashScrollIndicator();
    this.overlay_.refreshSelection();
    this.overlay_.board.requestPaint('grid');
  }
}

/** The ink of a stroke in progress (C++ `TransientDrawingObject`), in view coordinates. */
export class TransientStroke implements Transient {
  readonly style: Style;
  readonly points: Point[] = [];

  constructor(style: Style) {
    this.style = style;
  }

  addPoint(p: Point): void {
    this.points.push(p);
  }

  draw(dp: DrawingPlatform): void {
    this.style.setNoFill();
    const first = this.points[0];
    if (first === undefined) return;
    dp.startDrawing(first, this.style);
    for (let i = 1; i < this.points.length; i++) dp.addLineTo(this.points[i] as Point);
    dp.endDrawing();
  }
}

export class DrawingDragger extends BaseDragger {
  override readonly kind: string = 'DrawingDragger';
  private readonly overlay_: OverlayHost;
  private stroke_: TransientStroke | null = null;

  constructor(overlay: OverlayHost) {
    super();
    this.overlay_ = overlay;
  }

  /** The stroke in progress (tests). */
  get stroke(): TransientStroke | null {
    return this.stroke_;
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    if (m === Movement.Start) {
      const style = this.overlay_.board.currentStyle().clone();
      style.setStrokeWidth(style.effectiveStrokeWidth() * this.overlay_.board.view().zoom);
      this.stroke_ = new TransientStroke(style);
      this.overlay_.addTransient(this.stroke_);
      this.overlay_.drawingStarted();
    }
    // Coalesced samples arrive as one pan move each (`InputRouter` feeds every sample).
    this.stroke_?.addPoint(at);
    if (m === Movement.End && this.stroke_ !== null) this.overlay_.onTmpDrawingEnd(this.stroke_, this.stroke_.points);
    this.overlay_.invalidate();
  }
}

/** The eraser's circle (C++ the `lekhapp.ui.erase_dragger` template, 80 × 80). */
export class EraseCircle implements Transient {
  rect = new Rect();
  draw(dp: DrawingPlatform): void {
    drawGlyph(dp, 'lekhapp.ui.erase_dragger', this.rect);
  }
}

export class EraseDragger extends BaseDragger {
  override readonly kind: string = 'EraseDragger';
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private circle_: EraseCircle | null = null;
  private last_ = new Point();

  constructor(overlay: OverlayHost, view: CanvasView) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
  }

  override onPan(at: Point, ev: PointerEvent, m: Movement): void {
    if (!ev.likeMouseLeft()) return;
    if (m === Movement.Start) {
      this.circle_ = new EraseCircle();
      this.overlay_.addTransient(this.circle_);
      this.overlay_.deselect();
      this.last_ = at;
    }
    if (this.circle_ !== null) {
      this.circle_.rect = Rect.fromCenter(at, OVERLAY_VALUES.eraseCircleSize, OVERLAY_VALUES.eraseCircleSize);
    }
    if (m === Movement.End && this.circle_ !== null) {
      this.overlay_.removeTransient(this.circle_);
      this.circle_ = null;
    }
    this.eraseAt(at);
    this.last_ = at;
    this.overlay_.invalidate();
  }

  /** C++ `getPoints`: `pt` appended after midpoints, so no two points are more than 5 apart. */
  private static fill(pts: Point[], pt: Point): void {
    const last = pts[pts.length - 1];
    if (last === undefined) {
      pts.push(pt);
      return;
    }
    let tail = last;
    while (getDistance(tail, pt) > 5) {
      EraseDragger.fill(pts, new Point((tail.x + pt.x) / 2, (tail.y + pt.y) / 2));
      tail = pts[pts.length - 1] as Point;
    }
    pts.push(pt);
  }

  private eraseAt(pt: Point): void {
    const pts: Point[] = [this.view_.toDoc(this.last_)];
    EraseDragger.fill(pts, this.view_.toDoc(pt));
    const board = this.overlay_.board;
    const hit = board.page().objectStore.hit;
    const found: LekhObject[] = [];
    const seen = new Set<LekhObject>();
    for (const p of pts) {
      for (const o of hit.erasableAt(p)) {
        if (seen.has(o)) continue;
        seen.add(o);
        found.push(o);
      }
    }
    if (found.length === 0) return;
    const ids = found.map((o) => o.id);
    board.edit((ctx) => {
      const objs = ids.map((id) => ctx.page.objectStore.getObject(id)).filter((o): o is LekhObject => o !== null);
      if (objs.length === 0) return;
      for (const o of objs) o.getDrawingProfile().setIsSelected(false);
      ctx.editor.tx.run(new DeleteObjectAction(ctx.editor.env, ctx.doc, objs));
    });
  }
}

/** The fading laser dot (C++ `LaserCircleWidget`). */
export class LaserTrail implements Transient {
  centre = new Point();
  draw(dp: DrawingPlatform, paint: OverlayPaint): void {
    const s = new Style();
    s.setFillColor(paint.tokens.laserFill);
    s.setStrokeWidth(0);
    dp.startDrawing(this.centre, s);
    dp.addCircle(this.centre, OVERLAY_VALUES.laserRadius);
    dp.endDrawing();
  }
}

export class LaserDragger extends BaseDragger {
  override readonly kind: string = 'LaserDragger';
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private trail_: LaserTrail | null = null;
  private points_: Point[] = [];
  private startTime_ = 0;

  constructor(overlay: OverlayHost, view: CanvasView) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
  }

  override onPan(at: Point, ev: PointerEvent, m: Movement): void {
    if (!ev.likeMouseLeft()) return;
    if (this.trail_ === null) {
      this.trail_ = new LaserTrail();
      this.overlay_.addTransient(this.trail_);
    }
    this.trail_.centre = at;
    this.overlay_.invalidate();
    if (m === Movement.End) {
      this.overlay_.removeTransient(this.trail_);
      this.trail_ = null;
    }
    const pt = this.view_.toDoc(at);
    const now = this.overlay_.board.now();
    if (this.points_.length === 0) {
      this.points_.push(pt);
      this.startTime_ = now;
      return;
    }
    if (now - this.startTime_ >= 200) {
      this.points_.push(pt);
      this.overlay_.board.sendPointers(this.points_);
      this.points_ = [];
      this.startTime_ = now;
    } else if (getDistance(this.points_[this.points_.length - 1] as Point, pt) > 10) {
      this.points_.push(pt);
    }
  }
}
