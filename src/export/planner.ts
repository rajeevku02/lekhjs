// `planExport` (spec 08 §2.1, §5.1; class `ExportPlanner` → `ExportRequestBuilder` in spec 02):
// the port of C++ `ExportInputBuilder::makeInput` — page sizes, translations and file names —
// plus the raster pixel plan with the 50 MP / 100 MP cap (§5.2, OQ-51).
//
// Page sizes, as `makeInput`:
//   - a fixed (or auto) page with region `full`, or any non-infinite page in a PDF: the canvas
//     size (`getCanvasSize(true)`), no translation;
//   - otherwise (an infinite page always, a `drawing` region): the bounds of every object plus
//     `padding` on each side, translated so the bounds' corner lands at (padding, padding).
// File names: `<doc>.<ext>` for one page ("drawing" for a blank doc name); with several pages
// `<doc>-<page>.<ext>`, `page<N>` for a blank page name, `-page<N>` appended to a duplicate.
//
// A page under 1 unit wide or high (an empty infinite page at padding 0) cannot be encoded and is
// skipped (`export_page_skipped`); the other pages keep the names C++ gave them (§5.1, AC-EXP-37).
import { CanvasSizeType, type Page } from '../model';
import type { ExportFormat, ExportOptions, ExportPagePlan, ExportSource } from './types';

/** C++ `ExportInputBuilder::fileExtension`. */
export function fileExtension(format: ExportFormat): string {
  return format;
}

/** The planned pages, and the selected pages left out because they have no size. */
export interface ExportPlanDetail {
  readonly pages: readonly ExportPagePlan[];
  readonly skipped: readonly number[];
  /** `<doc>.<ext>`: the one file of a PDF or `.lekh` export. */
  readonly fileName: string;
}

/** The selected page indices: `pageIndexes` when it names any valid page, else every page. */
export function selectedPages(source: ExportSource, opts: ExportOptions): number[] {
  const n = source.document.pages.length;
  const sel = (opts.pageIndexes ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < n);
  return sel.length > 0 ? sel : Array.from({ length: n }, (_, i) => i);
}

function pageRect(page: Page, opts: ExportOptions, padding: number): Omit<ExportPagePlan, 'pageIndex' | 'fileName'> {
  const infinite = page.canvasSizeType === CanvasSizeType.Infinite;
  if (!infinite && (opts.region === 'full' || opts.format === 'pdf')) {
    const sz = page.getCanvasSize(true);
    return { width: sz.width, height: sz.height, translateX: 0, translateY: 0 };
  }
  const r = page.objectStore.hit.boundsOfAll();
  return {
    translateX: -(r.x - padding),
    translateY: -(r.y - padding),
    width: r.width + 2 * padding,
    height: r.height + 2 * padding,
  };
}

/** C++ `LekhUtil::trim` (spaces, tabs and line breaks at both ends). */
function trim(s: string): string {
  return s.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');
}

/** `makeInput` in full: every selected page with its size, translation and file name. */
export function planExportDetail(source: ExportSource, opts: ExportOptions): ExportPlanDetail {
  const pages = source.document.pages;
  const padding = Math.trunc(Number.isFinite(opts.padding) ? opts.padding : 0);
  const sel = selectedPages(source, opts);
  const ext = '.' + fileExtension(opts.format);
  let base = trim(source.document.name);
  if (base === '') base = 'drawing';
  const fileName = base + ext;
  const out: ExportPagePlan[] = [];
  const skipped: number[] = [];
  const names = new Set<string>();
  for (const pageIndex of sel) {
    const page = pages[pageIndex];
    if (page === undefined) continue;
    source.layoutAll(page.id);
    const rect = pageRect(page, opts, padding);
    let name = fileName;
    if (sel.length > 1) {
      let pageName = trim(page.name);
      if (pageName === '') pageName = `page${String(pageIndex + 1)}`;
      name = `${base}-${pageName}`;
      if (names.has(name)) name += `-page${String(pageIndex + 1)}`;
      names.add(name);
      name += ext;
    }
    if (!(rect.width >= 1 && rect.height >= 1)) {
      skipped.push(pageIndex);
      continue;
    }
    out.push({ pageIndex, fileName: name, ...rect });
  }
  return { pages: out, skipped, fileName };
}

/** The planned pages (spec 08 §4 `planExport`); skipped pages are left out. */
export function planExport(source: ExportSource, opts: ExportOptions): ExportPagePlan[] {
  return [...planExportDetail(source, opts).pages];
}

// ---- raster pixel plan (§5.1, §5.2) ----

/** The per-page cap (Android `MAX_EXPORT_PIXELS`, everywhere since OQ-51). */
export const MAX_PAGE_PIXELS = 50_000_000;
/** The cap on all pages of one export together. */
export const MAX_TOTAL_PIXELS = 100_000_000;
/** The smallest browser canvas side we target; a wider page is scaled down to it. */
export const MAX_RASTER_SIDE = 16_384;

export interface RasterPagePlan {
  readonly plan: ExportPagePlan;
  /** Output pixels. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Pixels per board point (`scale × rasterHostScale`, times the cap factor when downscaled). */
  readonly pixelScale: number;
  readonly downscaled: boolean;
}

function pixels(points: number, s: number): number {
  return Math.max(1, Math.round(points * s));
}

/**
 * Pixel sizes for raster pages: `round(width × scale × rasterHostScale)` (AC-EXP-04), then a page
 * over 50 MP (or wider than 16,384 px) is scaled to fit, keeping its aspect ratio, and an export
 * over 100 MP in total is scaled down proportionally (AC-EXP-06).
 */
export function planRaster(plans: readonly ExportPagePlan[], scale: number, rasterHostScale: number): RasterPagePlan[] {
  const s0 = (scale > 0 && scale < 8 ? scale : 1) * (rasterHostScale > 0 ? rasterHostScale : 1);
  const first = plans.map((plan) => {
    let s = s0;
    let w = pixels(plan.width, s);
    let h = pixels(plan.height, s);
    let down = false;
    if (w * h > MAX_PAGE_PIXELS) {
      s *= Math.sqrt(MAX_PAGE_PIXELS / (w * h));
      down = true;
    }
    if (plan.width * s > MAX_RASTER_SIDE) {
      s = MAX_RASTER_SIDE / plan.width;
      down = true;
    }
    if (down) {
      w = Math.max(1, Math.floor(plan.width * s));
      h = Math.max(1, Math.floor(plan.height * s));
    }
    return { plan, pixelWidth: w, pixelHeight: h, pixelScale: s, downscaled: down };
  });
  const total = first.reduce((n, p) => n + p.pixelWidth * p.pixelHeight, 0);
  if (total <= MAX_TOTAL_PIXELS) return first;
  const f = Math.sqrt(MAX_TOTAL_PIXELS / total);
  return first.map((p) => {
    const s = p.pixelScale * f;
    return {
      plan: p.plan,
      pixelWidth: Math.max(1, Math.floor(p.plan.width * s)),
      pixelHeight: Math.max(1, Math.floor(p.plan.height * s)),
      pixelScale: s,
      downscaled: true,
    };
  });
}
