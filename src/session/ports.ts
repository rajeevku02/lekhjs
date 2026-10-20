// The session contract (spec 01 §4.2: the one definition of the session's ports and events).
// The port interfaces `base/` owns (`Clock`, `IdSource`, `Logger`, `Scheduler`, `ResourceLoader`,
// `Canvas2DLike`), `Transport` (`sync/`), `DecodedImage` (`render/`) and the text ports (`text/`)
// are re-exported here, so hosts import every port from one place.
import type { Scheduler } from '../base';
import type { GeneratorRegistry } from '../generators';
import type { LekhDocument } from '../model';
import type { DecodedImage } from '../render';
import type { RecMutation } from '../recognizer';
import type { Transport, TransportState } from '../sync';
import type { JsonObject, TemplateCatalog } from '../template';
import type { EditCommand } from './commands';
import type { DialogRequest, StyleSnapshot, ToastRequest, UiRequests } from './ui';

export type {
  Canvas2DLike,
  Clock,
  GradientLike,
  Handle,
  IdSource,
  Logger,
  ResourceLoader,
  Scheduler,
  TextMetricsLike,
} from '../base';
export type { Transport, TransportState, TransportStateName } from '../sync';
export type { DecodedImage } from '../render';
export type { CanvasFactory, FontLoader, TextMeasurer } from '../text';
export type { EditCommand } from './commands';
export type { DialogRequest, DialogResponse, StyleSnapshot, ToastRequest, UiRequests } from './ui';

// ---- images (session) ----

export interface ImagePort {
  /** Fire and forget; results arrive as `imageLoaded` / `imageFailed`. */
  request(urls: readonly string[]): void;
  /** Export (spec 08 §4). */
  ensure(urls: readonly string[], opts: { timeoutMs: number }): Promise<{ loaded: string[]; missing: string[] }>;
  /** Returns unpin; pinned images are never evicted by the 60 s TTL. */
  pin(urls: readonly string[]): () => void;
  get(url: string): DecodedImage | undefined;
  /** Browser only: base64 images exist only in offline boards (OQ-66). */
  decodeInline(dataUrl: string): Promise<DecodedImage>;
}
// kashi: a pre-filled map wrapped as an ImagePort — request() is a no-op, ensure() resolves at once,
// decodeInline() rejects.

/** A template body as a stencil file or a board carries it. */
export type TemplateJson = JsonObject;

/** What the user may do on a cloud board (the documents API's permission). */
export type BoardPermission = 'write' | 'comment' | 'read';

/** Where a board came from (`load`, the `open` event). */
export interface BoardMeta {
  readonly kind: 'offline' | 'cloud';
  readonly docid?: string;
  readonly version?: number;
  readonly path?: string;
  /**
   * Cloud boards: the session's permission. Only a `write` session sends the conversion frame for
   * Lua it converted on open (spec 04 §7.3); absent counts as not `write`.
   */
  readonly permission?: BoardPermission;
}

// ---- events in (dispatch) ----

export type SessionEvent =
  | { readonly type: 'open'; readonly raw: string | object; readonly meta: BoardMeta }
  | { readonly type: 'remoteFrame'; readonly text: string }
  | { readonly type: 'transportState'; readonly state: TransportState }
  | { readonly type: 'imageLoaded'; readonly url: string; readonly image: DecodedImage }
  | {
      readonly type: 'imageFailed';
      readonly url: string;
      readonly reason: 'http' | 'decode' | 'too_large';
      /** The HTTP status when the server answered (a 4xx is never fetched again, round IF1). */
      readonly status?: number;
    }
  | { readonly type: 'stencilLoaded'; readonly setId: string; readonly bodies: readonly TemplateJson[] }
  /** Posted by the runtime to every live session. */
  | { readonly type: 'fontsChanged'; readonly epoch: number }
  | { readonly type: 'timer'; readonly token: string }
  /** Spec 07 §6.6. */
  | {
      readonly type: 'recognitionResult';
      readonly strokeId: string;
      readonly docGeneration: number;
      readonly mutations: readonly RecMutation[];
    }
  | {
      readonly type: 'command';
      readonly command: EditCommand;
      readonly origin: 'ui' | 'keyboard' | 'continuation';
      readonly docGeneration?: number;
    }
  /** Native: LekhPlugin lifecycle events; web: visibilitychange. */
  | { readonly type: 'hostLifecycle'; readonly state: 'foreground' | 'background' }
  /** A share change pushed by kashi raised or lowered the session's permission (spec 04 §7.3). */
  | { readonly type: 'permissionChanged'; readonly permission: BoardPermission }
  /**
   * A cloud board whose content arrives as the socket's first `load` frame (C++ `openRemoteDoc`):
   * the realtime session starts for `docid` at `version` with no document read yet; the `load`
   * frame then brings the document and its `permission`.
   */
  | { readonly type: 'connect'; readonly docid: string; readonly version?: number };

