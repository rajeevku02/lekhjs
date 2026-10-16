// Splitting a category into batches and laying a batch out (verification 02 §C.2 steps 2-3).
// Pure functions: a batch built from byte-identical inputs is byte-identical.

export const ROW_WIDTH = 2400;
export const GUTTER = 40;
export const MAX_CELLS = 100;
/** 16 MP at scale 1, padding included. */
export const MAX_PIXELS = 16e6;
/** The export padding of §B.2 item 1; part of the page-size check. */
export const PADDING = 20;

/**
 * The axis-aligned footprint of a w × h box turned by `angle` radians.
 * @param {number} w
 * @param {number} h
 * @param {number} angle
 */
export function footprint(w, h, angle) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  // Snap the float noise of ±π/2 so a quarter-turned box is exactly h × w.
  const r = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
  return { w: r(w * c + h * s), h: r(w * s + h * c) };
}

/**
 * Shelf packing: left to right in rows of at most `ROW_WIDTH`, `GUTTER` between cells and around
 * the page. Each cell gets its footprint rectangle and the shape's centre.
 * @template {{ w: number, h: number }} T
 * @param {T[]} items   footprints, in order
 * @returns {{ rects: { x: number, y: number, w: number, h: number }[], width: number, height: number }}
 */
export function shelfPack(items) {
  const rects = [];
  let x = GUTTER;
  let y = GUTTER;
  let rowH = 0;
  let width = 0;
  for (const it of items) {
    if (x > GUTTER && x + it.w > ROW_WIDTH - GUTTER) {
      x = GUTTER;
      y += rowH + GUTTER;
      rowH = 0;
    }
    rects.push({ x, y, w: it.w, h: it.h });
    width = Math.max(width, x + it.w + GUTTER);
    x += it.w + GUTTER;
    rowH = Math.max(rowH, it.h);
  }
  return { rects, width, height: y + rowH + GUTTER };
}

/**
 * Pixels of a laid-out page at scale 1 with the export padding.
 * @param {{ width: number, height: number }} page
 */
export const pagePixels = (page) => (page.width + 2 * PADDING) * (page.height + 2 * PADDING);

/**
 * Splits `shapes` (in index order) into `k` contiguous chunks of near-equal shape counts, raising
 * `k` from `ceil(cells / MAX_CELLS)` until every chunk has ≤ `MAX_CELLS` cells and its page is
 * ≤ `MAX_PIXELS` (§C.2 step 2).
 * @template T
 * @param {T[]} shapes
 * @param {(s: T) => number} cellsOf     1, or 2 for a generator shape
 * @param {(chunk: T[]) => { width: number, height: number }} pageOf
 * @returns {T[][]}
 */
export function splitCategory(shapes, cellsOf, pageOf) {
  const total = shapes.reduce((n, s) => n + cellsOf(s), 0);
  for (let k = Math.max(1, Math.ceil(total / MAX_CELLS)); k <= shapes.length; k++) {
    const chunks = [];
    for (let i = 0; i < k; i++) {
      const a = Math.round((i * shapes.length) / k);
      const b = Math.round(((i + 1) * shapes.length) / k);
      chunks.push(shapes.slice(a, b));
    }
    const ok = chunks.every(
      (c) => c.reduce((n, s) => n + cellsOf(s), 0) <= MAX_CELLS && pagePixels(pageOf(c)) <= MAX_PIXELS,
    );
    if (ok) return chunks;
  }
  throw new Error('splitCategory: one shape alone exceeds the page limits');
}
