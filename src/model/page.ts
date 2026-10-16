// A page (port of C++ `document::Page`, `Page.{h,cpp}`): identity, size, orientation, margin,
// canvas size type and name, background, and one `ObjectStore`.
//
// `paint` replaces `Page::draw`: the layout is flushed, then the objects are painted culled to
// the view (spec 03 §5.3, §6), then the margin box. Zoom and scroll are the canvas transform the
// caller set (§9), so this paints in canvas units.
import type { Config } from '../base';
import { Point } from '../geometry';
import type { DrawingPlatform, ViewTransform } from '../render';
import { Color, Length, Style, Unit } from '../style';
import type { LekhObject, PaintEnv } from './lekh-object';
import { ObjectStore, type ObjectStoreOptions } from './object-store';
import { PageBackground } from './page-background';

/** C++ `Page::CanvasSizeType`; persisted by name (`sizeTypeToStr`). */
export const CanvasSizeType = Object.freeze({ Auto: 0, Fixed: 1, Infinite: 2 } as const);
export type CanvasSizeType = (typeof CanvasSizeType)[keyof typeof CanvasSizeType];

/** C++ `Page::Orientation`. */
export const Orientation = Object.freeze({ Portrait: 0, Landscape: 1 } as const);
export type Orientation = (typeof Orientation)[keyof typeof Orientation];

/** C++ `Page::Size`. */
export class PageSize {
  readonly unit: Unit;
  readonly width: number;
  readonly height: number;

  constructor(unit: Unit = Unit.Point, width = 0, height = 0) {
    this.unit = unit;
    this.width = width;
    this.height = height;
    Object.freeze(this);
  }

  widthInPoints(): number {
    return Length.inPoints(this.width, this.unit);
  }

  heightInPoints(): number {
    return Length.inPoints(this.height, this.unit);
  }
}

/** C++ `Page::Margin`. */
export interface PageMargin {
  readonly show: boolean;
  readonly size: PageSize;
}

/** C++ `Page::CanvasSize`. */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
  readonly offsetx: number;
  readonly offsety: number;
}

/** C++ `MarginDrawInfo`. */
export interface MarginDrawInfo {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

/** What `Page.paint` needs beyond the drawing platform. */
export interface PagePaintOptions {
  readonly env: PaintEnv;
  /** The view; when absent nothing is culled and no margin is drawn (export). */
  readonly view?: ViewTransform;
}

/** C++ `Page::getCanvasSize`'s `minFixedSize`. */
const MIN_FIXED_SIZE = 5;
/** The pixels per inch of the web and the backend (`Platform::pixelsPerInch`; iOS answers 144). */
export const DEFAULT_PIXELS_PER_INCH = 96;

const MARGIN_COLOR: Color = Object.freeze(new Color(0, 172, 255, 255));

export class Page {
  id: string;
  name: string;
  order = 0;
  size: PageSize = new PageSize();
  orientation: Orientation = Orientation.Portrait;
  margin: PageMargin = { show: false, size: new PageSize() };
  background: PageBackground = new PageBackground();
  canvasSizeType: CanvasSizeType = CanvasSizeType.Auto;
  canvasName = '';
  readonly objectStore: ObjectStore;
  private computedSize_ = { width: 0, height: 0 };
  private readonly storeOpts_: ObjectStoreOptions;

  constructor(id: string, name: string, storeOpts: ObjectStoreOptions) {
    this.id = id;
    this.name = name;
    this.storeOpts_ = storeOpts;
    this.objectStore = new ObjectStore(storeOpts);
  }

  private get config(): Config {
    return this.storeOpts_.config;
  }

  static sizeTypeToStr(t: CanvasSizeType): string {
    if (t === CanvasSizeType.Infinite) return 'infinite';
    if (t === CanvasSizeType.Fixed) return 'fixed';
    return 'auto';
  }

  static sizeTypeFromStr(s: string): CanvasSizeType {
    if (s === 'infinite') return CanvasSizeType.Infinite;
    if (s === 'fixed') return CanvasSizeType.Fixed;
    return CanvasSizeType.Auto;
  }

  getObject(id: string): LekhObject | null {
    return this.objectStore.getObject(id);
  }

  lastObject(): LekhObject | null {
    return this.objectStore.lastObject();
  }

  objectBefore(obj: LekhObject): LekhObject | null {
    return this.objectStore.objectBefore(obj);
  }

  objectAfter(obj: LekhObject): LekhObject | null {
    return this.objectStore.objectAfter(obj);
  }

