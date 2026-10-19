// The tap / double-tap / long-press / move state machine (1:1 port of C++
// `event::GestureRecognizer`, `L/event/GestureRecognizer.cpp`): Init → Down → WaitForClick /
// Moving → WaitForMoveEnd / LongPressDown, with the C++ constants (`GESTURE_CONSTANTS`). Two or
// more pointers that move go to the scale / scroll / rotate recognisers in competition.
//
// Timers come from `GestureTimers` (the host scheduler; a manual clock in tests); no module state.
import { Point, getDistance } from '../geometry';
import { EventName, GESTURE_CONSTANTS, Movement, type GestureListener, type GestureTimers } from './gesture-listener';
import { PointerEvent, PointState, midOf, pointOf, type EventPoint } from './input-event';
import type { InputTrace } from './input-trace';
import {
  PointerPositions,
  RotateRecognizer,
  ScaleRecognizer,
  ScrollRecognizer,
  type MultiTouchShared,
} from './multi-touch';

const State = Object.freeze({
  Init: 0,
  Down: 1,
  WaitForClick: 2,
  Moving: 3,
  WaitForMoveEnd: 4,
  LongPressDown: 5,
} as const);
type State = (typeof State)[keyof typeof State];
const STATE_NAMES = Object.freeze([
  'Init',
  'Down',
  'WaitForClick',
  'Moving',
  'WaitForMoveEnd',
  'LongPressDown',
] as const);

function veryNear(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.1;
}

export interface GestureRecognizerOptions {
  /** `Config.onlyDrawWithPencil`, read on every event. */
  readonly onlyDrawWithPencil?: () => boolean;
  /** The opt-in input trace (state changes, stale-gesture resets). */
  readonly trace?: InputTrace;
}

export class GestureRecognizer {
  doubleTapGap: number = GESTURE_CONSTANTS.doubleTapMs;
  longPressTime: number = GESTURE_CONSTANTS.longPressMs;
  moveThreshold: number = GESTURE_CONSTANTS.moveThreshold;
  doubleClickMoveThreshold: number = GESTURE_CONSTANTS.doubleClickTolerance;

  private readonly listener_: GestureListener;
  private readonly timers_: GestureTimers;
  private readonly onlyPencil_: () => boolean;
  private readonly trace_: InputTrace | null;
  private current_ = new PointerEvent();
  private inProgress_ = new PointerEvent();
  private state_: State = State.Init;
  private readonly positions_ = new PointerPositions();
  private numMovePoints_ = 0;
  private saved_: EventPoint[] = [];
  private waitingForDoubleClick_ = false;
  private firstClickAt_: EventPoint | null = null;
  private doubleClickTimer_ = 0;
  private longPressInProgress_ = false;
  private longPressTimer_ = 0;
  private readonly scale_: ScaleRecognizer;
  private readonly scroll_: ScrollRecognizer;
  private readonly rotate_: RotateRecognizer;

  constructor(listener: GestureListener, timers: GestureTimers, opts: GestureRecognizerOptions = {}) {
    this.listener_ = listener;
    this.timers_ = timers;
    this.onlyPencil_ = opts.onlyDrawWithPencil ?? (() => false);
    this.trace_ = opts.trace ?? null;
    const shared: MultiTouchShared = {
      positions: this.positions_,
      event: () => this.inProgress_,
      listener,
    };
    this.scale_ = new ScaleRecognizer(shared);
    this.scroll_ = new ScrollRecognizer(shared);
    this.rotate_ = new RotateRecognizer(shared);
    this.scale_.addCompetitor(this.scroll_);
    this.scale_.addCompetitor(this.rotate_);
    this.scroll_.addCompetitor(this.scale_);
    this.scroll_.addCompetitor(this.rotate_);
    this.rotate_.addCompetitor(this.scroll_);
    this.rotate_.addCompetitor(this.scale_);
  }

  set scrollThreshold(v: number) {
    this.scroll_.threshold = v;
  }
  set scaleThreshold(v: number) {
    this.scale_.threshold = v;
  }
  set rotateThreshold(v: number) {
    this.rotate_.threshold = v;
  }

  inProgress(): boolean {
    return this.state_ !== State.Init;
  }

  /** The pointers down: first and latest point per id (remote pointer trackers draw them). */
  positions(): readonly { first: EventPoint; second: EventPoint }[] {
    return this.positions_.entries().map(([, p]) => p);
  }

  private resetAll(): void {
    this.reset();
    this.waitingForDoubleClick_ = false;
  }

  /**
   * Forgets the gesture in progress (the host's `resetPointerInputState`): the drag handler is
   * cancelled, or — one that cannot be cancelled — ends at the gesture's last point (`onCancel`).
   * A pending long press is dropped too, so it cannot fire into the next gesture.
   */
  reset(): void {
    this.onCancel();
    this.resetLongPressTimer();
    this.state_ = State.Init;
    this.numMovePoints_ = 0;
    this.positions_.clear();
    this.saved_ = [];
  }

