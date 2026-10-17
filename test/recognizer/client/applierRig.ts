// Drives `MutationApplier` inside a real session's command (as the session's recognition applier
// runs it), for the per-mutation suites.
import { MutationApplier, type AppliedJob } from '../../../src/recognizer/client';
import type { RecMutation, RecShapeDTO, RecViewTransform } from '../../../src/recognizer/worker';
import type { CommandContext } from '../../../src/session';
import { harness, type Harness } from '../../session/helpers';
import { boardText } from '../support/scene';
import { statsLog, type StatsLog } from './sessionRig';

export interface ApplierRig {
  readonly h: Harness;
  readonly applier: MutationApplier;
  readonly stats: StatsLog;
  run<T>(fn: (ctx: CommandContext) => T): T;
  /** A job whose snapshot saw every object on the active page as it is now. */
  job(view?: RecViewTransform): AppliedJob;
  ids(): string[];
  undoDepth(): number;
  undo(): void;
}

export function applierRig(board = 'format/01-empty.lekh'): ApplierRig {
  const h = harness({ board: boardText(board) });
  const stats = statsLog();
  const applier = new MutationApplier({ currentStyle: () => h.session.currentStyle, stats });
  h.session.registerCommand('apply', (ctx, fn) => {
    (fn as (c: CommandContext) => void)(ctx);
  });
  const page = () => h.session.editor.doc.activePage();
  return {
    h,
    applier,
    stats,
    run<T>(fn: (ctx: CommandContext) => T): T {
      let out: T | undefined;
      h.session.dispatch({
        type: 'command',
        command: {
          kind: 'custom',
          name: 'apply',
          arg: (ctx: CommandContext) => {
            out = fn(ctx);
          },
        },
        origin: 'ui',
      });
      return out as T;
    },
    job(view = { zoom: 1, tx: 0, ty: 0 }): AppliedJob {
      const revs = new Map<string, number>();
      for (const o of page().objectStore.objects) revs.set(o.id, o.rev);
      return { view, revs, pageId: page().id };
    },
    ids: () => page().objectStore.objects.map((o) => o.id),
    undoDepth: () => h.session.editor.undo.undoDepth,
    undo: () => {
      h.session.dispatch({ type: 'command', command: { kind: 'undo' }, origin: 'ui' });
    },
  };
}

export const rectDTO = (x: number, y: number, w: number, hgt: number): RecShapeDTO => ({
  kind: 'path',
  closed: true,
  snap: false,
  components: [
    { curve: false, p1: { x, y }, p2: { x: x + w, y } },
    { curve: false, p1: { x: x + w, y }, p2: { x: x + w, y: y + hgt } },
    { curve: false, p1: { x: x + w, y: y + hgt }, p2: { x, y: y + hgt } },
    { curve: false, p1: { x, y: y + hgt }, p2: { x, y } },
  ],
});

export const lineDTO = (x1: number, y1: number, x2: number, y2: number): RecShapeDTO => ({
  kind: 'path',
  closed: false,
  snap: false,
  components: [{ curve: false, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } }],
});

export function inkOf(points: readonly [number, number][]): Extract<RecMutation, { op: 'ink' }> {
  return { op: 'ink', points: new Float64Array(points.flat()) };
}
