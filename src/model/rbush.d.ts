// Types for `rbush` 4 (MIT, a devDependency inlined by the bundlers: spec 01 §5.4). The package
// ships no declarations; this covers the members `SpatialIndex` calls.
declare module 'rbush' {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  export default class RBush<T extends BBox = BBox> {
    constructor(maxEntries?: number);
    insert(item: T): this;
    load(items: readonly T[]): this;
    remove(item: T, equals?: (a: T, b: T) => boolean): this;
    search(box: BBox): T[];
    collides(box: BBox): boolean;
    all(): T[];
    clear(): this;
    toBBox(item: T): BBox;
  }
}
