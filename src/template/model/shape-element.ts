// The drawable parts of a template (port of C++ `ShapeElement`, `ShapePathElement`,
// `ShapeBoxElement`, `ShapeTextElement` and `ShapeImageElement`, `L/ShapeElement.{h,cpp}`).
//
// Each element has `layout(ds, env)` (pure geometry and text layout, stored on the element) and
// `paint(dp, env)` (draw calls only) in place of C++ `draw` (spec 03 §5.1). Two C++ behaviours
// change with the split:
//   - B10: a path's gradient coordinates are computed into the layout from the current box; C++
//     wrote them into the `Style` after drawing, so it painted with the previous draw's values;
//   - text is laid out by `text/TextLayout` with a per-element `TextMeasureMemo` (spec 03 §8.2).
import { INT_MAX } from '../../base';
import {
  Point,
  Rect,
  getDistance,
  getPointAtDistance,
  getSlope,
  isPointInsidePolygon,
  rotate,
  rotateAboutMid,
  type LineEquation,
  type PointAndSlope,
} from '../../geometry';
import type { Size } from '../../geometry';
import { computeGradient, type ComputedGradient, type DrawingPlatform } from '../../render';
import { Color, Style, TextAlignHorizontal, TextAlignVertical } from '../../style';
import { TextMeasureMemo, type LaidOutText } from '../../text';
import type { DataStore } from '../expr/data-store';
import { DataExpressionParser } from '../expr/data-expression-parser';
import type { TemplateEnv } from '../env';
import {
  BezierCurveShape,
  CloseCommand,
  EllipseShape,
  ArcShape,
  QuadBezierCurveShape,
  RoundedRectShape,
  type PrimitiveShape,
} from './primitive-shape';
import { SvgPathParser } from './svg-path-parser';
import { layoutTextInBox } from './text-box';

/** C++ `TextSide`: the side of the shape a title sits outside. */
export const TextSide = Object.freeze({ None: 0, Top: 1, Bottom: 2, Left: 3, Right: 4 } as const);
export type TextSide = (typeof TextSide)[keyof typeof TextSide];

/** C++ `textSideFromName`: "top", "bottom", "left", "right"; anything else is `None`. */
export function textSideFromName(name: string): TextSide {
  switch (name) {
    case 'top':
      return TextSide.Top;
    case 'bottom':
      return TextSide.Bottom;
    case 'left':
      return TextSide.Left;
    case 'right':
      return TextSide.Right;
  }
  return TextSide.None;
}

/** C++ `textSideName`. */
export function textSideName(side: TextSide): string {
  switch (side) {
    case TextSide.Top:
      return 'top';
    case TextSide.Bottom:
      return 'bottom';
    case TextSide.Left:
      return 'left';
    case TextSide.Right:
      return 'right';
  }
  return '';
}

/** C++ `ShapeElement::Type`. */
export const ElementType = Object.freeze({
  Polygon: 0,
  Ellipse: 1,
  Bezier: 2,
  Arc: 3,
  Rounded: 4,
  Mixed: 5,
  Text: 6,
  Image: 7,
} as const);
export type ElementType = (typeof ElementType)[keyof typeof ElementType];

export abstract class ShapeElement {
  protected type_: ElementType = ElementType.Mixed;
  protected style_: Style | null = null;

  abstract onLoad(): void;
  abstract isPointInside(pt: Point, ds: DataStore): boolean;
  abstract layout(ds: DataStore, env: TemplateEnv): void;
  abstract paint(dp: DrawingPlatform, env: TemplateEnv): void;
  abstract distanceFrom(pt: Point, ds: DataStore): number;
  abstract intersectionWith(eq: LineEquation, ds: DataStore, pts: PointAndSlope[]): void;
  abstract getPositionPoints(pts: number[]): void;
  abstract clone(): ShapeElement;

  /** C++ `draw`: `layout` then `paint`. */
  draw(dp: DrawingPlatform, ds: DataStore, env: TemplateEnv): void {
    this.layout(ds, env);
    this.paint(dp, env);
  }

