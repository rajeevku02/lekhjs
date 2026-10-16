// AC-ENG-25 (text/ and style/ part): no source file contains `async` or `await`, and `Promise`
// appears only in a port interface declaration (`FontLoader`, text/ports.ts).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('synchronous text engine (AC-ENG-25)', () => {
  for (const mod of ['text', 'style']) {
    it(`src/${mod}/ has no async/await and Promise only in ports.ts`, () => {
      const dir = path.join(PKG_ROOT, 'src', mod);
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
        const code = strip(readFileSync(path.join(dir, f), 'utf8'));
        expect(/\basync\b|\bawait\b/.test(code), `${mod}/${f}`).toBe(false);
        if (f !== 'ports.ts') expect(/\bPromise\b/.test(code), `${mod}/${f}`).toBe(false);
      }
    });
  }
});
