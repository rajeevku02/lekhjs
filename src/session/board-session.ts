// `BoardSession`: the only stateful root per board (spec 01 §4.2, spec 02 §14, spec 03 §12, §14).
// It holds the document, the view, the selection, the undo stack (through `edit/EditorContext`),
// the realtime session (`sync/SyncSession`), the per-session catalog overlay and image cache, and
// the host's ports. One class serves every consumer: a client attaches ports and drives it with
// events; kashi uses it headless (no transport, no UI, no dispatch) for one MCP operation.
//
// The engine API is synchronous (AC-ARC-08): nothing here is `async` or returns a promise. All
// state is per instance (no module-level mutable state), so many sessions run in one process and
// interleave only between calls.
//
// The serial event queue (spec 03 §12.2): `dispatch` queues; the first caller drains. Each event is
// handled and flushed (layout + index + repaint requests) to completion, then the outbox of
// realtime updates it raised is handed to the transport, then listeners hear about it. A `dispatch`
// from a listener or a port callback runs after the current event. The edges of spec 03 §14:
//   - `handle()` or `flush()` throws: the event's outbox is discarded (no frame), `error` is
//     emitted, a throwing command leaves the undo and redo stacks as they were, and the queue
//     goes on; objects still dirty are laid out by the next flush;
//   - a listener throws: caught per listener and logged; the rest still run;
//   - a frame for another docid, or a continuation from before a reload: dropped, debug log only;
//   - `dispose()` mid-drain: the current event finishes, the rest are dropped; later
//     `dispatch` calls are ignored (logged once).
import { isLekhError, shortIdFromUuid, type Config, type Handle, type Scheduler } from '../base';
import {
  ClipboardService,
  CollectingSink,
  EditCommands,
  EditorContext,
  MultiSelection,
  TranslateObjectAction,
  type EditTarget,
  type SelectionChange,
} from '../edit';
import type { Rect } from '../geometry';
import { LuaToJsConverter, TemplateGeneratorHost } from '../generators';
import { DocumentCodec, converterHooks, type IoEnv, type ReadResult } from '../io';
import {
  BackgroundType,
  CanvasSizeType,
  ImageRefs,
  ImageRequests,
  LekhDocument,
  isTemplated,
  settleLayout,
  type DocumentContext,
  type ImageLookup,
  type LekhObject,
  type ObjectEnv,
  type Page,
  type PaintEnv,
  type TemplatedObject,
} from '../model';
import {
  Canvas2DDrawingPlatform,
  GridPainter,
  ImageCache,
  ViewTransform,
  type DrawingPlatform,
  type ExportView,
  type GridBackground,
  type ThemeMode,
} from '../render';
import type { SemanticContext } from '../semantic';
import { Color, Style } from '../style';
import { SyncSession, type ApplyResult, type ReceiveOutcome, type ServerMessage } from '../sync';
import {
  CatalogOverlay,
  CatalogTemplateResolver,
  TemplateTextService,
  type JsonValue,
  type TemplateEnv,
  type UnknownGeneratorReason,
} from '../template';
import type { CommandContext, CommandHandler, EditCommand } from './commands';
import { SessionDiagnostics } from './diagnostics';
import { documentFontRequests } from './font-requests';
import { PaintRequests } from './paint-requests';
import type {
  AbortSignalLike,
  BoardMeta,
  BoardPermission,
  Canvas2DLike,
  LoadResult,
  PaintLayer,
  ReadonlyDoc,
  SessionEvent,
  SessionEvents,
  SessionOptions,
  TemplateJson,
  ViewState,
} from './ports';
import type { Runtime } from './runtime';
import { styleSnapshotOf } from './style-snapshot';
import type { DialogRequest, ToastRequest } from './ui';

type Listener<K extends keyof SessionEvents> = (e: SessionEvents[K]) => void;
type AnyListener = (e: never) => void;

/** Applies a recognition result (spec 07 §6.6 `MutationApplier`, registered by the host). */
export type RecognitionApplier = (
  ctx: CommandContext,
  result: Extract<SessionEvent, { type: 'recognitionResult' }>,
) => void;

/** What one event changed, collected while it runs and announced after it. */
interface Pending {
  readonly changed: Set<string>;
  readonly removed: Set<string>;
  reloaded: boolean;
  selection: boolean;
  view: boolean;
  readonly errors: SessionEvents['error'][];
  readonly dialogs: DialogRequest[];
  readonly toasts: ToastRequest[];
  reopen: boolean;
}

/** C++ `LekhGlobal::LekhGlobal`: `setFillColor(white, alpha 0)`, `setNoFill()`, `setStrokeColor(black)`. */
function defaultDrawingStyle(): Style {
  const s = new Style();
  s.setFillColor(new Color(255, 255, 255, 0));
  s.setNoFill();
  s.setStrokeColor(new Color(0, 0, 0, 0xff));
  return s;
}

function newPending(): Pending {
  return {
    changed: new Set(),
    removed: new Set(),
    reloaded: false,
    selection: false,
    view: false,
    errors: [],
    dialogs: [],
    toasts: [],
    reopen: false,
  };
}

const NO_IDS: readonly string[] = Object.freeze([]);
const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set<string>());

/** The queue's marker that ends a recognition hold (internal; never a `SessionEvent`). */
interface HoldEnd {
  readonly type: 'recognitionHoldEnd';
}
const HOLD_END: HoldEnd = Object.freeze({ type: 'recognitionHoldEnd' });
/** The queue's marker that ends the wait for a document's fonts (internal; spec 06 §5.3). */
interface FontWaitEnd {
  readonly type: 'fontWaitEnd';
  readonly token: object;
}
type QueueItem = SessionEvent | HoldEnd | FontWaitEnd;

/**
 * The commands a recognition hold queues behind the result (spec 07 §6.5): the document-mutating
 * commands a user issues directly (undo/redo, delete, paste-like duplicates, structure, keyboard
 * moves, a page switch). `select`, `view` and `custom` (the interaction layer's live edits, whose
 * undo steps are deferred instead) stay live.
 */
const HELD_COMMANDS: readonly EditCommand['kind'][] = Object.freeze<EditCommand['kind'][]>([
  'undo',
  'redo',
  'move',
  'delete',
  'duplicate',
  'group',
  'ungroup',
  'flip',
  'zOrder',
  'clear',
  'setActivePage',
]);

