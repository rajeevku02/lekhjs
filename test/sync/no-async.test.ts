// AC-ENG-25 (sync/ and edit/ part): no source file under sync/ or edit/ contains `async`, `await`
// or `Promise` (neither declares a port that returns one).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('sync/ and edit/ are synchronous (AC-ENG-25)', () => {
  it.each(['sync', 'edit'])('%s/: no async/await/Promise', (m) => {
    const dir = path.join(PKG_ROOT, 'src', m);
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((x) => x.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const code = strip(readFileSync(path.join(dir, f), 'utf8'));
      expect(/\basync\b|\bawait\b|\bPromise\b/.test(code), f).toBe(false);
    }
  });
});
