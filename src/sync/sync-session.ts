// One board's realtime session (port of C++ `UpdateManager`, `L/update/UpdateManager.cpp`, and the
// socket half of `CoreIO::applyUpdate` / `onWebSocketDisconnect`; spec 02 `SyncSession`, spec 03
// §11.2-§11.3, spec 04 §9.3-§9.4, spec 09 §7).
//
// Incoming (`receive`): decode (`frame_parse` drops), the server `message` envelope surfaces as an
// event, the docid check (`frame_docid_mismatch` drops), `trackpointer` points go to the
// `PresenceTracker`, the stamp key updates `docFormat`, and the rest is decoded and applied
// transactionally: a frame that fails validation applies nothing, keeps the version and reports
// `frame_rejected` (`syncError`). The version is taken from every handled frame, as C++ did, and
// is initialised from the board source and reset by every load (B2, DR-ENG-14).
//
// Outgoing (`raise`): an attribute update for an object that is not on its page is not sent
// (DR-ENG-13: e.g. an undo of a change to an object a peer deleted); a frame that introduces a
// JS-form generator on a board below 5.0 is stamped; the frame is encoded with the session's
// version and sent through the `Transport` port when there is one and it is open. Without a docid
// (an offline board) nothing is sent, as C++ `raise` dropped it.
//
// Connection loss goes through `ReconnectPolicy`. No state outlives the instance; timers are the
// presence tracker's and `dispose()` cancels them.
import type { Clock, Logger, Scheduler } from '../base';
import type { DocumentCodec, ReadResult } from '../io';
import type { LekhDocument } from '../model';
import { classifyGenerator, isJsonObject, type JsonObject, type JsonValue } from '../template';
import { CLIENT_COMPAT, FORMAT_STAMP_KEY, consts, msgtypes, updatetypes } from './consts';
import { FrameCodec, type OutgoingChanges, type UpdateFrame } from './frame';
import {
  FrameStamper,
  docTemplateKey,
  objectTemplateKey,
  type ConversionEntry,
  type JsFormTest,
} from './frame-stamper';
import { splitKey, utf8Length } from './paths';
import { PresenceTracker } from './presence-tracker';
import { ReconnectPolicy, type ReconnectDecision } from './reconnect-policy';
import type { Transport, TransportState } from './transport';
import { UpdateDecoder } from './update-decoder';
import { ApplyRecord, type ApplyEnv, type ApplyResult } from './update-actions';

/** What the realtime session needs from its board session. */
export interface SyncHost {
  /** The current document (a reload replaces it). */
  document(): LekhDocument;
  readonly codec: DocumentCodec;
  /** A `load` frame's document becomes the session's (C++ `DocManager::loadDoc`). */
  replaceDocument(read: ReadResult): void;
}

/** The server's `message` envelope (`/backend/api/websocket-protocol.md` §6.2; C++ `readBackendMessage`). */
export interface ServerMessage {
  readonly code: string;
  readonly arg: string;
  readonly message: string;
  readonly reload: boolean;
  readonly upgrade: boolean;
}

export interface SyncEvents {
  applied: ApplyResult;
  /** A frame was rejected or could not be read (the host may offer Reload). */
  syncError: { readonly code: 'frame_rejected' | 'frame_parse'; readonly reason: string };
  serverMessage: ServerMessage;
  presenceChanged: Record<string, never>;
  /** A stamp above this engine's latest format arrived: reload (it then fails `format_too_new`). */
  formatTooNew: { readonly version: string };
  reconnect: ReconnectDecision;
}

/** What `receive` did with one frame. */
export type ReceiveOutcome =
  | { readonly kind: 'dropped'; readonly code: 'frame_parse' | 'frame_docid_mismatch' }
  | { readonly kind: 'message'; readonly message: ServerMessage }
  | { readonly kind: 'presence' }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'applied'; readonly result: ApplyResult };

export interface SyncSessionOptions {
  readonly host: SyncHost;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger?: Logger;
  /** The board id; empty for an offline board (nothing is sent). */
  readonly docid: string;
  /** The version the board source carried (`BoardMeta.version`; B2). Default 0. */
  readonly version?: number;
  /** The board's `info.version` (`docFormat`). Default: the document's. */
  readonly docFormat?: string;
  readonly transport?: Transport;
  /** Whether a generator block is JS-form for a known module (placeholders are not). */
  readonly isJsForm?: JsFormTest;
  /** `env.autoReconnect` (false on Mac). Default true. */
  readonly autoReconnect?: boolean;
}

type Listener<K extends keyof SyncEvents> = (e: SyncEvents[K]) => void;

