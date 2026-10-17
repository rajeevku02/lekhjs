// Inserting a picked image (port of C++ `CoreIO::insertImage(center, img)` and
// `insertImageWithResource`, `L/app/CoreIO.cpp:545-635`): an `avabodh.basic.image` shape of the
// image's size centred at a point, as one `AddObjectAction`. The host has picked the file, decoded
// and (for `resizeInsertedImage`) scaled it, and, for a cloud board, uploaded it and holds its
// `res://` reference (spec 09 §5.1 `pickImage`); the engine only places it.
import type { Config } from '../base';
import { Rect, Size, type Point } from '../geometry';
import { TemplatedObject, stampNewContentFont, type LekhObject } from '../model';
import type { EditorContext } from './editor-context';
import { AddObjectAction } from './object-actions';

export const IMAGE_TEMPLATE_ID = 'avabodh.basic.image';

/** An offline board's image (base64 in the template) or a cloud board's uploaded one (`res://<id>`). */
export type InsertImageInput =
  | {
      readonly kind: 'data';
      readonly base64: string;
      readonly format: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'resource'; readonly url: string; readonly width: number; readonly height: number };

/**
 * C++ `insertImage`'s size: an image wider than `insertedImageMaxWidth` is scaled down to it
 * (keeping the aspect) when `resizeInsertedImage` is on; the host scales the pixels to the same size.
 */
export function insertedImageSize(
  width: number,
  height: number,
  config: Pick<Config, 'resizeInsertedImage' | 'insertedImageMaxWidth'>,
): Size {
  if (config.resizeInsertedImage && width > config.insertedImageMaxWidth && width > 0) {
    const max = config.insertedImageMaxWidth;
    return new Size(max, (height / width) * max);
  }
  return new Size(width, height);
}

/**
 * Adds the image shape (C++ `TemplatedObject(tmpl, bound, 0, snapToGridNewObject)` +
 * `AddObjectAction`). Returns the object, or null when the image template is missing.
 */
export function insertImageObject(ctx: EditorContext, center: Point, input: InsertImageInput): LekhObject | null {
  const env = ctx.env.codec.env;
  const tmpl = env.templates.resolver.getTemplate(IMAGE_TEMPLATE_ID);
  if (tmpl === null) return null;
  if (input.kind === 'data') tmpl.setImageData(0, input.base64, input.format);
  else tmpl.setImageSrc(0, input.url);
  tmpl.load();
  const snap = ctx.config.snapToGridNewObject ? ctx.doc.snapStep() : null;
  const obj = new TemplatedObject(env.objects, tmpl, Rect.fromCenter(center, input.width, input.height), 0, snap);
  obj.generateData();
  stampNewContentFont(obj);
  ctx.tx.run(new AddObjectAction(ctx.env, ctx.doc, [obj]));
  return obj;
}
