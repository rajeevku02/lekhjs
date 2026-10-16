// Shared helpers for the sync and edit suites: a board session-like harness over a real document
// (the C++-written `format/` fixtures, read in place), a fake transport, a manual clock and
// scheduler, and a serializer that makes two documents comparable.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Clock, Handle, Scheduler } from '../../src/base';
import { CollectingSink, EditorContext } from '../../src/edit';
import type { ReadResult } from '../../src/io';
import type { LekhDocument } from '../../src/model';
import { SyncSession, type Transport, type TransportState, type TransportStateName } from '../../src/sync';
import type { JsonObject, JsonValue } from '../../src/template';
import { CORE_FIXTURES, testIo, type TestIo } from '../io/helpers';

export const DOCID = 'doc-1';

/** A C++-written fixture board's JSON (`format/03-connector.lekh`, …). */
export function fixtureJson(rel: string): JsonObject {
  return JSON.parse(readFileSync(path.join(CORE_FIXTURES, rel), 'utf8')) as JsonObject;
}

/** The connector fixture: page P, shapes A ("Start"), B ("End"), connector C between them. */
export const P = '4K5eYQdS7snA1MXucdVzUL';
export const A = '4K5eYQdS7snA1MXucdVzUM';
export const B = '4K5eYQdS7snA1MXucdVzUN';
export const C = '4K5eYQdS7snA1MXucdVzUP';

export class ManualClock implements Clock {
  t = 1000;
  now(): number {
    return this.t;
  }
}

/** Timers that run when the test advances the clock. */
export class ManualScheduler implements Scheduler {
  private seq = 0;
  readonly timers = new Map<number, { at: number; fn: () => void }>();
  private readonly clock: ManualClock;
  constructor(clock: ManualClock) {
    this.clock = clock;
  }

  setTimeout(fn: () => void, ms: number): Handle {
    const h = ++this.seq;
    this.timers.set(h, { at: this.clock.t + ms, fn });
    return h;
  }
  clearTimeout(h: Handle): void {
    this.timers.delete(h as number);
  }
  requestFrame(cb: (t: number) => void): Handle {
    return this.setTimeout(() => {
      cb(this.clock.t);
    }, 16);
  }
  cancelFrame(h: Handle): void {
    this.clearTimeout(h);
  }
  advance(ms: number): void {
    const end = this.clock.t + ms;
    for (;;) {
      const due = [...this.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.clock.t = due[1].at;
      due[1].fn();
    }
    this.clock.t = end;
  }
}

export class FakeTransport implements Transport {
  state: TransportStateName = 'open';
  readonly sent: string[] = [];
  private stateCbs: ((s: TransportState) => void)[] = [];
  private frameCbs: ((t: string) => void)[] = [];
  connect(): void {
    this.state = 'connecting';
  }
  send(frame: string): boolean {
    if (this.state !== 'open') return false;
    this.sent.push(frame);
    return true;
  }
  close(): void {
    this.setState('closed');
  }
  onState(cb: (s: TransportState) => void): () => void {
    this.stateCbs.push(cb);
    return () => {
      this.stateCbs = this.stateCbs.filter((c) => c !== cb);
    };
  }
  onFrame(cb: (t: string) => void): () => void {
    this.frameCbs.push(cb);
    return () => {
      this.frameCbs = this.frameCbs.filter((c) => c !== cb);
    };
  }
  setState(state: TransportStateName, at = 0): void {
    this.state = state;
    for (const cb of this.stateCbs) cb({ state, at });
  }
  deliver(text: string): void {
    for (const cb of this.frameCbs) cb(text);
  }
  /** The sent frames, parsed. */
  frames(): JsonObject[] {
    return this.sent.map((s) => JSON.parse(s) as JsonObject);
  }
}

/** One board: its io, document, realtime session, transport and editor context. */
export interface Board {
  readonly io: TestIo;
  doc: LekhDocument;
  readonly sync: SyncSession;
  readonly transport: FakeTransport;
  readonly clock: ManualClock;
  readonly scheduler: ManualScheduler;
  readonly sink: CollectingSink;
  readonly editor: EditorContext;
  /** Sends what the editor raised through the realtime session (the session's outbox flush). */
  flush(): void;
  /** The document as comparable JSON (cloud stamp, keys sorted). */
  text(): string;
}

export function board(json: JsonValue, opts: { version?: number; docFormat?: string } = {}): Board {
  const io = testIo();
  const clock = new ManualClock();
  const scheduler = new ManualScheduler(clock);
  const transport = new FakeTransport();
  const holder: { doc: LekhDocument } = { doc: io.codec.readValue(json).doc };
  const sync = new SyncSession({
    host: {
      document: () => holder.doc,
      codec: io.codec,
      replaceDocument: (r: ReadResult) => {
        holder.doc = r.doc;
      },
    },
    clock,
    scheduler,
    logger: io.env.logger,
    docid: DOCID,
    transport,
    ...(opts.version !== undefined ? { version: opts.version } : {}),
    ...(opts.docFormat !== undefined ? { docFormat: opts.docFormat } : {}),
  });
  const sink = new CollectingSink();
  const editor = new EditorContext({ codec: io.codec, sink, document: () => holder.doc });
  const b: Board = {
    io,
    get doc() {
      return holder.doc;
    },
    set doc(d: LekhDocument) {
      holder.doc = d;
    },
    sync,
    transport,
    clock,
    scheduler,
    sink,
    editor,
    flush() {
      for (const u of sink.updates) sync.raise(u);
      sink.clear();
    },
    text() {
      return io.codec.serialize(holder.doc, { stamp: 'cloud' });
    },
  };
  return b;
}

/** A frame as a peer sends it. */
export function frame(type: string, changes: Record<string, JsonValue>, version = 7, docid = DOCID): string {
  return JSON.stringify({ version, docid, type: 'update', updates: { type, changes, conditions: {} } });
}

/** `v`, which the test knows is there. */
export function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}
