// `PdfExporter` (spec 08 §7.2, spec 02): the vector PDF renderer `runExport` plugs in through
// `env.loadPdf` (the `PdfRenderer` port). One `PDFDocument` per export, every planned page in one
// file, a page of `width/2 × height/2` points (the C++ 72/144 rule) drawn at scale 0.5:
//
//   pre-pass   `drawForExport` of every page into a `TextCollectingPlatform`: the texts and the
//              board images. Fonts are resolved (phase `fonts`; awaited, cancellable), fallback
//              images rendered and board images encoded, so the drawing pass is synchronous.
//   pages      `addPage`, the page background (a colour, with "Include background"), then
//              `drawForExport` through `PdfDrawingPlatform`; one synchronous draw per page with a
//              yield between pages (cancel is checked there).
//   output     PDFKit's chunks are taken as it pushes them and handed to `out` once per page
//              (and once at the end with the fonts, images and xref), each awaited: the whole file
//              is never held.
import type { Scheduler } from '../../base';
import { BackgroundType } from '../../model';
import type { DecodedImage } from '../../render';
import type {
  ExportEnv,
  ExportOptions,
  ExportPagePlan,
  ExportSource,
  ExportWarning,
  FontDataProvider,
  PdfRenderer,
  PdfRenderHooks,
  ExportSignalLike,
} from '../types';
import { BidiResolver } from './bidi-resolver';
import { PdfDrawingPlatform } from './pdf-drawing-platform';
import { PdfFontResolver } from './pdf-font-resolver';
import { PdfTextWriter, textColorCss } from './pdf-text-writer';
import type { PdfDocument, PdfModules } from './ports';
import { RunImageFallback } from './run-image-fallback';
import { TextCollectingPlatform, type CollectedText } from './text-collecting-platform';

/** The PDF page scale (board units → points): a page is `width/2 × height/2` points. */
export const PDF_SCALE = 0.5;

export interface PdfExporterOptions {
  /** The font chain (spec 08 §6.1, in order). Absent: `env.fonts`. */
  readonly fonts?: readonly FontDataProvider[];
  /** The document language, else the host's (`navigator.language`), for the Han choice. */
  readonly lang?: string;
  /** Timers for provider timeouts (native `getFontData`, 10 s). Without them nothing times out. */
  readonly timers?: Pick<Scheduler, 'setTimeout' | 'clearTimeout'>;
}

const NEVER: ExportSignalLike = Object.freeze({
  aborted: false,
  addEventListener: () => undefined,
});

