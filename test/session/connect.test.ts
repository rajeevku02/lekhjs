// A cloud board opened from its socket (W2 gaps, task W5): the `connect` event starts the
// realtime session without content, the first `load` frame's `permission` becomes the
// session's (spec 09 §7, kashi `document.js`), and `SessionOptions.autoReconnect` reaches the
// `ReconnectPolicy` (off on Mac).
import { describe, expect, it } from 'vitest';
import { BoardSession, type SessionEvents } from '../../src/session';
import { updatetypes } from '../../src/sync';
import { FakeImagePort, FakeScheduler, FakeTransport } from '../../src/testing';
import { DOCID, fixtureJson, testRuntime } from './helpers';

function loadFrame(permission: unknown, version = 40): string {
  return JSON.stringify({
    version,
    docid: DOCID,
    type: 'update',
    updates: {
      type: updatetypes.load,
      changes: { doc: fixtureJson('format/02-one-shape.lekh') },
      conditions: {},
      permission,
    },
  });
}

function cloud(autoReconnect?: boolean) {
  const transport = new FakeTransport();
  const session = new BoardSession(testRuntime(), {
    images: new FakeImagePort(),
    scheduler: new FakeScheduler(),
    transport,
    ...(autoReconnect !== undefined ? { autoReconnect } : {}),
  });
  const seen: { k: keyof SessionEvents; e: unknown }[] = [];
  for (const k of ['dialog', 'reopenRequested', 'documentChanged', 'error'] as const) {
    session.on(k, (e) => {
      seen.push({ k, e });
    });
  }
  return { session, transport, seen };
}

describe('connect: a cloud board whose content is the first load frame', () => {
  it('starts the realtime session for the docid; the load frame brings the document and its permission', () => {
    const c = cloud();
    c.session.dispatch({ type: 'connect', docid: DOCID, version: 0 });
    expect(c.session.sync.docid).toBe(DOCID);
    expect(c.session.sync.version).toBe(0);
    expect(c.session.permission).toBeNull();
    expect(c.session.isLoaded).toBe(false);
    c.transport.deliver(loadFrame('read'));
    expect(c.session.isLoaded).toBe(true);
    expect(c.session.permission).toBe('read');
    expect(c.session.sync.version).toBe(40);
    expect(c.seen.filter((s) => s.k === 'error')).toEqual([]);
  });

  it('a later load frame (a reload) updates the permission; an unknown value is ignored', () => {
    const c = cloud();
    c.session.dispatch({ type: 'connect', docid: DOCID });
    c.transport.deliver(loadFrame('comment'));
    expect(c.session.permission).toBe('comment');
    c.transport.deliver(loadFrame('write', 41));
    expect(c.session.permission).toBe('write');
    c.transport.deliver(loadFrame('owner', 42));
    expect(c.session.permission).toBe('write');
  });

  it('a load frame for another board is dropped with its permission', () => {
    const c = cloud();
    c.session.dispatch({ type: 'connect', docid: 'other' });
    c.transport.deliver(loadFrame('write'));
    expect(c.session.permission).toBeNull();
    expect(c.session.isLoaded).toBe(false);
  });
});

describe('autoReconnect reaches the ReconnectPolicy', () => {
  it('default (web, iOS, Android): a foreground close reopens the board', () => {
    const c = cloud();
    c.session.dispatch({ type: 'connect', docid: DOCID });
    c.transport.setState('open');
    c.transport.setState('closed');
    expect(c.seen.filter((s) => s.k === 'reopenRequested')).toHaveLength(1);
    expect(c.seen.filter((s) => s.k === 'dialog')).toEqual([]);
  });

  it('off (Mac): a foreground close shows "Disconnected from server" with Reload, no reopen', () => {
    const c = cloud(false);
    c.session.dispatch({ type: 'connect', docid: DOCID });
    c.transport.setState('open');
    c.transport.setState('closed');
    expect(c.seen.filter((s) => s.k === 'reopenRequested')).toEqual([]);
    expect(c.seen.filter((s) => s.k === 'dialog').map((s) => s.e)).toEqual([{ kind: 'disconnected' }]);
  });
});
