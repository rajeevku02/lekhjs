// Sub-entry `recognizer/worker` (spec 01 §3.2 rule 6): the `lekhjs/recognizer/worker` package
// entry, which the board's worker shim calls (`serveRecognizer(self, …)`, spec 07 §6.1).
//
// This entry must stay out of `sync/`, `semantic/`, `export/` and `interaction/` (AC-ARC-11): it
// imports the recognizer core and delegate, and `io/`'s object reader for the snapshot objects.
import type { Clock, PortLike } from '../../base';
import { defaultLineAggregatorModule, type LineAggregatorModule } from '../lines';
import type { Points } from '../lines/StrokeLine';
import type { TemplateCatalog } from '../../template';
import type { InitMsg } from './protocol';
import { WorkerHost } from './WorkerHost';

export * from './protocol';
export { RequestedCrashError, WARM_UP_STROKE, WorkerHost, type WorkerHostOptions } from './WorkerHost';
export { THROWING_MEASURER, TextMeasureInWorkerError, WorkerScene, WorkerTextService } from './WorkerScene';
export { measureKey } from './textSizes';
export { stubLineAggregatorModule } from '../lines';

/**
 * Test-only message a page may post before `init` to pick one of `testLineAggregators` for the
 * worker's lifetime (the e2e mechanics tests run the stub, so every stroke is ink). Ignored once
 * `init` has arrived, and when `serveRecognizer` was given no `testLineAggregators`.
 */
export interface TestLinesMsg {
  readonly type: 'test-lines';
  readonly module: string;
}

export interface ServeRecognizerOptions {
  /** Loads the base catalog at `init` (the board bundles the core and built-in stencils). */
  readonly catalog: (init: InitMsg) => TemplateCatalog | Promise<TemplateCatalog>;
  /** The worker's `performance.now`. */
  readonly clock: Clock;
  /** The worker bundle's build id (default: the one `init` sends, i.e. no check). */
  readonly buildId?: string;
  /** Default: the shipped binding (the owner's `LineAggregatorImpl`, M1). */
  readonly lineAggregator?: LineAggregatorModule;
  /**
   * Test-only: the modules a `TestLinesMsg` may pick by name. The board passes `{ stub }` only
   * behind its test-hook gate; without this option the message is not understood.
   */
  readonly testLineAggregators?: Readonly<Record<string, LineAggregatorModule>>;
}

/** Serves the recognition protocol on `port` (a `DedicatedWorkerGlobalScope` or a test port). */
export function serveRecognizer(port: PortLike, opts: ServeRecognizerOptions): WorkerHost {
  const tests = opts.testLineAggregators;
  let chosen = opts.lineAggregator ?? defaultLineAggregatorModule;
  // With test modules on offer, the host sees a module that forwards to the chosen one.
  const lineAggregator: LineAggregatorModule =
    tests === undefined
      ? chosen
      : {
          get id() {
            return chosen.id;
          },
          create: (config) => chosen.create(config),
          getCost: (points: Points) => chosen.getCost(points),
          isSingleLine: (a, b) => chosen.isSingleLine(a, b),
        };
  const host = new WorkerHost(port, {
    catalog: opts.catalog,
    clock: opts.clock,
    lineAggregator,
    ...(opts.buildId !== undefined ? { buildId: opts.buildId } : {}),
  });
  if (tests !== undefined) {
    const inner = port.onmessage;
    let started = false;
    port.onmessage = (e) => {
      const d = e.data as Partial<TestLinesMsg> | null;
      if (!started && d !== null && typeof d === 'object' && d.type === 'test-lines') {
        const m = typeof d.module === 'string' && Object.hasOwn(tests, d.module) ? tests[d.module] : undefined;
        if (m !== undefined) chosen = m;
        return;
      }
      started = true;
      inner?.(e);
    };
  }
  return host;
}
