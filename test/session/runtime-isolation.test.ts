// AC-CLS-07, runtime half: every exported non-function value of every module barrel is frozen
// (deeply, for plain tables), and the shared objects hang off each Runtime, never module scope:
// two runtimes have distinct catalogs, line-width caches, font registries and generator registries.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../../src/testing';
import { PKG_ROOT } from '../lint/eslint-helpers';

const SRC = path.join(PKG_ROOT, 'src');
const MODULES = readdirSync(SRC).filter((m) => existsSync(path.join(SRC, m, 'index.ts')));

/** Paths of the not-frozen parts of `v` (plain objects and arrays are walked). */
function unfrozen(v: unknown, at: string, seen = new Set<unknown>()): string[] {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return [];
  if (typeof v === 'function' || seen.has(v)) return [];
  seen.add(v);
  const out = Object.isFrozen(v) ? [] : [at];
  const proto: unknown = Object.getPrototypeOf(v);
  if (Array.isArray(v) || proto === Object.prototype || proto === null)
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out.push(...unfrozen(x, `${at}.${k}`, seen));
  return out;
}

describe('no shared mutable module state (AC-CLS-07)', () => {
  it('every exported object of every barrel is frozen', async () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(17);
    const bad: string[] = [];
    for (const name of MODULES) {
      const mod = (await import(pathToFileURL(path.join(SRC, name, 'index.ts')).href)) as Record<string, unknown>;
      for (const [k, v] of Object.entries(mod)) bad.push(...unfrozen(v, `${name}.${k}`));
    }
    expect(bad).toEqual([]);
  });

  it('two runtimes share no catalog, cache or registry', () => {
    const r1 = createTestRuntime();
    const r2 = createTestRuntime();
    expect(r1.catalog).not.toBe(r2.catalog);
    expect(r1.lineWidths).not.toBe(r2.lineWidths);
    expect(r1.fonts).not.toBe(r2.fonts);
    expect(r1.generators).not.toBe(r2.generators);
  });
});
