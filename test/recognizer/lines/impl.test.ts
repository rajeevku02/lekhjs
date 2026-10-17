// The owner's line aggregator (Work 01M4X7TCHFB862XGT68GPY071C, M1; spec 07 §5.1, §5.4): it is the
// default module, it keeps the LineAggregator contract, and the whole recognizer runs on it when it
// is injected through RecognizerContext (AC-REC-06). The algorithm (LineMerger.js) is a black box
// here: only its observable output is tested.
import { describe, expect, it } from 'vitest';
import type { MessageEventLike } from '../../../src/base';
import { Span } from '../../../src/base';
import { Point } from '../../../src/geometry';
import {
  RECOGNIZER_CONFIG_DEFAULTS,
  recognizerConfigFrom,
  recognizerConfigWith,
  recognizeStroke,
} from '../../../src/recognizer/core';
import {
  LineAggregatorImpl,
  LinePart,
  StrokeLine,
  defaultLineAggregatorModule,
  lineAggregatorImplModule,
} from '../../../src/recognizer/lines';
import {
  REC_PROTOCOL,
  serveRecognizer,
  stubLineAggregatorModule,
  type RecResponse,
  type RecShapeDTO,
  type ServeRecognizerOptions,
} from '../../../src/recognizer/worker';
import { bundledCatalog, emptySession, flat, jobView, SCENE_BOARDS, sessionOn, workerDelegate } from '../support/scene';
import { STROKE_CORPUS } from '../support/strokes';

const P = (x: number, y: number): Point => new Point(x, y);

/** An L: 30 points along x, then 30 down. */
function lStroke(): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 30; i++) pts.push(P(i * 4, 0));
  for (let i = 1; i <= 30; i++) pts.push(P(120, i * 4));
  return pts;
}

describe('LineAggregatorImpl (M1)', () => {
  it('is the default module, with its own id', () => {
    expect(defaultLineAggregatorModule).toBe(lineAggregatorImplModule);
    expect(lineAggregatorImplModule.id).toBe('lekh-line-merger-1');
    expect(lineAggregatorImplModule.create(RECOGNIZER_CONFIG_DEFAULTS)).toBeInstanceOf(LineAggregatorImpl);
  });

  it('starts minCost at lineAggregatorMaxJoinCost and gives a fresh state per create()', () => {
    const a = lineAggregatorImplModule.create(recognizerConfigWith({ lineAggregatorMaxJoinCost: 9 }));
    const b = lineAggregatorImplModule.create(RECOGNIZER_CONFIG_DEFAULTS);
    expect(a.minCost()).toBe(9);
    a.setMinCost(3);
    expect(a.minCost()).toBe(3);
    expect(b.minCost()).toBe(RECOGNIZER_CONFIG_DEFAULTS.lineAggregatorMaxJoinCost);
    expect(a.lines()).toEqual([]);
  });

  it('segments an L into two StrokeLines over the stroke array, in drawing order', () => {
    const pts = lStroke();
    const agg = lineAggregatorImplModule.create(RECOGNIZER_CONFIG_DEFAULTS);
    agg.setPoints(Span.of(pts));
    agg.process();
    const lines = agg.lines();
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toBeInstanceOf(StrokeLine);
      expect(l.points().items).toBe(pts);
    }
    expect(lines.map((l) => [l.points().startIndex, l.points().endIndex])).toEqual([
      [0, 30],
      [30, 60],
    ]);
    agg.reset();
    expect(agg.lines()).toEqual([]);
  });

  it('getCost is zero on a straight run and grows on a bent one; isSingleLine stays false', () => {
    const pts = lStroke();
    const straight = lineAggregatorImplModule.getCost(new Span(pts, 0, 30));
    expect([straight.start, straight.end]).toEqual([0, 0]);
    const bent = lineAggregatorImplModule.getCost(new Span(pts, 15, 45));
    expect(bent.start).toBeGreaterThan(0);
    expect(bent.greaterThan(straight).boolValue()).toBe(true);
    const l1 = new StrokeLine(new Span(pts, 0, 30));
    const l2 = new StrokeLine(new Span(pts, 30, 60));
    expect(lineAggregatorImplModule.isSingleLine(new LinePart(l1), new LinePart(l2))).toBe(false);
  });
});

/** A one-line summary of a mutation's shapes: `ellipse`, `path-closed:llll`, … */
function kinds(shapes: readonly RecShapeDTO[]): string[] {
  return shapes.map((s) =>
    s.kind === 'path'
      ? `path${s.closed ? '-closed' : ''}:${s.components.map((c) => (c.curve ? 'c' : 'l')).join('')}`
      : s.kind,
  );
}

