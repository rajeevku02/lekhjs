// The LekhObject event notion, kept as an opt-in capability (spec 05 §5). C++ declared 13 UI
// event virtuals on every `LekhObject` and no document object overrode any; the lekhjs model has
// no event methods. A shape class or a template-level behaviour may supply a `ShapeInteraction`,
// registered per interaction session (no module state) by template id or class name
// (`LekhObject.interactionKeys()`: the template id first, then the class name).
//
// Rules (spec 05 §5): consulted at router position 3, after the drag handler and the overlay
// (handles win), before the mode defaults; Select mode and editable boards only; points in canvas
// coordinates. No shape registers one at launch. Not imported by the backend.
import type { Point } from '../geometry';
import type { LekhObject } from '../model';

export type InteractionEventName = 'tap' | 'doubleTap' | 'drag' | 'longPress' | 'hover';
export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

export interface InputInfo {
  readonly kind: PointerKind;
  readonly mods: Modifiers;
  readonly buttons: number;
  readonly viewPt: Point;
}

export interface HitAnswer {
  readonly handles: boolean;
  readonly block?: boolean;
  readonly longPressMs?: number;
}

/** The cursor a shape may ask for while hovered (spec 05 `CursorKind`). */
export type CursorKind = 'default' | 'action' | 'draw' | 'smartDraw' | 'select' | 'scroll' | 'erase' | 'text' | 'laser';

/** A key press while the shape is the single selection. */
export interface KeyInput {
  readonly key: string;
  readonly mods: Modifiers;
}

/** The owner of a continuous gesture a shape started (spec 05 `DragHandler`, minimal). */
export interface ShapeDragHandler {
  move(pt: Point, ev: InputInfo): void;
  end(pt: Point, ev: InputInfo): void;
  /** True when it cancelled cleanly. */
  cancel(): boolean;
}

/** What a shape's handler may read of its board (read-only queries). */
export interface InteractionSessionView {
  objectById(id: string): LekhObject | undefined;
}

export interface InteractionCtx {
  readonly session: InteractionSessionView;
  readonly readOnly: boolean;
  /** Snapshot for undo. */
  beginChange(objectId: string): void;
  /** One undo step plus the usual `changeattr` update. */
  commit(label?: string): void;
  cancel(): void;
  /** Repaint the drawing and middle layers. */
  invalidate(): void;
  setCursor(c: CursorKind): void;
}

export interface ShapeInteraction {
  hitTest?(e: InteractionEventName, ptCanvas: Point, ev: InputInfo): HitAnswer;
  onTap?(pt: Point, ev: InputInfo, ctx: InteractionCtx): boolean;
  onDoubleTap?(pt: Point, ev: InputInfo, ctx: InteractionCtx): boolean;
  onDragStart?(pt: Point, ev: InputInfo, ctx: InteractionCtx): ShapeDragHandler | null;
  onLongPress?(pt: Point, ev: InputInfo, ctx: InteractionCtx): ShapeDragHandler | boolean;
  onHover?(pt: Point, phase: 'enter' | 'move' | 'leave', ctx: InteractionCtx): CursorKind | undefined;
  onKey?(k: KeyInput, ctx: InteractionCtx): boolean;
}

export type ShapeInteractionFactory = (obj: LekhObject) => ShapeInteraction;

export interface ShapeInteractionRegistry {
  register(templateIdOrClass: string, factory: ShapeInteractionFactory): void;
  get(obj: LekhObject): ShapeInteraction | undefined;
}

/**
 * The registry of one interaction session. `get` tries the object's keys in order (template id,
 * then class name) and keeps one interaction per object, so a shape's handler state lives as long
 * as the object.
 */
export class MapShapeInteractionRegistry implements ShapeInteractionRegistry {
  private readonly factories_ = new Map<string, ShapeInteractionFactory>();
  private readonly live_ = new WeakMap<LekhObject, ShapeInteraction>();

  register(templateIdOrClass: string, factory: ShapeInteractionFactory): void {
    this.factories_.set(templateIdOrClass, factory);
  }

  get(obj: LekhObject): ShapeInteraction | undefined {
    const live = this.live_.get(obj);
    if (live !== undefined) return live;
    for (const key of obj.interactionKeys()) {
      const f = this.factories_.get(key);
      if (f !== undefined) {
        const si = f(obj);
        this.live_.set(obj, si);
        return si;
      }
    }
    return undefined;
  }
}

/**
 * Whether a shape's interaction takes `e` at `pt` (the `canDoAt` arbitration): only in Select
 * mode on an editable board, and only when its `hitTest` says it handles it (no `hitTest`: every
 * event its handlers cover).
 */
export function shapeHandles(
  si: ShapeInteraction | undefined,
  e: InteractionEventName,
  pt: Point,
  ev: InputInfo,
  state: { readonly selectMode: boolean; readonly readOnly: boolean },
): boolean {
  if (si === undefined || !state.selectMode || state.readOnly) return false;
  if (si.hitTest !== undefined) return si.hitTest(e, pt, ev).handles;
  switch (e) {
    case 'tap':
      return si.onTap !== undefined;
    case 'doubleTap':
      return si.onDoubleTap !== undefined;
    case 'drag':
      return si.onDragStart !== undefined;
    case 'longPress':
      return si.onLongPress !== undefined;
    case 'hover':
      return si.onHover !== undefined;
  }
}