// ---- notifications out (on) ----

export type PaintLayer = 'grid' | 'drawing' | 'middle';

export interface SessionEvents {
  documentChanged: {
    readonly changedIds: readonly string[];
    readonly removedIds: readonly string[];
    readonly reloaded: boolean;
    readonly docGeneration: number;
  };
  selectionChanged: { readonly ids: readonly string[] };
  viewChanged: ViewState;
  /** `requestPaint(layer)`, coalesced per frame over `Scheduler.requestFrame`. */
  paintRequested: { readonly layer: PaintLayer };
  /** Includes `{ kind: 'disconnected' }` (spec 09 §7) and the server message frame. */
  dialog: DialogRequest;
  toast: ToastRequest;
  /** `ReconnectPolicy`: the host's BoardLoader reopens the board. */
  reopenRequested: { readonly reason: 'auto_reconnect' };
  /** Engine errors (spec 03 §14); no board content. */
  error: { readonly code: string; readonly eventType: SessionEvent['type'] };
}

export interface ViewState {
  readonly zoom: number;
  readonly tx: number;
  readonly ty: number;
  readonly activePageId: string;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly dpr: number;
  readonly style: StyleSnapshot;
}

// ---- the session's other ports ----

/** Font bytes for the PDF font chain (spec 08 §6): `LekhPlugin.getFontData`, or a fetch. */
export interface FontDataProvider {
  getFontData(req: {
    readonly text: string;
    readonly family: string;
    readonly bold: boolean;
    readonly italic: boolean;
  }): Promise<Uint8Array | null>;
}

/** Settings: `LekhPlugin` getSetting/setSetting natively, `localStorage` on the web. */
export interface SettingsStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** A cooperative deadline (spec 03 §12.4). `check()` throws `LekhError('budget_exceeded')`. */
export interface Budget {
  readonly deadline: number;
  check(): void;
}

export interface SessionOptions {
  /** Overlay base; default `runtime.catalog`. */
  readonly catalog?: TemplateCatalog;
  /** Required (kashi: the per-operation preload map). */
  readonly images: ImagePort;
  /** Required (kashi: node timers). */
  readonly scheduler: Scheduler;
  /** Cloud boards only. */
  readonly transport?: Transport;
  /** Dialogs, toasts, open view, export, pick image (spec 05 §6). */
  readonly ui?: UiRequests;
  /** PDF only (spec 08 §6). */
  readonly fontData?: FontDataProvider;
  readonly storage?: SettingsStore;
  /**
   * `env.autoReconnect` (spec 09 §7): a foreground close of a cloud board's socket reopens it.
   * False on Mac. Default true.
   */
  readonly autoReconnect?: boolean;
  /** Cooperative deadline; lekhjs calls `check()` at safe points (spec 03 §12.4). */
  readonly budget?: Budget;
  /**
   * The generator registry this session's converter uses; default `runtime.generators`. kashi's
   * backend-first mode passes one over the Lua pack with `preserveLua` (Work 01M4X7TCHFB862XGT68GPY071C
   * BF1), with a `catalog` built over the same registry.
   */
  readonly generators?: GeneratorRegistry;
  /**
   * Whether the semantic layer's new nodes and edges get `fontfamily: "Noto Sans"` (spec 06 §9).
   * Default true. kashi's backend-first mode passes false, as the C++ MCP never set a family.
   */
  readonly newContentFont?: boolean;
}

/** The structural `AbortSignal` part `on(…, signal)` reads (no DOM lib). */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, opts?: { once?: boolean }): void;
}

/** What `BoardSession.load` returns. */
export type LoadResult =
  { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

/** The read-only view of the document React and the semantic layer get. */
export type ReadonlyDoc = Pick<
  LekhDocument,
  | 'name'
  | 'info'
  | 'style'
  | 'grid'
  | 'scaling'
  | 'pages'
  | 'activePageIndex'
  | 'activePage'
  | 'getPage'
  | 'getPageIndex'
  | 'get'
  | 'hasTemplate'
  | 'templateIds'
>;
