// The export contract (spec 08 §4, §10.3): options, plans, progress, results, errors and the
// injected environment. DOM-free: the canvas, the image port, the byte sink and the usage
// reporter arrive through `ExportEnv` (AC-EXP-28).
import type { Canvas2DLike } from '../base';
import type { Page } from '../model';
import type { DecodedImage, DrawingPlatform, ExportView } from '../render';
import type { TextPainter } from '../text';

export type ExportFormat = 'pdf' | 'jpg' | 'png' | 'svg' | 'lekh';
/** The same strings as the `last_export_params` setting. */
export type ExportRegion = 'full' | 'drawing';
export type ExportDestination = 'generic' | 'files' | 'share' | 'gallery';

export interface ExportOptions {
  readonly format: ExportFormat;
  /** Page indices in export order; empty or absent: every page. */
  readonly pageIndexes?: readonly number[];
  /** Ignored for PDF on fixed pages, and on infinite pages (always the drawing area), as today. */
  readonly region: ExportRegion;
  /** Board points around the drawing area (C++ `int padding_`: truncated). */
  readonly padding: number;
  /** Raster only (x1-x4). */
  readonly scale: number;
  /** PNG: forced false, as the dialog hides it today. */
  readonly includeBackground: boolean;
  /** Save to gallery reports `board_copied_out{kind: gallery}` instead of `board_exported`. */
  readonly destination?: ExportDestination;
}

/** One page of an export (C++ `ExportInput::PageInfo`). */
export interface ExportPagePlan {
  readonly pageIndex: number;
  readonly fileName: string;
  /** Board points. */
  readonly width: number;
  readonly height: number;
  readonly translateX: number;
  readonly translateY: number;
}

export interface ExportFileMeta {
  readonly name: string;
  readonly mime: string;
  /** 0-based order of the file in this export. */
  readonly index: number;
}

export interface ExportFile extends ExportFileMeta {
  /** Bytes already delivered to `env.sink`. */
  readonly bytes: number;
}

export type ExportPhase = 'preparing' | 'fonts' | 'rendering' | 'encoding' | 'writing' | 'handoff';

export interface ExportProgress {
  /** `runExport` emits up to `encoding`; the host's delivery emits `writing` and `handoff`. */
  readonly phase: ExportPhase;
  /** 1-based page being worked on. */
  readonly page?: number;
  readonly pageCount?: number;
  /** 0..1 overall. */
  readonly fraction: number;
  /** Phase `fonts` (PDF): bytes of font data downloaded so far in this export. */
  readonly bytes?: number;
}

export type ExportErrorCode =
  | 'export_limit_reached'
  | 'export_empty'
  | 'export_image_unreadable'
  | 'export_out_of_memory'
  | 'export_pdf_unavailable'
  | 'export_write_failed'
  | 'export_share_failed'
  | 'export_board_load_failed'
  | 'export_internal';

export type ExportWarningCode =
  'font_unavailable' | 'run_as_image' | 'image_downscaled' | 'font_outlined' | 'export_image_missing';

export interface ExportError {
  readonly code: ExportErrorCode;
  readonly message: string;
  /** Debug builds only; never board content. */
  readonly detail?: string;
}

export interface ExportWarning {
  readonly code: ExportWarningCode;
  readonly count: number;
  readonly detail?: string;
}

export type ExportResult =
  | { readonly status: 'done'; readonly files: readonly ExportFile[]; readonly warnings: readonly ExportWarning[] }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: ExportError };

export type ExportUsageEvent =
  | {
      readonly name: 'board_exported';
      readonly format: ExportFormat;
      readonly capped_user: boolean;
      readonly exports_used?: number;
    }
  | { readonly name: 'board_copied_out'; readonly kind: 'gallery' };

/** The pixel rows `getImageData` returns (un-premultiplied RGBA). */
export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

/** The 2-D context of an export canvas: `Canvas2DLike` plus pixel read-back. */
export interface RasterContext2D extends Canvas2DLike {
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike;
}

export interface RasterCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): RasterContext2D | null;
}

/**
 * Off-screen canvases for export: a detached `<canvas>` (or `OffscreenCanvas`) in the browser,
 * `@napi-rs/canvas` on Node. `encode` is the single-canvas path (`toBlob` / `Canvas.encode`);
 * banded output never calls it.
 */
export interface RasterCanvasFactory {
  createCanvas(width: number, height: number): RasterCanvas;
  encode(canvas: RasterCanvas, mime: 'image/png' | 'image/jpeg', quality: number): Promise<Uint8Array>;
  /** Encodes a decoded board image as PNG (SVG `<image>` data). Absent: images are skipped. */
  encodeImage?(image: DecodedImage): Promise<Uint8Array>;
}

/** The session's image port as export uses it (spec 01 §4.2 `ImagePort`). */
export interface ExportImagePort {
  ensure(urls: readonly string[], opts: { timeoutMs: number }): Promise<{ loaded: string[]; missing: string[] }>;
  pin(urls: readonly string[]): () => void;
}

