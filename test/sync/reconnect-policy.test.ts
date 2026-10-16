// The reconnect decision (spec 09 §7; AC-PLT-30 and AC-PLT-32, unit half): a fake transport and
// lifecycle events, on native (LekhPlugin to_background / to_foreground) and on the web
// (`visibilitychange` hidden / visible: the same `hostLifecycle` events), and on Mac (no
// auto-reconnect).
import { describe, expect, it } from 'vitest';
import { ReconnectPolicy, SyncSession, type ReconnectDecision } from '../../src/sync';
import { DOCID, FakeTransport, ManualClock, ManualScheduler, board, fixtureJson } from './helpers';

const DIALOG = { kind: 'dialog', dialog: { kind: 'disconnected' } };
const REOPEN = { kind: 'reopen', reason: 'auto_reconnect' };
const open = (p: ReconnectPolicy) => p.onTransportState({ state: 'open', at: 0 });
const close = (p: ReconnectPolicy) => p.onTransportState({ state: 'closed', closeCode: 1006, at: 1 });

describe('ReconnectPolicy', () => {
  it('a close in the foreground with auto-reconnect reopens the board', () => {
    const p = new ReconnectPolicy({ autoReconnect: true });
    open(p);
    expect(close(p)).toEqual(REOPEN);
  });

  it('a close in the foreground without auto-reconnect (Mac) shows Disconnected with Reload (AC-PLT-32)', () => {
    const p = new ReconnectPolicy({ autoReconnect: false });
    open(p);
    expect(close(p)).toEqual(DIALOG);
  });

  it.each([
    ['native: to_background then the close', true],
    ['Mac: to_background then the close', false],
  ])('%s → the dialog, no reconnect, once (AC-PLT-30)', (_n, auto) => {
    const p = new ReconnectPolicy({ autoReconnect: auto });
    open(p);
    expect(p.onHostLifecycle('background')).toBeNull();
    expect(close(p)).toEqual(DIALOG);
    expect(p.onHostLifecycle('foreground', 'closed')).toBeNull();
  });

  it('the close only reaches JS after resume (WKWebView): the socket is not open at foreground → the dialog', () => {
    const p = new ReconnectPolicy({ autoReconnect: true });
    open(p);
    p.onHostLifecycle('background');
    // The resumed transport already reports closed before its close event is delivered.
    expect(p.onHostLifecycle('foreground', 'closed')).toEqual(DIALOG);
    // The late close event takes no second decision and starts no reconnect.
    expect(close(p)).toBeNull();
  });

  it('web: a hidden tab whose socket closed shows the dialog on visible (visibilitychange case)', () => {
    const p = new ReconnectPolicy({ autoReconnect: true });
    open(p);
    p.onHostLifecycle('background'); // document.visibilityState === 'hidden'
    expect(p.onHostLifecycle('foreground', 'closed')).toEqual(DIALOG); // 'visible'
  });

  it('back in the foreground with the socket still open: nothing', () => {
    const p = new ReconnectPolicy({ autoReconnect: true });
    open(p);
    p.onHostLifecycle('background');
    expect(p.onHostLifecycle('foreground', 'open')).toBeNull();
    expect(close(p)).toEqual(REOPEN);
  });

  it('after a reopen a new disconnect is decided again; after stop() a close is deliberate', () => {
    const p = new ReconnectPolicy({ autoReconnect: true });
    open(p);
    expect(close(p)).toEqual(REOPEN);
    expect(close(p)).toBeNull();
    p.restart();
    open(p);
    expect(close(p)).toEqual(REOPEN);
    p.restart();
    open(p);
    p.stop();
    expect(close(p)).toBeNull();
    expect(p.onHostLifecycle('foreground', 'closed')).toBeNull();
  });
});

describe('SyncSession wiring of the policy', () => {
  it('emits the decision and reads the live transport state on foreground', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    const seen: ReconnectDecision[] = [];
    b.sync.on('reconnect', (d) => seen.push(d));
    b.sync.onTransportState({ state: 'open', at: 0 });
    b.sync.onHostLifecycle('background');
    b.transport.state = 'closed';
    b.sync.onHostLifecycle('foreground');
    expect(seen).toEqual([DIALOG]);
  });

  it('a Mac session (autoReconnect false) never asks to reopen', () => {
    const clock = new ManualClock();
    const b = board(fixtureJson('format/03-connector.lekh'));
    const transport = new FakeTransport();
    const s = new SyncSession({
      host: { document: () => b.doc, codec: b.io.codec, replaceDocument: () => undefined },
      clock,
      scheduler: new ManualScheduler(clock),
      docid: DOCID,
      transport,
      autoReconnect: false,
    });
    s.onTransportState({ state: 'open', at: 0 });
    expect(s.onTransportState({ state: 'closed', at: 1 })).toEqual(DIALOG);
  });
});
