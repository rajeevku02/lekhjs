// The worker side of the protocol (spec 07 §6.2, §6.9): `ready` reports the protocol, the build
// id and the line aggregator after the warm-up; jobs answer with mutations and timings; malformed
// messages, snapshot failures and recognizer failures are the protocol's error codes.
import { describe, expect, it } from 'vitest';
import type { MessageEventLike } from '../../../src/base';
import { Point } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core';
import { stubLineAggregatorModule, type LineAggregatorModule } from '../../../src/recognizer/lines';
import {
  REC_PROTOCOL,
  RequestedCrashError,
  serveRecognizer,
  type InitMsg,
  type JobMsg,
  type RecResponse,
  type SceneSnapshot,
} from '../../../src/recognizer/worker';
import { bundledCatalog, flat } from '../support/scene';

class Port {
  onmessage: ((e: MessageEventLike) => void) | null = null;
  readonly out: RecResponse[] = [];
  postMessage(m: unknown): void {
    this.out.push(structuredClone(m) as RecResponse);
  }
  send(m: unknown): void {
    this.onmessage?.({ data: m });
  }
}

const EMPTY: SceneSnapshot = {
  region: { x: 0, y: 0, w: 0, h: 0 },
  objects: [],
  arrowEnds: [],
  connections: [],
  docTemplates: {},
  textSizes: {},
};

const init = (o: Partial<InitMsg> = {}): InitMsg => ({
  type: 'init',
  protocol: REC_PROTOCOL,
  buildId: 'b1',
  config: RECOGNIZER_CONFIG_DEFAULTS,
  catalog: { stencilBaseUrl: '', coreStencilIds: [] },
  warmUp: true,
  ...o,
});

const job = (o: Partial<JobMsg> = {}): JobMsg => ({
  type: 'job',
  jobId: 1,
  sessionId: 's',
  stroke: flat([new Point(10, 10), new Point(60, 12), new Point(120, 40)]),
  view: { zoom: 1, tx: 0, ty: 0 },
  strokeWidth: 2,
  config: RECOGNIZER_CONFIG_DEFAULTS,
  scene: EMPTY,
  ...o,
});

async function ready(
  port: Port,
  agg: LineAggregatorModule = stubLineAggregatorModule,
  buildId?: string,
): Promise<void> {
  let t = 0;
  serveRecognizer(port, {
    catalog: () => bundledCatalog(),
    clock: { now: () => (t += 1) },
    lineAggregator: agg,
    ...(buildId !== undefined ? { buildId } : {}),
  });
  port.send(init());
  await new Promise((r) => setTimeout(r, 0));
}

describe('WorkerHost', () => {
  it('answers init with ready after the warm-up: protocol, build id, aggregator id', async () => {
    const port = new Port();
    await ready(port);
    expect(port.out).toHaveLength(1);
    const r = port.out[0];
    expect(r).toMatchObject({ type: 'ready', protocol: REC_PROTOCOL, buildId: 'b1', lineAggregator: 'stub' });
    if (r?.type === 'ready') expect(r.warmUpMs).toBeGreaterThan(0);
  });

  it('reports its own build id when it has one (the client compares)', async () => {
    const port = new Port();
    await ready(port, stubLineAggregatorModule, 'worker-build');
    expect(port.out[0]).toMatchObject({ type: 'ready', buildId: 'worker-build' });
  });

  it('a job with the stub: one ink mutation and timings', async () => {
    const port = new Port();
    await ready(port);
    port.send(job());
    const r = port.out[1];
    expect(r?.type).toBe('result');
    if (r?.type === 'result') {
      expect(r.jobId).toBe(1);
      expect(r.mutations.map((m) => m.op)).toEqual(['ink']);
      expect(r.timings.totalMs).toBeGreaterThanOrEqual(r.timings.snapshotLoadMs);
      expect(r.timings.budgetExceeded).toBe(false);
    }
  });

  it('a malformed message is rec_protocol; a protocol mismatch at init too', async () => {
    const port = new Port();
    serveRecognizer(port, { catalog: () => bundledCatalog(), clock: { now: () => 0 } });
    port.send({ hello: 1 });
    expect(port.out[0]).toMatchObject({ type: 'error', code: 'rec_protocol' });
    port.send(init({ protocol: 99 as typeof REC_PROTOCOL }));
    await new Promise((r) => setTimeout(r, 0));
    expect(port.out[1]).toMatchObject({ type: 'error', code: 'rec_protocol' });
  });

  it('a catalog that does not load is rec_init (no job id)', async () => {
    const port = new Port();
    serveRecognizer(port, { catalog: () => Promise.reject(new Error('fetch')), clock: { now: () => 0 } });
    port.send(init());
    await new Promise((r) => setTimeout(r, 0));
    expect(port.out[0]).toMatchObject({ type: 'error', code: 'rec_init' });
    expect((port.out[0] as { jobId?: number }).jobId).toBeUndefined();
  });

  it('an object that does not read is rec_snapshot for that job', async () => {
    const port = new Port();
    await ready(port);
    const bad: SceneSnapshot = {
      ...EMPTY,
      objects: [
        {
          id: 'x',
          rev: 0,
          json: { type: 'templated', template: 'no.such.template' },
          isConnector: false,
          isHelper: false,
          isUnrecognized: false,
        },
      ],
    };
    port.send(job({ jobId: 7, scene: bad }));
    expect(port.out[1]).toMatchObject({ type: 'error', jobId: 7, code: 'rec_snapshot' });
  });

  it('a throwing recognizer is rec_internal for that job', async () => {
    const port = new Port();
    const broken: LineAggregatorModule = {
      ...stubLineAggregatorModule,
      id: 'broken',
      create: () => {
        throw new Error('boom');
      },
    };
    await ready(port, broken);
    port.send(job({ jobId: 3 }));
    expect(port.out.at(-1)).toMatchObject({ type: 'error', jobId: 3, code: 'rec_internal' });
  });

  it('the crash hook throws at the top level (the worker error event)', async () => {
    const port = new Port();
    await ready(port);
    expect(() => {
      port.send(job({ test: { crash: true } }));
    }).toThrow(RequestedCrashError);
  });

  it('shutdown stops answering', async () => {
    const port = new Port();
    await ready(port);
    port.send({ type: 'shutdown' });
    expect(port.onmessage).toBeNull();
  });
});
