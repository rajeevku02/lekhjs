// The per-session image store (port of C++ `app::RemoteResourceManager`'s image half; spec 03 §7).
//
// - Keyed by URL. Fetches are started by the session at create/load through its `ImagePort`, never
//   by paint: `missing(urls)` says what to request, `markPending` records the request, and the
//   arrival (`imageLoaded` / `imageFailed`) lands here through `put` / `fail`.
// - Each entry has its own expiry, `ttlMs` (60 s, as `RemoteResourceManager`) after its last paint
//   use (`get`). One timer, armed for the earliest expiry, sweeps. Re-adding an entry never lets
//   an older timer evict it (B11: the C++ armed a 60 s timer per `addToCache` and erased the URL
//   when *any* of them fired).
// - `pin(urls)` is ref-counted: a pinned entry is never evicted until its last unpin, which
//   restarts its TTL (export, spec 08 §4).
// - An evicted or replaced image is `close()`d (`ImageBitmap`); so is everything on `dispose()`,
//   which also cancels the timer (AC-ENG-26).
// - A URL that failed more than `maxFailures` times (C++: `count > 3`) is no longer reported
//   missing, so it is not requested again in this session.
//
// Synchronous: no promise, no fetch, no decode (AC-ENG-25).
import type { Clock, Handle, Scheduler } from '../base';
import type { DecodedImage } from './ports';

/** C++ `addToCache`'s `setTimer(60 * 1000, …)`. */
export const IMAGE_TTL_MS = 60_000;
/** C++ `RemoteResourceManager::getImage`: `if (count > 3) return nullptr`. */
export const IMAGE_MAX_FAILURES = 3;

export type ImageFailReason = 'http' | 'decode' | 'too_large';
export type ImageState = 'loaded' | 'pending' | 'failed' | 'absent';

export interface ImageCacheOptions {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly ttlMs?: number;
  readonly maxFailures?: number;
}

interface Entry {
  image: DecodedImage;
  expiresAt: number;
  pins: number;
}

export class ImageCache {
  private readonly clock_: Clock;
  private readonly scheduler_: Scheduler;
  private readonly ttl_: number;
  private readonly maxFailures_: number;
  private readonly entries_ = new Map<string, Entry>();
  private readonly pending_ = new Set<string>();
  private readonly failures_ = new Map<string, { count: number; reason: ImageFailReason }>();
  /** URLs pinned before their image arrived: the pin count waits here. */
  private readonly earlyPins_ = new Map<string, number>();
  private timer_: Handle | null = null;
  private timerDue_ = Infinity;
  private disposed_ = false;

  constructor(opts: ImageCacheOptions) {
    this.clock_ = opts.clock;
    this.scheduler_ = opts.scheduler;
    this.ttl_ = opts.ttlMs ?? IMAGE_TTL_MS;
    this.maxFailures_ = opts.maxFailures ?? IMAGE_MAX_FAILURES;
  }

  get size(): number {
    return this.entries_.size;
  }

  /** A paint use: the image, with its expiry pushed to now + TTL. */
  get(url: string): DecodedImage | undefined {
    const e = this.entries_.get(url);
    if (e === undefined) return undefined;
    e.expiresAt = this.clock_.now() + this.ttl_;
    return e.image;
  }

  /** The image without touching its expiry. */
  peek(url: string): DecodedImage | undefined {
    return this.entries_.get(url)?.image;
  }

  has(url: string): boolean {
    return this.entries_.has(url);
  }

  state(url: string): ImageState {
    if (this.entries_.has(url)) return 'loaded';
    if (this.pending_.has(url)) return 'pending';
    if (this.failures_.has(url)) return 'failed';
    return 'absent';
  }

  /** How often `url` failed, and the last reason. */
  failure(url: string): { count: number; reason: ImageFailReason } | undefined {
    return this.failures_.get(url);
  }

