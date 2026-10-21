// Runs the board's commands — the shortcuts, the toolbar's, the context menu's (port of the UI
// half of C++ `app::Command`, `L/app/Command.cpp`; spec 02 `CommandDispatcher`). Document edits go
// through `board.edit` (one command each) and the `edit/` commands; the selection afterwards is
// set on the session and the overlay follows it.
import {
  ChangeGridAction,
  StyleEditor,
  isMulti,
  selectionOf,
  targetStyle,
  type EditTarget,
  type SelectionChange,
} from '../edit';
import { Point, type Rect } from '../geometry';
import type { CommandContext } from '../session';
import { FontStyle, FontWeight, TextDecoration } from '../style';
import type { InteractionBoard } from './board';
import type { CanvasController } from './canvas-controller';
import type { CanvasView } from './canvas-view';
import type { ContextActionId } from './context-menu';
import { InputMode, type InputModeState } from './input-mode';
import type { InputRouter } from './input-router';
import type { KeyCommandId } from './key-map';
import type { LibraryDropHandler } from './library-drop';
import type { OverlayLayer } from './overlay-layer';
import type { TextEditSession } from './text-edit-session';

export interface CommandDispatcherOptions {
  readonly board: InteractionBoard;
  readonly view: CanvasView;
  readonly overlay: OverlayLayer;
  readonly canvas: CanvasController;
  readonly router: InputRouter;
  readonly modes: InputModeState;
  readonly textEdit: TextEditSession;
  /** Closes the top React popover or sheet; true when one was open (spec 05 §3.4). */
  readonly closeTopPopover?: () => boolean;
  /** `Command::save` (the host saves the board). */
  readonly save?: () => void;
  /** `Command::insertImage` (the host picks an image). */
  readonly insertImage?: (at: Point) => void;
  readonly library: LibraryDropHandler;
}

function idsOf(t: EditTarget | null): string[] {
  if (t === null) return [];
  return isMulti(t) ? t.objects.map((o) => o.id) : [t.id];
}

export class CommandDispatcher {
  private readonly o_: CommandDispatcherOptions;

  constructor(opts: CommandDispatcherOptions) {
    this.o_ = opts;
  }

  private get board(): InteractionBoard {
    return this.o_.board;
  }

  private selected(): EditTarget | null {
    return this.o_.overlay.selectionTarget();
  }

  /** Applies an edit's selection change inside its command. */
  private static apply(ctx: CommandContext, change: SelectionChange): void {
    if (change === undefined) return;
    ctx.select(idsOf(change));
  }

  run(id: KeyCommandId): void {
    const o = this.o_;
    switch (id) {
      case 'enter':
        this.enter();
        return;
      case 'escape':
        this.escape();
        return;
      case 'delete':
        this.del();
        return;
      case 'arrow_up':
        this.arrow(0, 1);
        return;
      case 'arrow_down':
        this.arrow(0, -1);
        return;
      case 'arrow_left':
        this.arrow(1, 0);
        return;
      case 'arrow_right':
        this.arrow(-1, 0);
        return;
      case 'save':
        o.save?.();
        return;
      case 'tool_select':
        o.modes.set(InputMode.Select);
        return;
      case 'tool_scroll':
        o.modes.set(InputMode.Scroll);
        return;
      case 'tool_draw':
        o.modes.set(InputMode.Draw);
        return;
      case 'tool_smart_draw':
        o.modes.set(InputMode.SmartDraw);
        return;
      case 'tool_erase':
        o.modes.set(InputMode.Erase);
        return;
      case 'tool_text':
        o.modes.set(InputMode.Text);
        return;
      case 'bold':
        this.toggleText('bold');
        return;
      case 'italic':
        this.toggleText('italic');
        return;
      case 'underline':
        this.toggleText('underline');
        return;
      case 'reset_zoom':
        o.view.resetZoom();
        o.overlay.refreshSelection();
        return;
      case 'zoom_in':
        this.zoomBy(0.05);
        return;
      case 'zoom_out':
        this.zoomBy(-0.05);
        return;
      case 'toggle_grid':
        this.toggleGrid();
        return;
      case 'group':
        this.selectionCommand((ctx, t) => ctx.commands.group(t));
        return;
      case 'ungroup':
        this.selectionCommand((ctx, t) => ctx.commands.ungroup(t));
        return;
      case 'select_all':
        this.selectAll();
        return;
      case 'undo':
        o.overlay.deselect();
        this.board.command({ kind: 'undo' });
        return;
      case 'redo':
        o.overlay.deselect();
        this.board.command({ kind: 'redo' });
        return;
      case 'copy':
        this.copy();
        return;
      case 'paste':
        this.paste();
        return;
      case 'duplicate':
        this.duplicate(null, true);
        return;
      case 'cut':
        this.cut();
        return;
    }
  }

