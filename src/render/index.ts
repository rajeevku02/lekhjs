// lekhjs module `render` (spec 01 §2.1). The only import target from outside the module.
// The drawing interface and its canvas, capture and no-op implementations, the view transform,
// the image codec port and per-session image cache, and the grid layer painter.
export type {
  ComputedGradient,
  ComputedLinearGradient,
  ComputedRadialGradient,
  DrawingPlatform,
  PathPaint,
} from './drawing-platform';
export type { DecodedImage, ImageCodec, ImageFormat } from './ports';
export { computeGradient, type GradientBox } from './gradient';
export { Canvas2DDrawingPlatform, cssColor, type Canvas2DDrawingPlatformOptions } from './canvas2d-drawing-platform';
export { NoOpPlatform } from './no-op-platform';
export { PathCaptureDrawingPlatform } from './path-capture-drawing-platform';
export { CULL_MARGIN_PX, ViewTransform, type Matrix, type ViewTransformInit } from './view-transform';
export {
  IMAGE_MAX_FAILURES,
  IMAGE_TTL_MS,
  ImageCache,
  type ImageCacheOptions,
  type ImageFailReason,
  type ImageState,
} from './image-cache';
export {
  GRID_LINE_COLOR_1,
  GRID_LINE_COLOR_2,
  GridPainter,
  SEPARATOR_COLOR,
  type GridBackground,
  type GridPaintInput,
  type ThemeMode,
} from './grid-painter';
