// AC-BE-08: `serialize()` of a loaded board is identical before and after each read-side call
// (`layoutAll()`, `project()`; `lint()` and `paintPage()` join `CALLS`), over the fixture boards.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { project } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { CORE_FIXTURES, lekhFiles } from '../io/helpers';
import { testRuntime } from '../session/helpers';

/** One read-side call; each runs on a freshly loaded session. */
const CALLS: readonly { readonly name: string; readonly run: (s: BoardSession) => unknown }[] = [
  {
    name: 'layoutAll',
    run: (s) => {
      s.layoutAll();
    },
  },
  { name: 'project', run: (s) => project(s, {}) },
  {
    name: 'project (region, no style)',
    run: (s) => project(s, { include_style: false, region: { minx: 0, miny: 0, maxx: 500, maxy: 500 } }),
  },
];

describe('AC-BE-08: read-side calls do not change serialize()', () => {
  const runtime = testRuntime();
  const files = lekhFiles(CORE_FIXTURES);
  it('has fixtures', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const call of CALLS) {
    it(`${call.name} leaves serialize() unchanged on every fixture`, () => {
      const changed: string[] = [];
      for (const f of files) {
        const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
        try {
          const r = s.load(readFileSync(path.join(CORE_FIXTURES, f), 'utf8'), { kind: 'offline' });
          if (!r.ok) continue;
          const before = s.serialize({ stamp: 'cloud' });
          call.run(s);
          if (s.serialize({ stamp: 'cloud' }) !== before) changed.push(f);
        } finally {
          s.dispose();
        }
      }
      expect(changed).toEqual([]);
    });
  }
});
