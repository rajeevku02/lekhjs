// Test doubles of the session's ports (spec 01 §4.1): `FakeScheduler` (a manual clock with timers
// and frames), `FakeTransport` (records sent frames, delivers peer frames and states),
// `FakeImagePort` (records requests, answers from a map) and `FakeFontLoader`. Everything is
// synchronous and deterministic; nothing touches a real timer, socket or file.
import type { Clock, Handle, Scheduler } from '../base';
import type { DecodedImage } from '../render';
import type { ImagePort, Transport, TransportState, TransportStateName } from '../session';
import type { FontFaceRequest, FontLoader } from '../text';

interface Timer {
  readonly at: number;
  readonly seq: number;
  readonly fn: () => void;
  readonly frame: boolean;
}

/**
 * A manual clock (`now()`), timers and frames. `advance(ms)` runs every timer due in order;
 * `frame()` runs the frame callbacks requested so far (one display frame).
 */
export class FakeScheduler implements Scheduler, Clock {
  private t_: number;
  private seq_ = 0;
  private readonly timers_ = new Map<number, Timer>();
  /** Frame requests made, ever. */
  framesRequested = 0;

  constructor(start = 1000) {
    this.t_ = start;
  }

  now(): number {
    return this.t_;
  }

  setTimeout(fn: () => void, ms: number): Handle {
    const h = ++this.seq_;
    this.timers_.set(h, { at: this.t_ + Math.max(0, ms), seq: h, fn, frame: false });
    return h;
  }

  clearTimeout(h: Handle): void {
    if (typeof h === 'number') this.timers_.delete(h);
  }

  requestFrame(cb: (t: number) => void): Handle {
    const h = ++this.seq_;
    this.framesRequested++;
    this.timers_.set(h, {
      at: Infinity,
      seq: h,
      fn: () => {
        cb(this.t_);
      },
      frame: true,
    });
    return h;
  }

  cancelFrame(h: Handle): void {
    this.clearTimeout(h);
  }

  /** Timers (not frames) waiting to fire. */
  get pendingTimers(): number {
    let n = 0;
    for (const t of this.timers_.values()) if (!t.frame) n++;
    return n;
  }

  /** Frame callbacks waiting for the next frame. */
  get pendingFrames(): number {
    let n = 0;
    for (const t of this.timers_.values()) if (t.frame) n++;
    return n;
  }

  /** Moves the clock by `ms`, running every timer that falls due, in time then creation order. */
  advance(ms: number): void {
    const end = this.t_ + ms;
    for (;;) {
      let due: Timer | null = null;
      let dueHandle = 0;
      for (const [h, t] of this.timers_) {
        if (t.frame || t.at > end) continue;
        if (due === null || t.at < due.at || (t.at === due.at && t.seq < due.seq)) {
          due = t;
          dueHandle = h;
        }
      }
      if (due === null) break;
      this.timers_.delete(dueHandle);
      this.t_ = Math.max(this.t_, due.at);
      due.fn();
    }
    this.t_ = end;
  }

  /** Runs the timers due now (`setTimeout(…, 0)`). */
  flushTimers(): void {
    this.advance(0);
  }

  /** Runs the frame callbacks requested before this call (one display frame). */
  frame(): number {
    const list = [...this.timers_].filter(([, t]) => t.frame);
    for (const [h] of list) this.timers_.delete(h);
    for (const [, t] of list) t.fn();
    return list.length;
  }
}

/** A transport that records what the session sends and lets the test play the server. */
export class FakeTransport implements Transport {
  state: TransportStateName;
  readonly sent: string[] = [];
  readonly connects: { url: string; q: { compat: 5; xc?: string; xo?: string } }[] = [];
  private stateCbs_: ((s: TransportState) => void)[] = [];
  private frameCbs_: ((t: string) => void)[] = [];

  constructor(state: TransportStateName = 'open') {
    this.state = state;
  }

  connect(url: string, q: { compat: 5; xc?: string; xo?: string }): void {
    this.connects.push({ url, q });
    this.state = 'connecting';
  }

  send(frame: string): boolean {
    if (this.state !== 'open') return false;
    this.sent.push(frame);
    return true;
  }

