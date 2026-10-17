// Sub-entry `recognizer/worker` (spec 01 §3.2 rule 6): the `lekhjs/recognizer/worker` package
// entry, which the board's worker shim calls (`serveRecognizer(self, …)`, spec 07 §6.1).
//
// This entry must stay out of `sync/`, `semantic/`, `export/` and `interaction/` (AC-ARC-11): it
// imports the recognizer core and delegate, and `io/`'s object reader for the snapshot objects.
import type { Clock, PortLike } from '../../base';
import { defaultLineAggregatorModule, type LineAggregatorModule } from '../lines';
import type { TemplateCatalog } from '../../template';
import type { InitMsg } from './protocol';
import { WorkerHost } from './WorkerHost';

export * from './protocol';
export { RequestedCrashError, WARM_UP_STROKE, WorkerHost, type WorkerHostOptions } from './WorkerHost';
export { THROWING_MEASURER, TextMeasureInWorkerError, WorkerScene, WorkerTextService } from './WorkerScene';
export { measureKey } from './textSizes';

export interface ServeRecognizerOptions {
  /** Loads the base catalog at `init` (the board bundles the core and built-in stencils). */
  readonly catalog: (init: InitMsg) => TemplateCatalog | Promise<TemplateCatalog>;
  /** The worker's `performance.now`. */
  readonly clock: Clock;
  /** The worker bundle's build id (default: the one `init` sends, i.e. no check). */
  readonly buildId?: string;
  /** Default: the shipped binding (the stub until H-REC-1). */
  readonly lineAggregator?: LineAggregatorModule;
}

/** Serves the recognition protocol on `port` (a `DedicatedWorkerGlobalScope` or a test port). */
export function serveRecognizer(port: PortLike, opts: ServeRecognizerOptions): WorkerHost {
  return new WorkerHost(port, {
    catalog: opts.catalog,
    clock: opts.clock,
    lineAggregator: opts.lineAggregator ?? defaultLineAggregatorModule,
    ...(opts.buildId !== undefined ? { buildId: opts.buildId } : {}),
  });
}