/** A recognition hold in progress. */
interface Hold {
  /** Events queued behind the result, in arrival order. */
  readonly held: SessionEvent[];
  /** Ids the live local edits during the hold changed (they never make a result stale). */
  readonly touched: Set<string>;
}

export class BoardSession {
  readonly runtime: Runtime;
  readonly options: SessionOptions;
  /** The per-session catalog overlay (copy-on-write over the runtime's base catalog). */
  readonly overlay: CatalogOverlay;
  readonly codec: DocumentCodec;
  readonly editor: EditorContext;
  readonly commands: EditCommands;
  readonly clipboard: ClipboardService;
  readonly sync: SyncSession;
  readonly imageCache: ImageCache;
  /** Lua → JS conversion and generator construction over the runtime's registry (spec 04 §7). */
  readonly converter: LuaToJsConverter;
  /** Unknown generators and the usage event (spec 04 §7.4). */
  readonly diagnostics: SessionDiagnostics;
  /** Text measuring for templates and the semantic layer (C++ `Platform::getTextSize`). */
  readonly text: TemplateTextService;

  private doc_: LekhDocument;
  private loaded_ = false;
  private docGeneration_ = 0;
  private view_: ViewTransform = new ViewTransform();
  private selection_: readonly string[] = NO_IDS;
  private viewState_: ViewState | null = null;

  private readonly queue_: QueueItem[] = [];
  private hold_: Hold | null = null;
  /** The wait for the adopted document's fonts (spec 06 §5.3): no layout and no drawing-layer paint until it ends. */
  private fontWait_: object | null = null;
  private draining_ = false;
  private disposed_ = false;
  private loggedAfterDispose_ = false;
  private pending_: Pending = newPending();
  /** The realtime updates the current event raised; sent only when it succeeds (spec 03 §14). */
  private readonly outbox_ = new CollectingSink();

  private readonly listeners_ = new Map<keyof SessionEvents, AnyListener[]>();
  private readonly paint_: PaintRequests;
  private readonly imageRequests_: ImageRequests;
  private readonly timers_ = new Map<string, { handle: Handle; fn: () => void }>();
  private readonly commandHandlers_ = new Map<string, CommandHandler>();
  private recognitionApplier_: RecognitionApplier | null = null;
  private readonly docHelp_ = new Map<string, string>();
  private readonly unsubscribe_: (() => void)[] = [];
  private readonly lookup_: ImageLookup;
  private permission_: BoardPermission | null = null;
  /**
   * The stored document of the last open or reload while it still holds Lua this session converted
   * in memory: what a writer's conversion frame is built from. Cleared once the frame is sent (or
   * dropped: there is no retry, spec 04 §7.3).
   */
  private pendingConversion_: { readonly raw: JsonValue; readonly skip: ReadonlySet<string> } | null = null;
  /** The placeholder toast and usage event went out for this open. */
  private placeholdersReported_ = false;
  /**
   * The session's current drawing style (C++ `LekhGlobal::currentStyle`): what the writer emits as
   * the root `style` (spec 03 §10.2). Its default is C++'s: no fill (white, alpha 0), black stroke.
   */
  readonly currentStyle: Style = defaultDrawingStyle();

  constructor(runtime: Runtime, opts: SessionOptions) {
    this.runtime = runtime;
    this.options = opts;
    const config = runtime.config;
    const text = new TemplateTextService(runtime.textLayout, runtime.fontResolver);
    this.text = text;
    this.imageCache = new ImageCache({ clock: runtime.clock, scheduler: opts.scheduler });
    this.lookup_ = { get: (url) => this.imageCache.get(url) ?? opts.images.get(url) };

    const holder: { codec: DocumentCodec | null } = { codec: null };
    const codec = (): DocumentCodec => {
      if (holder.codec === null) throw new Error('session codec not ready');
      return holder.codec;
    };
    this.converter = new LuaToJsConverter(opts.generators ?? runtime.generators);
    this.diagnostics = new SessionDiagnostics(runtime.logger);
    this.overlay = new CatalogOverlay(opts.catalog ?? runtime.catalog, {
      resolve: this.converter.resolve,
      instantiate: (def) => codec().templates.instantiate(def),
    });
    const resolver = new CatalogTemplateResolver(this.overlay, (def) => codec().embedFactory()(def));
    const logger = runtime.logger;
    const templates: TemplateEnv = {
      config,
      text,
      resolver,
      image: (key) => this.lookup_.get(key),
      generatorContext: (t) => new TemplateGeneratorHost(t, text),
      warn: (code, details) => {
        logger.warn(code, details);
      },
    };
    const objects: ObjectEnv = {
      config,
      text,
      arrowhead: (id) => {
        const def = this.overlay.arrowhead(id);
        return def === undefined ? null : codec().templates.instantiate(def);
      },
      newId: () => shortIdFromUuid(runtime.ids.next()),
    };
    const document: DocumentContext = { config, clock: runtime.clock, ids: runtime.ids };
    const env: IoEnv = {
      objects,
      templates,
      document,
      help: (id) => this.overlay.help(id) ?? this.docHelp_.get(id),
      onHelp: (id, t) => {
        if (this.overlay.help(id) === undefined && !this.docHelp_.has(id)) this.docHelp_.set(id, t);
      },
      logger,
      generators: converterHooks(this.converter),
    };
    this.codec = new DocumentCodec(env);
    holder.codec = this.codec;

    this.doc_ = new LekhDocument(document);
    this.editor = new EditorContext({ codec: this.codec, sink: this.outbox_, document: () => this.doc_ });
    this.clipboard = new ClipboardService(this.editor);
    this.commands = new EditCommands(this.editor, this.clipboard);

    this.sync = new SyncSession({
      host: {
        document: () => this.doc_,
        codec: this.codec,
        replaceDocument: (r) => {
          this.adopt(r);
        },
      },
      clock: runtime.clock,
      scheduler: opts.scheduler,
      logger,
      docid: '',
      isJsForm: this.converter.jsFormTest,
      autoReconnect: opts.autoReconnect ?? true,
      ...(opts.transport !== undefined ? { transport: opts.transport } : {}),
    });
    this.sync.attach(
      (t) => {
        this.dispatch({ type: 'remoteFrame', text: t });
      },
      (s) => {
        this.dispatch({ type: 'transportState', state: s });
      },
    );
    this.unsubscribe_.push(
      this.sync.on('syncError', (e) => {
        this.pending_.errors.push({ code: e.code, eventType: 'remoteFrame' });
      }),
      this.sync.on('serverMessage', (m) => {
        const d = dialogForMessage(m);
        if (d !== null) this.pending_.dialogs.push(d);
      }),
      this.sync.on('permission', (e) => {
        // Inside the `remoteFrame` event that carries the `load` frame: the reload that follows
        // (and its writer-only conversion frame) runs with this permission.
        this.permission_ = e.permission;
      }),
      this.sync.on('formatTooNew', () => {
        this.pending_.errors.push({ code: 'format_too_new', eventType: 'remoteFrame' });
      }),
      this.sync.on('presenceChanged', () => {
        this.requestPaint('middle');
      }),
      runtime.fonts.onFontsChanged((epoch) => {
        this.dispatch({ type: 'fontsChanged', epoch });
      }),
    );

    this.paint_ = new PaintRequests(opts.scheduler, (layer) => {
      this.emit('paintRequested', { layer });
    });
    // Inline (base64) images are scheduled by their `data:` key and decoded, not fetched.
    const images = opts.images;
    const port = {
      request: (urls: readonly string[]): void => {
        const fetched: string[] = [];
        for (const url of urls) {
          if (!url.startsWith('data:')) {
            fetched.push(url);
            continue;
          }
          images.decodeInline(url).then(
            (image) => {
              if (this.disposed_) image.close?.();
              else this.dispatch({ type: 'imageLoaded', url, image });
            },
            () => {
              if (!this.disposed_) this.dispatch({ type: 'imageFailed', url, reason: 'decode' });
            },
          );
        }
        if (fetched.length > 0) images.request(fetched);
      },
    };
    this.imageRequests_ = new ImageRequests({ cache: this.imageCache, port, scheduler: opts.scheduler });
  }

