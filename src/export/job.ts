// `runExport` (spec 08 §4, §10; class `ExportJob`): the async orchestrator over the synchronous
// engine draw. Phases `preparing` → (`fonts`, PDF only) → `rendering` → `encoding`; it
// resolves `done` once the last chunk of the last file has been awaited by `env.sink`.
//
// - The free cap is checked first: capped + local → `export_limit_reached`, before `preparing`,
//   with no sink and no image call (AC-EXP-24, AC-EXP-39).
// - `preparing` collects the image URLs of the selected pages, pins them in the session cache and
//   the image port for the whole job, and waits up to 15 s for the ones not decoded yet
//   (`ensure`). An image still missing draws the broken-image placeholder and gives one
//   `export_image_missing` warning with its count; the export goes on (AC-EXP-38).
//   An image that answered HTTP 4xx in this session is not asked for again (owner decision
//   2026-10-20, round IF1): it is missing at once, with no wait and no fetch.
// - Output is streamed: raster bands, SVG pages and the `.lekh` text go to the sink as they are
//   produced; no whole file is held (AC-EXP-39).
// - Cancel: the signal is checked at every yield (between pages, bands and the image wait);
//   the result is `cancelled` (a single page draw is one synchronous call).
// - lekhjs never counts the cap and never calls `env.report`: the host's delivery does both at
//   hand-off (§9).
// - Logs carry codes and counts only (AC-EXP-31).
import { ImageRefs } from '../model';
import { utf8Bytes } from './bytes';
import { planExportDetail, planRaster } from './planner';
import { LIMIT_REACHED_ERROR, exportLimitReached } from './policy';
import { exportRasterPage } from './raster/raster-exporter';
import { drawSvgPage, resolveSvgParts } from './svg/svg-exporter';
import type {
  ExportEnv,
  ExportError,
  ExportErrorCode,
  ExportFile,
  ExportFileMeta,
  ExportOptions,
  ExportPagePlan,
  ExportProgress,
  ExportResult,
  ExportSource,
  ExportWarning,
  PdfRenderer,
} from './types';

/** How long `preparing` waits for an image (spec 08 §4). */
export const IMAGE_WAIT_MS = 15_000;

const MIME: Readonly<Record<ExportOptions['format'], string>> = Object.freeze({
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  lekh: 'application/octet-stream',
});

/** The structural `AbortSignal` the job reads. */
export interface ExportSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, opts?: { once?: boolean }): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
}

class Cancelled extends Error {
  constructor() {
    super('export cancelled');
    this.name = 'ExportCancelled';
  }
}

/** An error the job maps to a code: anything with a known `code`, or what the runtime threw. */
export class ExportFailure extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const CODES: readonly string[] = Object.freeze<ExportErrorCode[]>([
  'export_limit_reached',
  'export_empty',
  'export_image_unreadable',
  'export_out_of_memory',
  'export_pdf_unavailable',
  'export_write_failed',
  'export_share_failed',
  'export_board_load_failed',
  'export_internal',
]);

const MESSAGES: Readonly<Record<ExportErrorCode, string>> = Object.freeze({
  export_limit_reached: 'Export limit reached',
  export_empty: 'Nothing to export.',
  export_image_unreadable: 'An image on this board could not be read, so it could not be exported.',
  export_out_of_memory: 'The export ran out of memory.',
  export_pdf_unavailable: 'PDF export needs a connection the first time. Please try again online.',
  export_write_failed: 'The exported file could not be written.',
  export_share_failed: 'The exported file could not be shared.',
  export_board_load_failed: 'The board could not be opened.',
  export_internal: 'The export failed.',
});

/** The `ExportError` of a thrown value (spec 08 §10.3); never board content. */
export function exportErrorOf(err: unknown): ExportError {
  const code = codeOf(err);
  return { code, message: MESSAGES[code] };
}

function codeOf(err: unknown): ExportErrorCode {
  if (typeof err === 'object' && err !== null) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === 'string' && CODES.includes(c)) return c as ExportErrorCode;
    const name = (err as { name?: unknown }).name;
    if (err instanceof RangeError || name === 'RangeError') return 'export_out_of_memory';
    if (name === 'SecurityError') return 'export_image_unreadable';
    if (name === 'EncodingError' || name === 'InvalidStateError') return 'export_image_unreadable';
  }
  return 'export_internal';
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    void Promise.resolve().then(resolve);
  });
}

