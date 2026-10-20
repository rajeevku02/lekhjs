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
//
// A generated template (a template with a generator: the wireframe date pickers, calendars, …)
// measured its text when the object was built, in the family it had then (the platform default);
// it is generated again in the stamped family (`ShapeTemplate.load()`, as the template is when the
// board is next loaded or received), or its text boxes stay sized for the default family. Owner
// round UI5: the android date picker's year box, measured in the default sans (33.4 px + 2 for
// "2018" at 15 px), was 1 px too narrow for "2018" in Noto Sans (34.3 px) less the text padding,
// so the over-long-word rule (DR-TXT-03 rule 3) broke it as "201" / "8" until the board was
// reopened; C++ set no family on new content, so its box always fit its font.
import { DEFAULT_FONT_FAMILY } from '../text';
import { isGroup } from './kinds';
import type { LekhObject } from './lekh-object';
import { TemplatedObject } from './templated-object';

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
    if (obj instanceof TemplatedObject) {
      const t = obj.shapeTemplate();
      if (t !== null && t.generator !== null && t.getStyle() === dp) {
        t.load();
        obj.generateData();
      }
    }
    n++;
  }
  return n;
}
