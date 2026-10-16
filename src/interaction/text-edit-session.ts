// The in-canvas text edit (spec 02 `TextEditSession`; C++ `lib::Edit` in its in-canvas role and
// `Platform::ediText`): which object's text is being edited, and its commit. The DOM editor
// (`CanvasTextEditor`, spec 06 §6) renders it and reports the text; the edit is one undo step.
import { TextEditAction } from '../edit';
import type { LekhObject } from '../model';
import type { InteractionBoard } from './board';

export class TextEditSession {
  private readonly board_: InteractionBoard;
  private objectId_: string | null = null;
  private readonly listeners_ = new Set<() => void>();

  constructor(board: InteractionBoard) {
    this.board_ = board;
  }

  get active(): boolean {
    return this.objectId_ !== null;
  }

  get objectId(): string | null {
    return this.objectId_;
  }

  /** The object's text as the editor opens with it. */
  text(): string {
    const o = this.object();
    return o?.getTextForEditing() ?? '';
  }

  object(): LekhObject | null {
    return this.objectId_ === null ? null : this.board_.page().objectStore.getObject(this.objectId_);
  }

  /** Called after `obj.startTextEditing(pt)` (inside the edit that started it). */
  began(obj: LekhObject): void {
    this.objectId_ = obj.id;
    this.notify();
  }

  /**
   * Ends the edit (C++ `finishTextEditing`): with `text`, the new text is set and recorded as one
   * `TextEditAction`; without, the object keeps what it had.
   */
  finish(text?: string): void {
    const id = this.objectId_;
    if (id === null) return;
    this.objectId_ = null;
    this.board_.edit((ctx) => {
      const o = ctx.page.objectStore.getObject(id);
      if (o === null) return;
      if (text !== undefined) o.updateText(text, -1);
      const r = o.finishTextEditing();
      if (text !== undefined && text !== r.text) {
        ctx.editor.tx.record(new TextEditAction(ctx.editor.env, ctx.doc, o, r.text, text, r.index));
      }
    });
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners_.add(fn);
    return () => {
      this.listeners_.delete(fn);
    };
  }

  dispose(): void {
    this.listeners_.clear();
  }

  private notify(): void {
    for (const l of [...this.listeners_]) l();
  }
}
