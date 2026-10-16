// The rest of the session contract (spec 01 §4.2, spec 03 §12.3-§12.4): the 11 events, fonts
// delivered to every live session, the budget, the realtime wiring and the per-session overlay.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isLekhError } from '../../src/base';
import { BoardSession, DeadlineBudget, type SessionEvent } from '../../src/session';
import { updatetypes } from '../../src/sync';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { A, C, DOCID, P, cmd, fixtureJson, frame, harness, testRuntime } from './helpers';

const EVENT_TYPES = [
  'open',
  'remoteFrame',
  'transportState',
  'imageLoaded',
  'imageFailed',
  'stencilLoaded',
  'fontsChanged',
  'timer',
  'recognitionResult',
  'command',
  'hostLifecycle',
] as const;

describe('session contract', () => {
  it('SessionEvent has exactly the 11 events of spec 01 §4.2', () => {
    expectTypeOf<SessionEvent['type']>().toEqualTypeOf<(typeof EVENT_TYPES)[number]>();
    expect(new Set(EVENT_TYPES).size).toBe(11);
  });

  it('every event type is handled without an error', () => {
    const h = harness({ cloud: true });
    const events: SessionEvent[] = [
      {
        type: 'remoteFrame',
        text: frame(updatetypes.changeAttr, { [`doc.pages.${P}.objects.${A}.params.cx`]: 50 }, 8),
      },
      { type: 'transportState', state: { state: 'open', at: 0 } },
      { type: 'imageFailed', url: 'https://x/missing.png', reason: 'http' },
      { type: 'stencilLoaded', setId: 'set', bodies: [] },
      { type: 'fontsChanged', epoch: 1 },
      { type: 'timer', token: 'none' },
      { type: 'recognitionResult', strokeId: 's', docGeneration: h.session.docGeneration, mutations: [] },
      cmd({ kind: 'select', ids: [A] }),
      { type: 'hostLifecycle', state: 'background' },
      { type: 'hostLifecycle', state: 'foreground' },
    ];
    for (const e of events) h.dispatch(e);
    expect(h.seen.filter((s) => s.k === 'error')).toEqual([]);
    const dc = h.seen.find((s) => s.k === 'documentChanged')?.e as { changedIds: string[] };
    expect(dc.changedIds).toContain(A);
  });

  it('fontsChanged reaches every live session of the runtime and re-lays out their text', () => {
    const runtime = testRuntime();
    const mk = () => {
      const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
      s.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
      return s;
    };
    const [s1, s2, s3] = [mk(), mk(), mk()];
    s3.dispose();
    const changed: string[] = [];
    s1.on('paintRequested', () => changed.push('s1'));
    const count = (s: BoardSession) => s.document.getPage(P)?.objectStore.tracker.layoutCalls ?? 0;
    const before = [count(s1), count(s2), count(s3)];
    runtime.fontLoader.bump();
    expect(runtime.fonts.fontEpoch).toBe(1);
    expect(count(s1)).toBeGreaterThan(before[0] ?? 0);
    expect(count(s2)).toBeGreaterThan(before[1] ?? 0);
    expect(count(s3)).toBe(before[2]);
  });

  it('the budget throws budget_exceeded at the first safe point and load returns nothing', () => {
    const clock = new FakeScheduler();
    const runtime = testRuntime({ clock });
    const budget = DeadlineBudget.fromNow(clock, 100);
    const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: clock, budget });
    expect(s.load(fixtureJson('format/05-multi-page.lekh')).ok).toBe(true);
    clock.advance(100);
    let caught: unknown = null;
    try {
      s.load(fixtureJson('format/05-multi-page.lekh'));
    } catch (e) {
      caught = e;
    }
    expect(isLekhError(caught, 'budget_exceeded')).toBe(true);
    expect(() => {
      s.layoutAll();
    }).toThrow('budget');
  });

  it('a failed load is a LoadResult, not a throw', () => {
    const s = BoardSession.empty(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
    expect(s.isLoaded).toBe(true);
    const r = s.load('{"info":{"version":"9.0"},"pages":{}}');
    expect(r).toMatchObject({ ok: false, code: 'format_too_new' });
    expect(s.serialize({ stamp: 'offline' })).toContain('"5.0"');
  });

  it('a cloud open starts the realtime session; edits go out with the board version', () => {
    const h = harness({ cloud: true });
    expect(h.session.sync.docid).toBe(DOCID);
    expect(h.session.sync.version).toBe(7);
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 1 }));
    expect(h.transport.frames()[0]).toMatchObject({ docid: DOCID, version: 7 });
    h.dispatch(cmd({ kind: 'undo' }));
    expect(h.transport.sent).toHaveLength(2);
  });

  it('an offline board sends nothing', () => {
    const h = harness();
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 1 }));
    expect(h.transport.sent).toHaveLength(0);
  });

  it('a close in the foreground asks for a reopen; a background disconnect shows the dialog', () => {
    const h = harness({ cloud: true });
    h.transport.setState('closed');
    expect(h.seen.filter((s) => s.k === 'reopenRequested').map((s) => s.e)).toEqual([{ reason: 'auto_reconnect' }]);
    const g = harness({ cloud: true });
    g.dispatch({ type: 'hostLifecycle', state: 'background' });
    g.transport.setState('closed');
    g.dispatch({ type: 'hostLifecycle', state: 'foreground' });
    expect(g.seen.filter((s) => s.k === 'dialog').map((s) => s.e)).toEqual([{ kind: 'disconnected' }]);
  });

  it('the gate message frame shows the gate dialog', () => {
    const h = harness({ cloud: true });
    h.transport.deliver(
      JSON.stringify({
        version: 7,
        docid: DOCID,
        type: 'message',
        message: { code: 'board_requires_newer_app', message: 'm', reload: true, arg: '' },
      }),
    );
    expect(h.seen.filter((s) => s.k === 'dialog').at(-1)?.e).toEqual({
      kind: 'gate',
      code: 'board_requires_newer_app',
      message: 'm',
      reload: true,
    });
  });

  it('a remote load reloads: new generation, empty undo, documentChanged.reloaded', () => {
    const h = harness({ cloud: true });
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 1 }));
    const gen = h.session.docGeneration;
    h.transport.deliver(frame(updatetypes.load, { doc: fixtureJson('format/02-one-shape.lekh') }, 40));
    expect(h.session.docGeneration).toBe(gen + 1);
    expect(h.session.editor.undo.canUndo()).toBe(false);
    expect(h.seen.filter((s) => s.k === 'documentChanged').at(-1)?.e).toMatchObject({
      reloaded: true,
      docGeneration: gen + 1,
    });
  });

  it('stencil templates go into this session’s overlay only', () => {
    const runtime = testRuntime();
    const a = harness({ runtime });
    const b = harness({ runtime });
    const body = { id: 'test.stencil.one', name: 'one', shapes: [] };
    a.dispatch({ type: 'stencilLoaded', setId: 's', bodies: [body] });
    expect(a.session.overlay.has('test.stencil.one')).toBe(true);
    expect(b.session.overlay.has('test.stencil.one')).toBe(false);
    expect(runtime.catalog.has('test.stencil.one')).toBe(false);
  });

  it('visualBounds answers for a laid-out object and null for an unknown one', () => {
    const h = harness();
    const r = h.session.visualBounds(P, C);
    expect(r?.width).toBeGreaterThan(0);
    expect(h.session.visualBounds(P, 'nope')).toBeNull();
    expect(h.session.visualBounds('nope', C)).toBeNull();
  });

  it('on(…, signal) unsubscribes on abort', () => {
    const h = harness();
    let n = 0;
    const listeners: (() => void)[] = [];
    const signal = {
      aborted: false,
      addEventListener: (_t: 'abort', l: () => void) => listeners.push(l),
    };
    h.session.on('documentChanged', () => n++, signal);
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 1 }));
    for (const l of listeners) l();
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 1 }));
    expect(n).toBe(1);
  });
});