  /**
   * The distinct URLs of `urls` to request: not loaded, not in flight, and not given up on
   * (failed more than `maxFailures` times). In first-seen order.
   */
  missing(urls: Iterable<string>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (this.entries_.has(url) || this.pending_.has(url)) continue;
      const f = this.failures_.get(url);
      if (f !== undefined && f.count > this.maxFailures_) continue;
      out.push(url);
    }
    return out;
  }

  /** Records that `urls` were requested. */
  markPending(urls: Iterable<string>): void {
    if (this.disposed_) return;
    for (const url of urls) this.pending_.add(url);
  }

  /** An image arrived. Replaces (and closes) a different image under the same URL. */
  put(url: string, image: DecodedImage): void {
    if (this.disposed_) {
      image.close?.();
      return;
    }
    this.pending_.delete(url);
    this.failures_.delete(url);
    const old = this.entries_.get(url);
    const expiresAt = this.clock_.now() + this.ttl_;
    if (old !== undefined) {
      if (old.image !== image) old.image.close?.();
      old.image = image;
      old.expiresAt = expiresAt;
    } else {
      const pins = this.earlyPins_.get(url) ?? 0;
      this.earlyPins_.delete(url);
      this.entries_.set(url, { image, expiresAt, pins });
    }
    this.arm(expiresAt);
  }

  /** A request failed. */
  fail(url: string, reason: ImageFailReason): void {
    if (this.disposed_) return;
    this.pending_.delete(url);
    const f = this.failures_.get(url);
    this.failures_.set(url, { count: (f?.count ?? 0) + 1, reason });
  }

  /**
   * Pins `urls` (loaded now or later) against eviction; returns the unpin function, which is
   * idempotent. Pins are counted per URL.
   */
  pin(urls: Iterable<string>): () => void {
    const list = [...new Set(urls)];
    for (const url of list) {
      const e = this.entries_.get(url);
      if (e !== undefined) e.pins++;
      else this.earlyPins_.set(url, (this.earlyPins_.get(url) ?? 0) + 1);
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const url of list) this.unpinOne(url);
    };
  }

  isPinned(url: string): boolean {
    return (this.entries_.get(url)?.pins ?? this.earlyPins_.get(url) ?? 0) > 0;
  }

  /** Evicts every unpinned entry whose expiry has passed; returns the evicted URLs. */
  sweep(): string[] {
    const now = this.clock_.now();
    const evicted: string[] = [];
    for (const [url, e] of this.entries_) {
      if (e.pins > 0 || e.expiresAt > now) continue;
      this.entries_.delete(url);
      e.image.close?.();
      evicted.push(url);
    }
    return evicted;
  }

  /** Closes every image, cancels the timer and stops accepting arrivals. Idempotent. */
  dispose(): void {
    if (this.disposed_) return;
    this.disposed_ = true;
    if (this.timer_ !== null) this.scheduler_.clearTimeout(this.timer_);
    this.timer_ = null;
    this.timerDue_ = Infinity;
    for (const e of this.entries_.values()) e.image.close?.();
    this.entries_.clear();
    this.pending_.clear();
    this.failures_.clear();
    this.earlyPins_.clear();
  }

  private unpinOne(url: string): void {
    const e = this.entries_.get(url);
    if (e !== undefined) {
      if (e.pins > 0) e.pins--;
      if (e.pins === 0) {
        e.expiresAt = Math.max(e.expiresAt, this.clock_.now() + this.ttl_);
        this.arm(e.expiresAt);
      }
      return;
    }
    const n = this.earlyPins_.get(url) ?? 0;
    if (n <= 1) this.earlyPins_.delete(url);
    else this.earlyPins_.set(url, n - 1);
  }

  /** Makes sure the sweep timer fires no later than `due`. */
  private arm(due: number): void {
    if (this.disposed_ || due >= this.timerDue_) return;
    if (this.timer_ !== null) this.scheduler_.clearTimeout(this.timer_);
    this.timerDue_ = due;
    this.timer_ = this.scheduler_.setTimeout(
      () => {
        this.onTimer();
      },
      Math.max(0, due - this.clock_.now()),
    );
  }

  private onTimer(): void {
    this.timer_ = null;
    this.timerDue_ = Infinity;
    if (this.disposed_) return;
    this.sweep();
    let next = Infinity;
    for (const e of this.entries_.values()) {
      if (e.pins === 0 && e.expiresAt < next) next = e.expiresAt;
    }
    if (next !== Infinity) this.arm(next);
  }
}
