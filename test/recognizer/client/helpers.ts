// Shared setup for the RecognitionClient suites.
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core';
import {
  RecognitionClient,
  type RecognitionClientEvent,
  type RecognitionClientOptions,
} from '../../../src/recognizer/client';
import { FakeScheduler, recordingLogger, type LogEntry } from '../../../src/testing';
import { FakeWorker, advance, type FakeWorkerOptions } from '../support/fakeWorker';

export const BUILD = 'test-build';

export interface ClientRig {
  readonly sched: FakeScheduler;
  readonly client: RecognitionClient;
  readonly workers: FakeWorker[];
  readonly events: RecognitionClientEvent[];
  readonly logs: LogEntry[];
  /** Advance fake time by `ms` (microtasks included). */
  tick(ms?: number): Promise<void>;
}

/** `workerOpts(i)`: the options of the i-th worker spawned (0-based). */
export function rig(
  workerOpts: (i: number) => FakeWorkerOptions = () => ({}),
  clientOpts: Partial<RecognitionClientOptions> = {},
): ClientRig {
  const sched = new FakeScheduler(0);
  const workers: FakeWorker[] = [];
  const events: RecognitionClientEvent[] = [];
  const logs: LogEntry[] = [];
  const client = new RecognitionClient({
    workerFactory: () => {
      const w = new FakeWorker(sched, { buildId: BUILD, ...workerOpts(workers.length) });
      workers.push(w);
      return w;
    },
    buildId: BUILD,
    scheduler: sched,
    clock: sched,
    logger: recordingLogger(logs),
    onEvent: (e) => events.push(e),
    ...clientOpts,
  });
  client.start(RECOGNIZER_CONFIG_DEFAULTS);
  return { sched, client, workers, events, logs, tick: (ms = 0) => advance(sched, ms) };
}
