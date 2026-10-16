// `paintPage`: draws one page of a session's document onto any `DrawingPlatform` (spec 10 §3,
// spec 01 §4.3) — the port of the backend binding `CoreDoc::render` and `CoreDoc::visualBounds`
// (the C++ backend glue). kashi's `board_render` draws through it onto an
// `@napi-rs/canvas` context wrapped in `Canvas2DDrawingPlatform`; the host puts the scale and the
// translation on its own 2D context first, so the page is drawn in document coordinates.
//
// THE PAGE, NOT THE APP: an export draw (`forExport`: no culling, no margin guide, no grid) of
// the named page, or of the first page in `pages` order when none is named, without the page
// background (the host prepared the surface). A refusal is a result, `{ ok: false, message }`,
// never an exception; the messages are the C++ ones word for word.
import type { Config } from '../../base';
import type { Rect } from '../../geometry';
import type { ImageLookup, LekhDocument, Page, PaintEnv } from '../../model';
import type { DrawingPlatform } from '../../render';

/** What `paintPage` reads from the session (`BoardSession.semanticContext()` satisfies it). */
export interface RasterContext {
  readonly doc: LekhDocument;
  readonly config: Config;
  readonly images: ImageLookup;
  budgetCheck(): void;
  /** Lays out a page keeping its serialized state (`BoardSession.layoutAll`). */
  layoutAll(pageId?: string): void;
}

/** The session as the raster export sees it (`BoardSession` satisfies it). */
export interface RasterHost {
  readonly isLoaded: boolean;
  semanticContext(): RasterContext;
}

/**
 * C++ render options: `page` (default the first page), and `node` — an object on the page at any
 * group depth whose visual bounds (title included) are the crop. The `minx`…`maxy` members are
 * read and validated as before but, as in the C++, nothing in the object tree culls by them.
 */
export interface PaintPageOptions {
  readonly page?: string;
  readonly node?: string;
  readonly minx?: number;
  readonly miny?: number;
  readonly maxx?: number;
  readonly maxy?: number;
}

/** C++ `renderAnswer`: the crop is present on a `node` paint (and on `pageVisualBounds`). */
export type PaintPageAnswer =
  | {
      readonly ok: true;
      readonly page: string;
      readonly minx?: number;
      readonly miny?: number;
      readonly maxx?: number;
      readonly maxy?: number;
    }
  | { readonly ok: false; readonly message: string; readonly page?: string };

function refusal(message: string, page: string): PaintPageAnswer {
  return page === '' ? { ok: false, message } : { ok: false, message, page };
}

function withCrop(page: string, r: Rect): PaintPageAnswer {
  return { ok: true, page, minx: r.x, miny: r.y, maxx: r.x + r.width, maxy: r.y + r.height };
}

/** The options object, or null when the text is not JSON (C++ `parseRenderOptions` false). */
function parseOptions(options: PaintPageOptions | string | undefined): PaintPageOptions | null {
  if (options === undefined) return {};
  if (typeof options !== 'string') return options;
  if (options === '') return {};
  try {
    const v: unknown = JSON.parse(options);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {};
  } catch {
    return null;
  }
}

/** The page by id, or the first page when `pageId` is ''. */
function pageOf(doc: LekhDocument, pageId: string): Page | null {
  return pageId === '' ? (doc.pages[0] ?? null) : doc.getPage(pageId);
}

function noPage(pageId: string): string {
  return pageId === '' ? 'This document has no pages.' : `This document has no page with id ${pageId}.`;
}

/**
 * Draws a page of the session's document onto `dp` (C++ `CoreDoc::render`). Lays out what is
 * dirty first; never fetches an image (images come from the session's image port).
 */
export function paintPage(
  s: RasterHost,
  options: PaintPageOptions | string | undefined,
  dp: DrawingPlatform | null,
): PaintPageAnswer {
  const opts = parseOptions(options);
  const named = typeof opts?.page === 'string' ? opts.page : '';
  if (opts === null) return refusal('The render options are not valid JSON.', named);
  if (!s.isLoaded) return refusal('No document is loaded on this handle, so there is nothing to draw.', named);
  if (dp === null) return refusal('No drawing surface was supplied, so there is nothing to draw on.', named);
  const ctx = s.semanticContext();
  const page = pageOf(ctx.doc, named);
  if (page === null) return refusal(noPage(named), named);
  const nodeId = typeof opts.node === 'string' ? opts.node : '';
  ctx.layoutAll(page.id);
  const env: PaintEnv = { config: ctx.config, zoom: 1, forExport: true, images: ctx.images };
  if (nodeId !== '') {
    const obj = page.objectStore.getObject(nodeId, true);
    if (obj === null) return refusal(`Page ${page.id} has no object with id ${nodeId}.`, page.id);
    const crop = obj.visualBounds();
    page.paint(dp, { env });
    return withCrop(page.id, crop);
  }
  page.paint(dp, { env });
  return { ok: true, page: page.id };
}

/**
 * One object's crop without drawing it (C++ `CoreDoc::visualBounds`): the rectangle
 * `paintPage({ page, node })` would draw, with the same page lookup and the same refusals.
 */
export function pageVisualBounds(s: RasterHost, pageId: string, nodeId: string): PaintPageAnswer {
  if (!s.isLoaded) return refusal('No document is loaded on this handle, so there is nothing to draw.', pageId);
  const ctx = s.semanticContext();
  const page = pageOf(ctx.doc, pageId);
  if (page === null) return refusal(noPage(pageId), pageId);
  const obj = nodeId === '' ? null : page.objectStore.getObject(nodeId, true);
  if (obj === null) return refusal(`Page ${page.id} has no object with id ${nodeId}.`, page.id);
  ctx.layoutAll(page.id);
  return withCrop(page.id, obj.visualBounds());
}