describe('AC-REC-06: the recognizer on the injected owner module', () => {
  const STROKES = STROKE_CORPUS.filter((s) => s.points.length >= 2);

  it('recognises the basic corpus shapes on an empty board', () => {
    const h = emptySession();
    const config = recognizerConfigFrom(h.session.config);
    const got = new Map<string, string[]>();
    for (const s of STROKES) {
      const pts = flat(s.points);
      const job = workerDelegate(h.session, pts, jobView(h.session));
      const out = recognizeStroke(pts, job.delegate, { config, lineAggregator: lineAggregatorImplModule });
      got.set(
        s.name,
        out.mutations.flatMap((m) =>
          m.op === 'add' ? kinds(m.shapes) : m.op === 'convert' ? kinds([m.shape]) : [m.op],
        ),
      );
    }
    expect(got.get('circle')).toEqual(['ellipse']);
    expect(got.get('circle-jitter')).toEqual(['ellipse']);
    expect(got.get('rect')).toEqual(['path-closed:llll']);
    expect(got.get('square-jitter')).toEqual(['path-closed:llll']);
    expect(got.get('triangle')).toEqual(['path-closed:lll']);
    expect(got.get('line')).toEqual(['path:l']);
    expect(got.get('L')).toEqual(['path:ll']);
    // No corpus stroke falls back to ink: the aggregator finds lines in every one.
    expect([...got].filter(([, k]) => k.includes('ink')).map(([n]) => n)).toEqual([]);
  });

  for (const board of SCENE_BOARDS) {
    it(`runs every corpus stroke without an exception over ${board}`, () => {
      const h = sessionOn(board);
      const config = recognizerConfigFrom(h.session.config);
      const view = jobView(h.session);
      const origin =
        h.session.editor.doc.activePage().objectStore.objects[0]?.selectionRect().center() ?? new Point(100, 100);
      for (const s of STROKES) {
        const pts = flat(s.points.map((p) => new Point(p.x + origin.x - 100, p.y + origin.y - 100)));
        const job = workerDelegate(h.session, pts, view);
        const out = recognizeStroke(pts, job.delegate, { config, lineAggregator: lineAggregatorImplModule });
        expect(out.mutations.length, s.name).toBeGreaterThan(0);
      }
    });
  }
});

const INIT = {
  type: 'init',
  protocol: REC_PROTOCOL,
  buildId: 'b1',
  config: RECOGNIZER_CONFIG_DEFAULTS,
  catalog: { stencilBaseUrl: '', coreStencilIds: [] },
  warmUp: true,
} as const;

/** A worker port, served, that collects the responses. */
function served(opts: Partial<ServeRecognizerOptions> = {}): {
  send: (m: unknown) => void;
  out: RecResponse[];
} {
  const out: RecResponse[] = [];
  const port = {
    onmessage: null as ((e: MessageEventLike) => void) | null,
    postMessage(m: unknown): void {
      out.push(structuredClone(m) as RecResponse);
    },
  };
  let t = 0;
  serveRecognizer(port, { catalog: () => bundledCatalog(), clock: { now: () => (t += 1) }, ...opts });
  return { send: (m) => port.onmessage?.({ data: m }), out };
}

const tick = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0));

const STROKE = flat(lStroke());

describe('the worker and its line aggregator', () => {
  it('serveRecognizer with no lineAggregator answers ready.lineAggregator = lekh-line-merger-1', async () => {
    const w = served();
    w.send(INIT);
    await tick();
    expect(w.out[0]).toMatchObject({ type: 'ready', lineAggregator: 'lekh-line-merger-1' });
  });

  it('a test-lines message before init picks a test module (the e2e mechanics run the stub)', async () => {
    const w = served({ testLineAggregators: { stub: stubLineAggregatorModule } });
    w.send({ type: 'test-lines', module: 'stub' });
    w.send(INIT);
    await tick();
    expect(w.out[0]).toMatchObject({ type: 'ready', lineAggregator: 'stub' });
  });

  it('test-lines is ignored after init, for an unknown name, and without testLineAggregators', async () => {
    const late = served({ testLineAggregators: { stub: stubLineAggregatorModule } });
    late.send(INIT);
    await tick();
    late.send({ type: 'test-lines', module: 'stub' });
    const unknown = served({ testLineAggregators: { stub: stubLineAggregatorModule } });
    unknown.send({ type: 'test-lines', module: 'toString' });
    unknown.send(INIT);
    const off = served();
    off.send({ type: 'test-lines', module: 'stub' });
    off.send(INIT);
    await tick();
    expect(late.out[0]).toMatchObject({ type: 'ready', lineAggregator: 'lekh-line-merger-1' });
    expect(unknown.out[0]).toMatchObject({ type: 'ready', lineAggregator: 'lekh-line-merger-1' });
    // Without the option the message reaches the host, which answers a protocol error.
    expect(off.out.find((r) => r.type === 'ready')).toMatchObject({ lineAggregator: 'lekh-line-merger-1' });
  });

  it('a job on the stub is ink; on the owner module it is a shape', async () => {
    const job = {
      type: 'job',
      jobId: 1,
      sessionId: 's',
      view: { zoom: 1, tx: 0, ty: 0 },
      strokeWidth: 2,
      config: RECOGNIZER_CONFIG_DEFAULTS,
      scene: {
        region: { x: 0, y: 0, w: 0, h: 0 },
        objects: [],
        arrowEnds: [],
        connections: [],
        docTemplates: {},
        textSizes: {},
      },
    };
    const ops = async (w: ReturnType<typeof served>): Promise<string[]> => {
      w.send(INIT);
      await tick();
      w.send({ ...job, stroke: STROKE.slice() });
      await tick();
      const r = w.out.find((x) => x.type === 'result');
      return r?.type === 'result' ? r.mutations.map((m) => m.op) : [];
    };
    const stub = served({ testLineAggregators: { stub: stubLineAggregatorModule } });
    stub.send({ type: 'test-lines', module: 'stub' });
    expect(await ops(stub)).toEqual(['ink']);
    expect(await ops(served())).toEqual(['add']);
  });
});
