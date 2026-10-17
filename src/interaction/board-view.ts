// `BoardView` (spec 02 §16; spec 05's working name `InteractionSession`): wires a `BoardSession`
// to the three canvases — grid, drawing (culled, store order) and the Middle overlay — and to the
// input. It owns the `LayerScheduler` and the interaction objects (router, overlay, controller,
// key map, commands, text edit, recogniser gate) and the UI state store React reads (spec 05 §6).
// No DOM: the host hands it `Canvas2DLike` contexts, `InputEvent`s, key chords and a
// `FrameScheduler`; `dispose()` drops every listener and timer it made.
import type { Canvas2DLike } from '../base';
import { SelectionActionCatalog, isMulti, type EditTarget, type SelectionActionId, type SelectionPanel } from '../edit';
import { Point, Rect, getPointsBound } from '../geometry';
import { GroupObject, TemplatedObject, isConnector } from '../model';
import { Canvas2DDrawingPlatform } from '../render';
import { styleSnapshotOf, type BoardSession, type PaintLayer } from '../session';
import { Style } from '../style';
import { textStyleSnapshot } from '../text';
import { SessionBoard } from './board';
import { CanvasController } from './canvas-controller';
import { CanvasView } from './canvas-view';
import { CommandDispatcher } from './commands';
import type { ContextActionId } from './context-menu';
import { CursorState } from './cursor';
import type { DragHandler } from './drag-handler';
import type { HostEnvironment } from './env';
import { Movement } from './gesture-listener';
import type { InputEvent } from './input-event';
import { InputMode, InputModeState, defaultInputMode } from './input-mode';
import { InputRouter } from './input-router';
import { KeyMap, type KeyChord } from './key-map';
import { LayerScheduler, type FrameScheduler } from './layer-scheduler';
import { LibraryDropHandler } from './library-drop';
import { OverlayLayer } from './overlay-layer';
import type { OverlayTheme } from './overlay-tokens';
import { RecognitionController } from './recognition-controller';
import type { OverlayTextPainter } from './selection/types';
import { MapShapeInteractionRegistry, type ShapeInteractionRegistry } from './shape-interaction';
import { ShapeInteractionLayer } from './shape-layer';
import { TextEditSession } from './text-edit-session';
import type { BoardUiState, SelectionAction, SelectionState, Store } from './ui-types';

export interface BoardViewOptions {
  readonly session: BoardSession;
  readonly env: HostEnvironment;
  readonly frames: FrameScheduler;
  readonly readOnly?: () => boolean;
  readonly theme?: () => OverlayTheme;
  readonly registry?: ShapeInteractionRegistry;
  readonly closeTopPopover?: () => boolean;
  readonly save?: () => void;
  readonly insertImage?: (at: Point) => void;
  /** A selection-menu item that opens a panel (stroke, fill, text, properties, …). */
  readonly openPanel?: (panel: SelectionPanel) => void;
  /** How UI-state changes are batched (spec 05 §6.1: a microtask); default: published at once. */
  readonly scheduleUi?: (fn: () => void) => void;
}

/** The UI state store: an immutable value, republished when it changes. */
class UiStore implements Store<BoardUiState> {
  private state_: BoardUiState;
  private readonly listeners_ = new Set<() => void>();

  constructor(initial: BoardUiState) {
    this.state_ = initial;
  }

  get(): BoardUiState {
    return this.state_;
  }

  subscribe(fn: () => void): () => void {
    this.listeners_.add(fn);
    return () => {
      this.listeners_.delete(fn);
    };
  }

  get listenerCount(): number {
    return this.listeners_.size;
  }

  set(next: BoardUiState): void {
    this.state_ = next;
    for (const l of [...this.listeners_]) l();
  }

  clear(): void {
    this.listeners_.clear();
  }
}

export class BoardView {
  readonly session: BoardSession;
  readonly env: HostEnvironment;
  readonly board: SessionBoard;
  readonly modes: InputModeState;
  readonly cursor = new CursorState();
  readonly view: CanvasView;
  readonly overlay: OverlayLayer;
  readonly canvas: CanvasController;
  readonly shapes: ShapeInteractionLayer;
  readonly router: InputRouter;
  readonly keys: KeyMap;
  readonly commands: CommandDispatcher;
  readonly textEdit: TextEditSession;
  readonly recognition: RecognitionController;
  readonly library: LibraryDropHandler;
  readonly layers: LayerScheduler;
  readonly registry: ShapeInteractionRegistry;
  readonly catalog = new SelectionActionCatalog();
  private readonly store_: UiStore;
  private readonly opts_: BoardViewOptions;
  private readonly contexts_ = new Map<PaintLayer, Canvas2DLike>();
  private readonly unsubscribe_: (() => void)[] = [];
  private readonly abort_: { aborted: boolean; listeners: (() => void)[] } = { aborted: false, listeners: [] };
  private uiScheduled_ = false;
  private disposed_ = false;