/** Update types whose keys address one object's attributes (the DR-ENG-13 guard). */
const ATTRIBUTE_TYPES: readonly string[] = Object.freeze([
  updatetypes.changeAttr,
  updatetypes.changeArrow,
  updatetypes.changeTemplateParams,
  updatetypes.changeConnectionParams,
  updatetypes.changeConnectionTexts,
  updatetypes.changeStyle,
]);

function readMessage(raw: JsonObject): ServerMessage | null {
  const m = raw['message'];
  if (!isJsonObject(m)) return null;
  const str = (k: string) => (typeof m[k] === 'string' ? m[k] : '');
  return {
    code: str('code'),
    arg: str('arg'),
    message: str('message'),
    reload: m['reload'] === true,
    upgrade: m['upgrade'] === true,
  };
}

export class SyncSession {
  readonly presence: PresenceTracker;
  readonly stamper: FrameStamper;
  readonly reconnect: ReconnectPolicy;
  private readonly opts_: SyncSessionOptions;
  private version_: number;
  private docid_: string;
  private numUpdatesReceived_ = 0;
  private readonly listeners_ = new Map<keyof SyncEvents, ((e: never) => void)[]>();
  private unsubscribe_: (() => void)[] = [];
  private disposed_ = false;

  constructor(opts: SyncSessionOptions) {
    this.opts_ = opts;
    this.docid_ = opts.docid;
    this.version_ = opts.version ?? 0;
    this.stamper = new FrameStamper(opts.docFormat ?? opts.host.document().info.version, opts.isJsForm);
    this.presence = new PresenceTracker({
      clock: opts.clock,
      scheduler: opts.scheduler,
      onChange: () => {
        this.emit('presenceChanged', {});
      },
    });
    this.reconnect = new ReconnectPolicy({ autoReconnect: opts.autoReconnect ?? true });
  }

  /** C++ `docVersion()`. */
  get version(): number {
    return this.version_;
  }

  get docid(): string {
    return this.docid_;
  }

  /** C++ `numUpdatesReceived()`. */
  get numUpdatesReceived(): number {
    return this.numUpdatesReceived_;
  }

  /** The `compat` the transport connects with (spec 04 §10.1). */
  static readonly compat = CLIENT_COMPAT;

  /**
   * C++ `start(docid)`, and every (re)open: the version and format come from the board source
   * (B2), the counters restart.
   */
  start(docid: string, version: number, docFormat: string = this.opts_.host.document().info.version): void {
    this.docid_ = docid;
    this.version_ = version;
    this.numUpdatesReceived_ = 0;
    this.stamper.reset(docFormat);
    this.reconnect.restart();
  }

  /** C++ `stop()`: no more frames go out; closes from now on are deliberate. */
  stop(): void {
    this.docid_ = '';
    this.reconnect.stop();
  }

  /** Subscribes the session to `transport` (frames are handed to `onFrame`, states to `onState`). */
  attach(onFrame: (text: string) => void, onState: (s: TransportState) => void): void {
    const t = this.opts_.transport;
    if (t === undefined) return;
    this.unsubscribe_.push(t.onFrame(onFrame), t.onState(onState));
  }

  on<K extends keyof SyncEvents>(k: K, fn: Listener<K>): () => void {
    const list = this.listeners_.get(k) ?? [];
    list.push(fn);
    this.listeners_.set(k, list);
    return () => {
      const l = this.listeners_.get(k);
      if (l !== undefined)
        this.listeners_.set(
          k,
          l.filter((f) => f !== (fn as unknown)),
        );
    };
  }

  dispose(): void {
    if (this.disposed_) return;
    this.disposed_ = true;
    this.stop();
    this.presence.dispose();
    for (const u of this.unsubscribe_) u();
    this.unsubscribe_ = [];
    this.listeners_.clear();
  }

  // ---- incoming ----

  /** One frame from the transport (the `remoteFrame` session event). */
  receive(text: string): ReceiveOutcome {
    const log = this.opts_.logger;
    const decoded = FrameCodec.decode(text);
    if (!decoded.ok) {
      log?.warn('frame_parse', { reason: decoded.reason });
      // C++ showed "Unable to recognize message from server" with Reload for a frame it could
      // parse as JSON but not as a message; the host decides from this.
      this.emit('syncError', { code: 'frame_parse', reason: decoded.reason });
      return { kind: 'dropped', code: 'frame_parse' };
    }
    const frame = decoded.frame;
    if (frame.nonFinite > 0) log?.warn('nonfinite_read', { count: frame.nonFinite });
    const message = readMessage(frame.raw);
    if (message !== null) {
      this.emit('serverMessage', message);
      return { kind: 'message', message };
    }
    if (frame.docid !== this.docid_) {
      log?.debug('frame_docid_mismatch');
      return { kind: 'dropped', code: 'frame_docid_mismatch' };
    }
    return this.handle(frame);
  }

