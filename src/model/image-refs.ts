// Image fetching at create/load (spec 03 §7). Paint never starts a fetch: after a load, a reload,
// an `addobjects`/`changeattr` frame, a paste or an insert, the session collects the URLs the new
// objects reference (`ImageRefs`) and `ImageRequests` asks the session's `ImagePort` for the ones
// the `ImageCache` does not hold, with one `setTimeout(0)` per event. Off-screen images therefore
// load as they do today. Arrival is the `imageLoaded` / `imageFailed` event, handled by the
// session; it requests a repaint and marks nothing dirty (no geometry changes).
//
// Base64 images (offline boards only, OQ-66) are not URLs: they are collected by their cache key
// (the `data:` URI) and the session decodes them through `ImagePort.decodeInline` instead of
// `request` (until W11 nothing decoded them, and every inline image drew as the placeholder).
import type { Handle, Scheduler } from '../base';
import type { ImageCache } from '../render';
import type { LekhDocument } from './lekh-document';
import type { LekhObject } from './lekh-object';
import type { Page } from './page';

/** The part of the session's `ImagePort` (spec 01 §4.2) a request needs. */
export interface ImageRequestPort {
  /** Fire and forget; results arrive as `imageLoaded` / `imageFailed` events. */
  request(urls: readonly string[]): void;
}

/** Collects every image URL a document, page or object references (groups descended). */
export const ImageRefs = Object.freeze({
  /** The URLs of `objects` and their members, distinct, in first-seen order. */
  collect(objects: Iterable<LekhObject>): string[] {
    const out = new Set<string>();
    const walk = (o: LekhObject): void => {
      for (const url of o.imageUrls()) if (url !== '') out.add(url);
      for (const m of o.members()) walk(m);
    };
    for (const o of objects) walk(o);
    return [...out];
  },

  /** The inline images' `data:` cache keys of `objects` and their members, distinct. */
  inline(objects: Iterable<LekhObject>): string[] {
    const out = new Set<string>();
    const walk = (o: LekhObject): void => {
      for (const key of o.inlineImageKeys()) out.add(key);
      for (const m of o.members()) walk(m);
    };
    for (const o of objects) walk(o);
    return [...out];
  },

  /** `inline` over every page of `doc`. */
  documentInline(doc: LekhDocument): string[] {
    const out = new Set<string>();
    for (const p of doc.pages) for (const key of ImageRefs.inline(p.objectStore.objects)) out.add(key);
    return [...out];
  },

  page(page: Page): string[] {
    return ImageRefs.collect(page.objectStore.objects);
  },

  document(doc: LekhDocument): string[] {
    const out = new Set<string>();
    for (const p of doc.pages) for (const url of ImageRefs.page(p)) out.add(url);
    return [...out];
  },
});

export interface ImageRequestsOptions {
  readonly cache: Pick<ImageCache, 'missing' | 'markPending'>;
  readonly port: ImageRequestPort;
  readonly scheduler: Scheduler;
}

/** Batches the image requests of one event into one deferred `ImagePort.request`. */
export class ImageRequests {
  private readonly cache_: Pick<ImageCache, 'missing' | 'markPending'>;
  private readonly port_: ImageRequestPort;
  private readonly scheduler_: Scheduler;
  private pending_: string[] = [];
  private timer_: Handle | null = null;
  private disposed_ = false;

  constructor(opts: ImageRequestsOptions) {
    this.cache_ = opts.cache;
    this.port_ = opts.port;
    this.scheduler_ = opts.scheduler;
  }

  /** URLs waiting for the deferred request. */
  get queued(): readonly string[] {
    return this.pending_;
  }

  /** Requests what `urls` names and the cache neither holds nor awaits; returns those URLs. */
  schedule(urls: Iterable<string>): string[] {
    if (this.disposed_) return [];
    const missing = this.cache_.missing(urls);
    if (missing.length === 0) return missing;
    this.cache_.markPending(missing);
    this.pending_.push(...missing);
    this.timer_ ??= this.scheduler_.setTimeout(() => {
      this.fire();
    }, 0);
    return missing;
  }

  /** `schedule` for the objects just created or loaded: their URLs and their inline images' keys. */
  scheduleFor(objects: Iterable<LekhObject>): string[] {
    const list = [...objects];
    return this.schedule([...ImageRefs.collect(list), ...ImageRefs.inline(list)]);
  }

  /** Cancels the deferred request. Idempotent. */
  dispose(): void {
    this.disposed_ = true;
    if (this.timer_ !== null) this.scheduler_.clearTimeout(this.timer_);
    this.timer_ = null;
    this.pending_ = [];
  }

  private fire(): void {
    this.timer_ = null;
    const urls = this.pending_;
    this.pending_ = [];
    if (!this.disposed_ && urls.length > 0) this.port_.request(urls);
  }
}