  constructor(opts: BoardViewOptions) {
    this.opts_ = opts;
    this.session = opts.session;
    this.env = opts.env;
    this.layers = new LayerScheduler(opts.frames, (l) => {
      this.paintLayer(l);
    });
    this.board = new SessionBoard(opts.session, {
      ...(opts.readOnly !== undefined ? { readOnly: opts.readOnly } : {}),
      requestPaint: (l) => {
        this.layers.invalidate(l);
      },
    });
    this.modes = new InputModeState(defaultInputMode(opts.env));
    this.registry = opts.registry ?? new MapShapeInteractionRegistry();
    this.view = new CanvasView(this.board);
    this.textEdit = new TextEditSession(this.board);
    this.recognition = new RecognitionController({
      board: this.board,
      view: this.view,
      modes: this.modes,
      docGeneration: () => this.session.docGeneration,
    });
    const setDrag = (d: DragHandler): void => {
      this.router.setDragHandler(d);
    };
    const duplicate = (t: EditTarget, displace: boolean): void => {
      this.commands.duplicate(t, displace);
    };
    this.overlay = new OverlayLayer({
      board: this.board,
      env: opts.env,
      modes: this.modes,
      view: this.view,
      cursor: this.cursor,
      setDragHandler: setDrag,
      duplicate,
      isEditingText: () => this.textEdit.active,
      strokes: this.recognition,
      text: this.textPainter(),
      theme: () => this.theme(),
      onSelectionLayout: () => {
        this.scheduleUi();
      },
    });
    this.recognition.setPendingInkHost(this.overlay);
    this.library = new LibraryDropHandler(this.board, this.view, this.overlay);
    this.canvas = new CanvasController({
      board: this.board,
      view: this.view,
      overlay: this.overlay,
      modes: this.modes,
      textEdit: this.textEdit,
      setDragHandler: setDrag,
      duplicate,
      zoomBy: (d, at) => {
        this.commands.zoomBy(d, at);
      },
    });
    this.shapes = new ShapeInteractionLayer({
      board: this.board,
      view: this.view,
      modes: this.modes,
      registry: this.registry,
      setDragHandler: setDrag,
      setCursor: (c) => {
        this.cursor.set(c);
      },
    });
    this.router = new InputRouter({
      env: opts.env,
      timers: this.board.timers,
      layers: [this.overlay, this.shapes, this.canvas],
      isDrawMode: () => this.modes.get() === InputMode.Draw,
      onlyDrawWithPencil: () => this.board.config.onlyDrawWithPencil,
      isEditingText: () => this.textEdit.active,
      finishTextEditing: () => {
        this.textEdit.finish();
      },
      onHover: (at, m) => {
        if (!this.shapes.onHover(at, m)) this.overlay.onHover(m);
      },
    });
    this.keys = new KeyMap(opts.env.isApple);
    this.commands = new CommandDispatcher({
      board: this.board,
      view: this.view,
      overlay: this.overlay,
      canvas: this.canvas,
      router: this.router,
      modes: this.modes,
      textEdit: this.textEdit,
      library: this.library,
      ...(opts.closeTopPopover !== undefined ? { closeTopPopover: opts.closeTopPopover } : {}),
      ...(opts.save !== undefined ? { save: opts.save } : {}),
      ...(opts.insertImage !== undefined ? { insertImage: opts.insertImage } : {}),
    });
    this.store_ = new UiStore(this.computeUi());
    const signal = {
      get aborted(): boolean {
        return abort.aborted;
      },
      addEventListener: (_t: 'abort', l: () => void) => {
        abort.listeners.push(l);
      },
    };
    const abort = this.abort_;
    const s = this.session;
    s.on(
      'paintRequested',
      (e) => {
        this.layers.invalidate(e.layer);
        this.layers.flush();
      },
      signal,
    );
    s.on(
      'selectionChanged',
      (e) => {
        this.overlay.syncSelection(e.ids);
        this.scheduleUi();
      },
      signal,
    );
    s.on(
      'documentChanged',
      () => {
        this.overlay.syncSelection(s.selection);
        this.scheduleUi();
      },
      signal,
    );
    s.on(
      'viewChanged',
      () => {
        this.overlay.refreshSelection();
        this.layers.invalidateAll();
        this.scheduleUi();
      },
      signal,
    );
    this.unsubscribe_.push(
      this.modes.subscribe(() => {
        this.overlay.onHover(Movement.Move);
        this.scheduleUi();
      }),
      this.cursor.subscribe(() => {
        this.scheduleUi();
      }),
      this.textEdit.subscribe(() => {
        this.scheduleUi();
      }),
    );
  }