  /** A session on a new, empty board (C++ `DocManager::loadEmpty`). */
  static empty(runtime: Runtime, opts: SessionOptions): BoardSession {
    const s = new BoardSession(runtime, opts);
    s.loaded_ = true;
    return s;
  }

  // ---- headless and shared engine API (synchronous) ----

  get isLoaded(): boolean {
    return this.loaded_;
  }

  get isDisposed(): boolean {
    return this.disposed_;
  }

  /** The read-only document (React, semantic). */
  get document(): ReadonlyDoc {
    return this.doc_;
  }

  /** Bumped by every load and reload; continuations carry it (spec 03 §12.2). */
  get docGeneration(): number {
    return this.docGeneration_;
  }

  get selection(): readonly string[] {
    return this.selection_;
  }

  get config(): Config {
    return this.runtime.config;
  }

  get scheduler(): Scheduler {
    return this.options.scheduler;
  }

  /** Parses `raw` (a file's text or a stored board's JSON) into the session's document. */
  load(raw: string | object, meta?: BoardMeta): LoadResult {
    this.budgetCheck();
    let read: ReadResult;
    try {
      read = typeof raw === 'string' ? this.codec.read(raw) : this.codec.readValue(raw as JsonValue);
    } catch (err) {
      if (isLekhError(err) && err.code !== 'budget_exceeded') {
        this.runtime.logger.warn('load_failed', { code: err.code });
        return { ok: false, code: err.code, message: err.message };
      }
      throw err;
    }
    for (let i = 0; i < read.doc.pages.length; i++) this.budgetCheck();
    this.placeholdersReported_ = false;
    this.permission_ = meta?.kind === 'cloud' ? (meta.permission ?? null) : null;
    this.adopt(read);
    if (meta?.kind === 'cloud' && meta.docid !== undefined) {
      this.sync.start(meta.docid, meta.version ?? 0, read.doc.info.version);
      this.sendPendingConversion();
    }
    return { ok: true };
  }

  /** The document as `.lekh` JSON under the stamp policy (spec 03 §10.6, spec 04 §9.2). */
  serialize(opts: { stamp: 'offline' | 'cloud' }): string {
    return this.codec.serialize(this.doc_, {
      stamp: opts.stamp,
      style: this.currentStyle,
      help: (id) => this.overlay.help(id) ?? this.docHelp_.get(id),
    });
  }

  /**
   * Lays out every dirty object of every page, or of one (replaces the C++ projector's settle
   * draw): routes, label centres and anchors exist afterwards, and `serialize` is unchanged
   * (AC-BE-08, `settleLayout`).
   */
  layoutAll(pageId?: string): void {
    for (const p of this.doc_.pages) {
      if (pageId !== undefined && p.id !== pageId) continue;
      this.budgetCheck();
      settleLayout(p.objectStore);
    }
  }

  /** An object's laid-out visual bounds (nested group members included), or null. */
  visualBounds(pageId: string, nodeId: string): Rect | null {
    const page = this.doc_.getPage(pageId);
    const obj = page?.objectStore.getObject(nodeId, true) ?? null;
    if (page === null || obj === null) return null;
    settleLayout(page.objectStore);
    return obj.visualBounds();
  }

  /**
   * The engine's single export draw (C++ `LekhCore::drawForExporting`, spec 08 §4): lays out the
   * page, then paints every object of `pageIndex` (no culling, no margin box, zoom 1) through
   * `view`, applied by the platform's `applyExportView` (or `translate` at scale 1) inside a
   * save/restore pair. The visible viewport and the selection are untouched: selection handles
   * are the interaction overlay's, never part of a page paint. The page background is the
   * exporter's (the JPEG fill, the SVG root style), as every C++ host's `setBackground` was a
   * no-op; `includeBackground` is accepted for the C++ signature.
   */
  drawForExport(platform: DrawingPlatform, pageIndex: number, _includeBackground: boolean, view: ExportView): void {
    this.budgetCheck();
    const page = this.doc_.pages[pageIndex];
    if (page === undefined) return;
    settleLayout(page.objectStore);
    const env: PaintEnv = { config: this.runtime.config, zoom: 1, forExport: true, images: this.lookup_ };
    platform.saveContext();
    if (platform.applyExportView !== undefined) platform.applyExportView(view);
    else if (view.tx !== 0 || view.ty !== 0) platform.translate(view.tx, view.ty);
    try {
      page.paint(platform, { env });
    } finally {
      platform.restoreContext();
    }
  }

  /** Whether the session's image cache or its image port holds `url` decoded (export, spec 08 §4). */
  hasImage(url: string): boolean {
    return this.imageCache.has(url) || this.options.images.get(url) !== undefined;
  }

