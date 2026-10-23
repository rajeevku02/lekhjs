// The connect handles on a single selected shape (port of C++ `ConnectHandleGeometry` and
// `ConnectHandleWidget`, `L/object/widget/selection/ConnectHandle*.cpp`; spec 02 `ConnectHandles`).
// The geometry is pure functions of view-pixel inputs; the rules of KB `widgets.md` "Connect
// handles and the connection dragger" are unchanged: visibility, the read-only refusal in four
// places (here: placement, draw, press and the dragger's own check), the nested-pair rule (in the
// dragger) and "the preview equals the drop".
import type { Config } from '../../base';
import { Point, getDistance } from '../../geometry';
import type { DrawingPlatform } from '../../render';
import { Style } from '../../style';
import { PointerType, type PointerEvent } from '../input-event';
import { OVERLAY_VALUES, type OverlayTokens } from '../overlay-tokens';

/** The midpoint of each side of the selection polygon: top, right, bottom, left for its corners. */
export function handleCentres(polygon: readonly Point[]): Point[] {
  const n = polygon.length;
  if (n < 2) return [];
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % n] as Point;
    out.push(new Point((a.x + b.x) / 2, (a.y + b.y) / 2));
  }
  return out;
}

/** A corner handle's hit radius: `Config.closePointDistanceShort`. */
export function cornerHitRadius(config: Config): number {
  return config.closePointDistanceShort;
}

/** A connect handle's hit radius: a corner's for a mouse or pen, `vertexHandleRadius` for a finger. */
export function hitRadius(config: Config, pointer: PointerType): number {
  return pointer === PointerType.Finger ? config.vertexHandleRadius : cornerHitRadius(config);
}

/** True when any handle's hit circle meets any corner's. */
export function overlapsCorner(
  handles: readonly Point[],
  corners: readonly Point[],
  handleRadius: number,
  cornerRadius: number,
): boolean {
  const limit = handleRadius + cornerRadius;
  for (const h of handles) for (const c of corners) if (getDistance(h, c) < limit) return true;
  return false;
}

export interface Visibility {
  readonly enabledInSettings: boolean;
  readonly connectable: boolean;
  readonly editable: boolean;
  readonly interacting: boolean;
  readonly editingText: boolean;
  readonly overlapsCorners: boolean;
}

export function shouldShow(v: Visibility): boolean {
  return v.enabledInSettings && v.connectable && v.editable && !v.interacting && !v.editingText && !v.overlapsCorners;
}

/** A press may start a connect drag on the same conditions, evaluated at the press. */
export function canStartDrag(v: Visibility): boolean {
  return shouldShow(v);
}

/** The side a handle sits on (C++ `ConnectionObject::Side`: Top, Right, Bottom, Left). */
export type HandleSide = 0 | 1 | 2 | 3;

/** One placed handle. */
export class ConnectHandle {
  readonly side: HandleSide;
  centre = new Point();
  visible = false;

  constructor(side: HandleSide) {
    this.side = side;
  }

  place(centre: Point, visible: boolean): void {
    this.centre = centre;
    this.visible = visible;
  }

  /** Within the pointer's own hit radius. */
  isWithinHitArea(config: Config, at: Point, ev: PointerEvent | null): boolean {
    const type = ev?.points[0]?.pointerType ?? PointerType.Mouse;
    const r = hitRadius(config, type);
    const dx = at.x - this.centre.x;
    const dy = at.y - this.centre.y;
    return dx * dx + dy * dy <= r * r;
  }

  /** The frame covers the larger of the two hit radii. */
  frameContains(config: Config, at: Point): boolean {
    if (!this.visible) return false;
    const r = Math.max(hitRadius(config, PointerType.Mouse), hitRadius(config, PointerType.Finger));
    return Math.abs(at.x - this.centre.x) <= r && Math.abs(at.y - this.centre.y) <= r;
  }

  /** A contrasting ring under a dot: a white ring in both themes (`connectRingFill`, owner round UF2). */
  draw(dp: DrawingPlatform, tokens: OverlayTokens): void {
    const ring = new Style();
    ring.setFillColor(tokens.connectRingFill);
    ring.setStrokeColor(tokens.cornerColor);
    ring.setStrokeWidth(1);
    dp.startDrawing(this.centre, ring);
    dp.addCircle(this.centre, OVERLAY_VALUES.connectRingRadius);
    dp.endDrawing();
    const dot = new Style();
    dot.setFillColor(tokens.cornerColor);
    dot.setStrokeWidth(0);
    dp.startDrawing(this.centre, dot);
    dp.addCircle(this.centre, OVERLAY_VALUES.connectDotRadius);
    dp.endDrawing();
  }
}