  elementType(): ElementType {
    return this.type_;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- overridden with the parameter
  updatePoints(_ds: DataStore): void {
    /* nothing by default */
  }
  reset(): void {
    /* nothing by default */
  }
  setStyle(st: Style | null): void {
    this.style_ = st;
  }
  style(): Style | null {
    return this.style_;
  }

  protected static typeOf(sp: PrimitiveShape): ElementType {
    if (sp instanceof EllipseShape) return ElementType.Ellipse;
    if (sp instanceof ArcShape) return ElementType.Arc;
    if (sp instanceof BezierCurveShape) return ElementType.Bezier;
    if (sp instanceof RoundedRectShape) return ElementType.Rounded;
    if (sp instanceof QuadBezierCurveShape) return ElementType.Bezier;
    if ('MLHVZ'.includes(sp.command)) return ElementType.Polygon;
    return ElementType.Mixed;
  }

  /** C++ `copy`: the type and a clone of the style. */
  protected copyTo(other: ShapeElement): void {
    other.type_ = this.type_;
    if (this.style_ !== null) other.style_ = this.style_.clone();
  }
}

/** A path part: the parsed commands of one draw string. */
export class ShapePathElement extends ShapeElement {
  private shapes_: PrimitiveShape[] = [];
  private drawCmdStr_ = '';
  private gradient_: ComputedGradient | null = null;

  shapes(): readonly PrimitiveShape[] {
    return this.shapes_;
  }
  drawCmdStr(): string {
    return this.drawCmdStr_;
  }

  /** Parses `str` into this element (C++ `setDrawCmdStr`). */
  setDrawCmdStr(str: string): void {
    this.drawCmdStr_ = str;
    this.parse(str);
    this.onLoad();
  }

  /** C++ `SVGPathParser::parse(str, this)` without touching `drawCmdStr` (the bound path). */
  parse(str: string): boolean {
    const r = new SvgPathParser().parse(str);
    this.shapes_ = r.shapes;
    return r.ok;
  }

  override reset(): void {
    this.shapes_ = [];
  }

  onLoad(): void {
    this.type_ = ElementType.Mixed;
    let i = 0;
    const first = this.shapes_[0];
    if (first !== undefined && first.command === 'M') i++;
    const only = this.shapes_[i];
    if (this.shapes_.length === i + 1 && only !== undefined) {
      this.type_ = ShapeElement.typeOf(only);
      return;
    }
    this.type_ = ElementType.Polygon;
    for (; i < this.shapes_.length; i++) {
      const s = this.shapes_[i];
      if (s !== undefined && ShapeElement.typeOf(s) !== ElementType.Polygon) {
        this.type_ = ElementType.Mixed;
        break;
      }
    }
  }

  isPointInside(pt: Point, ds: DataStore): boolean {
    if (this.type_ === ElementType.Ellipse || this.type_ === ElementType.Rounded || this.type_ === ElementType.Arc) {
      return this.shapes_[0]?.isPointInside(pt, ds) ?? false;
    }
    if (this.type_ === ElementType.Polygon) {
      return isPointInsidePolygon(this.getVertexPointsForSimplePath(ds), pt);
    }
    return false;
  }

  /** The polygon's vertices (a trailing close dropped), or a curve's two ends. */
  getVertexPointsForSimplePath(ds: DataStore): Point[] {
    const pts: Point[] = [];
    if (this.type_ === ElementType.Polygon) {
      for (let i = 0; i < this.shapes_.length; i++) {
        const s = this.shapes_[i];
        if (s === undefined) continue;
        if (i === this.shapes_.length - 1 && s instanceof CloseCommand) continue;
        s.computePoints(ds);
        pts.push(s.lastPoint());
      }
    } else if (this.type_ === ElementType.Bezier && this.shapes_.length > 0) {
      const s = this.shapes_[1];
      s?.computePoints(ds);
      if (s instanceof BezierCurveShape) {
        const c = s.curve();
        if (c.numPoints === 4) pts.push(c.point1, c.point4);
      }
      if (s instanceof QuadBezierCurveShape) {
        const c = s.curve();
        pts.push(c.point1, c.point3);
      }
    }
    return pts;
  }

