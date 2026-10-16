// The shared vocabulary of the overlay, its handles and the draggers (C++ `ShapePoint`, and the
// parts of `MiddleWidget`, `SelectionRectangleWidget` and `VertexHandleWidget` the draggers call).
// Kept apart so the draggers depend on interfaces only and the overlay can build them without an
// import cycle.
import type { EditTarget } from '../../edit';
import type { Point, Rect } from '../../geometry';
import type { LekhObject } from '../../model';
import type { DrawingPlatform } from '../../render';
import type { Color } from '../../style';
import type { InteractionBoard } from '../board';
import type { CursorKind } from '../cursor';
import type { DragHandler } from '../drag-handler';
import type { HostEnvironment } from '../env';
import type { Movement } from '../gesture-listener';
import type { InputModeState } from '../input-mode';
import type { OverlayTokens } from '../overlay-tokens';

/** C++ `ShapePoint::Type`. */
export const ShapePointType = Object.freeze({
  None: 0,
  Resizer: 1,
  Rotater: 2,
  Vertex: 3,
  Control: 4,
  Attr: 5,
  ControlAttr: 6,
} as const);
export type ShapePointType = (typeof ShapePointType)[keyof typeof ShapePointType];

export interface ShapePoint {
  readonly point: Point;
  readonly type: ShapePointType;
  readonly vid: number;
}

/** Draws a one-line label (size and angle info, the zoom badge); the host's text stack. */
export interface OverlayTextPainter {
  /** `text` centred horizontally in `rect`, at its top (C++ `WrapMode::Float`), in `color`. */
  draw(
    dp: DrawingPlatform,
    text: string,
    rect: Rect,
    opts: { readonly fontSize?: number; readonly color?: Color },
  ): void;
}

/** What a transient gets to paint with. */
export interface OverlayPaint {
  readonly tokens: OverlayTokens;
  readonly text: OverlayTextPainter | null;
}

/** Something the overlay paints in view coordinates (C++ a transient object on `MiddleWidget`). */
export interface Transient {
  draw(dp: DrawingPlatform, paint: OverlayPaint): void;
}

/** The selection rectangle as the draggers drive it (C++ `SelectionRectangleWidget`). */
export interface SelectionRectHost {
  target(): EditTarget | null;
  move(dx: number, dy: number, m: Movement): void;
  moveResizer(at: Point, m: Movement, vid: number): Point;
  moveRotater(at: Point, m: Movement): void;
  setIsScaling(v: boolean): void;
}

/** The vertex handle as the draggers drive it (C++ `VertexHandleWidget`). */
export interface VertexHandleHost {
  target(): LekhObject | null;
  update(at: Point, m: Movement): void;
}

/** What the controller and the draggers ask of the overlay (C++ `MiddleWidget`). */
export interface OverlayHost {
  readonly board: InteractionBoard;
  readonly env: HostEnvironment;
  readonly modes: InputModeState;
  /** C++ `updateSelectionRectangle(target, multiSelectAction)`. */
  select(target: EditTarget | null, multiSelectAction?: boolean): void;
  /** C++ `updateSelectionRectangle()`: re-lays the current selection out. */
  refreshSelection(): void;
  deselect(): void;
  selectionTarget(): EditTarget | null;
  selectionRect(): SelectionRectHost;
  isSelectionActive(): boolean;
  /** `vid` of `target`; `'rect'` means the selection rectangle's own corners; null clears. */
  updateVertexHandle(type: ShapePointType, vid: number, target: LekhObject | 'rect' | null): void;
  /** C++ `updateVertexHandle(at, movement)`. */
  moveVertexHandle(at: Point, m: Movement): void;
  addTransient(t: Transient): void;
  removeTransient(t: Transient): void;
  drawingStarted(): void;
  /** A finished stroke (view points, before the canvas displacement). */
  onTmpDrawingEnd(stroke: Transient, points: readonly Point[]): void;
  beforeCanvasScaleOrScroll(): void;
  flashScrollIndicator(): void;
  /** Repaint the Middle layer. */
  invalidate(): void;
  setDragHandler(d: DragHandler): void;
  setCursor(c: CursorKind): void;
  /** C++ `Command::duplicate(obj, displace)`: the copy becomes the selection. */
  duplicate(t: EditTarget, displace: boolean): void;
  /** An in-canvas text edit is open. */
  isEditingText(): boolean;
}
