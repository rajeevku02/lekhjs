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
    const tree = JSON.parse(out) as { dependencies?: Record<string, { extraneous?: boolean }> };
    // A worktree whose node_modules is a symlink to another checkout's makes npm list every
    // installed dev package as `extraneous` (it resolves them through the link's real path). An
    // extraneous package is not a declared dependency, so only the others count.
    const declared = Object.entries(tree.dependencies ?? {}).filter(([, d]) => d.extraneous !== true);
    expect(declared.map(([name]) => name)).toEqual([]);
  });
});