/** The image URLs of the selected pages (objects at any depth), distinct. */
export function exportImageUrls(source: ExportSource, plans: readonly ExportPagePlan[]): string[] {
  const out = new Set<string>();
  for (const p of plans) {
    const page = source.document.pages[p.pageIndex];
    if (page === undefined) continue;
    for (const url of ImageRefs.page(page)) out.add(url);
  }
  return [...out];
}

/**
 * Runs one export. `yieldFn` is how the job yields between steps; the default is a microtask
 * turn, and hosts pass `() => new Promise(r => setTimeout(r))` so the progress modal repaints.
 */
export async function runExport(
  source: ExportSource,
  opts: ExportOptions,
  env: ExportEnv,
  onProgress: (p: ExportProgress) => void,
  signal: ExportSignal,
  yieldFn: () => Promise<void> = yieldToUi,
): Promise<ExportResult> {
  const log = env.log ?? ((): void => undefined);
  if (exportLimitReached(env.policy)) {
    log('export_limit_reached');
    return { status: 'failed', error: LIMIT_REACHED_ERROR };
  }
  if (signal.aborted) return { status: 'cancelled' };
  const progress = (p: ExportProgress): void => {
    try {
      onProgress(p);
    } catch {
      // A progress listener never fails the export.
    }
  };
  const check = (): void => {
    if (signal.aborted) throw new Cancelled();
  };
  const step = async (): Promise<void> => {
    await yieldFn();
    check();
  };

  let unpin: (() => void)[] = [];
  const files: ExportFile[] = [];
  const warnings: ExportWarning[] = [];
  try {
    progress({ phase: 'preparing', fraction: 0 });
    const detail = opts.format === 'lekh' ? null : planExportDetail(source, opts);
    for (const i of detail?.skipped ?? []) log('export_page_skipped', { page: i + 1 });
    const plans = detail?.pages ?? [];
    if (detail !== null && plans.length === 0) {
      log('export_empty');
      return { status: 'failed', error: exportErrorOf(new ExportFailure('export_empty', '')) };
    }

    // ---- preparing: wait for and pin every image the pages draw ----
    if (plans.length > 0) {
      const urls = exportImageUrls(source, plans);
      if (urls.length > 0) {
        unpin = [source.imageCache.pin(urls), env.images.pin(urls)];
        const absent = urls.filter((u) => !source.hasImage(u));
        // A URL that answered 4xx in this session is never fetched again (owner decision
        // 2026-10-20, round IF1); it counts as missing and draws the failed-image placeholder.
        const waiting = absent.filter((u) => source.imageGone?.(u) !== true);
        if (absent.length > 0) {
          if (waiting.length > 0) {
            await raceAbort(env.images.ensure(waiting, { timeoutMs: IMAGE_WAIT_MS }), signal);
            check();
            await step(); // let the arrivals land in the session cache (imageLoaded events)
          }
          const missing = absent.filter((u) => !source.hasImage(u)).length;
          if (missing > 0) {
            warnings.push({ code: 'export_image_missing', count: missing });
            log('export_image_missing', { count: missing });
          }
        }
      }
    }

    const fileMeta = (name: string): ExportFileMeta => ({ name, mime: MIME[opts.format], index: files.length });
    const write = async (
      meta: ExportFileMeta,
      run: (out: (c: Uint8Array) => Promise<void>) => Promise<void>,
    ): Promise<void> => {
      let bytes = 0;
      await run(async (chunk) => {
        if (chunk.length === 0) return;
        bytes += chunk.length;
        await env.sink(meta, chunk);
      });
      files.push({ ...meta, bytes });
    };

    switch (opts.format) {
      case 'lekh': {
        // `.lekh` = the serializer's output, always stamped 5.0 (spec 04 §9.2, AC-FMT-03).
        progress({ phase: 'encoding', fraction: 0.5 });
        const name = (planName(source) ?? 'drawing') + '.lekh';
        const text = source.serialize({ stamp: 'offline' });
        await write(fileMeta(name), (out) => out(utf8Bytes(text)));
        break;
      }
      case 'svg': {
        const n = plans.length;
        for (let i = 0; i < n; i++) {
          const plan = plans[i];
          if (plan === undefined) continue;
          progress({ phase: 'rendering', page: i + 1, pageCount: n, fraction: i / n });
          const parts = drawSvgPage(source, plan, opts.includeBackground);
          progress({ phase: 'encoding', page: i + 1, pageCount: n, fraction: (i + 0.5) / n });
          const text = await resolveSvgParts(parts, env);
          check();
          await write(fileMeta(plan.fileName), (out) => out(utf8Bytes(text)));
          await step();
        }
        break;
      }
      case 'png':
      case 'jpg': {
        const format = opts.format;
        const raster = planRaster(plans, opts.scale, env.rasterHostScale);
        const down = raster.filter((r) => r.downscaled);
        if (down.length > 0) {
          const first = down[0];
          warnings.push({
            code: 'image_downscaled',
            count: down.length,
            ...(first !== undefined ? { detail: `${String(first.pixelWidth)} × ${String(first.pixelHeight)}` } : {}),
          });
          log('image_downscaled', { count: down.length });
        }
        const includeBackground = format === 'png' ? false : opts.includeBackground;
        const n = raster.length;
        for (let i = 0; i < n; i++) {
          const rp = raster[i];
          if (rp === undefined) continue;
          progress({ phase: 'rendering', page: i + 1, pageCount: n, fraction: i / n });
          await write(fileMeta(rp.plan.fileName), (out) =>
            exportRasterPage({
              source,
              page: rp,
              format,
              includeBackground,
              env,
              out,
              between: async (rowsDone) => {
                progress({
                  phase: 'encoding',
                  page: i + 1,
                  pageCount: n,
                  fraction: (i + rowsDone / rp.pixelHeight) / n,
                });
                await step();
              },
            }),
          );
          await step();
        }
        break;
      }
      case 'pdf': {
        if (env.loadPdf === undefined) throw new ExportFailure('export_pdf_unavailable', '');
        let pdf: PdfRenderer;
        try {
          pdf = await env.loadPdf();
        } catch {
          throw new ExportFailure('export_pdf_unavailable', '');
        }
        check();
        const n = plans.length;
        const name = detail?.fileName ?? 'drawing.pdf';
        let pdfWarnings: readonly ExportWarning[] = [];
        await write(fileMeta(name), async (out) => {
          const r = await pdf.render(source, plans, opts, env, out, {
            progress: (page) => {
              progress({ phase: 'rendering', page, pageCount: n, fraction: (page - 1) / n });
            },
            fonts: (bytes) => {
              progress({ phase: 'fonts', fraction: 0, bytes });
            },
            yieldToUi: step,
            signal,
          });
          pdfWarnings = r.warnings;
        });
        warnings.push(...pdfWarnings);
        break;
      }
    }
    progress({ phase: 'encoding', fraction: 1 });
    return { status: 'done', files, warnings };
  } catch (err) {
    if (err instanceof Cancelled || aborted(signal)) {
      log('export_cancelled');
      return { status: 'cancelled' };
    }
    const error = exportErrorOf(err);
    log(error.code);
    return { status: 'failed', error };
  } finally {
    for (const u of unpin) u();
  }
}

/** Read through a call, so a check after an earlier one is not narrowed away. */
function aborted(signal: ExportSignal): boolean {
  return signal.aborted;
}

function planName(source: ExportSource): string | null {
  const t = source.document.name.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');
  return t === '' ? null : t;
}

/** `p`, or a rejection with `Cancelled` as soon as `signal` aborts (the wait is abandoned). */
function raceAbort<T>(p: Promise<T>, signal: ExportSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Cancelled());
      return;
    }
    const onAbort = (): void => {
      reject(new Cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener?.('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener?.('abort', onAbort);
        reject(e instanceof Error ? e : new Error('export: wait failed'));
      },
    );
  });
}
