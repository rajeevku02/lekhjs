// Shared harness for the R3 suites: a board session on a C++ fixture (or an empty board) over the
// bundled catalog, its snapshot as the worker would get it, and the worker's scene built from it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Point } from '../../../src/geometry';
import { recognizerConfigFrom } from '../../../src/recognizer/core';
import { snapshotDelegate, type RecordingCanvasDelegate } from '../../../src/recognizer/delegate';
import { SceneSnapshotBuilder, type BuiltSnapshot } from '../../../src/recognizer/client';
import { WorkerScene, recViewOf, type RecViewTransform } from '../../../src/recognizer/worker';
import type { BoardSession } from '../../../src/session';
import { bundledCatalog, CORE_FIXTURES } from '../../io/helpers';
import { harness, type Harness } from '../../session/helpers';

export { bundledCatalog };

/** The C++ fixture boards the scene suites read (relative to the core fixture set). */
export const SCENE_BOARDS: readonly string[] = Object.freeze([
  'boards/android-shapes-and-connectors.lekh',
  'boards/ipad-block-diagram.lekh',
  'boards/ipad-flowchart.lekh',
  'boards/ipad-recognised-sketch.lekh',
  'boards/iphone-block-diagram.lekh',
  'boards/iphone-flowchart.lekh',
  'boards/iphone-recognised-sketch.lekh',
  'boards/iphone-wireframe.lekh',
  'boards/legacy-2.2.4.lekh',
  'objects/titled-shapes.lekh',
  'objects/image-and-text.lekh',
  'objects/groups.lekh',
  'objects/nested-groups.lekh',
  'edges/arrows.lekh',
  'edges/labels.lekh',
  'generated/wireframe-button.lekh',
  'format/03-connector.lekh',
]);

export function boardText(rel: string): string {
  return readFileSync(path.join(CORE_FIXTURES, rel), 'utf8');
}

/** A session with `rel` open (offline). */
export function sessionOn(rel: string): Harness {
  return harness({ board: boardText(rel) });
}

/** An empty board. */
export function emptySession(): Harness {
  return harness({ board: boardText('format/01-empty.lekh') });
}

/** `x0,y0,…` from points. */
export function flat(pts: readonly Point[]): Float64Array {
  const out = new Float64Array(pts.length * 2);
  pts.forEach((p, i) => {
    out[2 * i] = p.x;
    out[2 * i + 1] = p.y;
  });
  return out;
}

/** The session's view as a job transform. */
export function jobView(session: BoardSession): RecViewTransform {
  const v = session.viewTransform;
  return recViewOf(v.zoom, v.scrollX, v.scrollY);
}

export function snapshotOf(session: BoardSession, stroke: Float64Array, view: RecViewTransform): BuiltSnapshot {
  return new SceneSnapshotBuilder({
    doc: session.editor.doc,
    codec: session.codec,
    overlay: session.overlay,
    text: session.text,
    config: session.config,
  }).build(stroke, view);
}

/** The worker side of one job: its scene and a recording delegate over it. */
export function workerDelegate(
  session: BoardSession,
  stroke: Float64Array,
  view: RecViewTransform,
  scene = new WorkerScene({ catalog: bundledCatalog() }),
): { delegate: RecordingCanvasDelegate; failed: number; built: BuiltSnapshot } {
  const built = snapshotOf(session, stroke, view);
  const loaded = scene.load(built.snapshot, view.zoom);
  const delegate = snapshotDelegate({
    store: loaded.scene,
    view,
    strokeWidth: 2,
    config: recognizerConfigFrom(session.config),
  });
  return { delegate, failed: loaded.failed, built };
}
