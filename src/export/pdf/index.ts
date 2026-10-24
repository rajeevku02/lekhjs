// Sub-entry `lekhjs/export/pdf` (spec 01 §3.2 rule 6, spec 08 §3, §7): vector PDF. Loaded only
// when a PDF export starts (`import('lekhjs/export/pdf')`), never re-exported by the `export`
// barrel, so no other bundle contains PDFKit or fontkit; kashi's bundle never imports it
// (bundle audit, AC-CLS-08).
//
// The only module that imports `pdfkit`, `fontkit` and `bidi-js`. PDFKit 0.20's package entry
// resolves by condition: in the browser and the WebView its `default` build
// (`js/pdfkit.browser.mjs`: Uint8Array output, its own event emitter, fflate, no `Buffer`,
// `stream` or `fs`), on Node its `node` build. So no Vite Node polyfill is added and fontkit is
// one copy shared with PDFKit. Fonts are registered from bytes (a fontkit font opened from a
// `Uint8Array`), never a path, on every host.
//
//   const { createPdfRenderer, BundledFontSource } = await import('lekhjs/export/pdf');
//   env.loadPdf = async () => createPdfRenderer({ fonts: [new BundledFontSource({ registry, load })] });
import bidiFactory from 'bidi-js';
import * as fontkit from 'fontkit';
import PDFDocument from 'pdfkit';
import type { PdfRenderer } from '../types';
import { PdfExporter, type PdfExporterOptions } from './pdf-exporter';
import type { FontkitModule, PdfDocumentCtor, PdfModules } from './ports';

/** The real PDFKit, fontkit and bidi-js behind the writer's ports. */
export function pdfModules(): PdfModules {
  return {
    PDFDocument: PDFDocument as PdfDocumentCtor,
    fontkit: { create: (bytes, ps) => fontkit.create(bytes, ps) as ReturnType<FontkitModule['create']> },
    bidi: bidiFactory(),
  };
}

/** The `PdfRenderer` a host returns from `env.loadPdf`. */
export function createPdfRenderer(opts: PdfExporterOptions = {}): PdfRenderer {
  return new PdfExporter(pdfModules(), opts);
}

export { PdfExporter, PDF_SCALE, encodeImageForPdf, type PdfExporterOptions } from './pdf-exporter';
export { PdfDrawingPlatform, dashOperand, type PdfDrawingPlatformOptions } from './pdf-drawing-platform';
export { PdfTextWriter, SYNTHETIC_ITALIC_DEGREES, textColorCss } from './pdf-text-writer';
export {
  PdfFontResolver,
  fontTraits,
  type LinePlan,
  type LineRun,
  type PdfFontResolverOptions,
} from './pdf-font-resolver';
export { TextRunSplitter, isEmojiCluster, scriptOf, type ClusterSpan, type TextCluster } from './text-run-splitter';
export { BidiResolver } from './bidi-resolver';
export { TextCollectingPlatform, type CollectedText } from './text-collecting-platform';
export { RUN_IMAGE_SCALE, RunImageFallback, scaledFont, type RunImage } from './run-image-fallback';
export { BundledFontSource, type BundledFontCache, type BundledFontSourceOptions } from './bundled-font-source';
export {
  PDF_FONT_CACHE,
  WebScriptFontProvider,
  scriptFontKey,
  type ScriptFontCache,
  type ScriptFontEntry,
  type ScriptFontManifest,
  type WebScriptFontProviderOptions,
} from './web-script-font-provider';
export {
  FS_TYPE_BITMAP_ONLY,
  FS_TYPE_EDITABLE,
  FS_TYPE_NO_SUBSETTING,
  FS_TYPE_PREVIEW_PRINT,
  FS_TYPE_RESTRICTED,
  faceIsItalic,
  fsTypeAllowsEmbedding,
  fsTypeValue,
  hasUsableOutlines,
  isVariableFont,
  layoutWorks,
  openFace,
  openFont,
  type FontMode,
  type OpenedFont,
} from './font-embedding';
export type * from './ports';
export type { ExportSignalLike, FontData, FontDataProvider, FontRequest, PdfRenderer } from '../types';
