// A failed `open` (C++ `CoreIO::openFile` / `startOffline` → `DocManager::loadDoc`'s error): the
// core shows no dialog of its own; the error event carries the fixed LoadError text, which the
// host shows once (iOS / Android "Error while loading!"; the C++ web build showed nothing).
import { describe, expect, it } from 'vitest';
import { harness } from './helpers';

describe('a failed open', () => {
  it('raises an error with the LoadError text and no dialog', () => {
    const h = harness();
    h.dispatch({ type: 'open', raw: 'not a board', meta: { kind: 'offline' } });
    const errors = h.seen
      .filter((s) => s.k === 'error')
      .map((s) => s.e as { code: string; eventType: string; message?: string });
    expect(errors.length).toBe(1);
    expect(errors[0]?.eventType).toBe('open');
    expect(errors[0]?.message).toMatch(/Unable to load/);
    expect(h.seen.filter((s) => s.k === 'dialog')).toEqual([]);
  });
});
