// The one normalised input model every host feeds (spec 05 §3.1), and the pointer event the
// gesture recogniser works on (port of C++ `event::PointerEvent` / `EventPoint`, `L/event/Event.h`).
//
// The DOM adapter (`DomInputAdapter` in lekhboard-capacitor) builds `InputEvent`s from Pointer
// Events, `wheel`, Safari `gesture*` and `contextmenu`. `InputRouter` turns a `pointer` event into
// one `PointerEvent` per sample for `GestureRecognizer`. Coordinates are view CSS px relative to
// the board stack.
import { Point } from '../geometry';

export type PointerKind = 'mouse' | 'pen' | 'touch';

/** `cmd` is `meta` on Apple hosts and `ctrl` elsewhere (spec 05 §3.4). */
export interface Modifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly cmd: boolean;
}

export const NO_MODIFIERS: Modifiers = Object.freeze({
  shift: false,
  alt: false,
  ctrl: false,
  meta: false,
  cmd: false,
});

export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
}

export type InputEvent =
  | {
      readonly type: 'pointer';
      readonly phase: 'down' | 'move' | 'up' | 'cancel';
      readonly id: number;
      readonly kind: PointerKind;
      readonly eraser: boolean;
      readonly buttons: number;
      /** The DOM `button` of a down/up: 0 left, 1 middle, 2 right; -1 none. */
      readonly button: number;
      readonly samples: readonly PointerSample[];
      readonly mods: Modifiers;
      readonly hover: boolean;
    }
  /** `dx`/`dy` already negated as today. */
  | {
      readonly type: 'wheel';
      readonly x: number;
      readonly y: number;
      readonly dx: number;
      readonly dy: number;
      readonly mods: Modifiers;
    }
  /** Trackpad pinch only. */
  | {
      readonly type: 'scale';
      readonly phase: 'start' | 'move' | 'end';
      readonly x: number;
      readonly y: number;
      readonly scale: number;
    }
  | { readonly type: 'contextmenu'; readonly x: number; readonly y: number }
  /** `resetPointerInputState`. */
  | { readonly type: 'reset' };

export type PointerInput = Extract<InputEvent, { type: 'pointer' }>;

/**
 * The eraser rule of the DOM adapter (spec 05 §3.2, AC-UI-05): a pen whose `buttons` has the
 * eraser bit (32), and on Android also the S Pen side button (2).
 */
export function isEraserTip(kind: PointerKind, buttons: number, host: 'web' | 'ios' | 'android' | 'mac'): boolean {
  if (kind !== 'pen') return false;
  if ((buttons & 32) !== 0) return true;
  return host === 'android' && (buttons & 2) !== 0;
}

// ---- the recogniser's event (C++ `EventPoint` / `PointerEvent`) ----

/** C++ `EventPointState`. */
export const PointState = Object.freeze({ Unknown: 0, Stationary: 1, Down: 2, Move: 3, Up: 4 } as const);
export type PointState = (typeof PointState)[keyof typeof PointState];

/** C++ `PointerType`. */
export const PointerType = Object.freeze({
  Unknown: 0,
  Generic: 1,
  Mouse: 2,
  Finger: 3,
  Pen: 4,
  Eraser: 5,
  Cursor: 6,
} as const);
export type PointerType = (typeof PointerType)[keyof typeof PointerType];

/** C++ `MouseButton`. */
export const MouseButton = Object.freeze({ None: 0, Left: 1, Right: 2, Middle: 4, Back: 8 } as const);
export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

/** C++ `EventPoint`. */
export interface EventPoint {
  readonly x: number;
  readonly y: number;
  readonly pointerId: number;
  readonly state: PointState;
  readonly pressure: number;
  readonly timestamp: number;
  readonly pointerType: PointerType;
  readonly button: MouseButton;
}

export function eventPoint(p: Partial<EventPoint> & Pick<EventPoint, 'x' | 'y' | 'state'>): EventPoint {
  return {
    pointerId: 0,
    pressure: 0,
    timestamp: 0,
    pointerType: PointerType.Generic,
    button: MouseButton.None,
    ...p,
  };
}

export function pointOf(e: EventPoint): Point {
  return new Point(e.x, e.y);
}

/** C++ `EventUtil::mid`. */
export function midOf(points: readonly EventPoint[]): Point {
  if (points.length === 0) return new Point();
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return new Point(sx / points.length, sy / points.length);
}

/**
 * C++ `PointerEvent`: the points of one input step plus the modifiers. Mutable like the C++ class
 * (the recogniser rewrites `points` of the event in progress); copy with `clone()`.
 */
export class PointerEvent {
  points: EventPoint[];
  mods: Modifiers;
  /** C++ `deviceType() == Mouse`. */
  mouseDevice: boolean;

  constructor(points: EventPoint[] = [], mods: Modifiers = NO_MODIFIERS, mouseDevice = false) {
    this.points = points;
    this.mods = mods;
    this.mouseDevice = mouseDevice;
  }

  clone(): PointerEvent {
    return new PointerEvent(this.points.slice(), this.mods, this.mouseDevice);
  }

  /** C++ `likeMouseLeft`: one point, left button or none. */
  likeMouseLeft(): boolean {
    const p = this.points[0];
    return (
      this.points.length === 1 && p !== undefined && (p.button === MouseButton.Left || p.button === MouseButton.None)
    );
  }

  isMouseRight(): boolean {
    const p = this.points[0];
    return this.points.length === 1 && p?.button === MouseButton.Right && p.pointerType === PointerType.Mouse;
  }

  isMouseLeft(): boolean {
    const p = this.points[0];
    return this.points.length === 1 && p?.button === MouseButton.Left && p.pointerType === PointerType.Mouse;
  }

  isMouseDevice(): boolean {
    if (this.mouseDevice) return true;
    return this.points.length === 1 && this.points[0]?.pointerType === PointerType.Mouse;
  }

  /** C++ `isMouseMove`: a mouse with no button, moving (hover). */
  isMouseMove(): boolean {
    const p = this.points[0];
    return this.isMouseDevice() && p?.button === MouseButton.None && p.state === PointState.Move;
  }

  isEraser(): boolean {
    return this.points.length === 1 && this.points[0]?.pointerType === PointerType.Eraser;
  }

  isPencil(): boolean {
    return this.points.length > 0 && this.points[0]?.pointerType === PointerType.Pen;
  }

  /** C++ `hasModifiers(Command) || hasModifiers(Control)`. */
  hasCmdOrCtrl(): boolean {
    return this.mods.cmd || this.mods.ctrl;
  }
}

/** The C++ pointer type of a host pointer. */
export function pointerTypeOf(kind: PointerKind, eraser: boolean): PointerType {
  if (eraser) return PointerType.Eraser;
  if (kind === 'mouse') return PointerType.Mouse;
  if (kind === 'pen') return PointerType.Pen;
  return PointerType.Finger;
}

/** The C++ mouse button of a DOM `button` / `buttons` pair. */
export function mouseButtonOf(
  kind: PointerKind,
  button: number,
  buttons: number,
  phase: PointerInput['phase'],
): MouseButton {
  if (kind !== 'mouse') return MouseButton.None;
  if (phase === 'move') {
    if ((buttons & 1) !== 0) return MouseButton.Left;
    if ((buttons & 2) !== 0) return MouseButton.Right;
    if ((buttons & 4) !== 0) return MouseButton.Middle;
    return MouseButton.None;
  }
  if (button === 0) return MouseButton.Left;
  if (button === 2) return MouseButton.Right;
  if (button === 1) return MouseButton.Middle;
  return MouseButton.None;
}
