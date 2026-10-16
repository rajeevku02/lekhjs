// One layer of the input dispatch (C++ `HandlerWithFilter` around a top widget: `MiddleWidget`,
// `CanvasWidget`; spec 05 §4.2). `InputRouter` asks the layers in order — overlay, shape
// interaction, canvas controller — after the active drag handler.
import type { Point } from '../geometry';
import type { EventCheck, EventName, Movement } from './gesture-listener';
import type { PointerEvent } from './input-event';

/** What a pan that nobody claimed clicks at its End (C++ `makePanToClickHandler_`). */
export interface ClickTarget {
  contains(at: Point): boolean;
  click(at: Point, ev: PointerEvent): boolean;
}

export interface WheelInput {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly cmdOrCtrl: boolean;
}

export interface RouterLayer {
  canDoAt(name: EventName, at: Point, ev: PointerEvent): EventCheck;
  /** C++ `findForEvent(EventName::Generic)`: the widget at `at`, for pan-to-click; null when none. */
  findGeneric(at: Point): ClickTarget | null;
  /** C++ `isDrawingSurface()` of what `findGeneric` found here. */
  isDrawingSurfaceAt(at: Point): boolean;
  onDown(at: Point, ev: PointerEvent): boolean;
  onClick(at: Point, ev: PointerEvent): boolean;
  onDoubleClick(at: Point, ev: PointerEvent): boolean;
  /** Start of a pan (the layer may install a drag handler). Later movements go to the handler. */
  onPan(at: Point, ev: PointerEvent, m: Movement): boolean;
  onScale(at: Point, ev: PointerEvent, value: number, m: Movement): boolean;
  onRotate(at: Point, ev: PointerEvent, value: number, m: Movement): boolean;
  onLongPress(at: Point, ev: PointerEvent, m: Movement): boolean;
  onScroll(at: Point, w: WheelInput): boolean;
  onContextMenu(at: Point): boolean;
}
