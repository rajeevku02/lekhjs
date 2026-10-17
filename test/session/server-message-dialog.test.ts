// The server `message` frame's dialog (C++ `CoreIO::readBackendMessage` /
// `processBackendMessage`; KB websocket-protocol §6.2-§6.3): `upgrade: true` is the "Read-only
// board" paywall (Upgrade / Keep viewing, trigger readonly_open), `reload: true` is Reload, an
// empty text shows nothing, anything else is the text with OK; the format gate keeps its own.
import { describe, expect, it } from 'vitest';
import { dialogForMessage } from '../../src/session/board-session';

const msg = (o: Partial<{ code: string; arg: string; message: string; reload: boolean; upgrade: boolean }>) => ({
  code: '',
  arg: '',
  message: '',
  reload: false,
  upgrade: false,
  ...o,
});

describe('dialogForMessage', () => {
  it('upgrade: true → the Read-only board paywall, even with reload', () => {
    const text = 'This board is read-only on the free plan.';
    expect(dialogForMessage(msg({ code: 'no_subscription', message: text, upgrade: true }))).toEqual({
      kind: 'paywall',
      trigger: 'readonly_open',
      title: 'Read-only board',
      message: text,
      dismiss: 'Keep viewing',
    });
    expect(dialogForMessage(msg({ code: 'no_subscription', message: text, upgrade: true, reload: true }))?.kind).toBe(
      'paywall',
    );
  });

  it('reload: true → Reload (update_error)', () => {
    expect(dialogForMessage(msg({ code: 'update_error', message: 'Unable to save. Reload.', reload: true }))).toEqual({
      kind: 'reload',
      message: 'Unable to save. Reload.',
    });
  });

  it('a plain message → OK; an empty one → nothing', () => {
    expect(dialogForMessage(msg({ code: 'no_org_subscription', message: 'Read only' }))).toEqual({
      kind: 'info',
      title: '',
      message: 'Read only',
    });
    expect(dialogForMessage(msg({ code: 'x', message: '', upgrade: true, reload: true }))).toBeNull();
  });

  it('board_requires_newer_app keeps the gate dialog', () => {
    expect(dialogForMessage(msg({ code: 'board_requires_newer_app', message: 'Update', reload: true }))).toEqual({
      kind: 'gate',
      code: 'board_requires_newer_app',
      message: 'Update',
      reload: true,
    });
  });
});
