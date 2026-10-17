// The in-canvas text edit (spec 02 `TextEditSession`; spec 06 §6; C++ `lib::Edit` in its in-canvas
// role — `doEditingForLekhObj`, `editorContentChanged`, `finishEditingForLekhObj`,
// `L/object/widget/lib/Edit.cpp` — and `Platform::ediText`): which object's text is being edited,
// what the DOM editor shows (`view`: rect, font, line height, colour, alignment), the live text
// (`update`, which re-lays the shape out so it grows as today) and the commit (`finish`: one
// `TextEditAction`, or the removal of a floating text left empty).
import { AddObjectAction, DeleteObjectAction, TextEditAction } from '../edit';
import { Point, Rect, Size } from '../geometry';
import { ConnectionObject, TemplatedObject, type LekhObject } from '../model';
import type { Style } from '../style';
import { TextSide, TextTemplate, textEditRect } from '../template';
import { LINE_PITCH, buildCanvasFont, textStyleSnapshot, type FontNameResolver } from '../text';
import type { InteractionBoard } from './board';
import type { CanvasView } from './canvas-view';
import type { TextEditView } from './ui-types';

/** What `view` needs beyond the board: the runtime's text services. */
export interface TextEditHost {
  readonly fontResolver: FontNameResolver;
  /** The session's measure (C++ `Platform::measureText`). */
  measure(text: string, style: Style, constraint: Size): Size;
}

/** C++ `Edit::isFLoatingObjText`: a text object (its template is a `TextTemplate`). */
function isFloatingText(o: LekhObject): boolean {
  return o instanceof TemplatedObject && o.shapeTemplate() instanceof TextTemplate;
}

/** C++ `isTitleText`: a shape's title edits like floating text, but emptying it keeps the shape. */
function isTitleText(o: LekhObject): boolean {
  return o instanceof TemplatedObject && (o.getEditTextElement()?.external() ?? TextSide.None) !== TextSide.None;
}

/** C++ "is free text": sized by its text (floating, a title, a connector label). */
function isFreeText(o: LekhObject): boolean {
  return isFloatingText(o) || isTitleText(o) || o instanceof ConnectionObject;
}

export class TextEditSession {
  private readonly board_: InteractionBoard;
  private host_: TextEditHost | null = null;
  private objectId_: string | null = null;
  /** The editor's text (C++ `text_->text()`), from `began` / `update`. */
  private text_ = '';
  private readonly listeners_ = new Set<() => void>();

  constructor(board: InteractionBoard) {
    this.board_ = board;
  }

  /** The text services the editor geometry needs (the board view sets them). */
  setHost(host: TextEditHost): void {
    this.host_ = host;
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
    this.text_ = obj.getTextForEditing();
    this.notify();
  }

  /**
   * C++ `editorContentChanged`: the editor's new text goes to the object (no undo step yet; the
   * commit records one) and the editor rect is recomputed (`doEditing(true)`).
   */
  update(text: string): void {
    const id = this.objectId_;
    if (id === null || text === this.text_) return;
    this.text_ = text;
    this.board_.edit((ctx) => {
      const o = ctx.page.objectStore.getObject(id);
      if (o === null) return;
      o.updateText(text, -1);
      if (o instanceof TemplatedObject) o.generateData();
      o.invalidate();
    });
    this.board_.requestPaint('drawing');
    this.notify();
  }