  layout(ds: DataStore): void {
    for (const s of this.shapes_) s.layout(ds);
    const st = this.style_;
    this.gradient_ =
      st !== null
        ? computeGradient(st.effectiveFillPaint(), {
            cx: ds.cx(),
            cy: ds.cy(),
            width: ds.width(),
            height: ds.height(),
          })
        : null;
  }

  paint(dp: DrawingPlatform): void {
    const st = this.style_;
    if (st === null) return;
    dp.startDrawing(new Point(), st, { fillGradient: this.gradient_ });
    for (const s of this.shapes_) s.paint(dp);
    dp.endDrawing();
  }

  override updatePoints(ds: DataStore): void {
    for (const s of this.shapes_) s.updatePoints(ds);
  }

  distanceFrom(pt: Point, ds: DataStore): number {
    let dist = INT_MAX;
    for (const s of this.shapes_) {
      const d = s.distanceFrom(pt, ds);
      if (d < dist) dist = d;
    }
    return dist;
  }

  intersectionWith(eq: LineEquation, ds: DataStore, pts: PointAndSlope[], closeDist = 2): void {
    for (const s of this.shapes_) s.intersectionWith(eq, ds, pts);
    const n = this.shapes_.length;
    if (this.type_ !== ElementType.Polygon || n < 3 || pts.length === 0) return;

    // Fix the slope at line joins.
    const at = (i: number) => this.shapes_[i]?.lastPoint() ?? new Point();
    const first = at(0);
    const last = at(n - 1);
    let closed = false;
    let prev = new Point();
    if (getDistance(first, last) < closeDist) {
      prev = at(n - 2);
      closed = true;
    }
    for (let k = 0; k < pts.length; k++) {
      let ps = pts[k];
      if (ps === undefined) continue;
      for (let i = 0; i < n - 1; i++) {
        const pt = at(i);
        const dist = getDistance(pt, ps.point);
        if (dist < closeDist && (i > 0 || closed)) {
          let next = at(i + 1);
          const dist1 = getDistance(prev, pt);
          const dist2 = getDistance(next, pt);
          if (dist1 > 0.1 && dist2 > 0.1) {
            next = getPointAtDistance(pt, next, dist1);
            ps = { point: pt, slope: getSlope(prev, next) };
            pts[k] = ps;
          }
        }
        prev = pt;
      }
    }
  }

  getPositionPoints(pts: number[]): void {
    for (const s of this.shapes_) s.getPositionPoints(pts);
  }

  clone(): ShapePathElement {
    const path = new ShapePathElement();
    this.copyTo(path);
    path.setDrawCmdStr(this.drawCmdStr_);
    return path;
  }
}

/** A part placed by a location index list `cx cy [w h angle]`, or at the shape's centre ("default"). */
export abstract class ShapeBoxElement extends ShapeElement {
  protected cx_ = -1;
  protected cy_ = -1;
  protected w_ = -1;
  protected h_ = -1;
  protected angle_ = -1;
  protected atShapeCenter_ = false;
  protected locationStr_ = '';

  locationStr(): string {
    return this.locationStr_;
  }
  atShapeCenter(): boolean {
    return this.atShapeCenter_;
  }

  getPositionPoints(pts: number[]): void {
    if (this.atShapeCenter_) return;
    for (let i = 1; i < pts.length; i += 2) {
      if (pts[i - 1] === this.cx_ && pts[i] === this.cy_) return;
    }
    pts.push(this.cx_, this.cy_);
  }

  isPointInside(pt: Point, ds: DataStore): boolean {
    const { rect, angle } = this.getRectAndAngle(ds);
    if (angle === 0) return rect.contains(pt);
    // C++ `GeoUtil::rotate(pts, angle)`: about the corners' mean.
    return isPointInsidePolygon(rotateAboutMid(rect.getPoints(), angle), pt);
  }

  distanceFrom(): number {
    return INT_MAX;
  }

  intersectionWith(): void {
    /* C++: none */
  }

