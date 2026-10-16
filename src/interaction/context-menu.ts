// The canvas context menu (port of C++ `CanvasWidget::getContextMenuStatus`,
// `CanvasWidget.cpp:1101-1170`; spec 02 `ContextMenuModel`): which items a long press or right
// click at a point offers. Building it selects the shape under the point and sets the paste point,
// as C++ does.
import type { EditTarget } from '../edit';
import type { Point } from '../geometry';
import type { ContextAction } from '../session';
import type { CanvasView } from './canvas-view';
import type { OverlayLayer } from './overlay-layer';

export type ContextActionId =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'move_front'
  | 'move_back'
  | 'select_all'
  | 'add_note'
  | 'add_text'
  | 'add_rect'
  | 'add_circle'
  | 'insert_image';

const LABELS: Readonly<Record<ContextActionId, string>> = Object.freeze({
  copy: 'Copy',
  cut: 'Cut',
  paste: 'Paste',
  move_front: 'Move To Front',
  move_back: 'Move To Back',
  select_all: 'Select All',
  add_note: 'Add Note',
  add_text: 'Add Text',
  add_rect: 'Add Rectangle',
  add_circle: 'Add Circle',
  insert_image: 'Insert Image',
});

function item(id: ContextActionId): ContextAction {
  return { id, label: LABELS[id], enabled: true };
}

export class ContextMenuModel {
  private readonly overlay_: OverlayLayer;
  private readonly view_: CanvasView;

  constructor(overlay: OverlayLayer, view: CanvasView) {
    this.overlay_ = overlay;
    this.view_ = view;
  }

  /** The items at view point `at`, in the C++ order. */
  actionsAt(at: Point): ContextAction[] {
    const board = this.overlay_.board;
    const pt = this.view_.toDoc(at);
    const store = board.page().objectStore;
    const count = store.size;
    const clipboard = board.clipboard();
    let obj: EditTarget | null = null;
    const t = this.overlay_.selectionTarget();
    // C++ tests the canvas point against the rectangle's view frame (they agree at 100 % zoom and
    // no scroll); kept as is.
    if (t !== null && this.overlay_.rect.frame().contains(pt)) obj = t;
    if (obj === null) {
      obj = store.hit.selectableAt(pt, board.config.tapToSelectDistance / board.view().zoom);
      this.overlay_.select(obj);
    }
    const out: ContextAction[] = [];
    if (obj !== null && clipboard.canCopy(obj)) out.push(item('copy'), item('cut'));
    if (obj === null && clipboard.canPaste()) {
      clipboard.setPastePoint(pt);
      out.push(item('paste'));
    }
    if (count > 1 && obj !== null) out.push(item('move_front'), item('move_back'));
    if (count > 0 && obj === null) out.push(item('select_all'));
    if (obj === null) {
      clipboard.setPastePoint(pt);
      out.push(item('add_note'), item('add_text'), item('add_rect'), item('add_circle'), item('insert_image'));
    }
    return out;
  }
}
