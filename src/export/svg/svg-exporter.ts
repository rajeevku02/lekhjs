// `SvgExporter` (spec 08 §8; C++ `SVGExporter::exportToSVG`): one page as an SVG document. The
// root carries the page size and, with "Include background", the page background (a base64
// image as CSS `background-image`, a colour as `background-color`; C++ `start`). The page is
// drawn by `drawForExport` through `SvgDrawingPlatform` with the plan's translation, then every
// board image is encoded to PNG once and inlined. No fonts are embedded (as today).
import { BackgroundType, type Page } from '../../model';
import type { DecodedImage } from '../../render';
import { base64 } from '../bytes';
import type { ExportEnv, ExportPagePlan, ExportSource } from '../types';
import { SvgDrawingPlatform, type SvgPart } from './svg-drawing-platform';

function backgroundOf(
  page: Page,
  include: boolean,
): { color?: Page['background']['color']; imageBase64?: string } | null {
  if (!include) return null; // C++ `background.setDefault()`
  const bg = page.background;
  if (bg.type === BackgroundType.Default) return null;
  if (bg.type === BackgroundType.Image && bg.imageData !== '') return { imageBase64: bg.imageData };
  return { color: bg.color };
}

/** Draws one page; the result still holds image slots. */
export function drawSvgPage(source: ExportSource, plan: ExportPagePlan, includeBackground: boolean): SvgPart[] {
  const page = source.document.pages[plan.pageIndex];
  if (page === undefined) return [];
  const sp = new SvgDrawingPlatform({ idPrefix: `p${String(plan.pageIndex + 1)}-` });
  sp.start(plan.width, plan.height, backgroundOf(page, includeBackground));
  source.drawForExport(sp, plan.pageIndex, includeBackground, { scale: 1, tx: plan.translateX, ty: plan.translateY });
  sp.finish();
  return sp.parts();
}

/** PNG bytes of a decoded image, through the factory (a canvas of the image's size). */
export async function encodeImagePng(env: ExportEnv, image: DecodedImage): Promise<Uint8Array> {
  if (env.canvasFactory.encodeImage !== undefined) return env.canvasFactory.encodeImage(image);
  const w = Math.max(1, Math.round(image.width));
  const h = Math.max(1, Math.round(image.height));
  const c = env.canvasFactory.createCanvas(w, h);
  const ctx = c.getContext('2d');
  if (ctx === null) throw new RangeError('export: no 2d context');
  ctx.drawImage(image.source, 0, 0, w, h);
  const bytes = await env.canvasFactory.encode(c, 'image/png', 1);
  c.width = 0;
  c.height = 0;
  return bytes;
}

/** The SVG text of `parts`, each image encoded once (C++ `getBase64FromImage(…, "PNG")`). */
export async function resolveSvgParts(parts: readonly SvgPart[], env: ExportEnv): Promise<string> {
  const cache = new Map<DecodedImage, string>();
  let out = '';
  for (const p of parts) {
    if (typeof p === 'string') {
      out += p;
      continue;
    }
    let b64 = cache.get(p.image);
    if (b64 === undefined) {
      b64 = base64(await encodeImagePng(env, p.image));
      cache.set(p.image, b64);
    }
    out += b64;
  }
  return out;
}
