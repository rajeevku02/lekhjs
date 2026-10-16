// AC-ARC-12: the library never reaches the C++ oracle. Nothing in src/ or test/ names a
// wasm file or a path into the C++ repositories or the backend, and neither do the
// package's dependencies or exports. (The pattern is assembled from parts so that this
// file does not match itself.)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const NAMES = ['lekh' + 'core', 'lekh' + 'emsdk', 'lekhboard' + 'webapp'];
const PATTERN = new RegExp(['\\.' + 'wasm', ...NAMES, '\\.\\./' + 'lbs'].join('|'));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : [p];
  });
}

describe('no oracle references', () => {
  it.each(['src', 'test'])('%s/ names no wasm or C++/backend path', (dir) => {
    const hits = files(path.join(PKG_ROOT, dir)).filter((f) => PATTERN.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(PKG_ROOT, f))).toEqual([]);
  });

  it('package.json dependencies and exports name none of them', () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
    const text = JSON.stringify({ d: pkg['dependencies'] ?? null, e: pkg['exports'] ?? null });
    expect(PATTERN.test(text)).toBe(false);
  });
});
