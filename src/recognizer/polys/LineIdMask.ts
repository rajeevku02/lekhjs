// Line-id sets as bitmasks (speed-up R1, spec 07 §4.1). Line ids are 1..N with N ≤ 30
// (`LineColl.addLines` asserts it; `proceed` caps a stroke at 25 lines), so `1 << (id - 1)` fits a
// 32-bit int. This replaces the C++ `std::set<int>` and its FNV hash: the mask is its own dedup
// key, and set equality is `===`.
export { lineBit, MAX_LINES } from '../lines/LineColl';

/** A set of line ids. */
export type LineIdMask = number;

/** The ids in the mask, ascending (C++ `std::set<int>` iteration order). */
export function maskIds(mask: LineIdMask): number[] {
  const ids: number[] = [];
  let m = mask;
  let id = 1;
  while (m !== 0) {
    if ((m & 1) !== 0) ids.push(id);
    m >>>= 1;
    id++;
  }
  return ids;
}

/** Whether line `id` is in the mask. */
export function maskHas(mask: LineIdMask, id: number): boolean {
  return (mask & (1 << (id - 1))) !== 0;
}
