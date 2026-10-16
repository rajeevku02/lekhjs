// Two-finger pinch, pan and rotate in competition (1:1 port of C++ `MultiTouchRecognizer`,
// `ScaleRecognizer`, `ScrollRecognizer`, `RotateRecognizer`, `L/event/*Recognizer.cpp`).
// `ScrollRecognizer` has no momentum (KB `input-and-gestures.md` says it does; it does not).
import { Point, angleWithHorizontal, getDistance } from '../geometry';
import { EventName, GESTURE_CONSTANTS, Movement, type GestureListener } from './gesture-listener';
import { pointOf, type EventPoint, type PointerEvent } from './input-event';

export interface PointerPair {
  first: EventPoint;
  second: EventPoint;
}

/** C++ `std::map<long, pair<EventPoint, EventPoint>>`: iterated in pointer-id order. */
export class PointerPositions {
  private readonly map_ = new Map<number, PointerPair>();

  get size(): number {
    return this.map_.size;
  }

  has(id: number): boolean {
    return this.map_.has(id);
  }

  get(id: number): PointerPair | undefined {
    return this.map_.get(id);
  }

  set(id: number, e: EventPoint): void {
    this.map_.set(id, { first: e, second: e });
  }

  /** C++ `positions_[id].second.x/y = …`. */
  moveTo(id: number, x: number, y: number): void {
    const p = this.map_.get(id);
    if (p !== undefined) p.second = { ...p.second, x, y };
  }

  delete(id: number): void {
    this.map_.delete(id);
  }

  clear(): void {
    this.map_.clear();
  }

  /** Entries in ascending pointer id. */
  entries(): [number, PointerPair][] {
    return [...this.map_.entries()].sort((a, b) => a[0] - b[0]);
  }
}

export const RecognizerState = Object.freeze({ Init: 0, Active: 1, Cancelled: 2 } as const);
export type RecognizerState = (typeof RecognizerState)[keyof typeof RecognizerState];

/** What the three recognisers share with the gesture recogniser. */
export interface MultiTouchShared {
  readonly positions: PointerPositions;
  /** The event in progress (its points are rewritten). */
  readonly event: () => PointerEvent;
  readonly listener: GestureListener;
}

export abstract class MultiTouchRecognizer {
  protected readonly shared: MultiTouchShared;
  protected state_: RecognizerState = RecognizerState.Init;
  protected readonly competitors_: MultiTouchRecognizer[] = [];
  protected latest_: EventPoint[] = [];
  protected mid_ = new Point();

  constructor(shared: MultiTouchShared) {
    this.shared = shared;
  }

  abstract reset(): void;
  abstract onMove(ept: EventPoint, type: Movement): void;
  abstract onPointerReplace(): void;

  get state(): RecognizerState {
    return this.state_;
  }

  isCancelled(): boolean {
    return this.state_ === RecognizerState.Cancelled;
  }

  cancel(): void {
    this.state_ = RecognizerState.Cancelled;
  }

  addCompetitor(c: MultiTouchRecognizer): void {
    this.competitors_.push(c);
  }

  protected capturePoints(): void {
    let sx = 0;
    let sy = 0;
    this.latest_ = [];
    for (const [, p] of this.shared.positions.entries()) {
      this.latest_.push(p.second);
      sx += p.second.x;
      sy += p.second.y;
    }
    const n = this.latest_.length;
    this.mid_ = n === 0 ? new Point() : new Point(sx / n, sy / n);
    this.shared.event().points = this.latest_.slice();
  }

  protected cancelCompetitors(): void {
    for (const c of this.competitors_) c.cancel();
  }

  protected isCompetitorActive(): boolean {
    return this.competitors_.some((c) => c.state === RecognizerState.Active);
  }

  /** The first two pairs in id order (C++ `pair1`, `pair2`). */
  protected twoPairs(): [PointerPair, PointerPair] | null {
    const e = this.shared.positions.entries();
    const a = e[0]?.[1];
    const b = e[e.length > 1 ? e.length - 1 : 1]?.[1];
    if (a === undefined || b === undefined) return null;
    return [a, b];
  }
}

