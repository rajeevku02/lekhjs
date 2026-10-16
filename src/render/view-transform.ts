// Zoom and scroll as one canvas transform (spec 03 §9), and the screen ↔ document mapping of
// C++ `LekhUtil::mapPoint` / `mapPointR` / `mapRect` / `mapRectR` (`LekhUtil.cpp:529-596`).
//
// screen = zoom · (doc + scroll)    doc = screen / zoom − scroll
//
// "Screen" is CSS pixels (points) in the canvas; the device-pixel ratio is applied only by the
// matrix. Replaces `TranslatedDrawingPlatform` + `ScaledDrawingPlatform` (never ported).
import type { Canvas2DLike } from '../base';
import { Point, Rect } from '../geometry';

/** The culling margin in screen pixels (OQ-17): `32 / zoom` canvas units on each side. */
export const CULL_MARGIN_PX = 32;

/** A 2-D affine matrix in `setTransform(a, b, c, d, e, f)` order. */
export type Matrix = readonly [number, number, number, number, number, number];

export interface ViewTransformInit {
  /** Zoom factor (1 = 100 %). C++ `LekhGlobal::zoomDouble()`. */
  readonly zoom?: number;
  /** Scroll in canvas units. C++ `LekhGlobal::scroll()`. */
  readonly scrollX?: number;
  readonly scrollY?: number;
  /** Device pixels per CSS pixel. */
  readonly dpr?: number;
  /** Canvas size in CSS pixels. */
  readonly canvasW?: number;
  readonly canvasH?: number;
}

export class ViewTransform {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly dpr: number;
  readonly canvasW: number;
  readonly canvasH: number;

  constructor(init: ViewTransformInit = {}) {
    this.zoom = init.zoom ?? 1;
    this.scrollX = init.scrollX ?? 0;
    this.scrollY = init.scrollY ?? 0;
    this.dpr = init.dpr ?? 1;
    this.canvasW = init.canvasW ?? 0;
    this.canvasH = init.canvasH ?? 0;
    Object.freeze(this);
  }

  /** From the C++ integer zoom percentage (`LekhGlobal::zoom()`, 100 = 1:1). */
  static fromPercent(percent: number, init: Omit<ViewTransformInit, 'zoom'> = {}): ViewTransform {
    return new ViewTransform({ ...init, zoom: percent / 100 });
  }

  /** The export transform (`drawForExporting`): no zoom, translated by (sx, sy), at `dpr`. */
  static forExport(sx: number, sy: number, dpr = 1): ViewTransform {
    return new ViewTransform({ zoom: 1, scrollX: sx, scrollY: sy, dpr });
  }

  with(init: ViewTransformInit): ViewTransform {
    return new ViewTransform({
      zoom: this.zoom,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      dpr: this.dpr,
      canvasW: this.canvasW,
      canvasH: this.canvasH,
      ...init,
    });
  }

  /** Device pixels per canvas unit (zoom × dpr): what a 1-device-pixel minimum divides by. */
  get viewScale(): number {
    return this.zoom * this.dpr;
  }

  /** `[d·z, 0, 0, d·z, d·z·scroll.x, d·z·scroll.y]` (spec 03 §9). */
  matrix(): Matrix {
    const s = this.dpr * this.zoom;
    return [s, 0, 0, s, s * this.scrollX, s * this.scrollY];
  }

  /** The screen-space matrix of an overlay or grid layer: the DPR alone. */
  screenMatrix(): Matrix {
    return [this.dpr, 0, 0, this.dpr, 0, 0];
  }

  /** `ctx.setTransform(matrix())`. */
  apply(ctx: Pick<Canvas2DLike, 'setTransform'>): void {
    const [a, b, c, d, e, f] = this.matrix();
    ctx.setTransform(a, b, c, d, e, f);
  }

  /** `ctx.setTransform(screenMatrix())`. */
  applyScreen(ctx: Pick<Canvas2DLike, 'setTransform'>): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** C++ `mapPoint`: screen (CSS px) → canvas units. */
  toDoc(pt: Point): Point {
    return new Point(pt.x / this.zoom - this.scrollX, pt.y / this.zoom - this.scrollY);
  }

  /** C++ `mapPointR`: canvas units → screen (CSS px). */
  toScreen(pt: Point): Point {
    return new Point((pt.x + this.scrollX) * this.zoom, (pt.y + this.scrollY) * this.zoom);
  }

  /** C++ `mapRect`. */
  toDocRect(r: Rect): Rect {
    const z = r.zoom(1 / this.zoom);
    return new Rect(z.x - this.scrollX, z.y - this.scrollY, z.width, z.height);
  }

  /** C++ `mapRectR`. */
  toScreenRect(r: Rect): Rect {
    return new Rect(r.x + this.scrollX, r.y + this.scrollY, r.width, r.height).zoom(this.zoom);
  }

  /** A screen length (a hit tolerance, a handle size) in canvas units. */
  toDocLength(px: number): number {
    return px / this.zoom;
  }

  /** The visible part of the document: `{ −scroll, canvas size / zoom }` (spec 03 §6). */
  visibleRect(): Rect {
    return new Rect(-this.scrollX, -this.scrollY, this.canvasW / this.zoom, this.canvasH / this.zoom);
  }

  /** `visibleRect()` grown by `marginPx / zoom` canvas units on each side (spec 03 §6, OQ-17). */
  cullRect(marginPx = CULL_MARGIN_PX): Rect {
    const m = marginPx / this.zoom;
    const v = this.visibleRect();
    return new Rect(v.x - m, v.y - m, v.width + 2 * m, v.height + 2 * m);
  }
}
