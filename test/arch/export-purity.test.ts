// AC-EXP-28: no module in lekhjs/export imports a DOM global or `@capacitor/*` at top level. The
// import scan is here; the DOM-global identifier scan over all of src/ is no-dom-refs.test.ts
// (AC-CLS-15), and the Node import below proves the module loads with no DOM at all.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const EXPORT_DIR = path.join(PKG_ROOT, 'src', 'export');

describe('export purity (AC-EXP-28)', () => {
  it('imports nothing from @capacitor, react or the DOM-only libraries', () => {
    const bad: string[] = [];
    for (const f of files(EXPORT_DIR)) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)) {
        const spec = m[1] ?? '';
        if (/^@capacitor\//.test(spec) || /^react(-dom)?$/.test(spec) || spec === 'file-saver')
          bad.push(`${path.relative(PKG_ROOT, f)}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('loads in Node with no window or document', async () => {
    expect((globalThis as { window?: unknown }).window).toBeUndefined();
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    const mod = await import('../../src/export');
    expect(typeof mod.runExport).toBe('function');
    expect(typeof mod.planExport).toBe('function');
  });
});