  /**
   * What the semantic layer (`project`, `compile`, `generate`, `lint`) and `paintPage` read from
   * this session: the document, the codec, the overlay (C++ `TemplateStore`), text measurement, ids
   * and the budget (spec 10 §3). A new object per call; it holds the document current at the call.
   */
  semanticContext(): SemanticContext {
    const runtime = this.runtime;
    return Object.freeze({
      doc: this.doc_,
      codec: this.codec,
      catalog: this.overlay,
      arrows: this.overlay,
      text: this.text,
      config: runtime.config,
      logger: runtime.logger,
      images: this.lookup_,
      newContentFont: this.options.newContentFont !== false,
      newId: () => shortIdFromUuid(runtime.ids.next()),
      budgetCheck: () => {
        this.budgetCheck();
      },
      layoutAll: (pageId?: string) => {
        this.layoutAll(pageId);
      },
    });
  }

  /** Adds template bodies to this session's overlay (copy-on-write; the runtime's base is untouched). */
  addTemplates(bodies: readonly TemplateJson[]): void {
    for (const b of bodies) this.overlay.addTemplate(b);
  }

  /** Image URLs the document references that neither the image port nor the cache holds. */
  missingResources(): readonly string[] {
    return ImageRefs.document(this.doc_).filter((url) => this.lookup_.get(url) === undefined);
  }

  /** The current view. */
  get view(): ViewState {
    this.viewState_ ??= Object.freeze({
      zoom: this.view_.zoom,
      tx: this.view_.scrollX,
      ty: this.view_.scrollY,
      activePageId: this.doc_.activePage().id,
      canvasW: this.view_.canvasW,
      canvasH: this.view_.canvasH,
      dpr: this.view_.dpr,
      style: styleSnapshotOf(this.doc_.style),
    });
    return this.viewState_;
  }

  /** The view as a transform (culling, hit testing, the interaction layer). */
  get viewTransform(): ViewTransform {
    return this.view_;
  }

  /**
   * Paints one layer of the active page onto `ctx`: `grid` (background and grid, screen space),
   * `drawing` (the objects, culled to the view) or `middle` (cleared; the interaction layer draws
   * the overlay). Lays out what is dirty first; never fetches an image.
   *
   * A fixed-size (or auto-size) page is drawn as C++ draws it (`CanvasWidget::computeSize`, which
   * moves and sizes the grid and drawing canvases): the page rectangle only, with its 2 px
   * separator-coloured border, and the drawing clipped to it. Outside the page the grid layer is
   * left transparent, so the board's surround shows (the web's `#drawContent` grey, black in dark
   * mode). `opts.theme` picks the border colour (C++ `system_opaq_separator_color`).
   */
  paint(layer: PaintLayer, ctx: Canvas2DLike, opts: { readonly theme?: ThemeMode } = {}): void {
    this.budgetCheck();
    const page = this.doc_.activePage();
    const view = this.view_;
    // Waiting for the document's fonts: nothing is laid out yet, so the objects are not drawn.
    if (layer === 'drawing' && this.fontWait_ !== null) {
      view.applyScreen(ctx);
      ctx.clearRect(0, 0, view.canvasW, view.canvasH);
      return;
    }
    if (layer === 'middle') {
      view.applyScreen(ctx);
      ctx.clearRect(0, 0, view.canvasW, view.canvasH);
      return;
    }
    const dp = new Canvas2DDrawingPlatform(ctx, { textPainter: this.runtime.textPainter });
    const fixed = page.canvasSizeType === CanvasSizeType.Infinite ? null : fixedPageRect(page, view);
    if (layer === 'grid') {
      view.applyScreen(ctx);
      const input = {
        background: gridBackgroundOf(page),
        gridPresent: this.doc_.grid.present,
        gridWidth: this.doc_.gridWidth(true).points(),
        zoom: view.zoom,
        ...(opts.theme !== undefined ? { theme: opts.theme } : {}),
      };
      if (fixed === null) {
        new GridPainter().paint(dp, {
          ...input,
          scrollX: view.scrollX,
          scrollY: view.scrollY,
          width: view.canvasW,
          height: view.canvasH,
          infiniteCanvas: true,
        });
        return;
      }
      ctx.clearRect(0, 0, view.canvasW, view.canvasH);
      if (fixed.width <= 0 || fixed.height <= 0) return;
      ctx.save();
      ctx.translate(fixed.x, fixed.y);
      // The C++ grid canvas is the page: its border stroke is half outside, so clipped.
      ctx.beginPath();
      ctx.rect(0, 0, fixed.width, fixed.height);
      ctx.clip();
      new GridPainter().paint(dp, {
        ...input,
        scrollX: fixed.scrollX,
        scrollY: fixed.scrollY,
        width: fixed.width,
        height: fixed.height,
        infiniteCanvas: false,
      });
      ctx.restore();
      return;
    }
    if (fixed !== null) {
      view.applyScreen(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fixed.x, fixed.y, Math.max(0, fixed.width), Math.max(0, fixed.height));
      ctx.clip();
    }
    dp.setView(view);
    const env: PaintEnv = { config: this.runtime.config, zoom: view.zoom, forExport: false, images: this.lookup_ };
    page.paint(dp, { env, view });
    if (fixed !== null) ctx.restore();
  }

  // ---- client API ----

  /** Queues `event`; the first caller drains the queue (spec 03 §12.2). Never throws. */
  dispatch(event: SessionEvent): void {
    if (this.disposed_) {
      if (!this.loggedAfterDispose_) {
        this.loggedAfterDispose_ = true;
        this.runtime.logger.debug('dispatch_after_dispose', { type: event.type });
      }
      return;
    }
    this.enqueue(event);
  }

  private enqueue(event: QueueItem): void {
    this.queue_.push(event);
    if (this.draining_) return;
    this.draining_ = true;
    try {
      for (let ev = this.queue_.shift(); ev !== undefined; ev = this.queue_.shift()) {
        if (ev.type === 'recognitionHoldEnd') {
          this.releaseHold();
          continue;
        }
        if (ev.type === 'fontWaitEnd') {
          this.endFontWait(ev.token);
          continue;
        }
        if (this.hold_ !== null && this.isHeld(ev)) {
          this.hold_.held.push(ev);
          continue;
        }
        this.runOne(ev);
        // `dispose()` from inside the event: the rest of the queue is dropped.
        if (this.isDisposed) {
          this.queue_.length = 0;
          break;
        }
        this.notifyListeners();
      }
    } finally {
      this.draining_ = false;
    }
  }