  /** C++ `cloneWithoutObjects`: the attributes, a new id. C++ `copyFrom` copies neither id nor order. */
  cloneWithoutObjects(newId: string): Page {
    const p = new Page(newId, this.name, this.storeOpts_);
    p.orientation = this.orientation;
    p.canvasSizeType = this.canvasSizeType;
    p.size = this.size;
    p.margin = this.margin;
    p.background = this.background.clone();
    p.canvasName = this.canvasName;
    return p;
  }

  /** The size the last on-screen `getCanvasSize` computed (C++ `computedSize_`). */
  get computedSize(): { readonly width: number; readonly height: number } {
    return this.computedSize_;
  }

  /**
   * C++ `getCanvasSize`. A fixed page converts its size to points; an auto or infinite page is the
   * bounds of all objects plus `rightBottomMargin`, at least `minCanvasWidth × minCanvasHeight`.
   * Both are capped at `maxCanvasSize`.
   *
   * A fixed page in `pixel` units divides by C++'s integer `pixelsPerPoint`, which is
   * `trunc(pixelsPerInch / 144)`: 1 on iOS (144) and 0 on the web and the backend (96), where the
   * division gives infinity and the cap. Kept as is.
   */
  getCanvasSize(forExporting: boolean, pixelsPerInch = DEFAULT_PIXELS_PER_INCH): CanvasSize {
    const cfg = this.config;
    let width: number;
    let height: number;
    let offsetx = 0;
    let offsety = 0;
    if (this.canvasSizeType === CanvasSizeType.Fixed) {
      const pointsPerInch = Length.inPoints(1, Unit.Inch);
      const pixelsPerPoint = pointsPerInch > 0 ? Math.trunc(pixelsPerInch / pointsPerInch) : 1;
      const s = this.size;
      if (s.unit === Unit.Pixel) {
        width = s.width / pixelsPerPoint;
        height = s.height / pixelsPerPoint;
      } else {
        width = s.widthInPoints();
        height = s.heightInPoints();
      }
      if (width < MIN_FIXED_SIZE) width = MIN_FIXED_SIZE;
      if (height < MIN_FIXED_SIZE) height = MIN_FIXED_SIZE;
    } else {
      const rect = this.objectStore.hit.boundsOfAll();
      width = rect.width + rect.x + cfg.rightBottomMargin;
      height = rect.height + rect.y + cfg.rightBottomMargin;
      offsetx = rect.x;
      offsety = rect.y;
      if (width < cfg.minCanvasWidth) width = cfg.minCanvasWidth;
      if (height < cfg.minCanvasHeight) height = cfg.minCanvasHeight;
    }
    if (width > cfg.maxCanvasSize) width = cfg.maxCanvasSize;
    if (height > cfg.maxCanvasSize) height = cfg.maxCanvasSize;
    if (!forExporting) this.computedSize_ = { width, height };
    return { width, height, offsetx, offsety };
  }

  /**
   * C++ `Page::draw`'s margin box: drawn on screen for a non-infinite page whose margin (scaled
   * by the zoom) is positive and under half the computed canvas size.
   */
  marginBox(zoom: number): MarginDrawInfo | null {
    const mh = this.margin.size.heightInPoints() * zoom;
    const mw = this.margin.size.widthInPoints() * zoom;
    const cw = this.computedSize_.width * zoom;
    const ch = this.computedSize_.height * zoom;
    if (this.canvasSizeType === CanvasSizeType.Infinite || !(mw > 0 && mh > 0 && mw < cw / 2 && mh < ch / 2)) {
      return null;
    }
    const fromX = this.margin.size.widthInPoints();
    const fromY = this.margin.size.heightInPoints();
    return { fromX, fromY, toX: this.computedSize_.width - fromX, toY: this.computedSize_.height - fromY };
  }

  /**
   * Paints the page: objects (culled to `view.cullRect()` when a view is given) and, on screen,
   * the margin box. Returns the objects painted.
   */
  paint(dp: DrawingPlatform, opts: PagePaintOptions): readonly LekhObject[] {
    const view = opts.view;
    const cull = view === undefined || opts.env.forExport ? null : view.cullRect();
    const painted = this.objectStore.paint(dp, opts.env, cull);
    const mdi = view === undefined || opts.env.forExport ? null : this.marginBox(view.zoom);
    if (mdi !== null) {
      const style = new Style();
      style.setStrokeColor(MARGIN_COLOR);
      style.setStrokeWidth(1);
      dp.startDrawing(new Point(mdi.fromX, mdi.fromY), style);
      dp.addLineTo(new Point(mdi.toX, mdi.fromY));
      dp.addLineTo(new Point(mdi.toX, mdi.toY));
      dp.addLineTo(new Point(mdi.fromX, mdi.toY));
      dp.closePath();
      dp.endDrawing();
    }
    return painted;
  }
}
