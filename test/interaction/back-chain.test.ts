// AC-UI-11 (unit half, lekhjs part): Android back on the board (`CommandDispatcher.back`, spec 05
// §3.4, spec 09 §8) closes the top popover, then finishes text editing, then clears the
// selection or vertex handle, and only then answers `leave` (the host closes the board).
import { describe, expect, it } from 'vitest';
import { A, viewHarness } from './helpers';

describe('back chain (AC-UI-11)', () => {
  it('popover → text editing → selection → leave, one step per press', () => {
    let open = true;
    const h = viewHarness({
      closeTopPopover: () => {
        const was = open;
        open = false;
        return was;
      },
    });
    h.bv.overlay.select(h.obj(A));
    h.bv.commands.run('enter');
    expect(h.bv.textEdit.active).toBe(true);
    expect(h.bv.commands.back()).toBe('popover');
    expect(h.bv.textEdit.active).toBe(true);
    expect(h.bv.commands.back()).toBe('text');
    expect(h.bv.textEdit.active).toBe(false);
    h.bv.overlay.select(h.obj(A));
    expect(h.bv.commands.back()).toBe('selection');
    expect(h.session.selection).toEqual([]);
    expect(h.bv.commands.back()).toBe('leave');
  });

  it('text editing is finished before the selection is cleared', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    h.bv.commands.run('enter');
    expect(h.bv.commands.back()).toBe('text');
    expect(h.bv.textEdit.active).toBe(false);
  });

  it('nothing open: leave at once', () => {
    const h = viewHarness();
    expect(h.bv.commands.back()).toBe('leave');
  });
});