  /** The session's permission on a cloud board (`null` offline or when the host gave none). */
  get permission(): BoardPermission | null {
    return this.permission_;
  }

  /** Subscribes to a notification; `signal` (an `AbortSignal`) unsubscribes. */
  on<K extends keyof SessionEvents>(k: K, fn: Listener<K>, signal?: AbortSignalLike): void {
    if (this.disposed_ || signal?.aborted === true) return;
    const list = this.listeners_.get(k) ?? [];
    list.push(fn);
    this.listeners_.set(k, list);
    signal?.addEventListener(
      'abort',
      () => {
        const l = this.listeners_.get(k);
        if (l !== undefined) {
          this.listeners_.set(
            k,
            l.filter((f) => f !== (fn as AnyListener)),
          );
        }
      },
      { once: true },
    );
  }

  /** Registers the handler of `{ kind: 'custom', name }` commands. */
  registerCommand(name: string, handler: CommandHandler): void {
    this.commandHandlers_.set(name, handler);
  }

  /** Registers the applier of `recognitionResult` events (`recognizer/client`, spec 07 §6.6). */
  setRecognitionApplier(applier: RecognitionApplier | null): void {
    this.recognitionApplier_ = applier;
  }

  // ---- the recognition hold (spec 07 §6.5) ----

  /**
   * Starts holding for a recognition job: remote frames and the document-mutating commands of
   * `HELD_COMMANDS` are queued in arrival order until `endRecognitionHold`; pan, zoom, selection
   * and the interaction layer's live edits stay live, and the undo steps those edits add are put
   * on top of the result's when the hold ends. Idempotent.
   */
  beginRecognitionHold(): void {
    if (this.hold_ !== null || this.disposed_) return;
    this.hold_ = { held: [], touched: new Set() };
    this.editor.undo.beginDefer();
  }

  /**
   * Ends the hold after whatever is queued now (the result's event): the deferred undo steps go on
   * top, then the held events run, in arrival order, before anything queued later.
   */
  endRecognitionHold(): void {
    if (this.hold_ === null || this.disposed_) return;
    this.enqueue(HOLD_END);
  }

  /** Whether a recognition hold is in progress. */
  get recognitionHeld(): boolean {
    return this.hold_ !== null;
  }

  /** Ids that live local edits changed during the current hold (empty when none). */
  holdTouched(): ReadonlySet<string> {
    return this.hold_?.touched ?? EMPTY_SET;
  }

  private isHeld(ev: SessionEvent): boolean {
    if (ev.type === 'remoteFrame') return true;
    return ev.type === 'command' && HELD_COMMANDS.includes(ev.command.kind);
  }

  private releaseHold(): void {
    const hold = this.hold_;
    if (hold === null) return;
    this.hold_ = null;
    this.editor.undo.endDefer();
    this.queue_.unshift(...hold.held);
  }

  /**
   * Starts (or restarts) a session timer: after `ms` a `timer` event with `token` is dispatched,
   * and `fn` runs as that event. `dispose()` cancels every timer.
   */
  setTimer(token: string, ms: number, fn: () => void): void {
    this.clearTimer(token);
    if (this.disposed_) return;
    const handle = this.options.scheduler.setTimeout(() => {
      this.dispatch({ type: 'timer', token });
    }, ms);
    this.timers_.set(token, { handle, fn });
  }

  clearTimer(token: string): void {
    const t = this.timers_.get(token);
    if (t === undefined) return;
    this.options.scheduler.clearTimeout(t.handle);
    this.timers_.delete(token);
  }

  /** Session timers not yet fired. */
  get pendingTimers(): number {
    return this.timers_.size;
  }

  /** Asks for a repaint of `layer` at the next frame (coalesced). */
  requestPaint(layer: PaintLayer): void {
    this.paint_.request(layer);
  }

  /**
   * Cancels timers and frame requests, releases images and the transport subscription and drops
   * every listener. Mid-drain, the current event finishes and the queued ones are dropped.
   * Idempotent.
   */
  dispose(): void {
    if (this.disposed_) return;
    this.disposed_ = true;
    this.queue_.length = 0;
    this.hold_ = null;
    this.fontWait_ = null;
    for (const t of this.timers_.values()) this.options.scheduler.clearTimeout(t.handle);
    this.timers_.clear();
    this.paint_.dispose();
    this.imageRequests_.dispose();
    this.imageCache.dispose();
    for (const u of this.unsubscribe_) u();
    this.unsubscribe_.length = 0;
    this.sync.dispose();
    this.listeners_.clear();
    this.diagnostics.clear();
    this.pendingConversion_ = null;
    this.commandHandlers_.clear();
    this.recognitionApplier_ = null;
    this.outbox_.clear();
  }

  // ---- the queue ----

  private runOne(ev: SessionEvent): void {
    const isEdit = ev.type === 'command' || ev.type === 'recognitionResult';
    const checkpoint = isEdit ? this.editor.undo.checkpoint() : null;
    const before = isEdit ? this.topLevelIds() : null;
    this.outbox_.clear();
    try {
      this.handle(ev);
      if (before !== null) this.collectEditChanges(before);
      if (this.hold_ !== null && ev.type === 'command') {
        for (const id of this.pending_.changed) this.hold_.touched.add(id);
      }
      this.flush();
      this.sendOutbox();
    } catch (err) {
      this.outbox_.clear();
      if (checkpoint !== null) this.editor.undo.restore(checkpoint);
      this.reportError(ev, err);
    }
  }

