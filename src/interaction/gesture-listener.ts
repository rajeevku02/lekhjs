// The gesture constants (spec 05 §4.1) and the recogniser → router interface (port of C++
// `event::GestureListener`, `L/event/GestureListener.h`).
import type { Point } from '../geometry';
import type { PointerEvent } from './input-event';

/**
 * The C++ values, kept (AC-UI-02). `GestureRecognizer.cpp:30-35`, `ScaleRecognizer.cpp:13`,
 * `ScrollRecognizer.cpp:24`, `RotateRecognizer.cpp:11`; hit radii `Config::closePointDistanceShort`
 * (mouse, pen) and `Config::vertexHandleRadius` (finger).
 */
export const GESTURE_CONSTANTS = Object.freeze({
  doubleTapMs: 250,
  longPressMs: 500,
  moveThreshold: 10,
  doubleClickTolerance: 50,
  maxTouches: 3,
  scaleThreshold: 16,
  scrollThreshold: 12,
  rotateThreshold: 0.26,
  hitRadius: Object.freeze({ mouse: 15, pen: 15, touch: 16 }),
});

/** C++ `EventName`. */
export const EventName = Object.freeze({
  Down: 0,
  Up: 1,
  Click: 2,
  DoubleClick: 3,
  LongPress: 4,
  Pan: 5,
  Scale: 6,
  Rotate: 7,
  Scroll: 8,
  Hover: 9,
  Generic: 10,
} as const);
export type EventName = (typeof EventName)[keyof typeof EventName];

/** C++ `PointerMovement`. */
export const Movement = Object.freeze({ Start: 0, Move: 1, End: 2 } as const);
export type Movement = (typeof Movement)[keyof typeof Movement];

/** C++ `EventCheckResult`. */
export interface EventCheck {
  canHandle: boolean;
  shouldBlock: boolean;
  /** A long-press duration (ms) when positive. */
  param: number;
}

export function check(canHandle: boolean, shouldBlock: boolean, param = 0): EventCheck {
  return { canHandle, shouldBlock, param };
}

/** C++ `EventCheckResult::merge`. */
export function mergeCheck(into: EventCheck, other: EventCheck): void {
  into.canHandle ||= other.canHandle;
  into.shouldBlock ||= other.shouldBlock;
  if (other.canHandle) into.param = other.param;
}

export interface GestureListener {
  canDoAt(name: EventName, at: Point, ev: PointerEvent): EventCheck;
  isDrawOnlyMode(at: Point): boolean;
  onDown(at: Point, ev: PointerEvent): boolean;
  onUp(at: Point, ev: PointerEvent): boolean;
  onClick(at: Point, ev: PointerEvent): boolean;
  onDoubleClick(at: Point, ev: PointerEvent): boolean;
  onPan(at: Point, ev: PointerEvent, m: Movement): boolean;
  onScale(at: Point, ev: PointerEvent, value: number, m: Movement): boolean;
  onRotate(at: Point, ev: PointerEvent, value: number, m: Movement): boolean;
  onLongPress(at: Point, ev: PointerEvent, m: Movement): boolean;
  /** The gesture is being cancelled: abandon an active drag before its End. */
  cancelDrag(): void;
}

/** The timers the recogniser needs (the host scheduler; a manual clock in tests). */
export interface GestureTimers {
  setTimer(ms: number, fn: () => void): number;
  clearTimer(id: number): void;
}