  private handle(frame: UpdateFrame): ReceiveOutcome {
    const u = frame.update;
    if (frame.type !== msgtypes.update || u === null) {
      // C++ `UpdateHandler::handle`: a non-update frame is handled and its version taken.
      this.version_ = frame.version;
      return { kind: 'ignored' };
    }
    if (u.pointers.length > 0) {
      this.presence.updatePointer(frame.user.id, u.pointers);
      return { kind: 'presence' };
    }
    const stampEntry = u.changes.find(([k]) => k === FORMAT_STAMP_KEY);
    const changes = stampEntry === undefined ? u.changes : u.changes.filter(([k]) => k !== FORMAT_STAMP_KEY);
    const action = UpdateDecoder.decode(u, changes);
    const host = this.opts_.host;
    if (action === null) {
      this.observeStamp(stampEntry?.[1]);
      this.version_ = frame.version;
      this.numUpdatesReceived_++;
      return { kind: 'ignored' };
    }
    const env: ApplyEnv = {
      doc: host.document(),
      codec: host.codec,
      replaceDocument: (read) => {
        host.replaceDocument(read);
      },
    };
    if (!action.validate(env)) {
      this.opts_.logger?.warn('frame_rejected', { type: u.type });
      this.emit('syncError', { code: 'frame_rejected', reason: u.type });
      return { kind: 'rejected', reason: u.type };
    }
    const record = new ApplyRecord();
    action.apply(env, record);
    const result = record.result();
    if (result.reloaded) this.stamper.reset(host.document().info.version);
    this.observeStamp(stampEntry?.[1]);
    if (action.advancesVersion) {
      this.version_ = frame.version;
      this.numUpdatesReceived_++;
    }
    this.emit('applied', result);
    return { kind: 'applied', result };
  }

  private observeStamp(v: JsonValue | undefined): void {
    if (v === undefined) return;
    const obs = this.stamper.observe(v);
    if (obs.aboveLatest && obs.stamp !== null) this.emit('formatTooNew', { version: obs.stamp });
  }

  // ---- outgoing ----

  /**
   * The text of an outgoing frame (guarded and stamped), or null when nothing is to be sent: no
   * docid, or every key addresses an absent object (DR-ENG-13).
   */
  prepare(update: OutgoingChanges): string | null {
    if (this.docid_ === '' || this.disposed_) return null;
    let changes = update.changes;
    if (ATTRIBUTE_TYPES.includes(update.type)) {
      const kept = this.presentObjectsOnly(changes);
      if (kept === null) {
        this.opts_.logger?.debug('update_for_absent_object', { type: update.type });
        return null;
      }
      changes = kept;
    }
    changes = this.stamper.stamp(update.type, changes);
    return FrameCodec.encode(this.version_, this.docid_, { ...update, changes });
  }

  /** C++ `UpdateManager::raise`: prepare, then send when the transport is open. */
  raise(update: OutgoingChanges): boolean {
    const text = this.prepare(update);
    if (text === null) return false;
    if (this.opts_.logger !== undefined) this.opts_.logger.debug('update_sent', { type: update.type });
    return this.send(text);
  }

  /** Sends a prepared frame; false when there is no open transport (the frame is not queued). */
  send(text: string): boolean {
    const t = this.opts_.transport;
    if (t === undefined || t.state !== 'open') return false;
    return t.send(text);
  }