  private handle(ev: SessionEvent): void {
    switch (ev.type) {
      case 'open':
        this.onOpen(ev.raw, ev.meta);
        return;
      case 'remoteFrame':
        this.onFrame(this.sync.receive(ev.text));
        return;
      case 'transportState': {
        const d = this.sync.onTransportState(ev.state);
        if (d?.kind === 'dialog') this.pending_.dialogs.push(d.dialog);
        else if (d?.kind === 'reopen') this.pending_.reopen = true;
        return;
      }
      case 'hostLifecycle': {
        const d = this.sync.onHostLifecycle(ev.state);
        if (d?.kind === 'dialog') this.pending_.dialogs.push(d.dialog);
        else if (d?.kind === 'reopen') this.pending_.reopen = true;
        return;
      }
      case 'connect':
        // A cloud board opened from its socket: no content yet, no permission until the `load`
        // frame says (C++ `openRemoteDoc` before `loadDoc`).
        this.permission_ = null;
        this.sync.start(ev.docid, ev.version ?? 0);
        return;
      case 'permissionChanged':
        this.permission_ = ev.permission;
        // Raised to write: the conversion frame a writer sends on open, once (AC-FMT-24).
        this.sendPendingConversion();
        return;
      case 'imageLoaded':
        this.imageCache.put(ev.url, ev.image);
        this.requestPaint('drawing');
        return;
      case 'imageFailed':
        this.imageCache.fail(ev.url, ev.reason);
        return;
      case 'stencilLoaded':
        this.addTemplates(ev.bodies);
        return;
      case 'fontsChanged':
        for (const p of this.doc_.pages) p.objectStore.markAllDirty();
        this.requestPaint('drawing');
        return;
      case 'timer': {
        const t = this.timers_.get(ev.token);
        if (t === undefined) return;
        this.timers_.delete(ev.token);
        t.fn();
        return;
      }
      case 'recognitionResult':
        if (ev.docGeneration !== this.docGeneration_) {
          this.runtime.logger.debug('stale_continuation', { type: ev.type });
          return;
        }
        this.editor.undo.undeferred(() => {
          this.recognitionApplier_?.(this.commandContext(NO_IDS), ev);
        });
        return;
      case 'command':
        if (ev.docGeneration !== undefined && ev.docGeneration !== this.docGeneration_) {
          this.runtime.logger.debug('stale_continuation', { type: ev.type });
          return;
        }
        this.runCommand(ev.command);
        return;
    }
  }

  /** Layout of everything dirty, the index re-keyed (inside `flushLayout`), repaint requests. */
  private flush(): void {
    let laidOut = 0;
    for (const p of this.fontWait_ === null ? this.doc_.pages : []) {
      this.budgetCheck();
      laidOut += p.objectStore.flushLayout();
    }
    const pd = this.pending_;
    if (laidOut > 0 || pd.changed.size > 0 || pd.removed.size > 0 || pd.reloaded) this.requestPaint('drawing');
    if (pd.view || pd.reloaded) this.requestPaint('grid');
    if (pd.selection) this.requestPaint('middle');
  }

  private sendOutbox(): void {
    const updates = this.outbox_.updates.slice();
    this.outbox_.clear();
    for (const u of updates) this.sync.raise(u);
  }

  private reportError(ev: SessionEvent, err: unknown): void {
    const code = isLekhError(err) ? err.code : 'internal_error';
    const name = err instanceof Error ? err.name : typeof err;
    this.runtime.logger.error('engine_error', { code, eventType: ev.type, name });
    this.pending_.errors.push({ code, eventType: ev.type });
  }

  /** Announces what the event did; each listener call has its own `try` (spec 03 §14). */
  private notifyListeners(): void {
    const pd = this.pending_;
    this.pending_ = newPending();
    for (const e of pd.errors) this.emit('error', e);
    if (pd.reloaded || pd.changed.size > 0 || pd.removed.size > 0) {
      const removed = [...pd.removed];
      const changed = [...pd.changed].filter((id) => !pd.removed.has(id));
      this.emit('documentChanged', {
        changedIds: changed,
        removedIds: removed,
        reloaded: pd.reloaded,
        docGeneration: this.docGeneration_,
      });
    }
    if (pd.selection) this.emit('selectionChanged', { ids: this.selection_ });
    if (pd.view) this.emit('viewChanged', this.view);
    for (const d of pd.dialogs) this.emit('dialog', d);
    for (const t of pd.toasts) this.emit('toast', t);
    if (pd.reopen) this.emit('reopenRequested', { reason: 'auto_reconnect' });
  }

  private emit<K extends keyof SessionEvents>(k: K, e: SessionEvents[K]): void {
    const list = this.listeners_.get(k);
    if (list === undefined) return;
    for (const fn of list.slice()) {
      try {
        (fn as Listener<K>)(e);
      } catch (err) {
        this.runtime.logger.error('listener_error', {
          notification: k,
          name: err instanceof Error ? err.name : typeof err,
        });
      }
    }
  }

  // ---- event handlers ----

  private onOpen(raw: string | object, meta: BoardMeta): void {
    const r = this.load(raw, meta);
    if (!r.ok) {
      this.pending_.errors.push({ code: r.code, eventType: 'open' });
      this.pending_.dialogs.push({ kind: 'error', title: '', message: r.message });
    }
  }

  private onFrame(outcome: ReceiveOutcome): void {
    if (outcome.kind !== 'applied') return;
    const result: ApplyResult = outcome.result;
    if (result.reloaded) {
      // `adopt` recorded it; a reload is an open of the stored board.
      this.sendPendingConversion();
      return;
    }
    if (result.convertedLua && this.permission_ === 'write') {
      // An old peer's frame brought Lua (it raced the gate): a writer converts those objects.
      this.sync.sendFrames(this.sync.framesOf(this.sync.conversionEntriesFor(result.changedIds)));
    }
    const pd = this.pending_;
    for (const id of result.changedIds) pd.changed.add(id);
    for (const id of result.removedIds) pd.removed.add(id);
    if (result.backgroundChanged || result.pagesChanged) pd.view = true;
    if (result.removedIds.length > 0 && this.selection_.some((id) => result.removedIds.includes(id))) {
      this.setSelection(this.selection_.filter((id) => !result.removedIds.includes(id)));
    }
    const objs: LekhObject[] = [];
    for (const id of result.changedIds) {
      for (const p of this.doc_.pages) {
        const o = p.objectStore.getObject(id);
        if (o !== null) objs.push(o);
      }
    }
    this.imageRequests_.scheduleFor(objs);
    this.reportPlaceholders(objs);
  }

  /** A read document becomes the session's: a load, an `open`, a `load` frame (reload). */
  private adopt(read: ReadResult): void {
    this.doc_ = read.doc;
    this.loaded_ = true;
    this.docGeneration_++;
    for (const [id, t] of read.help) {
      if (this.overlay.help(id) === undefined && !this.docHelp_.has(id)) this.docHelp_.set(id, t);
    }
    this.editor.undo.reset();
    this.selection_ = NO_IDS;
    this.viewState_ = null;
    for (const p of this.doc_.pages) p.objectStore.markAllDirty();
    this.imageRequests_.schedule([...ImageRefs.document(this.doc_), ...ImageRefs.documentInline(this.doc_)]);
    // Conversion is in memory: the document is not dirty, and only a writer's conversion frame
    // (or the next save) persists it (spec 04 §7.3).
    this.pendingConversion_ =
      read.convertedLua && read.source !== null ? { raw: read.source, skip: new Set(read.recoveredPages) } : null;
    const pd = this.pending_;
    pd.reloaded = true;
    pd.selection = true;
    pd.view = true;
    this.reportPlaceholders(this.doc_.pages.flatMap((p) => p.objectStore.objects));
    this.startFontWait();
  }

