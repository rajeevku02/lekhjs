// The vertex-edit handle (port of C++ `VertexHandleWidget`, `L/object/widget/selection/`; spec 02
// `VertexHandles`): one handle on a vertex, control point or attribute point of a shape, or on a
// corner of the selection rectangle (a resizer or the rotater). It draws a dashed square with a
// circle (or the rotate glyph), takes the drag that starts on it, and dismisses itself on a press
// outside (its outside-tap filter).
import { isMulti } from '../../edit';
import { Point, Rect } from '../../geometry';
import type { LekhObject } from '../../model';
import type { DrawingPlatform } from '../../render';
import { Style } from '../../style';
import type { CanvasView } from '../canvas-view';
import { ResizeDragger, RotateDragger, VertexDragger } from '../draggers/selection-draggers';
import { EventName, Movement } from '../gesture-listener';
import { drawGlyph } from '../glyphs';
import type { PointerEvent } from '../input-event';
import type { SelectionRectangle } from './selection-rectangle';
import { ShapePointType, type OverlayHost, type OverlayPaint, type VertexHandleHost } from './types';

export class VertexHandles implements VertexHandleHost {
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private readonly rect_: SelectionRectangle;
  private target_: LekhObject | null = null;
  private type_: ShapePointType = ShapePointType.None;
  private vid_ = 0;
  /** On a corner of the selection rectangle. */
  private onRect_ = false;
  private centre_ = new Point();
  private frame_ = new Rect();
  isMoving = false;

  constructor(overlay: OverlayHost, view: CanvasView, rect: SelectionRectangle) {
    this.overlay_ = overlay;
    this.view_ = view;
    this.rect_ = rect;
  }

  isActive(): boolean {
    return this.target_ !== null;
  }

  target(): LekhObject | null {
    return this.target_;
  }

  type(): ShapePointType {
    return this.type_;
  }

  vid(): number {
    return this.vid_;
  }

  centre(): Point {
    return this.centre_;
  }

  frame(): Rect {
    return this.frame_;
  }

  /** C++ `updateTarget`: `'rect'` puts it on a corner of the selection rectangle. */
  updateTarget(type: ShapePointType, vid: number, target: LekhObject | 'rect' | null): void {
    this.type_ = type;
    this.vid_ = vid;
    this.onRect_ = target === 'rect';
    if (target === 'rect') {
      const t = this.rect_.target();
      this.target_ = t !== null && !isMulti(t) ? t : null;
    } else {
      this.target_ = target;
    }
    this.layout();
  }

  /** C++ `update(at, movement)`. */
  update(_at: Point, m: Movement): void {
    if (m === Movement.Start) this.isMoving = true;
    if (m === Movement.End) this.isMoving = false;
    this.layout();
  }

  /** C++ `update()`: the centre from the rectangle's corner or the target's point. */
  layout(): void {
    if (this.onRect_) {
      this.rect_.layout();
      const c = this.rect_.corners()[this.vid_];
      if (c === undefined) return;
      this.centre_ = c;
    } else if (this.target_ !== null) {
      const ip = this.target_.getInterestingPoints()[this.vid_];
      if (ip === undefined) return;
      this.centre_ = this.view_.toView(ip.point);
    } else {
      return;
    }
    const sz = this.overlay_.board.config.minSelectRectDimention;
    this.frame_ = Rect.fromCenter(this.centre_, sz, sz);
  }

  draw(dp: DrawingPlatform, paint: OverlayPaint): void {
    if (this.target_ === null) return;
    const s = new Style();
    s.setNoFill();
    s.setStrokeColor(paint.tokens.selectionStroke);
    s.setStrokeWidth(1);
    s.setDashArray([2, 2]);
    const f = this.frame_;
    dp.startDrawing(new Point(f.x, f.y), s);
    dp.addLineTo(new Point(f.x + f.width, f.y));
    dp.addLineTo(new Point(f.x + f.width, f.y + f.height));
    dp.addLineTo(new Point(f.x, f.y + f.height));
    dp.closePath();
    dp.endDrawing();
    const r = this.overlay_.board.config.vertexHandleRadius;
    if (this.type_ === ShapePointType.Rotater) {
      // C++ `VertexHandleWidget` draws the template with its own strokes (no border; see the
      // selection rectangle's rotater).
      drawGlyph(dp, 'lekhapp.ui.sel_rect_rotate', Rect.fromCenter(this.centre_, r * 2, r * 2), 0);
    } else {
      dp.startDrawing(this.centre_, s);
      dp.addCircle(this.centre_, r);
      dp.endDrawing();
    }
  }

  /** C++ `onPan` (a Start inside the frame). */
  onPan(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (m !== Movement.Start || !ev.likeMouseLeft()) return false;
    let d;
    if (this.type_ === ShapePointType.Rotater) {
      d = new RotateDragger(this.overlay_, this.view_, this.onRect_ ? this.rect_ : null, this);
    } else if (this.type_ === ShapePointType.Resizer) {
      d = new ResizeDragger(this.rect_, this.vid_, this);
    } else if (this.target_ !== null) {
      d = new VertexDragger(this.overlay_, this.view_, this.target_, this.vid_, this.type_);
    } else {
      return true;
    }
    d.onPan(at, ev, m);
    this.overlay_.setDragHandler(d);
    return true;
  }

  onClick(_at: Point, ev: PointerEvent): boolean {
    return ev.likeMouseLeft();
  }

  /** The outside-tap filter's test. */
  isOutside(at: Point): boolean {
    return this.target_ === null || !this.frame_.contains(at);
  }

  /** C++ `handleOutsideEvent`. */
  handleOutsideEvent(at: Point, ev: PointerEvent, name: EventName): boolean {
    const t = this.target_;
    if (t === null) return false;
    if ((name !== EventName.Click || !ev.likeMouseLeft()) && name !== EventName.Pan) {
      this.overlay_.deselect();
      return false;
    }
    const dismiss = (): void => {
      this.overlay_.updateVertexHandle(ShapePointType.Vertex, 0, null);
    };
    if (this.overlay_.isSelectionActive()) {
      dismiss();
      return false;
    }
    const { sp, dist } = this.rect_.shapePointNear(at, t, false);
    dismiss();
    if (sp.type !== ShapePointType.None && dist < this.overlay_.board.config.closePointDistanceShort) {
      this.overlay_.updateVertexHandle(sp.type, sp.vid, t);
    }
    return false;
  }
}