  setLocationStr(str: string): void {
    this.locationStr_ = str;
    if (str === 'default') {
      this.atShapeCenter_ = true;
      this.cx_ = -1;
      this.cy_ = -1;
      this.w_ = -1;
      this.h_ = -1;
      return;
    }
    const list = DataExpressionParser.parseList(str);
    const [a = -1, b = -1, c = -1, d = -1, e = -1] = list;
    if (list.length === 2) {
      this.cx_ = a;
      this.cy_ = b;
      this.w_ = -1;
      this.h_ = -1;
      this.angle_ = -1;
      this.atShapeCenter_ = false;
    } else if (list.length > 4) {
      this.cx_ = a;
      this.cy_ = b;
      this.w_ = c;
      this.h_ = d;
      this.angle_ = e;
      this.atShapeCenter_ = false;
    } else {
      this.atShapeCenter_ = true;
    }
  }

  /** The index form of `setLocationStr`. */
  setLocationIndices(cx: number, cy: number, w: number, h: number, angle: number): void {
    this.setLocationStr(`${String(cx)} ${String(cy)} ${String(w)} ${String(h)} ${String(angle)}`);
  }

  getRectAndAngle(ds: DataStore): { rect: Rect; angle: number } {
    let angle = ds.angle();
    if (this.atShapeCenter_) return { rect: Rect.fromCenter(ds.getCenter(), ds.width(), ds.height()), angle };
    const ct = new Point(ds.value(this.cx_), ds.value(this.cy_));
    if (this.angle_ >= 0) angle += ds.value(this.angle_);
    const rect =
      this.h_ >= 0 && this.w_ >= 0
        ? Rect.fromCenter(ct, ds.value(this.w_), ds.value(this.h_))
        : Rect.fromCenter(ct, 0, 0);
    return { rect, angle };
  }
}

/** C++ `ShapeTextElement::TextType`. */
export const TextType = Object.freeze({ Plain: 0, Equation: 1 } as const);
export type TextType = (typeof TextType)[keyof typeof TextType];

/** Is a horizontal alignment set on `style` or any ancestor? */
function isTextAlignHorizontalSet(style: Style | null): boolean {
  for (let s = style; s !== null; s = s.parent()) {
    if (s.isTextAlignHorizontalDefined()) return true;
  }
  return false;
}

/** A text slot. Its layout is a `LaidOutText`, measured through a per-element memo. */
export class ShapeTextElement extends ShapeBoxElement {
  private floating_ = false;
  private text_ = '';
  private textType_: TextType = TextType.Plain;
  private textCenter_ = new Point();
  private textCenterSet_ = false;
  private isDefaultText_ = false;
  private external_: TextSide = TextSide.None;
  private readonly memo_ = new TextMeasureMemo();
  private laid_: LaidOutText | null = null;
  private paintStyle_: Style | null = null;

  constructor(box?: { cx: number; cy: number; w: number; h: number; angle: number }) {
    super();
    this.type_ = ElementType.Text;
    if (box === undefined) {
      this.atShapeCenter_ = true;
    } else {
      this.cx_ = box.cx;
      this.cy_ = box.cy;
      this.w_ = box.w;
      this.h_ = box.h;
      this.angle_ = box.angle;
      this.atShapeCenter_ = false;
    }
  }

  onLoad(): void {
    this.type_ = ElementType.Text;
  }

  text(): string {
    return this.text_;
  }
  setText(txt: string): void {
    this.text_ = txt;
  }
  textType(): TextType {
    return this.textType_;
  }
  setTextType(t: TextType): void {
    this.textType_ = t;
  }
  floating(): boolean {
    return this.floating_;
  }
  setFloating(flt: boolean): void {
    this.floating_ = flt;
  }
  isDefaultText(): boolean {
    return this.isDefaultText_;
  }
  setIsDefaultText(val: boolean): void {
    this.isDefaultText_ = val;
  }
  external(): TextSide {
    return this.external_;
  }
  setExternal(side: TextSide): void {
    this.external_ = side;
  }
  /** The memo this slot measures through (spec 03 §8.2 level 1). */
  measureMemo(): TextMeasureMemo {
    return this.memo_;
  }
  /** The last layout, or `null` (empty text, or not laid out yet). */
  laidOut(): LaidOutText | null {
    return this.laid_;
  }

  center(ds: DataStore): Point {
    return this.textCenterSet_ ? this.textCenter_ : this.getRectAndAngle(ds).rect.center();
  }

