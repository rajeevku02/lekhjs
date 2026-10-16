// AC-BE-08, the lint leg: `serialize()` of a loaded board is identical before and after `lint()`
// (no draw/settle mutation), for every page of every core fixture board, with kashi's rule shape.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lint } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { CORE_FIXTURES, lekhFiles } from '../io/helpers';
import { testRuntime } from '../session/helpers';
import { rules } from './lint-helpers';

describe('AC-BE-08: lint does not change the serialized board', () => {
  const runtime = testRuntime();
  const files = lekhFiles(CORE_FIXTURES);

  it('has fixture boards', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const f of files) {
    it(f, () => {
      const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
      const r = s.load(readFileSync(path.join(CORE_FIXTURES, f), 'utf8'), { kind: 'offline' });
      expect(r.ok).toBe(true);
      const before = { offline: s.serialize({ stamp: 'offline' }), cloud: s.serialize({ stamp: 'cloud' }) };
      for (const p of s.document.pages) {
        const answer = lint(s, rules({ page: p.id }));
        expect(answer['ok']).toBe(true);
      }
      expect(s.serialize({ stamp: 'offline' })).toBe(before.offline);
      expect(s.serialize({ stamp: 'cloud' })).toBe(before.cloud);
      s.dispose();
    });
  }
});
