// Port of C++ `PathCaptureDrawingPlatform` (`L/PathCaptureDrawingPlatform.{h,cpp}`): records the
// lines and curves an object paints as `SimplePath`s, one per `startDrawing`. Anything it cannot
// record as a plain path (circles, arcs, ellipses, rounded rects, a second sub-path, text, images,
// translate, clip) marks the drawing complex. The recognizer's snapshot and the info panel use it
// to ask "is this object a single plain path, and which?".
//
// C++ returned `recognizer::ExistingShape`s; only their `path` was ever set here, and `render/`
// sits below `recognizer/`, so this returns the paths themselves.
import type { BezierCurve } from '../geometry';
import { PathComponent, Point, SimplePath } from '../geometry';
import type { LaidOutText } from '../text';
import type { DrawingPlatform } from './drawing-platform';

export class PathCaptureDrawingPlatform implements DrawingPlatform {
  private readonly paths_: SimplePath[] = [];
  private complex_ = false;
  private ignoreTextDraw_ = false;
  private last_ = new Point();

  /** C++ `setIgnoreTextDraw`: text does not make the drawing complex. */
  setIgnoreTextDraw(val: boolean): void {
    this.ignoreTextDraw_ = val;
  }

  isComplex(): boolean {
    return this.complex_;
  }

  /** One path per `startDrawing`, in draw order (C++ `shapes()[i].path`). */
  paths(): readonly SimplePath[] {
    return this.paths_;
  }

  startDrawing(pt: Point): void {
    this.last_ = pt;
    this.paths_.push(new SimplePath());
  }

  endDrawing(): void {
    /* nothing */
  }

  closePath(): void {
    const path = this.paths_.at(-1);
    if (path === undefined || path.size === 0) return;
    const first = path.front();
    const to = first.isCurve ? first.curve.point1 : first.segment.p1;
    path.push(PathComponent.line(this.last_, to));
    path.setClosed(true);
  }

  addLineTo(pt: Point): void {
    const path = this.paths_.at(-1);
    if (path !== undefined) path.push(PathComponent.line(this.last_, pt));
    this.last_ = pt;
  }

  moveTo(pt: Point): void {
    this.last_ = pt;
    const path = this.paths_.at(-1);
    if (path !== undefined && path.size > 0) this.complex_ = true;
  }

  addCircle(): void {
    this.complex_ = true;
  }

  addArc(): void {
    this.complex_ = true;
  }

  addEllipse(): void {
    this.complex_ = true;
  }

  addCurve(curve: BezierCurve): void {
    const path = this.paths_.at(-1);
    if (path !== undefined) {
      path.push(PathComponent.ofCurve(curve.clone()));
    }
    this.last_ = curve.point4;
  }

  addRoundedRect(): void {
    this.complex_ = true;
  }

  /**
   * C++ marks complex when the text is non-empty. A laid-out block keeps its lines, not the
   * source string: non-empty text is more than one line or a non-empty first line. The one
   * difference: a text of a single `\n` lays out as one empty line, so it is not complex here.
   */
  drawText(text: LaidOutText): void {
    const nonEmpty = text.lines.length > 1 || (text.lines[0]?.text.length ?? 0) > 0;
    if (nonEmpty && !this.ignoreTextDraw_) this.complex_ = true;
  }

  drawImage(): void {
    this.complex_ = true;
  }

  saveContext(): void {
    /* nothing */
  }

  restoreContext(): void {
    /* nothing */
  }

  translate(): void {
    this.complex_ = true;
  }

  clip(): void {
    this.complex_ = true;
  }
}