  /** The UI state React subscribes to (spec 05 §6.1). */
  get ui(): Store<BoardUiState> {
    return this.store_;
  }

  /** Subscribers of the UI store (a leak check after unmount). */
  get uiListenerCount(): number {
    return this.store_.listenerCount;
  }

  private theme(): OverlayTheme {
    return this.opts_.theme?.() ?? 'light';
  }

  // ---- host surface ----

  /** Gives the view a layer's 2D context (the host's `<canvas>`), or takes it away with null. */
  attach(layer: PaintLayer, ctx: Canvas2DLike | null): void {
    if (ctx === null) this.contexts_.delete(layer);
    else this.contexts_.set(layer, ctx);
    this.layers.invalidate(layer);
  }

  /** The board stack's CSS size and the device-pixel ratio (`ResizeObserver`, `matchMedia`). */
  setViewportSize(width: number, height: number, dpr: number): void {
    this.board.command({ kind: 'view', canvasW: width, canvasH: height, dpr });
    this.layers.invalidateAll();
  }

  /** One host input event (pointer, wheel, pinch, context menu, reset). */
  input(e: InputEvent): boolean {
    if (this.disposed_) return false;
    return this.router.handle(e);
  }

  /** A key press on the board stack; true when consumed (the host then calls `preventDefault`). */
  key(k: KeyChord): boolean {
    if (this.disposed_) return false;
    return this.keys.handle(k, (id) => {
      this.commands.run(id);
    });
  }

  /** The canvas context menu's choice. */
  runContextAction(id: ContextActionId): void {
    this.commands.runContextAction(id);
  }

  /** A selection-menu item (spec 05 §8). */
  runSelectionAction(id: SelectionActionId, arg?: unknown): void {
    const t = this.overlay.selectionTarget();
    if (t === null) return;
    this.board.edit((ctx) => {
      const r = this.catalog.run(id, t, { editor: ctx.editor, commands: ctx.commands, clipboard: ctx.clipboard }, arg);
      if (r.select !== undefined)
        ctx.select(r.select === null ? [] : isMulti(r.select) ? r.select.objects.map((o) => o.id) : [r.select.id]);
      if (r.open !== undefined) this.opts_.openPanel?.(r.open);
    });
  }

  /** Paints `layer` now on its attached context (the LayerScheduler's frame). */
  paintLayer(layer: PaintLayer): void {
    const ctx = this.contexts_.get(layer);
    if (ctx === undefined || this.disposed_) return;
    this.session.paint(layer, ctx);
    if (layer === 'middle') {
      const dp = new Canvas2DDrawingPlatform(ctx, { textPainter: this.session.runtime.textPainter });
      this.overlay.draw(dp);
    }
  }

  /** Draws the overlay on any drawing platform (tests, a recording platform). */
  drawOverlay(dp: Parameters<OverlayLayer['draw']>[0]): void {
    this.overlay.draw(dp);
  }

  private textPainter(): OverlayTextPainter {
    return {
      draw: (dp, text, rect, opts) => {
        const rt = this.session.runtime;
        const style = new Style();
        style.setFontSize(opts.fontSize ?? 12);
        if (opts.color !== undefined) style.setFontColor(opts.color);
        const laid = rt.textLayout.layout({
          text,
          style: textStyleSnapshot(style, rt.fontResolver),
          box: rect,
          wrapWidth: 0,
          angle: 0,
          wrapMode: 'float',
        });
        dp.drawText(laid, style);
      },
    };
  }

  // ---- the UI state ----

  private scheduleUi(): void {
    if (this.disposed_) return;
    const sched = this.opts_.scheduleUi;
    if (sched === undefined) {
      this.publishUi();
      return;
    }
    if (this.uiScheduled_) return;
    this.uiScheduled_ = true;
    sched(() => {
      this.uiScheduled_ = false;
      this.publishUi();
    });
  }

  private publishUi(): void {
    if (this.disposed_) return;
    const prev = this.store_.get();
    const next = this.computeUi(prev);
    if (next !== prev) this.store_.set(next);
  }

