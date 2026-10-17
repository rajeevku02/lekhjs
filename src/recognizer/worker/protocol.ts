// The recognition worker protocol (spec 07 §6.2): the messages between the main thread's
// `RecognitionClient` and the worker's `WorkerHost`. Plain data only (structured-clone safe); the
// stroke is a `Float64Array` the client transfers.
//
// Differences from the spec text, each deliberate:
//   - the view transform type is `RecViewTransform` (`delegate/SceneStore.ts`), not `ViewTransform`,
//     which is the engine's own class in `render/` (a different type with canvas-unit scroll);
//   - `JobMsg.test` carries the two test hooks (`spinMs`, `crash`) of `__lekhTest.recognizer`
//     (verification 01 §6.1); the client sets it only when a host armed a hook;
//   - `SceneSnapshot.objects` holds no connectors: connectors reach the worker only as
//     `arrowEnds` and `connections`, which is all the delegate asks of them (spec 07 §6.7 rows 4, 5);
//   - `SnapshotObject.parentId` is never set: the snapshot holds top-level objects (groups whole,
//     their members inside), which is what the hit tests flatten;
//   - `SceneSnapshot.textSizes` carries the text measurements that reading the objects back needs
//     (text boxes size themselves from their text; `textwidth()` data expressions): the worker
//     never measures text, so the main thread re-reads the snapshot objects with the measurements
//     tapped and ships the answers;
//   - `SceneSnapshot.docTemplates` also carries templates of the session's catalog overlay (stencil
//     sets loaded after start-up) that the worker's base catalog lacks, instead of the worker
//     fetching them from `stencilBaseUrl` (spec 07 §6.4 step 4).
import type { ObjectId, Pt, RecMutation } from '../delegate/RecMutation';
import type { RecViewTransform } from '../delegate/SceneStore';
import type { RecognizerConfig } from '../core/RecognizerConfig';

export type { ObjectId, Pt, RecMutation, RecPathComponent, RecShapeDTO, Seg } from '../delegate/RecMutation';
export type { RecViewTransform } from '../delegate/SceneStore';
export type { RecognizerConfig } from '../core/RecognizerConfig';

/** The protocol version; a `ready` with another value is `rec_protocol`. */
export const REC_PROTOCOL = 1;

// ---- main → worker

export interface InitMsg {
  readonly type: 'init';
  readonly protocol: typeof REC_PROTOCOL;
  readonly buildId: string;
  /** The initial config, used for the warm-up. */
  readonly config: RecognizerConfig;
  /** What the worker loads into its `TemplateCatalog` (the host's catalog loader reads it). */
  readonly catalog: { readonly stencilBaseUrl: string; readonly coreStencilIds: readonly string[] };
  readonly warmUp: boolean;
}

/** Test hooks of one job (`__lekhTest.recognizer`); absent in production. */
export interface JobTestHooks {
  /** Busy-wait this many ms before recognising (the watchdog tests). */
  readonly spinMs?: number;
  /** Throw at the top level of the message handler (an uncaught worker error). */
  readonly crash?: boolean;
}

export interface JobMsg {
  readonly type: 'job';
  readonly jobId: number;
  readonly sessionId: string;
  /** x0,y0,x1,y1,… view px, displacement already removed; transferred. */
  readonly stroke: Float64Array;
  /** The transform in force when the stroke was captured. */
  readonly view: RecViewTransform;
  /** `currentStrokeWidth()`: the current style's effective stroke width (canvas units, as C++). */
  readonly strokeWidth: number;
  /** A full copy each job (≈40 numbers): jobs are self-contained. */
  readonly config: RecognizerConfig;
  readonly scene: SceneSnapshot;
  readonly test?: JobTestHooks;
}

export interface ShutdownMsg {
  readonly type: 'shutdown';
}

export type RecRequest = InitMsg | JobMsg | ShutdownMsg;

