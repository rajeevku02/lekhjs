// A library shape drawn to fit a cell (port of C++ `CellObject::draw` + `LibraryObjectStore::
// drawObject`, `L/app/viewmanager/ShapeLibraryCells.cpp`, `L/LibraryObjectStore.cpp:230-309`;
// spec 02 `StencilThumbnail`, OQ-29: the host renders each thumbnail once into a cached bitmap).
//
// The object is a fresh instance the caller made for this drawing (it is resized and its text
// may be replaced; nothing is restored). Three cases, as C++:
// - a user-library item, or a template whose `libraryview` asks to `scale` with a size: the
//   shape is laid out at its own (or the library-view) size and drawn scaled down to the cell;
// - otherwise the shape is resized to the cell (keeping its aspect) and drawn 1:1, so strokes
//   and text keep their width.
// A template's `libraryview.text` replaces its first text (or its interpreted text) while drawn.
import type { Canvas2DLike, Config } from '../../base';
import { Point, Rect } from '../../geometry';
import { TemplatedObject, type ImageLookup, type LayoutEnv, type LekhObject, type PaintEnv } from '../../model';
import { Canvas2DDrawingPlatform } from '../../render';
import type { TextPainter } from '../../text';

export interface LibraryThumbnailOptions {
  /** The cell's side in CSS px (C++ the `CellObject` frame); the shape gets `size - 12`. */
  readonly size: number;
  /** Device pixels per CSS px of the target canvas (default 1). */
  readonly pixelRatio?: number;
  /** A user (custom) library item: always drawn scaled. */
  readonly isCustomLib?: boolean;
  readonly config: Config;
  readonly textPainter?: TextPainter;
  readonly images?: ImageLookup | null;
}

/** The C++ cell inset: `min(w, h) - 12`. */
export const THUMBNAIL_INSET = 12;

function layoutEnv(config: Config): LayoutEnv {
  const env: LayoutEnv = {
    config,
    ensureLayout: (o: LekhObject) => {
      if (o.needsLayout()) o.layout(env);
    },
    objectById: () => undefined,
  };
  return env;
}

/**
 * Draws `obj` centred in a `size` × `size` cell at the canvas origin. The context's transform is
 * set here (pixel ratio × scale); the caller clears the canvas first.
 */
export function drawLibraryThumbnail(ctx: Canvas2DLike, obj: LekhObject, o: LibraryThumbnailOptions): void {
  const dpr = o.pixelRatio ?? 1;
  const cellSz = o.size - THUMBNAIL_INSET;
  if (cellSz <= 0) return;
  const center = new Point(o.size / 2, o.size / 2);
  let factor = 1;
  if (obj instanceof TemplatedObject) {
    const stl = obj.shapeTemplate();
    const lv = stl?.libraryViewAttr;
    if (stl !== null && lv !== undefined && lv.text !== '') {
      if (stl.interpretText()) stl.setInterpretedText(lv.text);
      else if (stl.texts().length > 0) obj.updateText(lv.text, 0);
    }
    const back = obj.ds.rect();
    let width = back.width;
    let height = back.height;
    const scaled = o.isCustomLib === true || (lv !== undefined && lv.scale && lv.width > 0 && lv.height > 0);
    if (scaled) {
      if (o.isCustomLib !== true && lv !== undefined) {
        width = lv.width;
        height = lv.height;
      }
      factor = width > height ? cellSz / width : cellSz / height;
      obj.setRect(Rect.fromCenter(new Point(center.x / factor, center.y / factor), width, height));
    } else {
      const f = back.width > back.height ? cellSz / back.width : cellSz / back.height;
      obj.setRect(Rect.fromCenter(center, back.width * f, back.height * f));
    }
  }
  obj.layout(layoutEnv(o.config));
  ctx.save();
  ctx.setTransform(dpr * factor, 0, 0, dpr * factor, 0, 0);
  const dp = new Canvas2DDrawingPlatform(ctx, {
    viewScale: dpr * factor,
    ...(o.textPainter !== undefined ? { textPainter: o.textPainter } : {}),
  });
  const env: PaintEnv = { config: o.config, zoom: 1, forExport: true, images: o.images ?? null };
  obj.paint(dp, env);
  ctx.restore();
}
