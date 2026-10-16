// Sub-entry `export/raster` (spec 01 §3.2 rule 6): imported by `headless/`. Draws a page to any
// `DrawingPlatform` (kashi: `Canvas2DDrawingPlatform` over an @napi-rs/canvas context).
export {
  pageVisualBounds,
  paintPage,
  type PaintPageAnswer,
  type PaintPageOptions,
  type RasterContext,
  type RasterHost,
} from './paint-page';