  onCancel(): void {
    const p0 = this.inProgress_.points[0];
    const at = p0 !== undefined ? pointOf(p0) : new Point();
    // A cancelled gesture is not a drop: the drag handler is cancelled before the End below.
    this.listener_.cancelDrag();
    if (this.state_ === State.Moving || this.state_ === State.WaitForMoveEnd) {
      if (this.numMovePoints_ > 1) {
        this.scale_.reset();
        this.scroll_.reset();
        this.rotate_.reset();
      } else {
        this.listener_.onPan(at, this.inProgress_, Movement.End);
      }
    } else if (this.state_ === State.LongPressDown) {
      this.listener_.onLongPress(at, this.inProgress_, Movement.End);
    }
  }

  /** The recogniser's state name (the input trace and tests). */
  get stateName(): string {
    return STATE_NAMES[this.state_];
  }

  onPointerEvent(ev: PointerEvent): boolean {
    // A Down for a pointer that is still down in the gesture in progress: its Up was lost (the
    // host never saw it). End that gesture the way a cancel does (C++ hosts reset the recogniser
    // when a first pointer goes down: Android ACTION_DOWN, iOS a touch set with no known touch),
    // then take the Down as the start of a new one.
    if (this.state_ !== State.Init) {
      for (const pt of ev.points) {
        if (pt.state === PointState.Down && this.positions_.has(pt.pointerId)) {
          this.trace_?.emit('rec.stale_down', { id: pt.pointerId, state: this.stateName });
          this.reset();
          break;
        }
      }
    }
    const before = this.state_;
    const r = this.onPointerEventInner(ev);
    if (this.trace_?.on === true && this.state_ !== before) {
      this.trace_.emit('rec.state', { from: STATE_NAMES[before], to: this.stateName });
    }
    return r;
  }

  private onPointerEventInner(ev: PointerEvent): boolean {
    if (this.state_ !== State.Init && this.onlyPencil_()) {
      if (ev.isPencil() && !this.inProgress_.isPencil()) {
        this.resetAll();
      } else if (!ev.isPencil() && this.inProgress_.isPencil()) {
        return false;
      }
    }
    this.current_ = ev;
    for (const pt of ev.points) this.handle(pt);
    return true;
  }

  private handle(e: EventPoint): void {
    switch (this.state_) {
      case State.Init:
        this.whenInit(e);
        return;
      case State.Down:
        this.whenDown(e);
        return;
      case State.WaitForClick:
        this.whenWaitForClick(e);
        return;
      case State.Moving:
        this.whenMoving(e);
        return;
      case State.WaitForMoveEnd:
        this.whenWaitForMoveEnd(e);
        return;
      case State.LongPressDown:
        this.whenLongPressDown(e);
        return;
    }
  }

  private whenInit(e: EventPoint): void {
    const drawOnly = this.listener_.isDrawOnlyMode(pointOf(e));
    if (e.state === PointState.Down) {
      this.inProgress_ = this.current_.clone();
      this.state_ = State.Down;
      this.positions_.set(e.pointerId, e);
      if (!drawOnly) this.startLongPressTimer(e);
      this.listener_.onDown(pointOf(e), this.current_);
    }
    if (drawOnly && (this.current_.isPencil() || this.current_.isMouseDevice())) this.checkMoved(e, true);
  }

  private whenDown(e: EventPoint): void {
    if (e.state === PointState.Down) {
      this.positions_.set(e.pointerId, e);
      this.resetLongPressTimer();
    } else if (this.positions_.has(e.pointerId)) {
      if (e.state === PointState.Up) {
        this.resetLongPressTimer();
        this.state_ = State.WaitForClick;
        this.whenWaitForClick(e);
      } else if (e.state === PointState.Move) {
        this.positions_.moveTo(e.pointerId, e.x, e.y);
        this.checkMoved(e, false);
      }
    }
  }

  private whenWaitForClick(e: EventPoint): void {
    if (e.state !== PointState.Up) return;
    const p = this.positions_.get(e.pointerId);
    if (p !== undefined) {
      this.saved_.push(p.first);
      this.positions_.delete(e.pointerId);
    }
    if (this.positions_.size === 0) this.gotClick(e);
  }

  private whenMoving(e: EventPoint): void {
    if (!this.positions_.has(e.pointerId)) return;
    if (e.state === PointState.Up) {
      this.state_ = State.WaitForMoveEnd;
      this.whenWaitForMoveEnd(e);
    } else if (e.state === PointState.Move) {
      this.positions_.moveTo(e.pointerId, e.x, e.y);
      this.gotMove(e, Movement.Move);
    }
  }

  private whenWaitForMoveEnd(e: EventPoint): void {
    if (e.state === PointState.Down) {
      this.positions_.set(e.pointerId, e);
      if (this.positions_.size === this.numMovePoints_) {
        this.state_ = State.Moving;
        this.scale_.onPointerReplace();
        this.scroll_.onPointerReplace();
        this.rotate_.onPointerReplace();
        this.gotMove(e, Movement.Move);
      }
    }
    if (this.positions_.has(e.pointerId)) {
      if (e.state === PointState.Up) {
        this.positions_.delete(e.pointerId);
        if (this.positions_.size === 0) this.gotMove(e, Movement.End);
      } else if (e.state === PointState.Move) {
        this.positions_.moveTo(e.pointerId, e.x, e.y);
      }
    }
  }

