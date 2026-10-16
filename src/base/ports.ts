// The port interfaces `base/` owns (spec 01 §4.2). `session/ports.ts` re-exports them, so hosts
// import every port from one place. lekhjs has no ambient globals: time, ids, timers, fetching,
// the canvas and workers all arrive through these.

/** Milliseconds; monotonic enough for TTLs and stats. */
export interface Clock {
  now(): number;
}

/** Mints the entropy for page and object ids: a uuid-v4 string (encoded by `shortIdFromUuid`). */
export interface IdSource {
  next(): string;
}

/** Log sink. Fields carry codes and counts, never board content. */
export interface Logger {
  debug(m: string, f?: object): void;
  info(m: string, f?: object): void;
  warn(m: string, f?: object): void;
  error(m: string, f?: object): void;
}

/** A timer or frame handle as the host returns it. */
export type Handle = number | object;

/** Timers and frames. Host: `requestAnimationFrame` (interaction/FrameScheduler); node: `setImmediate`. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): Handle;
  clearTimeout(h: Handle): void;
  requestFrame(cb: (t: number) => void): Handle;
  cancelFrame(h: Handle): void;
}

/** Fetches stencils and library items. */
export interface ResourceLoader {
  fetchText(url: string): Promise<string>;
  fetchBytes(url: string): Promise<Uint8Array>;
}

/** The part of `TextMetrics` lekhjs reads. */
export interface TextMetricsLike {
  readonly width: number;
  readonly actualBoundingBoxAscent?: number;
  readonly actualBoundingBoxDescent?: number;
  readonly actualBoundingBoxLeft?: number;
  readonly actualBoundingBoxRight?: number;
  readonly fontBoundingBoxAscent?: number;
  readonly fontBoundingBoxDescent?: number;
}

/** A canvas gradient. */
export interface GradientLike {
  addColorStop(offset: number, color: string): void;
}

/** The subset of CanvasRenderingContext2D lekhjs calls; @napi-rs/canvas and OffscreenCanvas satisfy it. */
export interface Canvas2DLike {
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(r: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  quadraticCurveTo(a: number, b: number, c: number, d: number): void;
  arc(x: number, y: number, r: number, s: number, e: number, ccw?: boolean): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number, ccw?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(rule?: 'nonzero' | 'evenodd'): void;
  stroke(): void;
  clip(rule?: 'nonzero' | 'evenodd'): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): TextMetricsLike;
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
  setLineDash(d: number[]): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientLike;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): GradientLike;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  direction?: string;
  fontStretch?: string;
}

/** The `MessageEvent` part a port handler reads. */
export interface MessageEventLike {
  readonly data: unknown;
}

/**
 * The structural message port the recognizer worker serves (`serveRecognizer(port)`): a
 * `DedicatedWorkerGlobalScope`, a `MessagePort` or a test double. No WebWorker lib needed.
 */
export interface PortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEventLike) => void) | null;
}

/** An object a port may transfer (an `ArrayBuffer` in practice). */
export type Transferable = object;

/**
 * The main-thread side of a Web Worker, so the recognizer client needs no DOM types:
 * `postMessage` / `onmessage` / `terminate`, plus the error hook the client's watchdog uses.
 */
export interface WorkerLike extends PortLike {
  terminate(): void;
  onerror?: ((e: unknown) => void) | null;
}
