// AC-ENG-25 (model/ part): no source file under model/ contains `async`, `await` or `Promise`
// (model/ declares no port that returns one).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('model/ is synchronous (AC-ENG-25)', () => {
  it('no async/await/Promise', () => {
    const dir = path.join(PKG_ROOT, 'src', 'model');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((x) => x.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const code = strip(readFileSync(path.join(dir, f), 'utf8'));
      expect(/\basync\b|\bawait\b|\bPromise\b/.test(code), f).toBe(false);
    }
  });
});
