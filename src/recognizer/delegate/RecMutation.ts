// The recognizer's output as data (spec 07 §6.2): what a job asks the main thread to do to the
// board, keyed by object id. Geometry is in VIEW coordinates of the job's transform; the main
// thread's `MutationApplier` (task R3) maps it to canvas space and builds the engine objects.
// `worker/protocol.ts` re-exports these types; they are defined here so the delegate layer can
// record them without importing the worker.
//
// Plain data only (no classes), so a result crosses `postMessage` unchanged.

export type ObjectId = string;
export interface Pt {
  readonly x: number;
  readonly y: number;
}
export interface Seg {
  readonly p1: Pt;
  readonly p2: Pt;
}

/** A recognised geometry shape (C++ `geometry::Shape`): an ellipse or a path. */
export type RecShapeDTO =
  | {
      readonly kind: 'ellipse';
      readonly center: Pt;
      readonly width: number;
      readonly height: number;
      readonly rotation: number;
      readonly snap: boolean;
    }
  | {
      readonly kind: 'path';
      readonly closed: boolean;
      readonly components: readonly RecPathComponent[];
      readonly snap: boolean;
    };

export type RecPathComponent =
  | { readonly curve: false; readonly p1: Pt; readonly p2: Pt }
  | { readonly curve: true; readonly p1: Pt; readonly c1: Pt; readonly c2: Pt; readonly p2: Pt };

/**
 * One delegate mutation (C++ `CanvasDelegate` calls 17-23). A result holds at most two, and two
 * only as `delete` followed by `add` (`Recognizer.cpp:95-103`).
 */
export type RecMutation =
  | { readonly op: 'convert'; readonly deleteIds: readonly ObjectId[]; readonly shape: RecShapeDTO }
  | { readonly op: 'delete'; readonly ids: readonly ObjectId[] }
  | { readonly op: 'add'; readonly shapes: readonly RecShapeDTO[] }
  | {
      readonly op: 'connect';
      readonly obj1Id: ObjectId;
      readonly obj2Id: ObjectId;
      readonly type: number;
      readonly autoType: number;
      readonly params: readonly Readonly<Record<string, number>>[];
      readonly val: number;
      readonly deletedIds: readonly ObjectId[];
    }
  | {
      readonly op: 'doubleLineArrow';
      readonly obj1Id: ObjectId;
      readonly obj2Id: ObjectId;
      readonly seg1: Seg;
      readonly seg2: Seg;
      readonly center: Pt;
      readonly lineDist: number;
      readonly len: number;
      readonly firstSide: boolean;
    }
  | { readonly op: 'arrow'; readonly objId: ObjectId; readonly at: Pt; readonly add: boolean; readonly solid: boolean }
  | { readonly op: 'ink'; readonly points: Float64Array };
