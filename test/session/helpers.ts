// Shared helpers for the session suites: a test runtime over the bundled catalog, and a board
// session with a fake scheduler, image port and (for cloud boards) transport.
import { BoardSession, type BoardMeta, type SessionEvent, type SessionEvents } from '../../src/session';
import {
  FakeImagePort,
  FakeScheduler,
  FakeTransport,
  createTestRuntime,
  type TestRuntime,
  type TestRuntimeOptions,
} from '../../src/testing';
import type { JsonObject } from '../../src/template';
import { bundledCatalog } from '../io/helpers';
import { DOCID, fixtureJson } from '../sync/helpers';

export { A, B, C, DOCID, P, fixtureJson, frame } from '../sync/helpers';

export function testRuntime(opts: TestRuntimeOptions = {}): TestRuntime {
  return createTestRuntime({ catalog: bundledCatalog(), ...opts });
}

export interface Harness {
  readonly runtime: TestRuntime;
  readonly session: BoardSession;
  readonly scheduler: FakeScheduler;
  readonly images: FakeImagePort;
  readonly transport: FakeTransport;
  /** Every notification, in order, as `name` + payload. */
  readonly seen: { k: keyof SessionEvents; e: unknown }[];
  dispatch(e: SessionEvent): void;
}

export interface HarnessOptions {
  readonly runtime?: TestRuntime;
  readonly cloud?: boolean;
  readonly board?: JsonObject | string;
  readonly meta?: BoardMeta;
}

const EVENTS: readonly (keyof SessionEvents)[] = Object.freeze([
  'documentChanged',
  'selectionChanged',
  'viewChanged',
  'paintRequested',
  'dialog',
  'toast',
  'reopenRequested',
  'error',
]);

/** A session on `board` (default: the connector fixture), opened through the queue. */
export function harness(opts: HarnessOptions = {}): Harness {
  const runtime = opts.runtime ?? testRuntime();
  const scheduler = new FakeScheduler();
  const images = new FakeImagePort();
  const transport = new FakeTransport();
  const session = new BoardSession(runtime, {
    images,
    scheduler,
    ...(opts.cloud === true ? { transport } : {}),
  });
  const seen: Harness['seen'] = [];
  for (const k of EVENTS) {
    session.on(k, (e) => {
      seen.push({ k, e });
    });
  }
  const board = opts.board ?? fixtureJson('format/03-connector.lekh');
  const meta: BoardMeta =
    opts.meta ?? (opts.cloud === true ? { kind: 'cloud', docid: DOCID, version: 7 } : { kind: 'offline' });
  session.dispatch({ type: 'open', raw: board, meta });
  seen.length = 0;
  return {
    runtime,
    session,
    scheduler,
    images,
    transport,
    seen,
    dispatch: (e) => {
      session.dispatch(e);
    },
  };
}

type CommandEvent = Extract<SessionEvent, { type: 'command' }>;

/** A `command` event. */
export function cmd(
  command: CommandEvent['command'],
  docGeneration?: number,
  origin: CommandEvent['origin'] = 'ui',
): CommandEvent {
  return {
    type: 'command',
    command,
    origin,
    ...(docGeneration !== undefined ? { docGeneration } : {}),
  };
}

/** The names of the notifications seen, in order. */
export function names(h: Harness): string[] {
  return h.seen.map((s) => s.k);
}
