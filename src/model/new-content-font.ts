// New content gets the bundled default font (spec 06 §9, DR-TXT-06).
//
// When an object is CREATED (the text tool, recognition output, a library insert, a connector,
// an inserted image, a semantic node or edge, …) and neither its own style nor anything it
// inherits from sets `fontfamily`, the object's own style gets `"Noto Sans"`, so new content looks
// the same on every platform. A stencil or template that sets its own family keeps it, and a
// family the user chose for the canvas style (copied into the object) is kept too.
//
// Not called for loaded, pasted, duplicated or received objects (they keep their stored value,
// `""` included), nor for the document root style. Not called for a new group either: a group's
// style is a live copy of its members' (`GroupStyle`), so setting it would restyle existing text.
import { DEFAULT_FONT_FAMILY } from '../text';
import { isGroup } from './kinds';
import type { LekhObject } from './lekh-object';

/** Stamps `fontfamily = "Noto Sans"` on each object whose effective family is the platform default. Returns how many were stamped. */
export function stampNewContentFont(objs: LekhObject | readonly LekhObject[]): number {
  const list: readonly LekhObject[] = Array.isArray(objs) ? objs : [objs as LekhObject];
  let n = 0;
  for (const obj of list) {
    if (isGroup(obj)) continue;
    const dp = obj.getDrawingProfile();
    if (dp.isFontFamilyDefined() || dp.effectiveFontFamily() !== '') continue;
    if (!dp.isFontFamilyOverridable()) continue;
    dp.setFontFamily(DEFAULT_FONT_FAMILY);
    n++;
  }
  return n;
}
