// AC-ARC-06: a top-level let is module state.
let counter = 0;

export function next(): number {
  counter += 1;
  return counter;
}