  /** The canvas context menu's actions (`ContextMenuModel`). */
  runContextAction(id: ContextActionId): void {
    switch (id) {
      case 'copy':
        this.copy();
        return;
      case 'cut':
        this.cut();
        return;
      case 'paste':
        this.paste();
        return;
      case 'move_front':
        this.selectionCommand((ctx, t) => (ctx.commands.changeZOrder(t, 1), undefined));
        return;
      case 'move_back':
        this.selectionCommand((ctx, t) => (ctx.commands.changeZOrder(t, 0), undefined));
        return;
      case 'select_all':
        this.selectAll();
        return;
      case 'add_note':
        this.addShape('avabodh.basic.note');
        return;
      case 'add_rect':
        this.addShape('avabodh.basic.rectangle');
        return;
      case 'add_circle':
        this.addShape('avabodh.basic.circle');
        return;
      case 'add_text':
        this.o_.canvas.editTextAt(this.o_.view.toView(this.board.clipboard().pastePoint), false);
        return;
      case 'insert_image':
        this.o_.insertImage?.(this.board.clipboard().pastePoint);
        return;
    }
  }

  /** C++ `handleEnterKey`: edits the text of the selected shape. */
  private enter(): void {
    const ov = this.o_.overlay;
    if (ov.isSelectionActive() && !ov.rect.underVertexHandle) {
      this.o_.canvas.editTextAt(ov.rect.frame().center(), true);
    }
  }

  /** C++ `handleEscapeKey`: cancel a drag → finish text editing → close a popover → deselect. */
  escape(): void {
    const o = this.o_;
    if (o.router.hasDragHandler()) {
      o.router.cancelDrag();
      return;
    }
    if (o.textEdit.active) {
      o.textEdit.finish();
      return;
    }
    if (o.closeTopPopover?.() === true) return;
    o.overlay.deselect();
  }

  /**
   * Android back on the board (`on_back_button`; spec 05 §3.4, spec 09 §8, AC-UI-11; C++
   * `LekhCore::onBackButton`): close the top popover or panel → finish text editing → clear the
   * selection or vertex handle. Returns the step taken, or `leave` when none applied: the host
   * then closes the board.
   */
  back(): 'popover' | 'text' | 'selection' | 'leave' {
    const o = this.o_;
    if (o.closeTopPopover?.() === true) return 'popover';
    if (o.textEdit.active) {
      o.textEdit.finish();
      return 'text';
    }
    if (o.overlay.isSelectionActive() || o.overlay.vertex.isActive()) {
      o.overlay.deselect();
      return 'selection';
    }
    return 'leave';
  }

  private del(): void {
    this.selectionCommand((ctx, t) => ctx.clipboard.del(t));
  }

  /** C++ `handleArrowKey`: the selection moves 2 view px (snapping off), else the canvas 8. */
  private arrow(sx: number, sy: number): void {
    const ov = this.o_.overlay;
    const t = this.selected();
    const delta = t !== null ? 2 : 8;
    const dx = sx * delta;
    const dy = sy * delta;
    if (t !== null) {
      const zm = this.board.view().zoom;
      const ids = isMulti(t) ? t.movableObjects().map((m) => m.id) : [t.id];
      // `TranslateObjectAction` moves with snapping off, as C++ turned it off for the nudge.
      this.board.command({ kind: 'move', ids, dx: -dx / zm, dy: -dy / zm });
      ov.refreshSelection();
    } else {
      this.o_.view.scroll(new Point(0, 0), 0);
      this.o_.view.scroll(new Point(dx, dy), 2);
    }
  }

  private toggleText(which: 'bold' | 'italic' | 'underline'): void {
    const t = this.selected();
    if (t === null) return;
    const board = this.board;
    board.edit((ctx) => {
      const se = new StyleEditor(ctx.editor, board.currentStyle());
      const style = targetStyle(t);
      se.start(t, style);
      if (which === 'bold') se.setBold(style.effectiveFontWeight() !== FontWeight.Bold);
      else if (which === 'italic') se.setItalic(style.effectiveFontStyle() !== FontStyle.Italic);
      else se.setUnderline((style.effectiveTextDecoration() & TextDecoration.UnderLine) !== TextDecoration.UnderLine);
      se.finish();
    });
    board.requestPaint('drawing');
  }

  zoomBy(delta: number, at?: Point): void {
    this.o_.view.zoomBy(delta, at);
    this.o_.overlay.refreshSelection();
  }

  private toggleGrid(): void {
    this.board.edit((ctx) => {
      ctx.editor.tx.run(new ChangeGridAction(ctx.editor.env, ctx.doc, !ctx.doc.grid.present));
    });
    this.board.requestPaint('grid');
  }