export class ScaleRecognizer extends MultiTouchRecognizer {
  threshold: number = GESTURE_CONSTANTS.scaleThreshold;
  private initialDistance_ = 0;
  private currentScale_ = 1;

  reset(): void {
    if (this.state_ === RecognizerState.Active) {
      this.shared.listener.onScale(this.mid_, this.shared.event(), this.currentScale_, Movement.End);
    }
    this.state_ = RecognizerState.Init;
  }

  onMove(_ept: EventPoint, type: Movement): void {
    if (type === Movement.Start) {
      this.state_ =
        this.shared.positions.size === 2 && !this.isCompetitorActive()
          ? RecognizerState.Init
          : RecognizerState.Cancelled;
    }
    if (this.state_ === RecognizerState.Cancelled) return;
    if (type === Movement.End) {
      if (this.state_ === RecognizerState.Active) {
        this.shared.listener.onScale(this.mid_, this.shared.event(), this.currentScale_, Movement.End);
      }
      this.state_ = RecognizerState.Init;
      return;
    }
    this.capturePoints();
    if (this.state_ !== RecognizerState.Active) {
      this.checkCondition();
    } else {
      const a = this.latest_[0];
      const b = this.latest_[1];
      if (a === undefined || b === undefined) return;
      this.currentScale_ = getDistance(pointOf(a), pointOf(b)) / this.initialDistance_;
      this.shared.listener.onScale(this.mid_, this.shared.event(), this.currentScale_, Movement.Move);
    }
  }

  private checkCondition(): void {
    const pairs = this.twoPairs();
    if (pairs === null) return;
    const [p1, p2] = pairs;
    const d1 = getDistance(pointOf(p1.first), pointOf(p2.first));
    const d2 = getDistance(pointOf(p1.second), pointOf(p2.second));
    if (Math.abs(d1 - d2) >= this.threshold && d2 > 0) {
      this.state_ = RecognizerState.Active;
      this.initialDistance_ = d2;
      this.currentScale_ = 1;
      this.cancelCompetitors();
      this.shared.listener.onScale(this.mid_, this.shared.event(), this.currentScale_, Movement.Start);
    }
  }

  onPointerReplace(): void {
    if (this.state_ !== RecognizerState.Active) return;
    const pairs = this.twoPairs();
    if (pairs === null) return;
    const d = getDistance(pointOf(pairs[0].second), pointOf(pairs[1].second));
    if (d > 0) this.initialDistance_ = d / this.currentScale_;
  }
}

export class ScrollRecognizer extends MultiTouchRecognizer {
  threshold: number = GESTURE_CONSTANTS.scrollThreshold;

  reset(): void {
    if (this.state_ === RecognizerState.Active) {
      this.shared.listener.onPan(this.mid_, this.shared.event(), Movement.End);
    }
    this.state_ = RecognizerState.Init;
  }

  onMove(_ept: EventPoint, type: Movement): void {
    if (type === Movement.Start) {
      this.state_ = this.isCompetitorActive() ? RecognizerState.Cancelled : RecognizerState.Init;
    }
    if (this.state_ === RecognizerState.Cancelled) return;
    if (type === Movement.End) {
      if (this.state_ === RecognizerState.Active) {
        this.shared.listener.onPan(this.mid_, this.shared.event(), Movement.End);
      }
      this.state_ = RecognizerState.Init;
      return;
    }
    this.capturePoints();
    if (this.state_ === RecognizerState.Active) {
      this.shared.listener.onPan(this.mid_, this.shared.event(), Movement.Move);
    } else {
      this.checkCondition();
    }
  }

