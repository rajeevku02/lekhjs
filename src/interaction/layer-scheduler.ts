// Per-layer repaint coalesced to one frame (spec 02 `LayerScheduler` and `FrameScheduler`; C++
// `WidgetObject::setNeedsDisplay` / `Platform::drawCanvas`). `invalidate(layer)` any number of
// times before a frame gives one `requestFrame` and one paint per dirty layer, in grid → drawing →
// middle order. `FrameScheduler` is `requestAnimationFrame` in the browser and a manual tick in
// tests; nothing here reads a global.
import type { PaintLayer } from '../session';

export interface FrameScheduler {
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(handle: number): void;
}

/** A frame scheduler the test (or a headless host) ticks by hand. */
export class ManualFrameScheduler implements FrameScheduler {
  private seq_ = 0;
  private readonly pending_ = new Map<number, (t: number) => void>();

  requestFrame(cb: (t: number) => void): number {
    const h = ++this.seq_;
    this.pending_.set(h, cb);
    return h;
  }

  cancelFrame(handle: number): void {
    this.pending_.delete(handle);
  }

  get pending(): number {
    return this.pending_.size;
  }

  /** Runs the frames requested so far. */
  tick(t = 0): void {
    const cbs = [...this.pending_.values()];
    this.pending_.clear();
    for (const cb of cbs) cb(t);
  }
}

const ORDER: readonly PaintLayer[] = Object.freeze(['grid', 'drawing', 'middle']);

export class LayerScheduler {
  private readonly frames_: FrameScheduler;
  private readonly paint_: (layer: PaintLayer) => void;
  private readonly dirty_ = new Set<PaintLayer>();
  private frame_: number | null = null;
  private disposed_ = false;

  constructor(frames: FrameScheduler, paint: (layer: PaintLayer) => void) {
    this.frames_ = frames;
    this.paint_ = paint;
  }

  invalidate(layer: PaintLayer): void {
    if (this.disposed_) return;
    this.dirty_.add(layer);
    this.frame_ ??= this.frames_.requestFrame(() => {
      this.flush();
    });
  }

  invalidateAll(): void {
    for (const l of ORDER) this.invalidate(l);
  }

  get dirty(): readonly PaintLayer[] {
    return ORDER.filter((l) => this.dirty_.has(l));
  }

  /** Paints the dirty layers now. */
  flush(): void {
    this.frame_ = null;
    const layers = this.dirty;
    this.dirty_.clear();
    if (this.disposed_) return;
    for (const l of layers) this.paint_(l);
  }

  dispose(): void {
    this.disposed_ = true;
    if (this.frame_ !== null) this.frames_.cancelFrame(this.frame_);
    this.frame_ = null;
    this.dirty_.clear();
  }
}
