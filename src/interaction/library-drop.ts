// Placing library shapes (port of C++ `LibraryObjectStore::addObjectToCanvas` / `centreObjectAt`,
// `TemplateStore::getObjectFromTemplate` for a plain template, and `CanvasWidget::dropLibraryShapeAt`;
// spec 02 `LibraryDropHandler`). The host's library panel supplies the object (a stencil's or a
// custom library's, read by `io`); dropping it at a view point is one undo step and selects it.
import { AddObjectAction } from '../edit';
import { Point, Rect } from '../geometry';
import { TemplatedObject, snapNumber, type LekhObject } from '../model';
import type { InteractionBoard } from './board';
import type { CanvasView } from './canvas-view';
import type { OverlayLayer } from './overlay-layer';

export class LibraryDropHandler {
  private readonly board_: InteractionBoard;
  private readonly view_: CanvasView;
  private readonly overlay_: OverlayLayer;

  constructor(board: InteractionBoard, view: CanvasView, overlay: OverlayLayer) {
    this.board_ = board;
    this.view_ = view;
    this.overlay_ = overlay;
  }

  /** A new object of a catalog template at its default size (C++ `getObjectFromTemplate`). */
  objectFromTemplate(templateId: string): TemplatedObject | null {
    const tmpl = this.board_.template(templateId);
    if (tmpl === null) return null;
    const a = tmpl.defaultAttr;
    return new TemplatedObject(
      this.board_.objectEnv(),
      tmpl,
      Rect.fromCenter(new Point(0, 0), a.width, a.height),
      a.angle,
      null,
    );
  }

  /** C++ `addObjectToCanvas(tobj, cx, cy)`: centred at (cx, cy) (snapped), added, selected. */
  addObjectToCanvas(obj: LekhObject, cx: number, cy: number): void {
    const b = this.board_;
    let x = cx;
    let y = cy;
    b.edit((ctx) => {
      if (b.config.snapToGrid) {
        const step = ctx.doc.snapStep();
        x = snapNumber(cx, step, true);
        y = snapNumber(cy, step, true);
      }
      if (obj instanceof TemplatedObject) {
        const r = obj.ds.rect();
        obj.setRect(new Rect(x - r.width / 2, y - r.height / 2, r.width, r.height));
      }
      ctx.editor.tx.run(new AddObjectAction(ctx.editor.env, ctx.doc, [obj]));
    });
    if (b.page().objectStore.contains(obj)) this.overlay_.select(obj);
  }

  /** C++ `addShapeById`: a catalog shape at the paste point. */
  addShape(templateId: string, at?: Point): boolean {
    const obj = this.objectFromTemplate(templateId);
    if (obj === null) return false;
    const p = at ?? this.board_.clipboard().pastePoint;
    this.addObjectToCanvas(obj, p.x, p.y);
    return true;
  }

  /** C++ `dropLibraryShapeAt`: refused on a read-only board or off the canvas. */
  dropAt(obj: LekhObject, viewPt: Point): boolean {
    if (this.board_.readOnly()) return false;
    if (!this.view_.isPointOnCanvas(viewPt)) return false;
    const p = this.view_.toDoc(viewPt);
    this.addObjectToCanvas(obj, p.x, p.y);
    this.board_.requestPaint('drawing');
    return true;
  }
}
