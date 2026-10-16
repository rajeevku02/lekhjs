// What an edit applies to: one page object, or a multi-selection (C++ `MultiSelectedObjects`, a
// widget-side `TemplatedObject` in C++; here a plain value the interaction layer builds). Editors,
// the clipboard and the selection-action catalog take the target as an argument instead of
// reading the selection widget (C11).
import { ConnectionObject, TemplatedObject, type LekhObject } from '../model';
import { Style } from '../style';

export class MultiSelection {
  readonly objects: readonly LekhObject[];
  /** The style the selection itself carries (C++ the container's drawing profile). */
  readonly drawingProfile: Style;

  constructor(objects: readonly LekhObject[], drawingProfile: Style = new Style()) {
    this.objects = objects.slice();
    this.drawingProfile = drawingProfile;
  }

  /** C++ `movableObjects()`: the templated objects that are not connectors. */
  movableObjects(): TemplatedObject[] {
    return this.objects.filter(
      (o): o is TemplatedObject => !(o instanceof ConnectionObject) && o instanceof TemplatedObject,
    );
  }
}

export type EditTarget = LekhObject | MultiSelection;

export function isMulti(t: EditTarget | null): t is MultiSelection {
  return t instanceof MultiSelection;
}

/** The objects an edit of `t` changes (C++ `StyleEditor::getObjects`). */
export function targetObjects(t: EditTarget | null): LekhObject[] {
  if (t === null) return [];
  if (t instanceof MultiSelection) return [...t.objects];
  return [t];
}

/** The style a target shows (C++ `target->getDrawingProfile()`). */
export function targetStyle(t: EditTarget): Style {
  return t instanceof MultiSelection ? t.drawingProfile : t.getDrawingProfile();
}

/**
 * What the selection should become after an edit (C++ `updateSelectionRectangle(…)` / `deselect`):
 * `undefined` leaves it, `null` clears it.
 */
export type SelectionChange = EditTarget | null | undefined;

/** C++ "a multi when more than one movable object, the one when one, else deselect". */
export function selectionOf(objs: readonly LekhObject[]): EditTarget | null {
  const multi = new MultiSelection(objs);
  const movable = multi.movableObjects();
  if (movable.length > 1) return multi;
  if (movable.length === 1) return movable[0] as TemplatedObject;
  return null;
}
