// Auto-placement shared by the delta compiler and the whole-board generator (port of C++
// `semantic/SemanticPlacement.{h,cpp}`): a node's axis-aligned half extents, its box, and the
// push that moves it clear of the boxes already taken.

export interface PlacementBox {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

/** The gap left between an auto-placed node and the box it is pushed past. */
export const PLACEMENT_GAP = 24;
/** The margin from the page's content an auto-placed node keeps. */
export const PLACEMENT_MARGIN = 40;

/**
 * The half extents of a `width` × `height` box rotated by `angle` RADIANS, used exactly as stored
 * (the compiler writes the semantic `angle` through to the stored field unchanged).
 */
export function placementHalfExtents(width: number, height: number, angle: number): { halfW: number; halfH: number } {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return {
    halfW: Math.abs(width / 2) * c + Math.abs(height / 2) * s,
    halfH: Math.abs(width / 2) * s + Math.abs(height / 2) * c,
  };
}

export function placementBoxAt(cx: number, cy: number, halfW: number, halfH: number): PlacementBox {
  return { minx: cx - halfW, maxx: cx + halfW, miny: cy - halfH, maxy: cy + halfH };
}

/**
 * Pushes the box centred at `at` clear of every box in `taken`: past the furthest edge it overlaps
 * (`maxy` when `vertical`, else `maxx`) plus the gap, repeated until nothing overlaps (at most
 * `taken.length + 1` rounds). Returns the new centre.
 */
export function placementPushClear(
  at: { cx: number; cy: number },
  halfW: number,
  halfH: number,
  vertical: boolean,
  taken: readonly PlacementBox[],
): { cx: number; cy: number } {
  let { cx, cy } = at;
  for (let guard = 0; guard <= taken.length; guard++) {
    let furthest = 0;
    let hit = false;
    for (const box of taken) {
      if (cx - halfW < box.maxx && cx + halfW > box.minx && cy - halfH < box.maxy && cy + halfH > box.miny) {
        const edge = vertical ? box.maxy : box.maxx;
        if (!hit || edge > furthest) furthest = edge;
        hit = true;
      }
    }
    if (!hit) break;
    if (vertical) cy = furthest + PLACEMENT_GAP + halfH;
    else cx = furthest + PLACEMENT_GAP + halfW;
  }
  return { cx, cy };
}
