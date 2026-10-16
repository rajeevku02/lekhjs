// AC-ENG-25 (template/ part): the template module is synchronous, and AC-GEN-09: nothing in it
// evaluates generator script text.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : [],
  );
}

describe('template/', () => {
  const all = files(path.join(PKG_ROOT, 'src', 'template'));

  it('has no async, await, Promise or timers', () => {
    expect(all.length).toBeGreaterThan(15);
    for (const f of all) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(/\basync\b|\bawait\b|\bPromise\b|\bsetTimeout\b|\bsetInterval\b/.test(code), f).toBe(false);
    }
  });

  it('never evaluates text: no eval, Function, Worker or dynamic import', () => {
    for (const f of all) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\bWorker\b|\bimport\s*\(/.test(code), f).toBe(false);
    }
  });

  it('never imports generators/ or any module above it', () => {
    for (const f of all) {
      const code = readFileSync(f, 'utf8');
      expect(
        /from '\.\.\/\.\.\/(generators|model|io|sync|edit|semantic|export|session|recognizer|headless|interaction)/.test(
          code,
        ),
        f,
      ).toBe(false);
    }
  });
});
