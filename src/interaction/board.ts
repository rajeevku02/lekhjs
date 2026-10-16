// What the interaction layer reads of and does to its board (spec 05 §4.3: "calls into the engine
// go through `BoardSession` queries and commands; the controller never mutates the store
// directly, so every edit is one undo step and one sync update").
//
// `InteractionBoard` is the narrow port the controller, the overlay and the draggers use;
// `SessionBoard` implements it over a `BoardSession`. Reads (hit tests, geometry) look at the live
// document; every change runs inside `edit(fn)`, which is one `command` event on the session's
// serial queue (a registered `custom` command), so layout, the index, repaint requests and the
// realtime outbox follow the session's flush. A drag changes its objects live across several
// `edit` calls and records its one undo step (and its one update) at the End.
import type { Config, Handle } from '../base';
import type { ClipboardService } from '../edit';
import type { Point, Rect } from '../geometry';
import type { Style } from '../style';
import {
  modificationContext,
  type LekhDocument,
  type LekhObject,
  type ModificationContext,
  type ObjectEnv,
  type Page,
} from '../model';
import type { ViewTransform } from '../render';
import type { BoardSession, CommandContext, EditCommand, PaintLayer, UiRequests } from '../session';
import type { ShapeTemplate } from '../template';
import type { GestureTimers } from './gesture-listener';

export interface ViewChange {
  readonly zoom?: number;
  readonly tx?: number;
  readonly ty?: number;
}

export interface InteractionBoard {
  readonly config: Config;
  /** A read-only board (C++ `coreIO()->isReadOnly()`). */
  readOnly(): boolean;
  view(): ViewTransform;
  setView(v: ViewChange): void;
  /** The live document (read; change it only inside `edit`). */
  document(): LekhDocument;
  page(): Page;
  objectEnv(): ObjectEnv;
  /** A fresh, loaded instance of a catalog template (C++ `TemplateStore::getTemplate`). */
  template(id: string): ShapeTemplate | null;
  selection(): readonly string[];
  /** Replaces the selection (ids on the active page). */
  select(ids: readonly string[]): void;
  /** Runs `fn` as one command on the session's queue. */
  edit(fn: (ctx: CommandContext) => void): void;
  command(cmd: EditCommand): void;
  requestPaint(layer: PaintLayer): void;
  now(): number;
  readonly timers: GestureTimers;
  ui(): UiRequests | null;
  /** The drawing style new strokes and shapes take (C++ `LekhGlobal::currentStyle`). */
  currentStyle(): Style;
  /** The session's clipboard (its paste point is set by taps and the context menu). */
  clipboard(): ClipboardService;
  /** A laser trail for the collaborators (C++ a `trackpointer` update), document units. */
  sendPointers(points: readonly Point[]): void;
}

/** The custom command `SessionBoard.edit` runs through. */
export const INTERACTION_EDIT_COMMAND = 'lekh.interaction.edit';

/** The modification context of a drag on the active page (snapping, containers). */
export function dragContext(board: InteractionBoard, doc: LekhDocument = board.document()): ModificationContext {
  return modificationContext(board.objectEnv(), doc.activePage().objectStore, doc.snapStep());
}

/** The objects of `ids` on the active page, in order; missing ids are left out. */
export function objectsOf(board: InteractionBoard, ids: readonly string[]): LekhObject[] {
  const store = board.page().objectStore;
  const out: LekhObject[] = [];
  for (const id of ids) {
    const o = store.getObject(id);
    if (o !== null) out.push(o);
  }
  return out;
}

export interface SessionBoardOptions {
  /** Forced read-only (a viewer link); a `read` / `comment` permission is read-only too. */
  readonly readOnly?: () => boolean;
  /** Where repaint requests go (default: the session's own `requestPaint`). */
  readonly requestPaint?: (layer: PaintLayer) => void;
}

export class SessionBoard implements InteractionBoard {
  readonly session: BoardSession;
  readonly timers: GestureTimers;
  private readonly readOnly_: () => boolean;
  private readonly requestPaint_: ((layer: PaintLayer) => void) | null;

  constructor(session: BoardSession, opts: SessionBoardOptions = {}) {
    this.session = session;
    this.readOnly_ = opts.readOnly ?? (() => false);
    this.requestPaint_ = opts.requestPaint ?? null;
    const sched = session.scheduler;
    const handles = new Map<number, Handle>();
    let seq = 0;
    this.timers = {
      setTimer: (ms, fn) => {
        const id = ++seq;
        handles.set(
          id,
          sched.setTimeout(() => {
            handles.delete(id);
            fn();
          }, ms),
        );
        return id;
      },
      clearTimer: (id) => {
        const h = handles.get(id);
        if (h !== undefined) sched.clearTimeout(h);
        handles.delete(id);
      },
    };
    session.registerCommand(INTERACTION_EDIT_COMMAND, (ctx, arg) => {
      (arg as (c: CommandContext) => void)(ctx);
    });
  }

  get config(): Config {
    return this.session.config;
  }

  readOnly(): boolean {
    const p = this.session.permission;
    return this.readOnly_() || p === 'read' || p === 'comment';
  }

  view(): ViewTransform {
    return this.session.viewTransform;
  }

  setView(v: ViewChange): void {
    this.session.dispatch({ type: 'command', command: { kind: 'view', ...v }, origin: 'ui' });
  }

  document(): LekhDocument {
    return this.session.editor.doc;
  }

  page(): Page {
    return this.session.editor.doc.activePage();
  }

  objectEnv(): ObjectEnv {
    return this.session.editor.env.codec.env.objects;
  }

  template(id: string): ShapeTemplate | null {
    return this.session.editor.env.codec.env.templates.resolver.getTemplate(id);
  }

  selection(): readonly string[] {
    return this.session.selection;
  }

  select(ids: readonly string[]): void {
    this.command({ kind: 'select', ids });
  }

  edit(fn: (ctx: CommandContext) => void): void {
    this.command({ kind: 'custom', name: INTERACTION_EDIT_COMMAND, arg: fn });
  }

  command(cmd: EditCommand): void {
    this.session.dispatch({ type: 'command', command: cmd, origin: 'ui' });
  }

  requestPaint(layer: PaintLayer): void {
    if (this.requestPaint_ !== null) this.requestPaint_(layer);
    else this.session.requestPaint(layer);
  }

  now(): number {
    return this.session.runtime.clock.now();
  }

  ui(): UiRequests | null {
    return this.session.options.ui ?? null;
  }

  currentStyle(): Style {
    return this.session.currentStyle;
  }

  clipboard(): ClipboardService {
    return this.session.clipboard;
  }

  sendPointers(points: readonly Point[]): void {
    this.session.sync.raise({ type: 'trackpointer', changes: {}, pointers: points.map((p) => ({ x: p.x, y: p.y })) });
  }
}

/** The visible document area (for culling the overlay's queries). */
export function visibleDocRect(board: InteractionBoard): Rect {
  return board.view().visibleRect();
}