  close(code?: number, reason?: string): void {
    this.setState('closed', 0, code, reason);
  }

  onState(cb: (s: TransportState) => void): () => void {
    this.stateCbs_.push(cb);
    return () => {
      this.stateCbs_ = this.stateCbs_.filter((c) => c !== cb);
    };
  }

  onFrame(cb: (text: string) => void): () => void {
    this.frameCbs_.push(cb);
    return () => {
      this.frameCbs_ = this.frameCbs_.filter((c) => c !== cb);
    };
  }

  /** Subscribers (state + frame), for leak checks. */
  get subscribers(): number {
    return this.stateCbs_.length + this.frameCbs_.length;
  }

  setState(state: TransportStateName, at = 0, closeCode?: number, closeReason?: string): void {
    this.state = state;
    const s: TransportState = {
      state,
      at,
      ...(closeCode !== undefined ? { closeCode } : {}),
      ...(closeReason !== undefined ? { closeReason } : {}),
    };
    for (const cb of this.stateCbs_.slice()) cb(s);
  }

  /** A frame from the server (a peer's update, a `load`, a `message`). */
  deliver(text: string): void {
    for (const cb of this.frameCbs_.slice()) cb(text);
  }

  /** The sent frames, parsed. */
  frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

/** A decoded image whose `close()` calls are counted. */
export interface FakeImage extends DecodedImage {
  readonly closed: number;
}

/** A `width × height` fake image (its `source` is a plain marker object). */
export function fakeImage(width = 10, height = 10): FakeImage {
  let closed = 0;
  return {
    width,
    height,
    source: { fake: true, width, height },
    get closed() {
      return closed;
    },
    close() {
      closed++;
    },
  };
}

/**
 * An `ImagePort` over a map. `request` records the URLs (results are the test's to dispatch as
 * `imageLoaded` / `imageFailed`); `ensure` answers from the map at once; `pin` counts; `get`
 * reads the map; `decodeInline` gives a fake image (or rejects when `inline` is false: kashi).
 */
export class FakeImagePort implements ImagePort {
  readonly images: Map<string, DecodedImage>;
  readonly requests: string[][] = [];
  readonly pins = new Map<string, number>();
  private readonly inline_: boolean;

  constructor(images: ReadonlyMap<string, DecodedImage> = new Map(), opts: { inline?: boolean } = {}) {
    this.images = new Map(images);
    this.inline_ = opts.inline ?? true;
  }

  /** Every URL requested so far, in order. */
  get requested(): string[] {
    return this.requests.flat();
  }

  request(urls: readonly string[]): void {
    this.requests.push([...urls]);
  }

  /** Answers at once from the map (there is nothing to wait for, so no timeout). */
  ensure(urls: readonly string[]): Promise<{ loaded: string[]; missing: string[] }> {
    const loaded = urls.filter((u) => this.images.has(u));
    const missing = urls.filter((u) => !this.images.has(u));
    return Promise.resolve({ loaded, missing });
  }

  pin(urls: readonly string[]): () => void {
    for (const u of urls) this.pins.set(u, (this.pins.get(u) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const u of urls) this.pins.set(u, (this.pins.get(u) ?? 1) - 1);
    };
  }

  get(url: string): DecodedImage | undefined {
    return this.images.get(url);
  }

  decodeInline(): Promise<DecodedImage> {
    if (!this.inline_) return Promise.reject(new Error('inline images are not decoded here'));
    return Promise.resolve(fakeImage());
  }
}

/** A font loader whose `fontsChanged` the test fires (`bump()`). */
export class FakeFontLoader implements FontLoader {
  epoch = 0;
  readonly loads: (readonly FontFaceRequest[])[] = [];
  private cbs_: (() => void)[] = [];

  ensureLoaded(fonts: readonly FontFaceRequest[]): Promise<void> {
    this.loads.push(fonts);
    return Promise.resolve();
  }

  onFontsChanged(cb: () => void): () => void {
    this.cbs_.push(cb);
    return () => {
      this.cbs_ = this.cbs_.filter((c) => c !== cb);
    };
  }

  /** New fonts became usable. */
  bump(): void {
    this.epoch++;
    for (const cb of this.cbs_.slice()) cb();
  }
}
