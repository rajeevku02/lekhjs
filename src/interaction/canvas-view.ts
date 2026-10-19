// Zoom and scroll of the drawing surface (port of the view half of C++ `CanvasWidget`: `scale`,
// `zoom`, `checkMinMaxZoom`, `scroll`, `scrollInfiniteCanvas`, `scrollFixedCanvas`,
// `isPointOnCanvas`, `getInsertLocationWithClip`; and `Command::zoomIn/zoomOut/resetZoom`).
//
// The TS view is one transform (spec 03 §9): screen = zoom · (doc + scroll). A fixed-size page,
// which C++ placed by moving the canvas element (`offsetX_`), is the same transform with
// scroll = offset / zoom; the C++ "a quarter stays visible" clamp is kept. The zoom is still
// stepped on the C++ integer percentage (`LekhGlobal::setZoom(int)`).
import { Point, Rect } from '../geometry';
import { CanvasSizeType } from '../model';
import type { InteractionBoard } from './board';
import { Movement } from './gesture-listener';

/** C++ `MinSizeDP`: a fixed canvas is never drawn smaller than this. */
const MIN_SIZE_DP = 20;

export class CanvasView {
  private readonly board_: InteractionBoard;
  private focus_ = new Point();
  private savedZoom_ = 1;
  private savedScroll_ = new Point();
  private last_ = new Point();
  private lastScroll_ = new Point();
  private scrolling_ = false;

  constructor(board: InteractionBoard) {
    this.board_ = board;
  }

  get scrolling(): boolean {
    return this.scrolling_;
  }

  isInfinite(): boolean {
    return this.board_.page().canvasSizeType === CanvasSizeType.Infinite;
  }

  toDoc(viewPt: Point): Point {
    return this.board_.view().toDoc(viewPt);
  }

  toView(docPt: Point): Point {
    return this.board_.view().toScreen(docPt);
  }

  /** C++ `isPointOnCanvas`. */
  isPointOnCanvas(viewPt: Point): boolean {
    const page = this.board_.page();
    if (page.canvasSizeType === CanvasSizeType.Infinite) return true;
    const p = this.toDoc(viewPt);
    if (p.x < 0 || p.y < 0) return false;
    if (page.canvasSizeType === CanvasSizeType.Auto) return true;
    const sz = page.getCanvasSize(false);
    return !(p.x > sz.width || p.y > sz.height);
  }

  /** C++ `checkMinMaxZoom`: the integer percentage, clamped to the config's range. */
  checkMinMaxZoom(factor: number): number {
    let zm = Math.round(factor * 100);
    const cfg = this.board_.config;
    if (zm < cfg.minCanvasZoom) zm = cfg.minCanvasZoom;
    if (zm > cfg.maxCanvasZoom) zm = cfg.maxCanvasZoom;
    return zm / 100;
  }

  /** C++ `CanvasWidget::scale`. */
  scale(at: Point, value: number, m: Movement): void {
    const v = this.board_.view();
    if (m === Movement.Start) {
      this.focus_ = at;
      this.savedScroll_ = new Point(v.scrollX, v.scrollY);
      this.savedZoom_ = v.zoom;
      return;
    }
    this.zoom(value);
  }

  /** C++ `CanvasWidget::zoom(factor)`: keeps the focus point fixed. */
  private zoom(factor: number): void {
    const z1 = Math.round(this.savedZoom_ * 100) / 100;
    let z2 = Math.round(z1 * factor * 100) / 100;
    z2 = this.checkMinMaxZoom(z2);
    z2 = Math.round(z2 * 100) / 100;
    let z2Int = Math.round(z2 * 100);
    const z1Int = Math.round(z1 * 100);
    if (z1Int === z2Int) {
      if (z1Int < 10 && factor > 1) {
        z2Int = z1Int + 1;
        z2 = z2Int / 100;
      } else {
        return;
      }
    }
    const x = this.focus_.x;
    const y = this.focus_.y;
    const sx = x / z2 - x / z1 + this.savedScroll_.x;
    const sy = y / z2 - y / z1 + this.savedScroll_.y;
    const clamped = this.isInfinite() ? new Point(sx, sy) : this.clampFixed(new Point(sx, sy), z2Int / 100);
    this.board_.setView({ zoom: z2Int / 100, tx: clamped.x, ty: clamped.y });
  }

  /** C++ `CanvasWidget::scroll`. */
  scroll(at: Point, m: Movement): void {
    if (m === Movement.Start) this.scrolling_ = true;
    const v = this.board_.view();
    if (m === Movement.Start) {
      this.last_ = at;
      this.lastScroll_ = new Point(v.scrollX, v.scrollY);
    } else {
      const z = v.zoom;
      let s = new Point(this.lastScroll_.x + (at.x - this.last_.x) / z, this.lastScroll_.y + (at.y - this.last_.y) / z);
      if (!this.isInfinite()) s = this.clampFixed(s, z);
      this.board_.setView({ tx: s.x, ty: s.y });
    }
    if (m === Movement.End) this.scrolling_ = false;
  }

  stopScrolling(): void {
    this.scrolling_ = false;
  }

  /** C++ `scrollDelta`. */
  scrollDelta(dx: number, dy: number): void {
    this.scroll(new Point(0, 0), Movement.Start);
    this.scroll(new Point(dx, dy), Movement.Move);
    this.scroll(new Point(dx, dy), Movement.End);
  }

