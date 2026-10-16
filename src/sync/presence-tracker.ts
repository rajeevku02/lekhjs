// Remote pointers (port of the data half of C++ `CursorTracker`, `L/update/CursorTracker.cpp`;
// spec 02 `PresenceTracker`). A `trackpointer` frame carries a user's recent pointer points; the
// tracker keeps them per user with a colour, trims a trail to its last point 300 ms after the last
// frame and forgets a user 5 s after it. Painting is `interaction/`'s (the trail radii are here
// as data). Timers go through the `Scheduler` port and are cancelled by `dispose()`.
import type { Clock, Handle, Scheduler } from '../base';
import type { Point } from '../geometry';
import { LEKH_COLORS, type Color } from '../style';

/** C++ `clearPointsDuration`: a trail shrinks to its last point this long after the last frame. */
export const CLEAR_POINTS_MS = 300;
/** C++ `LastPointerDuration`: a user's pointer goes this long after the last frame. */
export const LAST_POINTER_MS = 5000;

/**
 * C++ `CursorTracker()`: `getColors()` without its first two entries (white, black), cut to 21.
 */
export const PRESENCE_COLORS: readonly Color[] = Object.freeze(LEKH_COLORS.slice(2, 23));

/** C++ `PointerLoc`. */
export interface PointerLoc {
  readonly ts: number;
  readonly points: readonly Point[];
  readonly colorIndex: number;
}

/** C++ `drawPoints`' radius of the `idx`-th point back from the newest. */
export function trailRadius(idx: number): number {
  if (idx > 10) return 3;
  return Math.trunc(10 * (1.0 - 0.06 * idx));
}

/**
 * C++ `std::stol(uid) % colors_.size()`: the leading integer of `uid` (optional sign, after
 * leading whitespace), as an unsigned 64-bit value modulo the palette size; 0 when there is none
 * or it overflows a `long`.
 */
export function colorIndexOf(uid: string, n: number = PRESENCE_COLORS.length): number {
  const m = /^\s*([+-]?\d+)/.exec(uid);
  if (m === null || n <= 0) return 0;
  const v = BigInt(m[1] as string);
  const LONG_MAX = 2n ** 63n - 1n;
  if (v > LONG_MAX || v < -LONG_MAX - 1n) return 0;
  return Number(BigInt.asUintN(64, v) % BigInt(n));
}

export interface PresenceTrackerOptions {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** Called when what should be drawn changed (C++ `setNeedsDisplay`). */
  readonly onChange?: () => void;
}

export class PresenceTracker {
  private readonly pointers_ = new Map<string, PointerLoc>();
  private readonly opts_: PresenceTrackerOptions;
  private nextTimer_ = 0;
  private timer_: Handle | null = null;
  private disposed_ = false;

  constructor(opts: PresenceTrackerOptions) {
    this.opts_ = opts;
  }

  /** C++ `hasPoints`. */
  hasPoints(): boolean {
    return this.pointers_.size > 0;
  }

  /** The live pointers by user id, expired points dropped first (C++ `draw`'s first step). */
  pointers(): ReadonlyMap<string, PointerLoc> {
    this.deleteExpiredPoints();
    return this.pointers_;
  }

  /** C++ `updatePointer`. */
  updatePointer(uid: string, pts: readonly Point[]): void {
    if (this.disposed_) return;
    const prev = this.pointers_.get(uid);
    const colorIndex = prev?.colorIndex ?? colorIndexOf(uid);
    this.pointers_.set(uid, { ts: this.opts_.clock.now(), points: pts.slice(), colorIndex });
    this.setTimer();
    this.opts_.onChange?.();
  }

  dispose(): void {
    this.disposed_ = true;
    if (this.timer_ !== null) this.opts_.scheduler.clearTimeout(this.timer_);
    this.timer_ = null;
    this.pointers_.clear();
  }

  private setTimer(): void {
    const cur = this.opts_.clock.now();
    if (cur < this.nextTimer_) return;
    this.nextTimer_ = cur + CLEAR_POINTS_MS;
    this.timer_ = this.opts_.scheduler.setTimeout(() => {
      this.timer_ = null;
      this.onTimer();
    }, CLEAR_POINTS_MS);
  }

  private onTimer(): void {
    if (this.disposed_ || this.pointers_.size === 0) return;
    this.deleteExpiredPoints();
    if (this.pointers_.size > 0) this.setTimer();
    else this.opts_.onChange?.();
  }

  /** C++ `deleteExpiredPoints`. */
  private deleteExpiredPoints(): void {
    const cur = this.opts_.clock.now();
    let needsUpdate = false;
    for (const [uid, loc] of this.pointers_) {
      if (loc.points.length > 1 && loc.ts + CLEAR_POINTS_MS < cur) {
        this.pointers_.set(uid, { ...loc, points: loc.points.slice(-1) });
        needsUpdate = true;
      }
    }
    for (const [uid, loc] of [...this.pointers_]) {
      if (cur - loc.ts > LAST_POINTER_MS) this.pointers_.delete(uid);
    }
    if (needsUpdate) this.opts_.onChange?.();
  }
}
