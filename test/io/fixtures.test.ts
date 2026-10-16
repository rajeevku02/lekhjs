// Every C++-written fixture loads (AC-FMT-02, the fixture half of AC-ENG-01): the 40 boards of the
// core's own fixtures and the 48 of the backend's core tier, read in place from the sibling
// worktrees (parity/fixture-sets.json). The format/ examples, which the C++ core generated and round-trips exactly, also
// round-trip exactly through the TS writer (cloud stamp; same JSON).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIVE_NAMES,
  BACKEND_FIXTURES,
  CORE_FIXTURES,
  allObjects,
  lekhFiles,
  readText,
  testIo,
  typesIn,
} from './helpers';
import { LEGACY_TYPE_NAMES } from '../../src/io';

const SETS = [
  { name: 'core', dir: CORE_FIXTURES, count: 40 },
  { name: 'backend', dir: BACKEND_FIXTURES, count: 48 },
];

for (const set of SETS) {
  describe.skipIf(!existsSync(set.dir))(`${set.name} fixtures`, () => {
    const files = existsSync(set.dir) ? lekhFiles(set.dir) : [];

    it(`has the ${String(set.count)} fixtures`, () => {
      expect(files).toHaveLength(set.count);
    });

    it.each(files)('%s loads, holds only live kinds and writes back', (rel) => {
      const io = testIo();
      const res = io.codec.read(readText(path.join(set.dir, rel)));
      expect(res.doc.pages.length).toBeGreaterThan(0);
      for (const o of allObjects(res.doc)) expect(LIVE_NAMES).toContain(o.name());
      const out = io.codec.write(res.doc, { stamp: 'offline' });
      expect(out.version).toBe('5.0');
      expect(typesIn(out.json).filter((t) => LEGACY_TYPE_NAMES.includes(t))).toEqual([]);
      // What TS wrote, TS reads again; from the second write on the text is a fixed point. (The
      // first may still drop a converted legacy style attribute equal to the template's effective
      // value, which a template style never keeps — as C++.)
      const second = io.codec.write(testIo().codec.read(out.text).doc, { stamp: 'offline' });
      const third = io.codec.write(testIo().codec.read(second.text).doc, { stamp: 'offline' });
      expect(JSON.parse(third.text)).toEqual(JSON.parse(second.text));
    });
  });
}

const FORMAT = path.join(CORE_FIXTURES, 'format');

describe.skipIf(!existsSync(FORMAT))('format/ examples round-trip exactly', () => {
  const files = existsSync(FORMAT) ? lekhFiles(FORMAT) : [];
  it.each(files)('%s', (rel) => {
    const text = readText(path.join(FORMAT, rel));
    const io = testIo();
    const out = io.codec.write(io.codec.read(text).doc, { stamp: 'cloud' });
    expect(out.json).toEqual(JSON.parse(text));
  });
});
