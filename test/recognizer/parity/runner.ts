// The TS side of the recognizer parity run (spec 07 §7.4.2): each corpus case's scene opened in a
// board session, its snapshot loaded into the worker's scene, and the stroke recognised by the
// pure entry against `SnapshotCanvasDelegate`, as the worker does it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { recognizerConfigFrom, recognizeStroke, type RecognizerQuirks } from '../../../src/recognizer/core';
import { snapshotDelegate } from '../../../src/recognizer/delegate';
import type { LineAggregatorModule } from '../../../src/recognizer/lines';
import { WorkerScene, type RecViewTransform } from '../../../src/recognizer/worker';
import { PKG_ROOT } from '../../lint/eslint-helpers';
import { harness, type Harness } from '../../session/helpers';
import { bundledCatalog, snapshotOf } from '../support/scene';
import { toJson, type RefCall } from './compare';

export interface ParityCase {
  readonly name: string;
  readonly origin: 'synthetic' | 'seed' | 'dev';
  readonly scene: string;
  readonly view: RecViewTransform;
  readonly strokeWidth: number;
  readonly points: readonly number[];
}

export interface Reference {
  readonly name: string;
  readonly origin: string;
  readonly calls: RefCall[];
  /** The wasm's calls for the 8 jitters (ink points replaced by their count). */
  readonly jitter: RefCall[][];
}

export const CORPUS_DIR = path.join(PKG_ROOT, 'test/recognizer/corpus');
export const REFERENCE_DIR = path.join(PKG_ROOT, 'test/recognizer/parity/reference');

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

export function loadCorpus(): { cases: ParityCase[]; scenes: Record<string, unknown> } {
  return {
    cases: (readJson(path.join(CORPUS_DIR, 'strokes.json')) as { cases: ParityCase[] }).cases,
    scenes: (readJson(path.join(CORPUS_DIR, 'scenes.json')) as { scenes: Record<string, unknown> }).scenes,
  };
}

export function loadReference(name: string): Reference {
  return readJson(path.join(REFERENCE_DIR, `${name}.json`)) as Reference;
}

export function loadManifest(): Record<string, unknown> {
  return readJson(path.join(REFERENCE_DIR, 'MANIFEST.json')) as Record<string, unknown>;
}

/** One session per scene board, reused across cases (recognition does not change the board). */
export class SceneSessions {
  private readonly sessions = new Map<string, Harness>();
  private readonly scene = new WorkerScene({ catalog: bundledCatalog() });

  private readonly scenes: Record<string, unknown>;

  constructor(scenes: Record<string, unknown>) {
    this.scenes = scenes;
  }

  session(name: string): Harness {
    let h = this.sessions.get(name);
    if (h === undefined) {
      h = harness({ board: JSON.stringify(this.scenes[name]) });
      this.sessions.set(name, h);
    }
    return h;
  }

  /** Recognise one case; `ms` is the recogniser alone (snapshot and scene load excluded). */
  run(
    c: ParityCase,
    lineAggregator: LineAggregatorModule,
    quirks: RecognizerQuirks = {},
  ): { calls: RefCall[]; ms: number } {
    const h = this.session(c.scene);
    const stroke = Float64Array.from(c.points);
    const built = snapshotOf(h.session, stroke, c.view);
    const loaded = this.scene.load(built.snapshot, c.view.zoom);
    const config = recognizerConfigFrom(h.session.config);
    const delegate = snapshotDelegate({ store: loaded.scene, view: c.view, strokeWidth: c.strokeWidth, config });
    const t0 = performance.now();
    const out = recognizeStroke(stroke, delegate, { config, lineAggregator, quirks });
    const ms = performance.now() - t0;
    return { calls: toJson(out.mutations), ms };
  }
}
