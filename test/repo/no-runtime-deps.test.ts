// AC-ARC-05: lekhjs has no runtime dependencies; `npm ls --omit=dev --json` lists nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

describe('runtime dependencies', () => {
  it('package.json has no dependencies key', () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg).not.toHaveProperty('dependencies');
    expect(pkg).not.toHaveProperty('peerDependencies');
    expect(pkg).not.toHaveProperty('optionalDependencies');
  });

  it('npm ls --omit=dev lists no packages', () => {
    const out = execFileSync('npm', ['ls', '--omit=dev', '--json'], { cwd: PKG_ROOT, encoding: 'utf8' });
    const tree = JSON.parse(out) as { dependencies?: Record<string, unknown> };
    expect(Object.keys(tree.dependencies ?? {})).toEqual([]);
  });
});
