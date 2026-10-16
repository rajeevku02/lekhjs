// AC-UI-01: `lekhjs/interaction` has no import of `react` / `react-dom` and touches no DOM global at
// module top level; every file imports in Node (no `window`, no `document`). The lint zone
// (`no-restricted-imports` with the React patterns, `no-restricted-globals`) holds the same line
// for every file of src/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESTRICTED_GLOBALS, SRC_RESTRICTED_IMPORT_PATTERNS } from '../../tools/layers.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../src/interaction');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

const ALL = files(ROOT);
/** A DOM global used as an object (`window.x`) or called / constructed (`new Path2D(`). */
const DOM_USES: readonly RegExp[] = [
  /(?<![.\w])(window|document|navigator|localStorage|sessionStorage)\s*\./,
  /(?<![.\w])(requestAnimationFrame|cancelAnimationFrame|queueMicrotask|getComputedStyle)\s*\(/,
  /\bnew\s+(Path2D|Image|OffscreenCanvas|KeyboardEvent)\s*\(/,
  /\b(HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D)\b/,
];

describe('lekhjs/interaction has no DOM and no React (AC-UI-01)', () => {
  it('has files to check', () => {
    expect(ALL.length).toBeGreaterThan(20);
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  });

  for (const f of ALL) {
    const rel = path.relative(ROOT, f);
    it(`${rel} imports in Node and names no DOM global or React module`, async () => {
      await expect(import(f)).resolves.toBeDefined();
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/from\s+['"]react(-dom)?(\/[^'"]*)?['"]/);
      for (const re of DOM_USES) expect(src).not.toMatch(re);
    });
  }

  it('the lint zone bans React and the DOM globals in src/', () => {
    const groups = SRC_RESTRICTED_IMPORT_PATTERNS.flatMap((p) => p.group);
    expect(groups).toEqual(expect.arrayContaining(['react', 'react-dom']));
    expect(RESTRICTED_GLOBALS).toEqual(expect.arrayContaining(['window', 'document', 'navigator']));
  });
});
