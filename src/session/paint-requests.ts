// `requestPaint(layer)` (spec 01 §4.2): repaint requests coalesced per frame over
// `Scheduler.requestFrame`. Any number of requests before the frame give one `requestFrame` and one
// `paintRequested` per layer asked for, in grid → drawing → middle order. The host's
// `interaction/FrameScheduler` is the browser `requestFrame` (one `requestAnimationFrame` per
// frame); there is no second repaint mechanism.
import type { Handle, Scheduler } from '../base';
import type { PaintLayer } from './ports';

const ORDER: readonly PaintLayer[] = Object.freeze(['grid', 'drawing', 'middle']);

export class PaintRequests {
  private readonly scheduler_: Scheduler;
  private readonly emit_: (layer: PaintLayer) => void;
  private readonly pending_ = new Set<PaintLayer>();
  private frame_: Handle | null = null;
  private disposed_ = false;

  constructor(scheduler: Scheduler, emit: (layer: PaintLayer) => void) {
    this.scheduler_ = scheduler;
    this.emit_ = emit;
  }

  /** Layers waiting for the frame. */
  get pending(): readonly PaintLayer[] {
    return ORDER.filter((l) => this.pending_.has(l));
  }

  /** Whether a frame is requested. */
  get scheduled(): boolean {
    return this.frame_ !== null;
  }

  request(layer: PaintLayer): void {
    if (this.disposed_) return;
    this.pending_.add(layer);
    this.frame_ ??= this.scheduler_.requestFrame(() => {
      this.fire();
    });
  }

  /** Cancels the frame request. Idempotent. */
  dispose(): void {
    this.disposed_ = true;
    if (this.frame_ !== null) this.scheduler_.cancelFrame(this.frame_);
    this.frame_ = null;
    this.pending_.clear();
  }

  private fire(): void {
    this.frame_ = null;
    const layers = this.pending;
    this.pending_.clear();
    if (this.disposed_) return;
    for (const l of layers) this.emit_(l);
  }
}