  private selectionState(): SelectionState | null {
    const t = this.overlay.selectionTarget();
    if (t === null) return null;
    const anchor = this.overlay.anchorRect() ?? new Rect();
    const kind: SelectionState['kind'] = isMulti(t)
      ? 'multi'
      : t instanceof GroupObject
        ? 'group'
        : isConnector(t)
          ? 'connector'
          : t instanceof TemplatedObject && t.shapeTemplate()?.id() === 'avabodh.basic.text'
            ? 'text'
            : 'shape';
    const ctx = { editor: this.session.editor, commands: this.session.commands, clipboard: this.session.clipboard };
    const actions: SelectionAction[] = this.catalog.actionsFor(t, ctx).map((a) => ({ ...a }));
    const style = styleSnapshotOf(isMulti(t) ? t.drawingProfile : t.getDrawingProfile());
    const ids = isMulti(t) ? t.objects.map((o) => o.id) : [t.id];
    return { ids, kind, anchorRect: anchor, actions, style };
  }

  private computeUi(prev?: BoardUiState): BoardUiState {
    const s = this.session;
    const doc = s.document;
    const v = s.view;
    const perm = s.permission;
    const sel = this.selectionState();
    const te = this.textEdit.object();
    const textEdit =
      te === null
        ? null
        : {
            objectId: te.id,
            rect: getPointsBound(
              te
                .selectionRect()
                .getPoints()
                .map((p) => this.view.toView(p)),
            ),
            rotation: te.rotation(),
            font: '',
            color: '',
            align: 'center' as const,
            lineHeight: 0,
            text: te.getTextForEditing(),
          };
    const cfg = this.board.config;
    const next: BoardUiState = {
      inputMode: this.modes.get(),
      popup: prev?.popup ?? { for: null },
      shapeLibraryOpen: prev?.shapeLibraryOpen ?? false,
      selection: sel,
      zoom: v.zoom,
      scroll: new Point(v.tx, v.ty),
      doc: {
        name: doc.name,
        permission: perm === null ? 'owner' : perm === 'write' ? 'edit' : 'read',
        remote: perm !== null,
        sharable: perm !== null,
        canRename: perm === null || perm === 'write',
        canDelete: perm === null,
        formatVersion: doc.info.version,
      },
      pages: { ids: doc.pages.map((p) => p.id), active: doc.activePageIndex },
      undo: { canUndo: s.editor.undo.canUndo(), canRedo: s.editor.undo.canRedo() },
      busy: prev?.busy ?? null,
      textEdit,
      cursor: this.cursor.get(),
      theme: this.theme(),
      env: this.env,
      settings: prev?.settings ?? {
        gridOn: doc.grid.present,
        snapToGrid: cfg.snapToGrid,
        darkMode: 'system',
        onlyDrawWithPencil: cfg.onlyDrawWithPencil,
        recognizeShape: this.modes.get() === InputMode.SmartDraw,
        keepScreenOn: false,
        autoConnect: false,
        showRulers: false,
      },
    };
    if (prev !== undefined && sameUi(prev, next)) return prev;
    return Object.freeze(next);
  }

  /** Drops every listener, timer and frame request this view made (spec 05 §6.2). */
  dispose(): void {
    if (this.disposed_) return;
    this.disposed_ = true;
    this.abort_.aborted = true;
    for (const l of this.abort_.listeners) l();
    this.abort_.listeners.length = 0;
    for (const u of this.unsubscribe_) u();
    this.unsubscribe_.length = 0;
    this.router.reset();
    this.layers.dispose();
    this.overlay.dispose();
    this.store_.clear();
    this.modes.dispose();
    this.cursor.dispose();
    this.textEdit.dispose();
    this.contexts_.clear();
  }
}

function sameUi(a: BoardUiState, b: BoardUiState): boolean {
  return (
    a.inputMode === b.inputMode &&
    a.zoom === b.zoom &&
    a.scroll.x === b.scroll.x &&
    a.scroll.y === b.scroll.y &&
    a.cursor === b.cursor &&
    a.theme === b.theme &&
    a.undo.canUndo === b.undo.canUndo &&
    a.undo.canRedo === b.undo.canRedo &&
    a.pages.active === b.pages.active &&
    a.pages.ids.length === b.pages.ids.length &&
    a.doc.name === b.doc.name &&
    a.doc.permission === b.doc.permission &&
    JSON.stringify(a.selection) === JSON.stringify(b.selection) &&
    JSON.stringify(a.textEdit) === JSON.stringify(b.textEdit)
  );
}