/** Encodes a board image for the PDF: JPEG (quality 1.0) when it is opaque, else PNG with alpha. */
export async function encodeImageForPdf(env: ExportEnv, image: DecodedImage): Promise<Uint8Array | null> {
  const w = Math.max(1, Math.round(image.width));
  const h = Math.max(1, Math.round(image.height));
  const c = env.canvasFactory.createCanvas(w, h);
  const ctx = c.getContext('2d');
  if (ctx === null) return null;
  try {
    ctx.drawImage(image.source, 0, 0, w, h);
  } catch {
    c.width = 0;
    c.height = 0;
    return null;
  }
  let opaque: boolean;
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    opaque = true;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] !== 255) {
        opaque = false;
        break;
      }
    }
  } catch (e) {
    c.width = 0;
    c.height = 0;
    throw e; // a tainted canvas: export_image_unreadable
  }
  const bytes = await env.canvasFactory.encode(c, opaque ? 'image/jpeg' : 'image/png', 1.0);
  c.width = 0;
  c.height = 0;
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0] !== undefined) return parts[0];
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class PdfExporter implements PdfRenderer {
  private readonly modules: PdfModules;
  private readonly opts: PdfExporterOptions;

  constructor(modules: PdfModules, opts: PdfExporterOptions = {}) {
    this.modules = modules;
    this.opts = opts;
  }

  async render(
    source: ExportSource,
    plans: readonly ExportPagePlan[],
    opts: ExportOptions,
    env: ExportEnv,
    out: (chunk: Uint8Array) => Promise<void>,
    hooks: PdfRenderHooks,
  ): Promise<{ readonly warnings: readonly ExportWarning[] }> {
    const signal = hooks.signal ?? NEVER;
    const log = env.log;
    const images = new RunImageFallback(env.canvasFactory);
    const resolver = new PdfFontResolver({
      fontkit: this.modules.fontkit,
      bidi: new BidiResolver(this.modules.bidi),
      providers: this.opts.fonts ?? env.fonts ?? [],
      images,
      ...(this.opts.lang !== undefined ? { lang: this.opts.lang } : {}),
      ...(this.opts.timers !== undefined ? { timers: this.opts.timers } : {}),
      ...(log !== undefined ? { log } : {}),
      onBytes: (total) => hooks.fonts?.(total),
    });

    // ---- pre-pass: texts and images of every page ----
    const texts: CollectedText[] = [];
    const boardImages = new Set<DecodedImage>();
    for (const plan of plans) {
      const c = new TextCollectingPlatform();
      source.drawForExport(c, plan.pageIndex, opts.includeBackground, {
        scale: 1,
        tx: plan.translateX,
        ty: plan.translateY,
      });
      texts.push(...c.texts);
      for (const i of c.images) boardImages.add(i);
    }
    if (texts.length > 0) {
      hooks.fonts?.(0);
      await resolver.prepare(texts, (c) => textColorCss(c.style), signal);
      await hooks.yieldToUi();
    }
    const imageBytes = new Map<DecodedImage, Uint8Array>();
    for (const img of boardImages) {
      const b = await encodeImageForPdf(env, img);
      if (b !== null) imageBytes.set(img, b);
      await hooks.yieldToUi();
    }

    // ---- the document ----
    // PDFKit writes every chunk through `Readable.push` (its own emitter in the browser build,
    // Node's stream on Node), the header already in the constructor. A subclass takes the chunks
    // there, synchronously, so the output keeps in step with the pages on both builds (Node's
    // stream would only start flowing on a later tick).
    const pending: Uint8Array[] = [];
    let ended = false;
    let endWaiter: (() => void) | null = null;
    const Base = this.modules.PDFDocument as unknown as new (o: unknown) => object;
    const Capturing = class extends Base {
      push(chunk: Uint8Array | null): boolean {
        if (chunk === null) {
          ended = true;
          endWaiter?.();
        } else {
          pending.push(chunk);
        }
        return true;
      }
    };
    const doc = new Capturing({
      autoFirstPage: false,
      compress: true,
      font: null,
      info: { Title: source.document.name, Creator: 'Lekh', Producer: 'Lekh' },
    }) as unknown as PdfDocument;
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const chunk = concat(pending.splice(0, pending.length));
      await out(chunk);
    };

    const text = new PdfTextWriter(doc, resolver);
    const platform = new PdfDrawingPlatform({ doc, text, imageBytes });
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      if (plan === undefined) continue;
      hooks.progress(i + 1);
      doc.addPage({ size: [plan.width * PDF_SCALE, plan.height * PDF_SCALE], margin: 0 });
      doc.save();
      doc.scale(PDF_SCALE);
      const page = source.document.pages[plan.pageIndex];
      if (opts.includeBackground && page !== undefined && page.background.type === BackgroundType.Color) {
        const c = page.background.color;
        doc.rect(0, 0, plan.width, plan.height);
        doc.fillColor([c.red, c.green, c.blue], c.alpha / 255);
        doc.fill('non-zero');
      }
      source.drawForExport(platform, plan.pageIndex, opts.includeBackground, {
        scale: 1,
        tx: plan.translateX,
        ty: plan.translateY,
      });
      doc.restore();
      await flush();
      await hooks.yieldToUi();
    }
    const done = new Promise<void>((resolve) => {
      endWaiter = resolve;
      if (ended) resolve();
    });
    doc.end();
    await done;
    await flush();

    const warnings = resolver.warnings();
    if (text.failed > 0) log?.('font_run_failed', { count: text.failed });
    if (text.outlined > 0) {
      warnings.push({ code: 'font_outlined', count: text.outlined });
      log?.('font_outlined', { count: text.outlined });
    }
    for (const w of warnings) if (w.code === 'font_unavailable') log?.('font_unavailable', { count: w.count });
    return { warnings };
  }
}
