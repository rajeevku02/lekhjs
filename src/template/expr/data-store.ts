// One shape instance's live values (port of C++ `DataStore`, `L/DataExpression.{h,cpp}`): the
// box (`w`, `h`, centre `cx`/`cy`, `angle`), the evaluated data list, the arrow locations of open
// shapes, and the snapshot a vertex edit starts from (`save`).
import { Point, Rect } from '../../geometry';

/** C++ `DataStore::ArrowInfo`: an arrowhead's tip and the point it points away from. */
export type ArrowInfo = readonly [Point, Point];

export class DataStore {
  private width_ = 0;
  private height_ = 0;
  private cx_ = 0;
  private cy_ = 0;
  private angle_ = 0;

  private savedWidth_ = 0;
  private savedHeight_ = 0;
  private savedCx_ = 0;
  private savedCy_ = 0;
  private savedAngle_ = 0;
  private tempCx_ = 0;
  private tempCy_ = 0;

  private savedDataExprs_: readonly string[] = [];
  /** The evaluated data, in expression order (C++ `values()`). */
  values: number[] = [];
  /** C++ `arrowLocations()`. */
  arrowLocations: ArrowInfo[] = [];

  width(): number {
    return this.width_;
  }
  height(): number {
    return this.height_;
  }
  cx(): number {
    return this.cx_;
  }
  cy(): number {
    return this.cy_;
  }
  angle(): number {
    return this.angle_;
  }

  /** At least 1, as C++. */
  setWidth(w: number): void {
    this.width_ = w < 1.0 ? 1.0 : w;
  }
  /** At least 1, as C++. */
  setHeight(h: number): void {
    this.height_ = h < 1.0 ? 1.0 : h;
  }
  setCx(x: number): void {
    this.cx_ = x;
  }
  setCy(y: number): void {
    this.cy_ = y;
  }
  setAngle(a: number): void {
    this.angle_ = a;
  }

  /** The value at `i`; 0 outside the list (C++ read past the vector). */
  value(i: number): number {
    return this.values[i] ?? 0;
  }

  /** C++ `setRect`: no minimum is applied here. */
  setRect(rect: Rect): void {
    this.height_ = rect.height;
    this.width_ = rect.width;
    const c = rect.center();
    this.cx_ = c.x;
    this.cy_ = c.y;
  }

  rect(): Rect {
    return new Rect(this.cx_ - this.width_ / 2, this.cy_ - this.height_ / 2, this.width_, this.height_);
  }

  getCenter(): Point {
    return new Point(this.cx_, this.cy_);
  }

  setCenter(p: Point): void {
    this.cx_ = p.x;
    this.cy_ = p.y;
  }

  /** C++: a no-op. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the C++ signature, kept for callers
  setRotationCenter(_p: Point): void {
    /* no-op, as C++ */
  }

  getRotationCenter(): Point {
    return this.getCenter();
  }

  /** Snapshots the box (and the temp centre) for a modification. */
  save(): void {
    this.savedCx_ = this.cx_;
    this.savedCy_ = this.cy_;
    this.savedAngle_ = this.angle_;
    this.savedWidth_ = this.width_;
    this.savedHeight_ = this.height_;
    this.tempCx_ = this.cx_;
    this.tempCy_ = this.cy_;
  }

  saveDataExprs(exprs: readonly string[]): void {
    this.savedDataExprs_ = exprs.slice();
  }
  savedDataExprs(): readonly string[] {
    return this.savedDataExprs_;
  }

  savedWidth(): number {
    return this.savedWidth_;
  }
  savedHeight(): number {
    return this.savedHeight_;
  }
  savedCx(): number {
    return this.savedCx_;
  }
  savedCy(): number {
    return this.savedCy_;
  }
  savedAngle(): number {
    return this.savedAngle_;
  }

  tempCx(): number {
    return this.tempCx_;
  }
  setTempCx(val: number): void {
    this.tempCx_ = val;
  }
  tempCy(): number {
    return this.tempCy_;
  }
  setTempCy(val: number): void {
    this.tempCy_ = val;
  }
}