  /**
   * The DOM editor's geometry and font (spec 06 §6.1): C++ `editableAreaForLekhObj` in document
   * units, mapped to view px (the box scales with the zoom), and the font at
   * `effectiveFontPx × zoom` with the 1.18 pitch.
   */
  view(cv: CanvasView): TextEditView | null {
    const o = this.object();
    const h = this.host_;
    if (o === null || h === null) return null;
    const free = isFreeText(o);
    const tobj = o instanceof TemplatedObject ? o : null;
    const el = tobj?.getEditTextElement() ?? null;
    let constraint = new Size(0, 0);
    let pad = 0;
    const cfg = this.board_.config;
    if (!free) {
      if (tobj !== null && el !== null) {
        const sz = el.getSize(tobj.ds);
        constraint = new Size(sz.width, sz.height);
        if (el.isDefaultText()) pad = cfg.alignmentPad;
      } else {
        const r = o.selectionRect();
        constraint = new Size(r.width, r.height);
      }
      pad += o.getDrawingProfile().effectiveStrokeWidth() / 2;
    }
    const style = o.getEditTextStyle();
    const interpret = tobj?.shapeTemplate()?.interpretText() === true;
    const ts = textStyleSnapshot(style, h.fontResolver, { defaultAlignAlways: interpret });
    let text = this.text_;
    if (text === '') text = '|';
    else if (text.endsWith('\n')) text += '|';
    const center = o.getTextEditCenter();
    const param = {
      text,
      angle: 0,
      inRect: Rect.fromCenter(center, constraint.width, constraint.height),
      pad,
      textSizeAdjustment: free ? 1 : 0,
      wrapMode: free ? ('float' as const) : ('wrap' as const),
      forEditing: true,
    };
    const wrap = free ? -1 : constraint.width - pad * 2;
    const measured = h.measure(text, style, new Size(wrap, -1));
    const r = textEditRect(param, style, measured, cfg.minTextEditWidth);
    const zoom = this.board_.view().zoom;
    const tl = cv.toView(new Point(r.x, r.y));
    const px = ts.fontSize * ts.fontMultiplier;
    return Object.freeze({
      objectId: o.id,
      rect: new Rect(tl.x, tl.y, r.width * zoom, r.height * zoom),
      rotation: o.rotation(),
      font: buildCanvasFont(ts.font, px * zoom),
      color: style.effectiveTextFill().solidColor.toCss(),
      align: ts.align,
      lineHeight: LINE_PITCH * px * zoom,
      text: this.text_,
      multiLine: true,
      showBorder: true,
      variableWidth: free,
      variableHeight: true,
      defaultAlignAlways: interpret,
    });
  }

  /**
   * Ends the edit (C++ `finishEditingForLekhObj`). With `text` (default: the editor's), the new
   * text is kept: a floating text left empty is removed (its creation undone when it was just
   * added), otherwise a change is one `TextEditAction`. `cancel` keeps what the object had.
   */
  finish(text?: string): void {
    const id = this.objectId_;
    if (id === null) return;
    const cur = text ?? this.text_;
    this.objectId_ = null;
    this.text_ = '';
    this.board_.edit((ctx) => {
      const o = ctx.page.objectStore.getObject(id);
      if (o === null) return;
      if (o.getTextForEditing() !== cur) o.updateText(cur, -1);
      const r = o.finishTextEditing();
      if (isFloatingText(o) && cur === '') {
        if (r.text !== '') {
          o.updateText(r.text, 0);
          ctx.editor.tx.run(new DeleteObjectAction(ctx.editor.env, ctx.doc, [o]));
        } else {
          const top = ctx.editor.undo.topUndo();
          if (top instanceof AddObjectAction && top.objectIds.length === 1 && top.objectIds[0] === id) {
            top.undo();
            ctx.editor.undo.popAction();
          }
        }
        ctx.select([]);
        return;
      }
      if (o instanceof TemplatedObject) o.generateData();
      if (r.text !== cur) ctx.editor.tx.record(new TextEditAction(ctx.editor.env, ctx.doc, o, r.text, cur, r.index));
    });
    this.board_.requestPaint('drawing');
    this.notify();
  }

  /** Ends the edit keeping the object's text as it was before it began. */
  cancel(): void {
    const id = this.objectId_;
    if (id === null) return;
    const o = this.object();
    const orig = o === null ? '' : o.finishTextEditing().text;
    if (o !== null) {
      // `finishTextEditing` was a peek: restart the edit's bookkeeping and finish with the original.
      o.startTextEditing(o.getTextEditCenter());
    }
    this.finish(orig);
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
