// AC-REC-02, the review half (spec 07 §2.3): the three live `akaar` uses — the implicit-container
// rectangle check, make-square and make-equilateral — use `geometry/fit`'s Quadrilateral and
// Triangle; no other copy of either class exists. (The golden half: test/geometry/fit/golden.test.ts.)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const SRC = path.join(PKG_ROOT, 'src');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return files(p);
    return d.name.endsWith('.ts') ? [p] : [];
  });
}

const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/');

describe('AC-REC-02: the akaar call sites use geometry/fit', () => {
  const all = files(SRC);

  it('Quadrilateral and Triangle are defined only in geometry/fit', () => {
    const defs = all.filter((f) => /\bclass\s+(Quadrilateral|Triangle)\b/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(defs.sort()).toEqual(['geometry/fit/quadrilateral.ts', 'geometry/fit/triangle.ts']);
  });

  it('the implicit-container check, make-square and make-equilateral import them from geometry', () => {
    const uses: [string, RegExp, RegExp][] = [
      ['model/templated-object.ts', /isRectangle\(\)/, /\bQuadrilateral\b/],
      ['edit/selection-actions.ts', /makeSquare\(\)/, /\bQuadrilateral\b/],
      ['edit/selection-actions.ts', /makeEquilateral\(\)/, /\bTriangle\b/],
    ];
    for (const [file, call, cls] of uses) {
      const src = readFileSync(path.join(SRC, file), 'utf8');
      expect(call.test(src), `${file} calls ${String(call)}`).toBe(true);
      const imp = [...src.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm)].find((m) =>
        cls.test(m[1] ?? ''),
      );
      expect(imp, `${file} imports ${String(cls)}`).toBeDefined();
      const target = path.resolve(path.dirname(path.join(SRC, file)), imp?.[2] ?? '');
      expect(rel(target).startsWith('geometry'), `${file} imports it from ${imp?.[2] ?? ''}`).toBe(true);
    }
  });
});