  setTextCenter(pt: Point): void {
    this.textCenter_ = pt;
    this.textCenterSet_ = true;
  }

  getSize(ds: DataStore): Size {
    return this.getRectAndAngle(ds).rect.size();
  }

  /** The style the text paints with: a title with no alignment anywhere aligns toward the shape. */
  paintStyle(): Style | null {
    const style = this.style_;
    if (style === null) return null;
    if (this.external_ === TextSide.None || isTextAlignHorizontalSet(style)) return style;
    let ts = this.paintStyle_;
    if (ts?.parent() !== style) {
      ts = new Style();
      ts.setParent(style);
      ts.setTextAlignHorizontal(
        this.external_ === TextSide.Left
          ? TextAlignHorizontal.Right
          : this.external_ === TextSide.Right
            ? TextAlignHorizontal.Left
            : TextAlignHorizontal.Center,
      );
      this.paintStyle_ = ts;
    }
    return ts;
  }

  layout(ds: DataStore, env: TemplateEnv): void {
    const style = this.style_;
    const paintStyle = this.paintStyle();
    if (style === null || paintStyle === null) {
      this.laid_ = null;
      return;
    }
    let ctr = this.center(ds);
    const box = this.getRectAndAngle(ds);
    const angle = box.angle;
    let rect = box.rect;
    if (this.floating_ || ((this.h_ < 0 || this.w_ < 0) && !this.atShapeCenter_)) {
      rect = Rect.fromCenter(ctr, 40000, 40000);
    }
    if (
      this.textCenterSet_ &&
      this.external_ === TextSide.None &&
      (style.effectiveTextAlignVertical() !== TextAlignVertical.Center ||
        style.effectiveTextAlignHorizontal() !== TextAlignHorizontal.Center)
    ) {
      ctr = ds.getCenter();
    }
    rect = Rect.fromCenter(ctr, rect.width, rect.height);
    let pad = 0;
    if (!this.floating_) {
      pad = style.effectiveStrokeWidth() / 2;
      if (this.isDefaultText_) pad += env.config.alignmentPad;
    }
    this.laid_ = layoutTextInBox(
      env.text,
      {
        text: this.text_,
        angle,
        inRect: rect,
        pad,
        textSizeAdjustment: this.floating_ ? 1 : 0,
        wrapMode: this.floating_ ? 'float' : 'wrap',
      },
      paintStyle,
      env.config.minTextEditWidth,
      this.memo_,
    );
  }

  paint(dp: DrawingPlatform): void {
    const style = this.paintStyle();
    if (this.laid_ !== null && style !== null) dp.drawText(this.laid_, style);
  }

  /** C++ `clone`: `isDefaultText` is not copied (as C++). */
  clone(): ShapeTextElement {
    const te = new ShapeTextElement();
    this.copyTo(te);
    te.text_ = this.text_;
    te.floating_ = this.floating_;
    te.textType_ = this.textType_;
    te.textCenter_ = this.textCenter_;
    te.textCenterSet_ = this.textCenterSet_;
    te.atShapeCenter_ = this.atShapeCenter_;
    te.external_ = this.external_;
    te.setLocationStr(this.locationStr_);
    return te;
  }
}

/** The fill of an image slot whose image is not loaded: white, alpha 2555 truncated to 251 (as C++). */
const IMAGE_PLACEHOLDER_FILL = Object.freeze(new Color(255, 255, 255, 2555));

/**
 * The label drawn in the placeholder while the image is loading (owner decision 2026-10-20: the
 * white rectangle as C++, plus "Loading…"; C++ draws no label). Live view only: the session's
 * `TemplateEnv.imageLoading` is false for export, thumbnails and `board_render`.
 */
export const IMAGE_LOADING_LABEL = 'Loading\u2026';
/** The label's font size as a fraction of the placeholder's shorter side (it scales with the shape). */
export const IMAGE_LOADING_FONT_FRACTION = 0.1;
/** Below this font size (board points) the label is not drawn. */
export const IMAGE_LOADING_MIN_FONT = 6;
const IMAGE_LOADING_TEXT = Object.freeze(new Color(128, 128, 128, 255));

/**
 * The "Loading…" label centred in the placeholder `rect` (rotated by `angle` with it), or nothing
 * when the rectangle is too small for it: a font under `IMAGE_LOADING_MIN_FONT`, or a label wider
 * or taller than 90 % of the rectangle.
 */
function paintImageLoadingLabel(dp: DrawingPlatform, env: TemplateEnv, rect: Rect, angle: number): void {
  const fontSize = Math.min(rect.width, rect.height) * IMAGE_LOADING_FONT_FRACTION;
  if (!(fontSize >= IMAGE_LOADING_MIN_FONT)) return;
  const style = new Style();
  style.setFontSize(fontSize);
  style.setFontColor(IMAGE_LOADING_TEXT);
  const laid = layoutTextInBox(
    env.text,
    { text: IMAGE_LOADING_LABEL, angle, inRect: rect, wrapMode: 'float' },
    style,
    0,
  );
  if (laid === null || laid.width > rect.width * 0.9 || laid.height > rect.height * 0.9) return;
  dp.drawText(laid, style);
}

/** An image slot. The element holds the image's key; paint looks the bitmap up in the env. */
export class ShapeImageElement extends ShapeBoxElement {
  private resourceUrl_ = '';
  private inline_: { readonly data: string; readonly format: string } | null = null;
  private laid_: { rect: Rect; angle: number } = { rect: new Rect(), angle: 0 };

