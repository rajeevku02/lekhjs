// The difference-register fixtures of sync/ (spec 03 §15-§16; parity/register/DR-ENG-13..16.yaml):
// one minimal synthetic case per entry, showing the TS behaviour. B2 (DR-ENG-14), B3 (DR-ENG-15)
// and B4 (DR-ENG-16) are the sync/ bug fixes; DR-ENG-13 is the outgoing guard of §11.3.
import { describe, expect, it } from 'vitest';
import type { TemplatedObject } from '../../src/model';
import { updatetypes } from '../../src/sync';
import { A, B, P, board, fixtureJson, frame } from './helpers';

const json = () => fixtureJson('format/03-connector.lekh');
const prefix = `doc.pages.${P}.objects.`;

describe('DR-ENG-13: no attribute update is sent for an object that is not on its page', () => {
  it('a changeattr for a deleted object is not sent', () => {
    const b = board(json());
    b.doc.getPage(P)?.objectStore.removeById(A);
    expect(b.sync.raise({ type: updatetypes.changeAttr, changes: { [`${prefix}${A}.params.cx`]: 5 } })).toBe(false);
    expect(b.transport.sent).toEqual([]);
  });
});

describe('DR-ENG-14 (B2): the version comes from the board source and every load resets it', () => {
  it('outgoing frames carry the source version before any frame arrived', () => {
    const b = board(json(), { version: 41 });
    b.sync.raise({ type: updatetypes.changeAttr, changes: { [`${prefix}${A}.params.cx`]: 5 } });
    expect(b.transport.frames()[0]?.['version']).toBe(41);
  });

  it('a load frame, and start() on a reopen, reset it', () => {
    const b = board(json(), { version: 41 });
    b.sync.receive(frame(updatetypes.load, { doc: json() }, 3));
    expect(b.sync.version).toBe(3);
    b.sync.start(b.sync.docid, 90);
    expect(b.sync.version).toBe(90);
  });
});

describe('DR-ENG-15 (B3): a load frame with empty changes is rejected', () => {
  it('nothing applied, version kept, frame_rejected (C++ dereferenced begin() of an empty map)', () => {
    const b = board(json(), { version: 8 });
    const before = b.text();
    expect(b.sync.receive(frame(updatetypes.load, {}, 9)).kind).toBe('rejected');
    expect(b.text()).toBe(before);
    expect(b.sync.version).toBe(8);
  });
});

describe('DR-ENG-16 (B4): realtime frames apply transactionally', () => {
  it('a changeattr whose second entry is bad leaves the first object untouched (C++ moved it)', () => {
    const b = board(json(), { version: 8 });
    const before = b.text();
    const out = b.sync.receive(
      frame(updatetypes.changeAttr, { [`${prefix}${A}.params.cx`]: 999, [`${prefix}${B}.params.cy`]: 'not a number' }),
    );
    expect(out.kind).toBe('rejected');
    expect((b.doc.getPage(P)?.getObject(A) as TemplatedObject).ds.cx()).toBe(150);
    expect(b.text()).toBe(before);
    expect(b.sync.version).toBe(8);
  });
});