  /** C++ `Command::zoomIn(at?, delta)` (a negative delta zooms out). */
  zoomBy(delta: number, at?: Point): void {
    const v = this.board_.view();
    let val = v.zoom + delta;
    if (val < 0.01) val = 0.01;
    const factor = val / v.zoom;
    const pt = at ?? new Point(v.canvasW / 2, v.canvasH / 2);
    this.scale(pt, 1, Movement.Start);
    this.scale(pt, factor, Movement.Move);
    this.scale(pt, factor, Movement.End);
  }

  /** C++ `Command::resetZoom`: back to exactly 100 % about the centre. */
  resetZoom(): void {
    const v = this.board_.view();
    const pt = new Point(v.canvasW / 2, v.canvasH / 2);
    this.scale(pt, 1, Movement.Start);
    this.scale(pt, 1 / v.zoom, Movement.Move);
    this.scale(pt, 1 / v.zoom, Movement.End);
    if (this.board_.view().zoom !== 1) this.board_.setView({ zoom: 1 });
  }

  /** C++ `getInsertLocationWithClip`: the centre of the visible canvas, in document units. */
  insertLocation(leftClip = 0, topClip = 0, rightClip = 0, bottomClip = 0): Point {
    const v = this.board_.view();
    if (this.isInfinite()) {
      return this.toDoc(new Point((leftClip + (v.canvasW - rightClip)) / 2, (topClip + (v.canvasH - bottomClip)) / 2));
    }
    const sz = this.board_.page().getCanvasSize(false);
    const ox = v.scrollX * v.zoom;
    const oy = v.scrollY * v.zoom;
    let left = Math.max(ox, leftClip);
    let right = Math.min(ox + sz.width * v.zoom, v.canvasW - rightClip);
    let top = Math.max(oy, topClip);
    let bottom = Math.min(oy + sz.height * v.zoom, v.canvasH - bottomClip);
    if (left > right) left = right = (ox + v.canvasW) / 2;
    if (top > bottom) top = bottom = (oy + v.canvasH) / 2;
    return this.toDoc(new Point((left + right) / 2, (top + bottom) / 2));
  }

  /** The visible canvas in view px (the drawing surface's extent; the whole view when infinite). */
  canvasRect(): Rect {
    const v = this.board_.view();
    if (this.isInfinite()) return new Rect(0, 0, v.canvasW, v.canvasH);
    const sz = this.board_.page().getCanvasSize(false);
    return new Rect(
      v.scrollX * v.zoom,
      v.scrollY * v.zoom,
      Math.max(MIN_SIZE_DP, sz.width * v.zoom),
      Math.max(MIN_SIZE_DP, sz.height * v.zoom),
    );
  }

  /**
   * C++ `CanvasWidget::computeSize(false)` after an edit (`LekhUtil::updateCanvas(true)`,
   * `Command::undo/redo`, `Clipboard`, `CoreIO` after a remote update, …): the page's size is
   * recomputed (an auto-size page follows its content, growing and shrinking) and the offset
   * re-clamped so that a quarter of the canvas stays in view. True when the scroll moved.
   */
  reclampFixed(): boolean {
    if (this.isInfinite()) return false;
    const v = this.board_.view();
    if (v.canvasW <= 0 || v.canvasH <= 0) return false;
    const s = this.clampFixed(new Point(v.scrollX, v.scrollY), v.zoom);
    if (s.x === v.scrollX && s.y === v.scrollY) return false;
    this.board_.setView({ tx: s.x, ty: s.y });
    return true;
  }

  /**
   * C++ `CanvasWidget::handleFirstTimeLayout` (`computeSize(true)`: a board's first open, and
   * `setViewFromBegnining` on a finite page): a fixed or auto-size page smaller than the view is
   * centred on that axis, else placed at the view's edge. Nothing on an infinite canvas. False
   * only while the view has no size yet (nothing could be placed).
   */
  firstTimeLayout(): boolean {
    const v = this.board_.view();
    if (v.canvasW <= 0 || v.canvasH <= 0) return false;
    if (this.isInfinite()) return true;
    const sz = this.board_.page().getCanvasSize(false);
    const cw = Math.max(MIN_SIZE_DP, sz.width * v.zoom);
    const ch = Math.max(MIN_SIZE_DP, sz.height * v.zoom);
    const ox = cw < v.canvasW ? (v.canvasW - cw) / 2 : 0;
    const oy = ch < v.canvasH ? (v.canvasH - ch) / 2 : 0;
    const tx = ox / v.zoom;
    const ty = oy / v.zoom;
    if (tx !== v.scrollX || ty !== v.scrollY) this.board_.setView({ tx, ty });
    return true;
  }

  /** C++ `computeSize`'s clamp: at least a quarter of a fixed canvas stays in view. */
  private clampFixed(scroll: Point, zoom: number): Point {
    const v = this.board_.view();
    const sz = this.board_.page().getCanvasSize(false);
    const cw = Math.max(MIN_SIZE_DP, sz.width * zoom);
    const ch = Math.max(MIN_SIZE_DP, sz.height * zoom);
    let ox = scroll.x * zoom;
    let oy = scroll.y * zoom;
    const minW = Math.min(cw, v.canvasW) / 4;
    const minH = Math.min(ch, v.canvasH) / 4;
    if (ox < 0 && cw + ox < minW) ox = minW - cw;
    if (ox > 0 && v.canvasW - ox < minW) ox = v.canvasW - minW;
    if (oy < 0 && ch + oy < minH) oy = minH - ch;
    if (oy > 0 && v.canvasH - oy < minH) oy = v.canvasH - minH;
    return new Point(ox / zoom, oy / zoom);
  }
}
