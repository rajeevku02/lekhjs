// The per-session undo stack (spec 03 §11.5): cap 200, redo cleared by a new step, a command whose
// objects are gone is dropped, and an undo after a peer deleted the object sends no frame
// (AC-ENG-19, DR-ENG-13). EditTransaction: run, record, begin/commit/cancel.
import { describe, expect, it } from 'vitest';
import { Rect } from '../../src/geometry';
import {
  ChangeGridAction,
  EditTransaction,
  ExpandAction,
  TemplatedObjectsChangeAction,
  TranslateObjectAction,
  UNDO_STACK_SIZE,
  UndoManager,
} from '../../src/edit';
import type { TemplatedObject } from '../../src/model';
import { updatetypes } from '../../src/sync';
import { A, B, P, board, fixtureJson, frame, must } from '../sync/helpers';

const conn = () => board(fixtureJson('format/03-connector.lekh'));

describe('UndoManager', () => {
  it('keeps at most 200 steps, the oldest dropped first', () => {
    const b = conn();
    const u = b.editor.undo;
    const first = new ChangeGridAction(b.editor.env, b.doc, false);
    u.addAction(first);
    for (let i = 0; i < UNDO_STACK_SIZE + 5; i++) u.addAction(new ChangeGridAction(b.editor.env, b.doc, i % 2 === 0));
    expect(u.undoDepth).toBe(UNDO_STACK_SIZE);
    expect(UNDO_STACK_SIZE).toBe(200);
  });

  it('a new step clears redo; state changes are reported', () => {
    let changes = 0;
    const b = conn();
    const u = new UndoManager({ onStateChange: () => changes++ });
    u.addAction(new ChangeGridAction(b.editor.env, b.doc, false));
    u.undo();
    expect(u.canRedo()).toBe(true);
    u.addAction(new ChangeGridAction(b.editor.env, b.doc, true));
    expect(u.canRedo()).toBe(false);
    expect(changes).toBeGreaterThan(0);
  });

  it('a step whose object a peer deleted is dropped on undo and sends nothing (AC-ENG-19)', () => {
    const b = conn();
    b.editor.tx.run(new TranslateObjectAction(b.editor.env, b.doc, must(must(b.doc.getPage(P)).getObject(A)), 10, 0));
    b.flush();
    expect(b.transport.sent).toHaveLength(1);
    b.sync.receive(frame(updatetypes.delObjects, { [`doc.pages.${P}.objects.${A}`]: null }));
    b.editor.undo.undo();
    b.flush();
    expect(b.transport.sent).toHaveLength(1);
    expect(b.editor.undo.canUndo()).toBe(false);
    expect(b.editor.undo.canRedo()).toBe(false);
  });

  it('DR-ENG-13: an attribute update raised for an object not on its page is not sent', () => {
    const b = conn();
    b.sync.raise({ type: updatetypes.changeAttr, changes: { [`doc.pages.${P}.objects.gone.params.cx`]: 1 } });
    expect(b.transport.sent).toHaveLength(0);
    b.sync.raise({
      type: updatetypes.changeAttr,
      changes: { [`doc.pages.${P}.objects.gone.params.cx`]: 1, [`doc.pages.${P}.objects.${B}.params.cx`]: 2 },
    });
    const f = b.transport.frames()[0] as { updates: { changes: Record<string, unknown> } };
    expect(Object.keys(f.updates.changes)).toEqual([`doc.pages.${P}.objects.${B}.params.cx`]);
    // Adds and deletes are not attribute updates: a delete of an absent id still goes out.
    b.sync.raise({ type: updatetypes.delObjects, changes: { [`doc.pages.${P}.objects.gone`]: null } });
    expect(b.transport.sent).toHaveLength(2);
  });
});

describe('EditTransaction', () => {
  it('run performs and pushes; a failing command is not pushed', () => {
    const b = conn();
    const tx = new EditTransaction(b.editor.env, b.editor.undo);
    expect(tx.run(new ChangeGridAction(b.editor.env, b.doc, false))).toBe(true);
    const ghost = new ExpandAction(b.editor.env, b.doc, must(must(b.doc.getPage(P)).getObject(A)), {
      old: new Rect(),
      cur: new Rect(0, 0, 5, 5),
    });
    must(b.doc.getPage(P)).objectStore.removeById(A);
    expect(tx.run(ghost)).toBe(false);
    expect(b.editor.undo.undoDepth).toBe(1);
  });

  it('begin … commit: one step and one changeattr frame for every changed object; nothing changed → nothing', () => {
    const b = conn();
    const tx = b.editor.tx;
    const a = must(b.doc.getPage(P)).getObject(A) as TemplatedObject;
    tx.begin(b.doc, [A, B]);
    expect(tx.commit()).toBe(false);
    tx.begin(b.doc, [A, B]);
    a.setRect(Rect.fromCenter(a.ds.rect().center(), 300, 30));
    expect(tx.commit()).toBe(true);
    expect(b.editor.undo.topUndo()).toBeInstanceOf(TemplatedObjectsChangeAction);
    expect(b.sink.updates).toHaveLength(1);
    expect(b.sink.updates[0]?.type).toBe('changeattr');
    expect(Object.keys(b.sink.updates[0]?.changes ?? {}).every((k) => k.includes(`.objects.${A}.`))).toBe(true);
    b.editor.undo.undo();
    expect(a.ds.width()).toBe(120);
  });

  it('cancel restores the snapshot and records nothing', () => {
    const b = conn();
    const a = must(b.doc.getPage(P)).getObject(A) as TemplatedObject;
    b.editor.tx.begin(b.doc, [A]);
    a.setRect(new Rect(0, 0, 10, 10));
    b.editor.tx.cancel();
    expect(a.ds.width()).toBe(120);
    expect(b.editor.undo.canUndo()).toBe(false);
    expect(b.sink.updates).toHaveLength(0);
  });
});
