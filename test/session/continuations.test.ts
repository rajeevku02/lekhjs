// Continuations across a host await (spec 03 §12.2): AC-ENG-16, AC-ENG-29, E-34.
import { describe, expect, it } from 'vitest';
import { updatetypes } from '../../src/sync';
import { A, B, P, cmd, fixtureJson, frame, harness } from './helpers';

const prefix = `doc.pages.${P}.objects.`;

describe('continuations', () => {
  it('AC-ENG-16: a recognition result or dialog continuation after a reload is dropped', () => {
    const h = harness({ cloud: true });
    const gen = h.session.docGeneration;
    const applied: string[] = [];
    h.session.setRecognitionApplier((_ctx, r) => {
      applied.push(r.strokeId);
    });
    const answered: string[] = [];
    h.session.registerCommand('dialog-answer', (ctx) => {
      answered.push(...ctx.objects.map((o) => o.id));
    });
    h.transport.deliver(frame(updatetypes.load, { doc: fixtureJson('format/03-connector.lekh') }, 40));
    expect(h.session.docGeneration).toBe(gen + 1);
    const reloaded = h.session.serialize({ stamp: 'cloud' });
    h.dispatch({ type: 'recognitionResult', strokeId: 's1', docGeneration: gen, mutations: [] });
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 40, dy: 0 }, gen, 'continuation'));
    h.dispatch(cmd({ kind: 'custom', name: 'dialog-answer', ids: [A] }, gen, 'continuation'));
    expect(applied).toEqual([]);
    expect(answered).toEqual([]);
    expect(h.session.serialize({ stamp: 'cloud' })).toBe(reloaded);
    expect(h.transport.sent).toHaveLength(0);
    expect(h.seen.some((s) => s.k === 'error')).toBe(false);
    // The current generation is applied.
    h.dispatch({ type: 'recognitionResult', strokeId: 's2', docGeneration: h.session.docGeneration, mutations: [] });
    expect(applied).toEqual(['s2']);
  });

  it('AC-ENG-29 / E-34: a continuation naming a deleted id applies to the survivors only', () => {
    const h = harness({ cloud: true });
    const gen = h.session.docGeneration;
    const seenIds: string[][] = [];
    h.session.registerCommand('record', (ctx) => {
      seenIds.push(ctx.objects.map((o) => o.id));
    });
    h.transport.deliver(frame(updatetypes.delObjects, { [`${prefix}${B}`]: null }, 8));
    expect(h.session.document.getPage(P)?.getObject(B)).toBeNull();
    h.dispatch(cmd({ kind: 'custom', name: 'record', ids: [A, B] }, gen, 'continuation'));
    h.dispatch(cmd({ kind: 'move', ids: [A, B], dx: 7, dy: 0 }, gen, 'continuation'));
    expect(seenIds).toEqual([[A]]);
    expect(h.transport.sent).toHaveLength(1);
    expect(h.transport.sent[0]).toContain(A);
    expect(h.transport.sent[0]).not.toContain(`${prefix}${B}`);
    expect(h.seen.some((s) => s.k === 'error')).toBe(false);
  });

  it('a remote delete drops the deleted id from the selection', () => {
    const h = harness({ cloud: true });
    h.dispatch(cmd({ kind: 'select', ids: [A, B] }));
    h.transport.deliver(frame(updatetypes.delObjects, { [`${prefix}${B}`]: null }, 8));
    expect(h.session.selection).toEqual([A]);
    const dc = h.seen.filter((s) => s.k === 'documentChanged').at(-1)?.e as { removedIds: string[] };
    expect(dc.removedIds).toEqual([B]);
  });
});