  private selectionCommand(fn: (ctx: CommandContext, t: EditTarget) => SelectionChange): void {
    const t = this.selected();
    if (t === null) return;
    this.board.edit((ctx) => {
      CommandDispatcher.apply(ctx, fn(ctx, t));
    });
  }

  /** C++ `selectAll`: every object but helpers. */
  private selectAll(): void {
    const objs = [...this.board.page().objectStore.objects];
    const t = selectionOf(objs);
    if (t === null) this.o_.overlay.deselect();
    else this.o_.overlay.select(t);
  }

  /** C++ `updatePastePoint`: the visible centre, or next to the selection. */
  private updatePastePoint(): void {
    let pt = this.o_.view.insertLocation();
    const t = this.selected();
    if (t !== null) {
      const d = this.board.config.cloneDisplacement;
      let r: Rect | null = null;
      for (const o of isMulti(t) ? t.objects : [t])
        r = r === null ? o.selectionRect() : r.includeRect(o.selectionRect());
      const c = r?.center() ?? pt;
      pt = new Point(c.x + d, c.y + d);
    }
    this.board.clipboard().setPastePoint(pt);
  }

  private copy(): void {
    this.updatePastePoint();
    const t = this.selected();
    this.board.edit((ctx) => {
      ctx.clipboard.copy(t);
    });
  }

  private cut(): void {
    this.updatePastePoint();
    const t = this.selected();
    this.board.edit((ctx) => {
      CommandDispatcher.apply(ctx, ctx.clipboard.cut(t));
    });
  }

  private paste(): void {
    const cb = this.board.clipboard();
    if (!this.o_.view.isPointOnCanvas(this.o_.view.toView(cb.pastePoint)))
      cb.setPastePoint(this.o_.view.insertLocation());
    this.board.edit((ctx) => {
      CommandDispatcher.apply(ctx, ctx.clipboard.paste());
    });
  }

  /** C++ `Command::clear` (the toolbar's Clear Canvas): deselect, then clear the page (undoable). */
  clearCanvas(): void {
    this.o_.overlay.deselect();
    this.board.command({ kind: 'clear' });
    this.board.requestPaint('drawing');
  }

  /** C++ `ToolMenu::clickResetZoom`. */
  resetZoom(): void {
    this.o_.view.resetZoom();
    this.o_.overlay.refreshSelection();
  }

  /**
   * The web zoom control's − / + (C++ `initBottomLeftMenus` `setZoom`): the integer percentage
   * snapped down to a multiple of 5, reached by `Command::zoomIn(delta)` about the centre.
   */
  setZoomPercent(percent: number): void {
    const zm = Math.trunc(percent / 5) * 5;
    this.zoomBy(zm / 100 - this.board.view().zoom);
  }

  /** The integer zoom percentage C++ `LekhGlobal::zoom()` shows (`zoom_info_text`). */
  zoomPercent(): number {
    return Math.round(this.board.view().zoom * 100);
  }

  /**
   * C++ `CanvasWidget::setViewFromBegnining` (the toolbar's "Move to beginning"): 100 %, and on
   * an infinite canvas the content's top-left brought into view (centred on an axis it fits in,
   * else 65 px in, clear of the toolbar; the x inset only on a big screen). A fixed or auto-size
   * page goes back to 100 % placed as on the board's first open (`computeSize(true)`: centred on
   * an axis it fits in, else at the view's edge).
   */
  goToBeginning(smallScreen: boolean): void {
    const v = this.board.view();
    if (!this.o_.view.isInfinite()) {
      this.board.setView({ zoom: 1, tx: 0, ty: 0 });
      this.o_.view.firstTimeLayout();
      this.o_.overlay.refreshSelection();
      return;
    }
    const rect = this.board.page().objectStore.hit.boundsOfAll();
    let sx = 0;
    let sy = 0;
    if (rect.width > 0.01 || rect.height > 0.01) {
      const toolBarDelta = 65;
      sx = -rect.x;
      sy = -rect.y;
      if (rect.width < v.canvasW) sx += (v.canvasW - rect.width) / 2;
      else if (!smallScreen) sx += toolBarDelta;
      if (rect.height < v.canvasH) sy += (v.canvasH - rect.height) / 2;
      else sy += toolBarDelta;
    }
    this.board.setView({ zoom: 1, tx: sx, ty: sy });
    this.o_.overlay.refreshSelection();
  }

  /** C++ `duplicate(obj, displace)`. */
  duplicate(target: EditTarget | null, displace: boolean): void {
    const t = target ?? this.selected();
    if (t === null) return;
    this.board.edit((ctx) => {
      CommandDispatcher.apply(ctx, ctx.commands.duplicate(t, displace));
    });
  }

  /** C++ `addShapeById`: a catalog shape at the paste point. */
  private addShape(templateId: string): void {
    this.o_.library.addShape(templateId);
  }
}
