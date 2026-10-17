// AC-REC-34 (spec 07 §7.2): the recognizer corpus is synthetic, seeded or developer-drawn, and
// every entry records its origin. No user strokes.
//  - The stroke corpus (support/strokes.ts): every stroke carries `origin`.
//  - The C++ goldens the suites compare with: each names, in `about`, the parity tool that wrote
//    it from synthetic or seeded inputs, and that tool exists.
//  - Any committed corpus or parity-reference JSON (spec 07 §7.2, §7.4: test/recognizer/corpus/,
//    test/recognizer/parity/reference/; none before H-REC-1/2) carries `origin` per file or per
//    case.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { STROKE_CORPUS } from './support/strokes';

const ORIGINS = new Set(['synthetic', 'dev', 'seed']);
const TEST = path.join(PKG_ROOT, 'test');

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return jsonFiles(p);
    return d.name.endsWith('.json') ? [p] : [];
  });
}

describe('AC-REC-34: the recognizer corpus records its origin', () => {
  it('every corpus stroke is synthetic, seeded or developer-drawn', () => {
    expect(STROKE_CORPUS.length).toBeGreaterThan(10);
    for (const s of STROKE_CORPUS) expect(ORIGINS.has(s.origin), s.name).toBe(true);
  });

  it('every recognizer golden names the parity tool that generated it', () => {
    const goldens = [
      ...jsonFiles(path.join(TEST, 'recognizer/golden')),
      path.join(TEST, 'fixtures/golden/fit-akaar.json'),
      path.join(TEST, 'fixtures/golden/fit-curve-ellipse.json'),
    ];
    expect(goldens.length).toBeGreaterThanOrEqual(5);
    for (const f of goldens) {
      const about = (JSON.parse(readFileSync(f, 'utf8')) as { about?: string }).about ?? '';
      const tool = /parity\/tools\/([\w-]+)\/regen\.mjs/.exec(about);
      expect(tool, path.relative(PKG_ROOT, f)).not.toBeNull();
      expect(existsSync(path.join(PKG_ROOT, 'parity/tools', tool?.[1] ?? '', 'regen.mjs'))).toBe(true);
    }
  });

  it('committed corpus and reference files carry an origin', () => {
    const files = [
      ...jsonFiles(path.join(TEST, 'recognizer/corpus')),
      ...jsonFiles(path.join(TEST, 'recognizer/parity/reference')).filter((f) => !f.endsWith('MANIFEST.json')),
    ];
    for (const f of files) {
      const d = JSON.parse(readFileSync(f, 'utf8')) as { origin?: string; cases?: { origin?: string }[] };
      const ok =
        ORIGINS.has(d.origin ?? '') || (Array.isArray(d.cases) && d.cases.every((c) => ORIGINS.has(c.origin ?? '')));
      expect(ok, path.relative(PKG_ROOT, f)).toBe(true);
    }
  });
});
