// lekhjs module `export` (spec 01 §2.1, spec 08). The only import target from outside the module.
// The export job over a board session: the page plan (C++ `ExportInputBuilder`), PNG/JPEG
// (single canvas or banded, streaming encoders), SVG, `.lekh`, the free-cap policy and the usage
// payloads. PDF is the separate `export/pdf` entry (task F1), plugged in through `env.loadPdf`.
export type {
  ExportDestination,
  ExportEnv,
  ExportError,
  ExportErrorCode,
  ExportFile,
  ExportFileMeta,
  ExportFormat,
  ExportImagePort,
  ExportOptions,
  ExportPagePlan,
  ExportPhase,
  ExportProgress,
  ExportRegion,
  ExportResult,
  ExportSource,
  ExportUsageEvent,
  ExportView,
  ExportWarning,
  ExportWarningCode,
  ImageDataLike,
  PdfRenderer,
  RasterCanvas,
  RasterCanvasFactory,
  RasterContext2D,
} from './types';
export {
  MAX_PAGE_PIXELS,
  MAX_RASTER_SIDE,
  MAX_TOTAL_PIXELS,
  fileExtension,
  planExport,
  planExportDetail,
  planRaster,
  selectedPages,
  type ExportPlanDetail,
  type RasterPagePlan,
} from './planner';
export {
  EXPORT_COUNTER_SETTING,
  FREE_EXPORT_LIMIT,
  exportLimitReached,
  exportPolicy,
  exportUsageEvent,
} from './policy';
export { ExportFailure, IMAGE_WAIT_MS, exportErrorOf, exportImageUrls, runExport, type ExportSignal } from './job';
export {
  JPEG_BAND_ROWS,
  SAFE_CANVAS_PIXELS,
  SAFE_CANVAS_SIDE,
  bandRows,
  fitsOneCanvas,
} from './raster/raster-exporter';
export { PngStreamEncoder } from './raster/png-encoder';
export { JpegStreamEncoder } from './raster/jpeg-encoder';
export { SvgDrawingPlatform, escapeXml, svgNum, type SvgPart } from './svg/svg-drawing-platform';
export { drawSvgPage, encodeImagePng, resolveSvgParts } from './svg/svg-exporter';
export { ByteBuffer, base64, utf8Bytes } from './bytes';
