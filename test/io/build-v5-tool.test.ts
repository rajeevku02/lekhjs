// `lekhboard/tools/build-v5.js` run as the stencil maintainer runs it (verification 04 §4):
// derived into a temporary folder from `stencils/v4`, it reproduces the committed `v5` file for
// file (AC-GEN-13), and a v4 template id with no lekhjs module fails the build with exit 1, names
// the id and writes nothing to the output folder (AC-GEN-14). lekhboard has no test runner of its
// own, so this suite holds the lekhboard rows from the lekhjs side, like `stencils-v5.test.ts`.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const LEKHBOARD = path.join(PKG_ROOT, '..', 'lekhboard');
const TOOL = path.join(LEKHBOARD, 'tools', 'build-v5.js');
const V4 = path.join(LEKHBOARD, 'stencils', 'v4');
const V5 = path.join(LEKHBOARD, 'stencils', 'v5');

const tmp = mkdtempSync(path.join(tmpdir(), 'lekhjs-build-v5-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(...args: string[]) {
  return spawnSync(process.execPath, [TOOL, '--quiet', ...args], { encoding: 'utf8', timeout: 60_000 });
}

describe.skipIf(!existsSync(TOOL) || !existsSync(V4) || !existsSync(V5))('lekhboard/tools/build-v5.js', () => {
  it('derives exactly the committed v5 from v4 into a temporary folder (AC-GEN-13)', () => {
    const out = path.join(tmp, 'v5-fresh');
    const r = run('--to', out);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const names = readdirSync(out).sort();
    expect(names).toEqual(readdirSync(V5).sort());
    const differing = names.filter((n) => !readFileSync(path.join(out, n)).equals(readFileSync(path.join(V5, n))));
    expect(differing).toEqual([]);
    expect(run('--check').status).toBe(0);
  });

  it('a v4 id with no module: exit 1 naming the id, and nothing written (AC-GEN-14)', () => {
    const from = path.join(tmp, 'v4-nosuch');
    cpSync(V4, from, { recursive: true });
    const file = path.join(from, 'wireframe.json');
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('"avabodh.wireframe.button"');
    writeFileSync(file, text.replace('"avabodh.wireframe.button"', '"avabodh.wireframe.nosuch"'));

    const fresh = path.join(tmp, 'v5-none');
    const r = run('--from', from, '--to', fresh);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('avabodh.wireframe.nosuch');
    expect(existsSync(fresh)).toBe(false);

    // An existing output folder is left as it was, byte for byte.
    const existing = path.join(tmp, 'v5-existing');
    cpSync(V5, existing, { recursive: true });
    const before = readdirSync(existing).map((n) => [n, readFileSync(path.join(existing, n), 'utf8')] as const);
    expect(run('--from', from, '--to', existing).status).toBe(1);
    const after = readdirSync(existing).map((n) => [n, readFileSync(path.join(existing, n), 'utf8')] as const);
    expect(after).toEqual(before);
  });
});
