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
  type DocumentContext,
  type ImageLookup,
  type LekhObject,
  type ObjectEnv,
  type Page,
  type PaintEnv,
  type TemplatedObject,
} from '../model';
import { Canvas2DDrawingPlatform, GridPainter, ImageCache, ViewTransform, type GridBackground } from '../render';
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

  private doc_: LekhDocument;
  private loaded_ = false;
  private docGeneration_ = 0;
  private view_: ViewTransform = new ViewTransform();
  private selection_: readonly string[] = NO_IDS;
  private viewState_: ViewState | null = null;

  private readonly queue_: SessionEvent[] = [];
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
    this.imageCache = new ImageCache({ clock: runtime.clock, scheduler: opts.scheduler });
    this.lookup_ = { get: (url) => this.imageCache.get(url) ?? opts.images.get(url) };

    const holder: { codec: DocumentCodec | null } = { codec: null };
    const codec = (): DocumentCodec => {
      if (holder.codec === null) throw new Error('session codec not ready');
      return holder.codec;
    };
    this.converter = new LuaToJsConverter(runtime.generators);
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
        this.pending_.dialogs.push(dialogForMessage(m));
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
    this.imageRequests_ = new ImageRequests({ cache: this.imageCache, port: opts.images, scheduler: opts.scheduler });
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

  /** Lays out every dirty object of every page, or of one (replaces the projector's settle draw). */
  layoutAll(pageId?: string): void {
    for (const p of this.doc_.pages) {
      if (pageId !== undefined && p.id !== pageId) continue;
      this.budgetCheck();
      p.objectStore.flushLayout();
    }
  }

  /** An object's laid-out visual bounds (nested group members included), or null. */
  visualBounds(pageId: string, nodeId: string): Rect | null {
    const page = this.doc_.getPage(pageId);
    const obj = page?.objectStore.getObject(nodeId, true) ?? null;
    if (page === null || obj === null) return null;
    page.objectStore.flushLayout();
    page.objectStore.ensureLayout(obj);
    return obj.visualBounds();
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
   */
  paint(layer: PaintLayer, ctx: Canvas2DLike): void {
    this.budgetCheck();
    const page = this.doc_.activePage();
    const view = this.view_;
    if (layer === 'middle') {
      view.applyScreen(ctx);
      ctx.clearRect(0, 0, view.canvasW, view.canvasH);
      return;
    }
    const dp = new Canvas2DDrawingPlatform(ctx, { textPainter: this.runtime.textPainter });
    if (layer === 'grid') {
      view.applyScreen(ctx);
      new GridPainter().paint(dp, {
        background: gridBackgroundOf(page),
        gridPresent: this.doc_.grid.present,
        gridWidth: this.doc_.gridWidth(true).points(),
        zoom: view.zoom,
        scrollX: view.scrollX,
        scrollY: view.scrollY,
        width: view.canvasW,
        height: view.canvasH,
        infiniteCanvas: page.canvasSizeType === CanvasSizeType.Infinite,
      });
      return;
    }
    dp.setView(view);
    const env: PaintEnv = { config: this.runtime.config, zoom: view.zoom, forExport: false, images: this.lookup_ };
    page.paint(dp, { env, view });
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
    this.queue_.push(event);
    if (this.draining_) return;
    this.draining_ = true;
    try {
      for (let ev = this.queue_.shift(); ev !== undefined; ev = this.queue_.shift()) {
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
        this.recognitionApplier_?.(this.commandContext(NO_IDS), ev);
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
    for (const p of this.doc_.pages) {
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
    this.imageRequests_.schedule(ImageRefs.document(this.doc_));
    // Conversion is in memory: the document is not dirty, and only a writer's conversion frame
    // (or the next save) persists it (spec 04 §7.3).
    this.pendingConversion_ =
      read.convertedLua && read.source !== null ? { raw: read.source, skip: new Set(read.recoveredPages) } : null;
    const pd = this.pending_;
    pd.reloaded = true;
    pd.selection = true;
    pd.view = true;
    this.reportPlaceholders(this.doc_.pages.flatMap((p) => p.objectStore.objects));
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
        this.applySelection(c.undo());
        return;
      case 'redo':
        this.applySelection(c.redo());
        return;
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

function gridBackgroundOf(page: Page): GridBackground {
  const bg = page.background;
  if (bg.type === BackgroundType.Color) return { type: 'color', color: bg.color };
  if (bg.type === BackgroundType.Image) return { type: 'image' };
  return { type: 'default' };
}

function dialogForMessage(m: ServerMessage): DialogRequest {
  if (m.code === 'board_requires_newer_app') {
    return { kind: 'gate', code: 'board_requires_newer_app', message: m.message, reload: true };
  }
  return { kind: 'info', title: '', message: m.message };
}