  constructor(box?: { cx: number; cy: number; w: number; h: number; angle: number }) {
    super();
    this.type_ = ElementType.Image;
    if (box === undefined) {
      this.atShapeCenter_ = true;
    } else {
      this.cx_ = box.cx;
      this.cy_ = box.cy;
      this.w_ = box.w;
      this.h_ = box.h;
      this.angle_ = box.angle;
      this.atShapeCenter_ = false;
    }
  }

  onLoad(): void {
    this.type_ = ElementType.Image;
  }

  resourceUrl(): string {
    return this.resourceUrl_;
  }
  setResourceUrl(url: string): void {
    this.resourceUrl_ = url;
  }
  /** Inline (base64) image data of the template (C++ `setPlatformData` from base64). */
  setInlineImage(data: string, format: string): void {
    this.inline_ = data === '' ? null : { data, format };
  }
  inlineImage(): { readonly data: string; readonly format: string } | null {
    return this.inline_;
  }

  /** The `ImageCache` key: the inline image's `data:` URI, else the resource URL ('' for none). */
  imageKey(): string {
    if (this.inline_ !== null) return inlineImageKey(this.inline_.data, this.inline_.format);
    return this.resourceUrl_;
  }

  layout(ds: DataStore): void {
    this.laid_ = this.getRectAndAngle(ds);
  }

  paint(dp: DrawingPlatform, env: TemplateEnv): void {
    const { rect, angle } = this.laid_;
    const key = this.imageKey();
    const image = key !== '' ? env.image(key) : undefined;
    if (image !== undefined) {
      dp.drawImage(rect.center(), rect.size(), angle, image);
      return;
    }
    const pts = rotate(rect.getPoints(), rect.center(), angle);
    const style = new Style();
    style.setFillColor(IMAGE_PLACEHOLDER_FILL);
    dp.startDrawing(pts[0] ?? new Point(), style);
    for (let i = 1; i < pts.length; i++) dp.addLineTo(pts[i] ?? new Point());
    dp.closePath();
    dp.endDrawing();
    if (key !== '' && env.imageLoading?.(key) === true) paintImageLoadingLabel(dp, env, rect, angle);
  }

  /** C++ `clone`: copies the image and the location only (not the style or the URL), as C++. */
  clone(): ShapeImageElement {
    const si = new ShapeImageElement();
    si.inline_ = this.inline_;
    si.atShapeCenter_ = this.atShapeCenter_;
    si.setLocationStr(this.locationStr_);
    return si;
  }
}

/** The cache key of an inline template image (spec 03 §7: decoded once per template instance). */
export function inlineImageKey(data: string, format: string): string {
  return `data:image/${format === '' ? 'png' : format};base64,${data}`;
}