  // ---- fonts before the first layout (spec 06 §5.3) ----

  /** Whether the session is waiting for the adopted document's fonts (nothing laid out or drawn yet). */
  get waitingForFonts(): boolean {
    return this.fontWait_ !== null;
  }

  /**
   * A loader that asks for it (`waitBeforeLayout`, the browser) gets the document's fonts to load
   * before the first layout; the loader bounds the wait (one shared 3 s deadline). Elsewhere
   * layout never waits and the engine API stays synchronous.
   */
  private startFontWait(): void {
    const loader = this.runtime.fontLoader;
    if (loader.waitBeforeLayout !== true) {
      this.fontWait_ = null;
      return;
    }
    const { requests, sampleText } = documentFontRequests(this.doc_, this.runtime.fontResolver);
    const token = {};
    this.fontWait_ = token;
    const end = (): void => {
      if (!this.disposed_ && this.fontWait_ === token) this.enqueue({ type: 'fontWaitEnd', token });
    };
    let p: Promise<void>;
    try {
      p = loader.ensureLoaded(requests, sampleText);
    } catch {
      p = Promise.resolve();
    }
    p.then(end, end);
  }

  private endFontWait(token: object): void {
    if (this.fontWait_ !== token || this.disposed_) return;
    this.fontWait_ = null;
    for (const p of this.doc_.pages) p.objectStore.markAllDirty();
    try {
      this.flush();
    } catch (err) {
      this.reportError({ type: 'fontsChanged', epoch: this.runtime.fonts.fontEpoch }, err);
    }
    this.requestPaint('drawing');
    this.notifyListeners();
  }

  // ---- generators (spec 04 §7.3, §7.4) ----

  /**
   * A writer sends the conversion frame for the Lua it converted on open, once: when the open or
   * reload finished, or when its permission was raised to `write` while the converted templates
   * are still held. A chunk the transport does not take is not retried (AC-FMT-25).
   */
  private sendPendingConversion(): void {
    const pc = this.pendingConversion_;
    if (pc === null || this.permission_ !== 'write' || this.sync.docid === '') return;
    this.pendingConversion_ = null;
    const sent = this.sync.sendConversion(pc.raw, pc.skip);
    this.runtime.logger.debug('conversion_sent', { chunks: sent });
  }

  /**
   * Reports the placeholders among `objs` (group members included): one `unknown_generator`
   * diagnostic each, and, the first time in this open that any exists, the toast and the
   * `unknown_generator_seen` usage event (counts and reasons only).
   */
  private reportPlaceholders(objs: readonly LekhObject[]): void {
    const found: { templateId: string; objectId: string; reason: UnknownGeneratorReason }[] = [];
    const visit = (o: LekhObject): void => {
      if (isTemplated(o)) {
        const t = (o as TemplatedObject).shapeTemplate();
        const p = t?.generator?.preserved() ?? null;
        if (t !== null && p !== null) found.push({ templateId: t.templateId, objectId: o.id, reason: p.reason });
      }
      for (const m of o.members()) visit(m);
    };
    for (const o of objs) visit(o);
    if (found.length === 0) return;
    for (const f of found) {
      this.runtime.logger.warn('unknown_generator', { templateId: f.templateId, reason: f.reason });
      this.diagnostics.emit('unknown_generator', f);
    }
    if (this.placeholdersReported_) return;
    this.placeholdersReported_ = true;
    this.pending_.toasts.push({
      kind: 'warn',
      message: "Some shapes on this board can't be shown by this version of Lekh. They are kept unchanged.",
    });
    const reasons = [...new Set(found.map((f) => f.reason))].sort();
    this.diagnostics.emit('usage', { name: 'unknown_generator_seen', count: found.length, reasons });
  }

  // ---- commands ----

  private runCommand(cmd: EditCommand): void {
    const c = this.commands;
    switch (cmd.kind) {
      case 'undo':
      case 'redo': {
        // Undoing a page action (add, delete, rename, reorder, duplicate) changes no object, so
        // nothing else would tell the view: announce it as a view change, as a remote page change
        // is (`pagesChanged`), so the page list and the pages button follow.
        const pages = this.pageSignature();
        this.applySelection(cmd.kind === 'undo' ? c.undo() : c.redo());
        if (this.pageSignature() !== pages) this.markView();
        return;
      }
      case 'select':
        this.setSelection(this.resolve(cmd.ids).map((o) => o.id));
        return;
      case 'move': {
        const objs = this.resolve(cmd.ids);
        if (objs.length === 0) return;
        this.editor.tx.run(new TranslateObjectAction(this.editor.env, this.doc_, objs, cmd.dx, cmd.dy));
        return;
      }
      case 'delete':
        this.applySelection(c.del(this.target(cmd.ids)));
        return;
      case 'duplicate':
        this.applySelection(c.duplicate(this.target(cmd.ids)));
        return;
      case 'group':
        this.applySelection(c.group(this.target(cmd.ids)));
        return;
      case 'ungroup':
        this.applySelection(c.ungroup(this.target(cmd.ids)));
        return;
      case 'flip':
        this.applySelection(c.flip(this.target(cmd.ids), cmd.direction));
        return;
      case 'zOrder':
        c.changeZOrder(this.target(cmd.ids), cmd.front ? 1 : 0);
        return;
      case 'clear':
        this.applySelection(c.clear());
        return;
      case 'setActivePage': {
        const page = this.doc_.getPage(cmd.pageId);
        if (page === null) return;
        if (this.doc_.setActivePageIndex(this.doc_.getPageIndex(page))) {
          this.setSelection(NO_IDS);
          this.markView();
        }
        return;
      }
      case 'view': {
        this.view_ = this.view_.with({
          ...(cmd.zoom !== undefined ? { zoom: cmd.zoom } : {}),
          ...(cmd.tx !== undefined ? { scrollX: cmd.tx } : {}),
          ...(cmd.ty !== undefined ? { scrollY: cmd.ty } : {}),
          ...(cmd.canvasW !== undefined ? { canvasW: cmd.canvasW } : {}),
          ...(cmd.canvasH !== undefined ? { canvasH: cmd.canvasH } : {}),
          ...(cmd.dpr !== undefined ? { dpr: cmd.dpr } : {}),
        });
        this.markView();
        this.requestPaint('drawing');
        return;
      }
      case 'custom': {
        const h = this.commandHandlers_.get(cmd.name);
        if (h === undefined) {
          this.runtime.logger.warn('unknown_command', { name: cmd.name });
          return;
        }
        h(this.commandContext(cmd.ids ?? NO_IDS), cmd.arg);
        return;
      }
    }
  }