export interface SnapRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SceneSnapshot {
  /** Canvas coords: what was queried (spec 07 §6.4). */
  readonly region: SnapRect;
  /** In store order (the hit-test tie-break is store order, as today). */
  readonly objects: readonly SnapshotObject[];
  /** `IArrowObject` ends of the objects in the region (connectors included), canvas coords. */
  readonly arrowEnds: readonly SnapshotArrow[];
  /** Connections incident to snapshot objects. */
  readonly connections: readonly SnapshotConnection[];
  /** Template bodies the snapshot objects reference that the worker's base catalog lacks, by id. */
  readonly docTemplates: Readonly<Record<string, unknown>>;
  /**
   * Text sizes reading the objects back measures, by `measureKey` → [width, height] (the worker
   * never measures text). Not in the spec text; see `worker/textSizes.ts`.
   */
  readonly textSizes: Readonly<Record<string, readonly [number, number]>>;
}

export interface SnapshotObject {
  readonly id: ObjectId;
  /** `LekhObject.rev` when the snapshot was built. */
  readonly rev: number;
  /** The object's serialised form (the io writer's, as realtime sends it). */
  readonly json: unknown;
  readonly parentId?: ObjectId;
  /** Canvas coords; precomputed: the worker never measures text. */
  readonly titleRect?: SnapRect;
  /** The title box's rotation about its centre (radians); absent when 0. Not in the spec text. */
  readonly titleAngle?: number;
  readonly isConnector: boolean;
  readonly isHelper: boolean;
  readonly isUnrecognized: boolean;
}

export interface SnapshotArrow {
  readonly id: ObjectId;
  readonly ends: readonly { readonly p1: Pt; readonly p2: Pt; readonly hasArrow: boolean }[];
  readonly strokeWidth: number;
  readonly isSingleCurve: boolean;
}

export interface SnapshotConnection {
  readonly id: ObjectId;
  readonly firstId: ObjectId;
  readonly secondId: ObjectId;
  readonly type: number;
  readonly autoType: number;
}

// ---- worker → main

export interface ReadyMsg {
  readonly type: 'ready';
  readonly protocol: typeof REC_PROTOCOL;
  readonly buildId: string;
  /** `LineAggregatorModule.id` ('stub' until the handoff). */
  readonly lineAggregator: string;
  readonly warmUpMs: number;
}

export interface ResultMsg {
  readonly type: 'result';
  readonly jobId: number;
  /** 0..2 entries, in apply order. */
  readonly mutations: readonly RecMutation[];
  readonly timings: {
    readonly snapshotLoadMs: number;
    readonly recognizeMs: number;
    readonly totalMs: number;
    readonly budgetExceeded: boolean;
  };
  /** E.g. the closed-shape budget line (`Recognizer.cpp:331`). */
  readonly logs: readonly string[];
}

export type RecErrorCode =
  | 'rec_protocol' // version/buildId mismatch or malformed message (worker side)
  | 'rec_init' // catalog load failed (worker side)
  | 'rec_snapshot' // an object in the snapshot failed to load (worker side)
  | 'rec_internal' // exception/assert inside the recognizer (worker side)
  | 'rec_timeout' // watchdog (client side)
  | 'rec_crash' // worker 'error'/'messageerror' or unexpected exit (client side)
  | 'rec_stale'; // apply-time validation failed (client side)

export interface ErrorMsg {
  readonly type: 'error';
  readonly jobId?: number;
  readonly code: RecErrorCode;
  /** Content-free: an error class name or a short reason, never board content. */
  readonly message: string;
}

export type RecResponse = ReadyMsg | ResultMsg | ErrorMsg;

/** The view transform of a job from the engine's zoom and canvas-unit scroll. */
export function recViewOf(zoom: number, scrollX: number, scrollY: number): RecViewTransform {
  return { zoom, tx: scrollX * zoom, ty: scrollY * zoom };
}

/** Whether `m` looks like a `RecResponse` (the client's malformed-message check). */
export function isRecResponse(m: unknown): m is RecResponse {
  if (typeof m !== 'object' || m === null) return false;
  const t = (m as { type?: unknown }).type;
  return t === 'ready' || t === 'result' || t === 'error';
}

/** Whether `m` looks like a `RecRequest` (the worker's malformed-message check). */
export function isRecRequest(m: unknown): m is RecRequest {
  if (typeof m !== 'object' || m === null) return false;
  const t = (m as { type?: unknown }).type;
  return t === 'init' || t === 'job' || t === 'shutdown';
}