  private checkCondition(): void {
    const dx: number[] = [];
    const dy: number[] = [];
    for (const [, p] of this.shared.positions.entries()) {
      dx.push(p.second.x - p.first.x);
      dy.push(p.second.y - p.first.y);
      if (getDistance(pointOf(p.first), pointOf(p.second)) < this.threshold) return;
    }
    const sameSign = (nums: readonly number[]): boolean => {
      const ref = nums.find((n) => n !== 0);
      if (ref === undefined) return true;
      return nums.every((n) => n * ref >= 0);
    };
    if (this.shared.positions.size === 2 && (!sameSign(dx) || !sameSign(dy))) return;
    this.state_ = RecognizerState.Active;
    this.cancelCompetitors();
    this.shared.listener.onPan(this.mid_, this.shared.event(), Movement.Start);
  }

  onPointerReplace(): void {
    /* C++: nothing */
  }
}

export class RotateRecognizer extends MultiTouchRecognizer {
  threshold: number = GESTURE_CONSTANTS.rotateThreshold;
  private currentRotation_ = 0;
  private pid1_ = 0;
  private pid2_ = 0;
  private initialAngle_ = 0;
  private deltaAngle_ = 0;

  reset(): void {
    if (this.state_ === RecognizerState.Active) {
      this.shared.listener.onRotate(this.mid_, this.shared.event(), this.currentRotation_, Movement.End);
    }
    this.state_ = RecognizerState.Init;
    this.initialAngle_ = 0;
    this.deltaAngle_ = 0;
  }

  onMove(_ept: EventPoint, type: Movement): void {
    if (type === Movement.Start) {
      if (this.shared.positions.size === 2 && !this.isCompetitorActive()) {
        this.reset();
        this.state_ = RecognizerState.Init;
        this.assignPids();
      } else {
        this.state_ = RecognizerState.Cancelled;
      }
    }
    if (this.state_ === RecognizerState.Cancelled) return;
    if (type === Movement.End) {
      if (this.state_ === RecognizerState.Active) {
        this.shared.listener.onRotate(this.mid_, this.shared.event(), this.currentRotation_, Movement.End);
      }
      this.state_ = RecognizerState.Init;
      return;
    }
    this.capturePoints();
    if (this.state_ !== RecognizerState.Active) {
      this.checkCondition();
    } else {
      this.currentRotation_ = this.angle() - this.initialAngle_ + this.deltaAngle_;
      this.shared.listener.onRotate(this.mid_, this.shared.event(), this.currentRotation_, Movement.Move);
    }
  }

  private checkCondition(): void {
    const res = this.shared.listener.canDoAt(EventName.Rotate, this.mid_, this.shared.event());
    if (!res.canHandle) return;
    const a = this.angle();
    if (Math.abs(a - this.initialAngle_) > this.threshold) {
      this.currentRotation_ = this.angle() - this.initialAngle_;
      this.state_ = RecognizerState.Active;
      this.cancelCompetitors();
      this.shared.listener.onRotate(this.mid_, this.shared.event(), this.currentRotation_, Movement.Start);
    }
  }

  private assignPids(): void {
    const e = this.shared.positions.entries();
    const ea = e[0];
    const eb = e[1];
    if (ea === undefined || eb === undefined) return;
    const [aid, a] = ea;
    const [bid, b] = eb;
    const apt = a.first;
    const bpt = b.first;
    if (apt.x < bpt.x || (apt.x === bpt.x && apt.y < bpt.y)) {
      this.pid1_ = aid;
      this.pid2_ = bid;
    } else {
      this.pid1_ = bid;
      this.pid2_ = aid;
    }
    const p1 = this.shared.positions.get(this.pid1_)?.first;
    const p2 = this.shared.positions.get(this.pid2_)?.first;
    if (p1 !== undefined && p2 !== undefined) this.initialAngle_ = angleWithHorizontal(pointOf(p1), pointOf(p2));
  }

  private angle(): number {
    const p1 = this.shared.positions.get(this.pid1_)?.second;
    const p2 = this.shared.positions.get(this.pid2_)?.second;
    if (p1 !== undefined && p2 !== undefined) return Math.atan2(p2.y - p1.y, p2.x - p1.x);
    return this.initialAngle_;
  }

  onPointerReplace(): void {
    this.assignPids();
    this.deltaAngle_ = this.currentRotation_;
  }
}