  /** The DR-ENG-13 guard: `changes` without the keys of objects not on their page; null if none is left. */
  private presentObjectsOnly(changes: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> | null {
    const doc = this.opts_.host.document();
    const out: Record<string, JsonValue> = {};
    let kept = 0;
    for (const key of Object.keys(changes)) {
      const keys = splitKey(key);
      const v = changes[key] as JsonValue;
      if (keys.length >= 6 && keys[1] === consts.pages && keys[3] === consts.objects) {
        const page = doc.getPage(keys[2] as string);
        if (page === null || page.objectStore.getObject(keys[4] as string) === null) continue;
        kept++;
      }
      out[key] = v;
    }
    return kept === 0 ? null : out;
  }

  // ---- format 5.0 conversion (spec 04 §7.3, §9.4) ----

  /**
   * The entries of the conversion frame for a board just opened from `raw` (the stored document
   * a `load` carried): every document template that held Lua, then every top-level object whose
   * stored template held a Lua generator and whose live template is now JS-form, in page order and
   * then object order. Group members are not listed (their template keys are deeper than a TS
   * receiver applies; they convert in memory on every open). Pages in `skipPages` (the phantom
   * pages kept as "Recovered", which no open may write: AC-FMT-29) are not listed either.
   */
  conversionEntries(
    raw: JsonValue,
    skipPages?: ReadonlySet<string>,
  ): { templates: ConversionEntry[]; objects: ConversionEntry[] } {
    const doc = this.opts_.host.document();
    const codec = this.opts_.host.codec;
    const templates: ConversionEntry[] = [];
    for (const id of doc.templateIds()) {
      const def = doc.get(id);
      if (def?.converted === true) templates.push({ key: docTemplateKey(id), template: def.json });
    }
    const objects: ConversionEntry[] = [];
    const pages = isJsonObject(raw) ? raw['pages'] : undefined;
    for (const page of doc.pages) {
      if (skipPages?.has(page.id) === true) continue;
      const rawPage = isJsonObject(pages) ? pages[page.id] : undefined;
      const rawObjects = isJsonObject(rawPage) ? rawPage['objects'] : undefined;
      if (!isJsonObject(rawObjects)) continue;
      for (const obj of page.objectStore.objects) {
        const ro = rawObjects[obj.id];
        const rt = isJsonObject(ro) ? ro['template'] : undefined;
        const rg = isJsonObject(rt) ? rt['generator'] : undefined;
        if (!isJsonObject(rg) || classifyGenerator(rg).kind !== 'lua') continue;
        const written = codec.writeObject(obj)['template'];
        if (written === undefined || !this.stamper.containsJs(written)) continue;
        objects.push({ key: objectTemplateKey(page.id, obj.id), template: written });
      }
    }
    return { templates, objects };
  }

  /**
   * The conversion entries for objects a realtime frame brought with Lua (an old peer's frame
   * that raced the gate, spec 04 §7.3): each listed top-level object whose live template is now
   * JS-form. Re-sending a template that was JS already is idempotent.
   */
  conversionEntriesFor(ids: readonly string[]): { templates: ConversionEntry[]; objects: ConversionEntry[] } {
    const doc = this.opts_.host.document();
    const codec = this.opts_.host.codec;
    const objects: ConversionEntry[] = [];
    for (const page of doc.pages) {
      for (const id of ids) {
        const obj = page.objectStore.getObject(id);
        if (obj === null) continue;
        const written = codec.writeObject(obj)['template'];
        if (written === undefined || !this.stamper.containsJs(written)) continue;
        objects.push({ key: objectTemplateKey(page.id, obj.id), template: written });
      }
    }
    return { templates: [], objects };
  }

  /** The conversion frame's chunks as frame texts (`changeattr`, no conditions, each stamped). */
  conversionFrames(raw: JsonValue, skipPages?: ReadonlySet<string>): string[] {
    return this.framesOf(this.conversionEntries(raw, skipPages));
  }

  /** `entries` as conversion-frame texts (none without a docid). */
  framesOf(entries: { templates: ConversionEntry[]; objects: ConversionEntry[] }): string[] {
    if (this.docid_ === '') return [];
    const envelope = (changes: Readonly<Record<string, JsonValue>>) =>
      FrameCodec.encode(this.version_, this.docid_, { type: updatetypes.changeAttr, changes });
    const chunks = this.stamper.conversionChunks(entries.templates, entries.objects, (c) => utf8Length(envelope(c)));
    return chunks.map((c) => envelope(c));
  }

  /**
   * Sends conversion-frame texts (no retry: a chunk the transport does not take is dropped, and
   * the next writer open converts again). Returns the chunks sent.
   */
  sendFrames(texts: readonly string[]): number {
    let sent = 0;
    for (const text of texts) if (this.send(text)) sent++;
    return sent;
  }

  /** Sends the conversion frame for a writer's open of `raw`. Returns the chunks sent. */
  sendConversion(raw: JsonValue, skipPages?: ReadonlySet<string>): number {
    return this.sendFrames(this.conversionFrames(raw, skipPages));
  }

  /** The board's format is at least 5.0 (spec 04 §9.3). */
  isStamped(): boolean {
    return !this.stamper.belowLatest();
  }

  // ---- connection state (spec 09 §7) ----

  /** A `transportState` event. */
  onTransportState(s: TransportState): ReconnectDecision | null {
    const d = this.reconnect.onTransportState(s);
    if (d !== null) this.emit('reconnect', d);
    return d;
  }

  /** A `hostLifecycle` event. */
  onHostLifecycle(state: 'foreground' | 'background'): ReconnectDecision | null {
    const d = this.reconnect.onHostLifecycle(state, this.opts_.transport?.state);
    if (d !== null) this.emit('reconnect', d);
    return d;
  }

  private emit<K extends keyof SyncEvents>(k: K, e: SyncEvents[K]): void {
    const list = this.listeners_.get(k);
    if (list === undefined) return;
    for (const fn of [...list]) {
      try {
        (fn as Listener<K>)(e);
      } catch {
        this.opts_.logger?.error('listener_error', { event: k });
      }
    }
  }
}