  private commandContext(ids: readonly string[]): CommandContext {
    return {
      doc: this.doc_,
      page: this.doc_.activePage(),
      editor: this.editor,
      commands: this.commands,
      clipboard: this.clipboard,
      objects: this.resolve(ids),
      select: (next) => {
        this.setSelection(this.resolve(next).map((o) => o.id));
      },
    };
  }

  /** `ids` on the active page that still exist, in the order given (spec 03 §12.2). */
  private resolve(ids: readonly string[]): LekhObject[] {
    const store = this.doc_.activePage().objectStore;
    const out: LekhObject[] = [];
    for (const id of ids) {
      const o = store.getObject(id);
      if (o !== null) out.push(o);
    }
    return out;
  }

  /** One object, or a multi-selection, or null when none of `ids` exists. */
  private target(ids: readonly string[]): EditTarget | null {
    const objs = this.resolve(ids);
    if (objs.length === 0) return null;
    if (objs.length === 1) return objs[0] as LekhObject;
    return new MultiSelection(objs);
  }

  private applySelection(change: SelectionChange): void {
    if (change === undefined) return;
    if (change === null) this.setSelection(NO_IDS);
    else if (change instanceof MultiSelection) this.setSelection(change.objects.map((o) => o.id));
    else this.setSelection([change.id]);
  }

  private setSelection(ids: readonly string[]): void {
    const same = ids.length === this.selection_.length && ids.every((id, i) => this.selection_[i] === id);
    if (same) return;
    this.selection_ = Object.freeze(ids.slice());
    this.pending_.selection = true;
  }

  /** The pages as the UI shows them: ids, names and orders in order, and the active index. */
  private pageSignature(): string {
    const d = this.doc_;
    return `${String(d.activePageIndex)}|${d.pages.map((p) => `${p.id}:${String(p.order)}:${p.name}`).join('\n')}`;
  }

  private markView(): void {
    this.viewState_ = null;
    this.pending_.view = true;
  }

  // ---- change tracking ----

  private topLevelIds(): Set<string> {
    const ids = new Set<string>();
    for (const p of this.doc_.pages) for (const o of p.objectStore.objects) ids.add(o.id);
    return ids;
  }

  /**
   * After an edit: the ids that appeared or went away, and every top-level object that is now
   * waiting for layout (what the edit touched). New objects' images are requested.
   */
  private collectEditChanges(before: ReadonlySet<string>): void {
    const pd = this.pending_;
    const after = new Set<string>();
    const added: LekhObject[] = [];
    for (const p of this.doc_.pages) {
      for (const o of p.objectStore.objects) {
        after.add(o.id);
        if (!before.has(o.id)) {
          pd.changed.add(o.id);
          added.push(o);
        } else if (o.layoutState.dirty || p.objectStore.tracker.isPending(o)) {
          pd.changed.add(o.id);
        }
      }
    }
    for (const id of before) if (!after.has(id)) pd.removed.add(id);
    if (pd.removed.size > 0 && this.selection_.some((id) => pd.removed.has(id))) {
      this.setSelection(this.selection_.filter((id) => !pd.removed.has(id)));
    }
    if (added.length > 0) this.imageRequests_.scheduleFor(added);
  }

  private budgetCheck(): void {
    this.options.budget?.check();
  }
}

/** C++ `MinSizeDP`: a fixed canvas is never drawn smaller than this. */
const MIN_PAGE_SIZE_DP = 20;

/**
 * The visible part of a fixed (or auto) size page in screen px, and the grid's scroll, as C++
 * `CanvasWidget::computeSize` places the grid and drawing canvases: at the page's offset (the TS
 * scroll times the zoom) clamped to 0, its size cut by a negative offset and by the view's right
 * and bottom edges, and a negative offset turned into the grid scroll.
 */
function fixedPageRect(
  page: Page,
  view: ViewTransform,
): { x: number; y: number; width: number; height: number; scrollX: number; scrollY: number } {
  const zoom = view.zoom;
  const size = page.getCanvasSize(false);
  const cw = Math.max(MIN_PAGE_SIZE_DP, size.width * zoom);
  const ch = Math.max(MIN_PAGE_SIZE_DP, size.height * zoom);
  const ox = view.scrollX * zoom;
  const oy = view.scrollY * zoom;
  const x = Math.max(0, ox);
  const y = Math.max(0, oy);
  let width = cw + Math.min(0, ox);
  let height = ch + Math.min(0, oy);
  if (x + width > view.canvasW) width = view.canvasW - x;
  if (y + height > view.canvasH) height = view.canvasH - y;
  return { x, y, width, height, scrollX: Math.min(0, ox) / zoom, scrollY: Math.min(0, oy) / zoom };
}

function gridBackgroundOf(page: Page): GridBackground {
  const bg = page.background;
  if (bg.type === BackgroundType.Color) return { type: 'color', color: bg.color };
  if (bg.type === BackgroundType.Image) return { type: 'image' };
  return { type: 'default' };
}

/**
 * The dialog of a server `message` frame (C++ `CoreIO::readBackendMessage` /
 * `processBackendMessage`; KB websocket-protocol §6.2-§6.3): nothing for an empty text;
 * `upgrade: true` → the "Read-only board" paywall (Upgrade / Keep viewing, trigger
 * `readonly_open`); `reload: true` → Reload (the format gate's code keeps its own dialog, spec
 * 04 §10.1); otherwise the text with OK.
 */
export function dialogForMessage(m: ServerMessage): DialogRequest | null {
  if (m.code === 'board_requires_newer_app') {
    return { kind: 'gate', code: 'board_requires_newer_app', message: m.message, reload: true };
  }
  if (m.message === '') return null;
  if (m.upgrade) {
    return {
      kind: 'paywall',
      trigger: 'readonly_open',
      title: 'Read-only board',
      message: m.message,
      dismiss: 'Keep viewing',
    };
  }
  if (m.reload) return { kind: 'reload', message: m.message };
  return { kind: 'info', title: '', message: m.message };
}