/** Injected by the host; lekhjs imports no DOM or Capacitor module (AC-EXP-28). */
export interface ExportEnv {
  readonly canvasFactory: RasterCanvasFactory;
  /** Pixels per board point beyond `scale` (§5.1): 1 on iOS, Mac and web, the DPR on Android. */
  readonly rasterHostScale: number;
  readonly images: ExportImagePort;
  /** Every output byte, in order; awaited (back-pressure). A rejection fails the export with its `code` when it has one. */
  readonly sink: (file: ExportFileMeta, chunk: Uint8Array) => Promise<void>;
  /** The free cap, decided by the host before the job: `capped` = the allowance is used up. */
  readonly policy: { readonly capped: boolean; readonly isLocal: boolean };
  /** Usage events: lekhjs never calls it; the host's delivery does at hand-off (§9). */
  readonly report: (event: ExportUsageEvent) => void;
  /** Debug logging: codes and counts only (AC-EXP-31). */
  readonly log?: (code: string, fields?: Record<string, number | string | boolean>) => void;
  /**
   * PDF only: the font chain after the bundled fonts (spec 08 §6.1), in order. A renderer made with
   * its own `fonts` (`createPdfRenderer({ fonts })`) uses those instead.
   */
  readonly fonts?: readonly FontDataProvider[];
  /** PDF only: loads the lazily imported `lekhjs/export/pdf` entry and returns its renderer. */
  readonly loadPdf?: () => Promise<PdfRenderer>;
  /** Tests and tuning: the safe single-canvas budget (default 16,777,216 px, 8,192 px a side). */
  readonly canvasBudget?: { readonly pixels: number; readonly side: number };
}

/**
 * The PDF half (spec 08 §7, task F1): renders the planned pages to `sink` in chunks. Until it is
 * plugged in, a PDF export fails with `export_pdf_unavailable`.
 */
export interface PdfRenderer {
  render(
    source: ExportSource,
    plans: readonly ExportPagePlan[],
    opts: ExportOptions,
    env: ExportEnv,
    out: (chunk: Uint8Array) => Promise<void>,
    hooks: PdfRenderHooks,
  ): Promise<{ readonly warnings: readonly ExportWarning[] }>;
}

/** What the job gives the PDF renderer: progress, the yield (which throws once cancelled) and the signal. */
export interface PdfRenderHooks {
  /** Phase `rendering`, 1-based page. */
  progress(page: number): void;
  /** Phase `fonts`, with the bytes downloaded so far. */
  fonts?(bytes: number): void;
  yieldToUi(): Promise<void>;
  /** Aborts in-flight font requests on cancel. */
  readonly signal?: ExportSignalLike;
}

/** The part of an `AbortSignal` font providers read. */
export interface ExportSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, opts?: { once?: boolean }): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
}

// ---- the PDF font chain (spec 08 §6.1) ----

/** One font request: the text a font must draw, the box's family and traits, and the run's script. */
export interface FontRequest {
  readonly text: string;
  /** The primary family of the text box ('' for the platform default). */
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Set for a run the primary font does not cover: a Unicode script name (`Arabic`, `Han`, …). */
  readonly script?: string;
  /** BCP 47 language hint (the document language, else the host's), for the Han choice. */
  readonly lang?: string;
}

/** Font bytes for a request. */
export interface FontData {
  /** TTF, OTF, or a TTC collection. */
  readonly bytes: Uint8Array;
  /** Selects the face; required to pick one face from a TTC ('' with `collectionIndex`: the face at that index). */
  readonly postscriptName: string;
  /** Android `getTtcIndex()`: a cross-check of `postscriptName`, or the selector when the name is ''. */
  readonly collectionIndex?: number;
  /** OS/2 `fsType` allows embedding and subsetting (as the host read it). */
  readonly embeddable: boolean;
  /** Has an `fvar` table. */
  readonly variable: boolean;
  readonly source: 'bundled' | 'platform' | 'noto-web' | 'noto-backend';
}

/**
 * A source of font bytes (spec 08 §6.1, spec 02 `FontDataProvider`): the bundled fonts, the native
 * `LekhPlugin.getFontData`, the web's Noto script fonts. `null` = nothing for this request.
 */
export interface FontDataProvider {
  readonly id: string;
  /** The resolver gives up on a request after this long and ignores a late answer (native: 10 s). */
  readonly timeoutMs?: number;
  resolve(req: FontRequest, signal: ExportSignalLike): Promise<FontData | null>;
  /** Bytes this provider downloaded so far (the progress modal's phase `fonts`). */
  downloadedBytes?(): number;
}

/**
 * What `runExport` needs from a board session (`BoardSession` satisfies it). A structural type,
 * so export (rank 10) never imports the session module (rank 11).
 */
export interface ExportSource {
  readonly document: {
    readonly name: string;
    readonly pages: readonly Page[];
  };
  readonly runtime: { readonly textPainter: TextPainter };
  readonly imageCache: { pin(urls: Iterable<string>): () => void };
  layoutAll(pageId?: string): void;
  /** Whether the session's cache or its image port holds `url` decoded. */
  hasImage(url: string): boolean;
  drawForExport(platform: DrawingPlatform, pageIndex: number, includeBackground: boolean, view: ExportView): void;
  serialize(opts: { stamp: 'offline' | 'cloud' }): string;
}

export type { ExportView };
