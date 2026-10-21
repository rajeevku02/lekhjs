// `BoardView` (spec 02 §16; spec 05's working name `InteractionSession`): wires a `BoardSession`
// to the three canvases — grid, drawing (culled, store order) and the Middle overlay — and to the
// input. It owns the `LayerScheduler` and the interaction objects (router, overlay, controller,
// key map, commands, text edit, recogniser gate) and the UI state store React reads (spec 05 §6).
// No DOM: the host hands it `Canvas2DLike` contexts, `InputEvent`s, key chords and a
// `FrameScheduler`; `dispose()` drops every listener and timer it made.
import type { Canvas2DLike } from '../base';
import {
  SelectionActionCatalog,
  arrowPointCount,
  arrowsOf,
  insertImageObject,
  isMulti,
  type EditTarget,
  type InsertImageInput,
  type SelectionActionId,
  type SelectionPanel,
} from '../edit';
import { Point, Rect } from '../geometry';
import { ConnectionObject, GroupObject, TemplatedObject, isConnector } from '../model';
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
import { BoardEditors } from './editor-api';
import { TextEditSession } from './text-edit-session';
import type { BoardUiState, ConfigSnapshot, SelectionAction, SelectionState, Store, TextEditView } from './ui-types';

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
  /** What the panels call (spec 05 §6.3 `StyleEditorApi`, `SettingsApi`, …). */
  readonly editors: BoardEditors;
  private readonly store_: UiStore;
  private readonly opts_: BoardViewOptions;
  private readonly contexts_ = new Map<PaintLayer, Canvas2DLike>();
  private readonly unsubscribe_: (() => void)[] = [];
  private readonly abort_: { aborted: boolean; listeners: (() => void)[] } = { aborted: false, listeners: [] };
  private uiScheduled_ = false;
  private disposed_ = false;
  /** C++ `computeSize(true)` is due: the board was opened (or reloaded) and not yet placed. */
  private firstLayoutPending_: boolean;
  /** The finite page's size and the view's at the last drawing paint (null: infinite). */
  private canvasSizeKey_: string | null = null;

  constructor(opts: BoardViewOptions) {
    this.opts_ = opts;
    this.session = opts.session;
    this.firstLayoutPending_ = opts.session.isLoaded;
    this.env = opts.env;
    this.layers = new LayerScheduler(opts.frames, (l) => {
      this.paintLayer(l);
    });
    this.board = new SessionBoard(opts.session, {
      ...(opts.readOnly !== undefined ? { readOnly: opts.readOnly } : {}),
      requestPaint: (l) => {
        this.layers.invalidate(l);
        // The grid's presence is UI state (`settings.gridOn`); a grid change only repaints.
        if (l === 'grid') this.scheduleUi();
      },
    });
    this.modes = new InputModeState(defaultInputMode(opts.env));
    this.registry = opts.registry ?? new MapShapeInteractionRegistry();
    this.view = new CanvasView(this.board);
    this.textEdit = new TextEditSession(this.board);
    this.textEdit.setHost({
      fontResolver: opts.session.runtime.fontResolver,
      measure: (text, style, constraint) => opts.session.text.measure(text, style, constraint),
      layout: (text, style, box, wrapWidth, wrapMode) => opts.session.text.layout(text, style, box, wrapWidth, 0, wrapMode),
    });
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
        // The selection's corners are above the shapes (C++ `MiddleWidget` is hit-tested first).
        if (this.overlay.hoverHandle(at, m)) {
          this.shapes.onHover(at, Movement.End);
          return;
        }
        if (!this.shapes.onHover(at, m)) this.overlay.onHover(m);
      },
      trace: this.board.trace,
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
    this.editors = new BoardEditors({
      board: this.board,
      editor: this.session.editor,
      overlay: this.overlay,
      settings: this.session.runtime.settings,
      arrowheads: () => this.session.overlay.arrowheads().map((d) => this.session.overlay.instantiate(d)),
      changed: () => {
        this.overlay.refreshSelection();
        this.scheduleUi();
      },
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
      (e) => {
        if (e.reloaded) this.firstLayoutPending_ = true;
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
      // A settings change (any session on this runtime, or the settings file read late).
      this.session.runtime.settings.onChange(() => {
        this.overlay.refreshSelection();
        this.layers.invalidateAll();
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

  /**
   * Inserts a picked image (C++ `CoreIO::insertImage` / `insertImageWithResource`): an
   * `avabodh.basic.image` shape of `input`'s size centred at `at` (document units), default the
   * centre of the visible canvas; one undo step. Returns the new object's id ('' when none).
   */
  insertImage(input: InsertImageInput, at?: Point): string {
    const center = at ?? this.view.insertLocation();
    // The user's own upload: a 4xx racing it must not make the image gone for the session (IF1).
    if (input.kind === 'resource') this.session.imageCache.trust(input.url);
    let id = '';
    this.board.edit((ctx) => {
      id = insertImageObject(ctx.editor, center, input)?.id ?? '';
    });
    this.board.requestPaint('drawing');
    return id;
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
    this.session.paint(layer, ctx, { theme: this.theme() });
    if (layer === 'drawing') this.syncCanvasSize();
    if (layer === 'middle') {
      const dp = new Canvas2DDrawingPlatform(ctx, { textPainter: this.session.runtime.textPainter });
      this.overlay.draw(dp);
      // The selection menu follows every overlay frame (its anchor, and hidden while the
      // selection moves, resizes or rotates; spec 05 §8, AC-UI-23).
      if (this.overlay.selectionTarget() !== null) this.scheduleUi();
    }
  }

  /**
   * After a drawing paint (the objects laid out): C++ `CanvasWidget::computeSize`. On the first
   * paint of an opened board, `computeSize(true)` (a fixed or auto-size page smaller than the
   * view is centred, `handleFirstTimeLayout`); afterwards, whenever a finite page's size or the
   * view's changed, `computeSize(false)`: an auto-size page follows its content, which C++
   * recomputes after every add, delete, move, resize, text edit, undo, redo and remote update
   * (`LekhUtil::updateCanvas(true)` and the `computeSize(false)` calls of `Command`,
   * `Clipboard`, `CoreIO`); every such change repaints the drawing layer here. The offset is
   * re-clamped and the grid layer (the page rectangle and its border) repainted.
   */
  private syncCanvasSize(): void {
    const s = this.session;
    if (s.waitingForFonts) return;
    if (!s.isLoaded) {
      // A cloud board still connecting shows the empty placeholder page under "Loading..": C++
      // `openRemoteDoc` loads the empty document (`loadEmpty`) and the canvas places it with
      // `computeSize(true)`, again at every layout (`resetAndSetSize`), so it is centred as a
      // loaded page is (owner round UI4). The load frame's `reloaded` places the real page.
      this.view.firstTimeLayout();
      return;
    }
    if (this.firstLayoutPending_ && this.view.firstTimeLayout()) {
      this.firstLayoutPending_ = false;
      // A view change repaints every layer; the size is compared from that paint on.
      this.canvasSizeKey_ = this.canvasSizeKey();
      return;
    }
    const key = this.canvasSizeKey();
    if (key === this.canvasSizeKey_) return;
    this.canvasSizeKey_ = key;
    if (key === null) return;
    if (this.view.reclampFixed()) return;
    this.paintLayer('grid');
    this.layers.invalidate('middle');
  }

  private canvasSizeKey(): string | null {
    const page = this.session.document.activePage();
    if (this.view.isInfinite()) return null;
    const sz = page.getCanvasSize(false);
    const v = this.board.view();
    return `${page.id}|${String(sz.width)}|${String(sz.height)}|${String(v.zoom)}|${String(v.canvasW)}|${String(v.canvasH)}`;
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
    // `store_` is unset while the constructor runs.
    if (this.disposed_ || (this.store_ as UiStore | undefined) === undefined) return;
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
    const r = this.overlay.rect;
    const menuHidden = r.isMoving || r.isResizing || r.isRotating || r.isScaling || this.textEdit.active;
    let arrows: SelectionState['arrows'] = null;
    // As the Connection And Arrows item (`selection-actions.ts`): a connector, or an object with arrow points.
    const heads = isMulti(t) || !(t instanceof ConnectionObject || arrowPointCount(t) > 0) ? null : arrowsOf(t);
    if (heads !== null) {
      arrows = Object.freeze({
        type: t instanceof ConnectionObject ? t.getType() : -1,
        start: heads.start()?.id() ?? null,
        end: heads.end()?.id() ?? null,
      });
    }
    const targetRect = this.overlay.targetRect() ?? anchor;
    return { ids, kind, anchorRect: anchor, targetRect, actions, style, menuHidden, arrows };
  }

  private computeUi(prev?: BoardUiState): BoardUiState {
    const s = this.session;
    const doc = s.document;
    const v = s.view;
    const perm = s.permission;
    const sel = this.selectionState();
    const textEdit: TextEditView | null = this.textEdit.view(this.view);
    const cfg = this.board.config;
    const settings: ConfigSnapshot = {
      gridOn: doc.grid.present,
      snapToGrid: cfg.snapToGrid,
      darkMode: cfg.screenMode === 1 ? 'light' : cfg.screenMode === 2 ? 'dark' : 'system',
      onlyDrawWithPencil: cfg.onlyDrawWithPencil,
      recognizeShape: this.modes.get() === InputMode.SmartDraw,
      keepScreenOn: cfg.preventScreenToTurnOff,
      autoConnect: false,
      showRulers: false,
      screenMode: cfg.screenMode,
      recognizeConnection: cfg.recognizeConnection,
      resizeInsertedImage: cfg.resizeInsertedImage,
      shapeConnectionGap: cfg.connectionLineSeparationFromObject > 0,
      resizeShapeByZoomGesture: cfg.resizeShapeByZoomGesture,
      shouldShowInfoButton: cfg.shouldShowInfoButton,
      preventScreenToTurnOff: cfg.preventScreenToTurnOff,
      defaultFontSize: cfg.defaultFontSize,
      defaultArrowType: cfg.defaultArrowType,
      defaultConnectionType: cfg.defaultConnectionType,
      showConnectionHandles: cfg.showConnectionHandles,
      enableAirGesture: cfg.enableAirGesture,
    };
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
      pages: { ids: doc.pages.map((p) => p.id), names: doc.pages.map((p) => p.name), active: doc.activePageIndex },
      drawingStyle: styleSnapshotOf(this.board.currentStyle()),
      undo: { canUndo: s.editor.undo.canUndo(), canRedo: s.editor.undo.canRedo() },
      busy: prev?.busy ?? null,
      textEdit,
      cursor: this.cursor.get(),
      theme: this.theme(),
      env: this.env,
      settings: sameSettings(prev?.settings, settings) ? (prev?.settings ?? settings) : settings,
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

function sameSettings(a: BoardUiState['settings'] | undefined, b: BoardUiState['settings']): boolean {
  if (a === undefined) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
}

function sameUi(a: BoardUiState, b: BoardUiState): boolean {
  return (
    a.settings === b.settings &&
    a.inputMode === b.inputMode &&
    a.zoom === b.zoom &&
    a.scroll.x === b.scroll.x &&
    a.scroll.y === b.scroll.y &&
    a.cursor === b.cursor &&
    a.theme === b.theme &&
    a.undo.canUndo === b.undo.canUndo &&
    a.undo.canRedo === b.undo.canRedo &&
    a.pages.active === b.pages.active &&
    a.pages.ids.join('\u0000') === b.pages.ids.join('\u0000') &&
    a.pages.names.join('\u0000') === b.pages.names.join('\u0000') &&
    JSON.stringify(a.drawingStyle) === JSON.stringify(b.drawingStyle) &&
    a.doc.name === b.doc.name &&
    a.doc.permission === b.doc.permission &&
    JSON.stringify(a.selection) === JSON.stringify(b.selection) &&
    JSON.stringify(a.textEdit) === JSON.stringify(b.textEdit)
  );
}
