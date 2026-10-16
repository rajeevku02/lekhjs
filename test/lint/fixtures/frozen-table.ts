// AC-ARC-06 control: constants, frozen tables, as-const tables and pure functions are allowed.
export const POINTS_PER_INCH = 144;

export const ObjectKind = {
  Templated: 'templated',
  Group: 'group',
} as const;
export type ObjectKind = (typeof ObjectKind)[keyof typeof ObjectKind];

export const DEFAULTS = Object.freeze({ zoom: 1, grid: true });

export function double(x: number): number {
  return x * 2;
}