  private whenLongPressDown(e: EventPoint): void {
    if (!this.positions_.has(e.pointerId)) return;
    if (e.state === PointState.Up) {
      this.gotLongPress(e, Movement.End);
      this.resetAll();
    } else if (e.state === PointState.Move) {
      this.gotLongPress(e, Movement.Move);
    }
  }

  private startLongPressTimer(e: EventPoint): void {
    if (this.longPressInProgress_) return;
    const res = this.listener_.canDoAt(EventName.LongPress, pointOf(e), this.current_);
    if (!res.canHandle) return;
    this.longPressInProgress_ = true;
    const interval = res.param > 0 ? res.param : this.longPressTime;
    this.longPressTimer_ = this.timers_.setTimer(interval, () => {
      this.longPressInProgress_ = false;
      this.trace_?.emit('rec.state', { from: this.stateName, to: 'LongPressDown', timer: true });
      this.state_ = State.LongPressDown;
      this.gotLongPress(e, Movement.Start);
    });
  }

  private resetLongPressTimer(): void {
    if (this.longPressInProgress_) {
      this.longPressInProgress_ = false;
      this.timers_.clearTimer(this.longPressTimer_);
    }
  }

  private checkMoved(e: EventPoint, force: boolean): void {
    for (const [, p] of this.positions_.entries()) {
      if (getDistance(pointOf(p.first), pointOf(p.second)) >= this.moveThreshold || force) {
        this.resetLongPressTimer();
        this.state_ = State.Moving;
        this.numMovePoints_ = this.positions_.size;
        this.gotMove(e, Movement.Start);
      }
    }
  }

  private gotClick(e: EventPoint): void {
    this.listener_.onUp(pointOf(e), this.current_);
    if (this.saved_.length === 0) {
      this.reset();
      return;
    }
    const firstClickEvent = this.inProgress_.clone();
    const first = this.firstClickAt_;
    firstClickEvent.points = first !== null ? [first] : [];
    const mid = midOf(this.saved_);
    this.inProgress_.points = this.saved_.slice();
    if (this.waitingForDoubleClick_) this.timers_.clearTimer(this.doubleClickTimer_);

    if (this.saved_.length > 1) {
      if (this.waitingForDoubleClick_) {
        this.waitingForDoubleClick_ = false;
        if (first !== null) this.listener_.onClick(pointOf(first), firstClickEvent);
      }
      this.listener_.onClick(mid, this.inProgress_);
    } else if (this.waitingForDoubleClick_) {
      this.waitingForDoubleClick_ = false;
      const firstPt = first !== null ? pointOf(first) : mid;
      if (getDistance(firstPt, mid) > this.doubleClickMoveThreshold) {
        this.listener_.onClick(firstPt, firstClickEvent);
        this.listener_.onClick(mid, this.inProgress_);
      } else {
        this.listener_.onDoubleClick(firstPt, this.inProgress_);
      }
    } else {
      const res = this.listener_.canDoAt(EventName.DoubleClick, pointOf(e), this.current_);
      if (res.canHandle) {
        this.firstClickAt_ = e;
        const tmp = this.inProgress_.clone();
        this.waitingForDoubleClick_ = true;
        this.doubleClickTimer_ = this.timers_.setTimer(this.doubleTapGap, () => {
          const at = this.firstClickAt_;
          this.listener_.onClick(at !== null ? pointOf(at) : mid, tmp.clone());
          this.waitingForDoubleClick_ = false;
        });
      } else {
        this.listener_.onClick(pointOf(e), this.current_);
      }
    }
    this.reset();
  }

  private gotMove(e: EventPoint, type: Movement): void {
    if (type === Movement.End) this.listener_.onUp(pointOf(e), this.current_);
    if (this.numMovePoints_ > 1) {
      this.scale_.onMove(e, type);
      this.scroll_.onMove(e, type);
      this.rotate_.onMove(e, type);
    } else {
      this.inProgress_.points = [e];
      if (type === Movement.Start) {
        const p = this.positions_.get(e.pointerId);
        if (p !== undefined) {
          const firstPt = pointOf(p.first);
          this.listener_.onPan(firstPt, this.inProgress_, Movement.Start);
          if (!veryNear(pointOf(e), firstPt)) this.listener_.onPan(pointOf(e), this.inProgress_, Movement.Move);
        } else {
          this.listener_.onPan(pointOf(e), this.inProgress_, Movement.Start);
        }
      } else {
        this.listener_.onPan(pointOf(e), this.inProgress_, type);
      }
    }
    if (type === Movement.End) this.resetAll();
  }

  private gotLongPress(e: EventPoint, type: Movement): void {
    if (type === Movement.End) this.listener_.onUp(pointOf(e), this.current_);
    this.inProgress_.points = [e];
    this.listener_.onLongPress(pointOf(e), this.inProgress_, type);
  }
}
