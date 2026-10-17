// AC-ARC-10: tools/bundle-audit.mjs passes a clean bundle and fails each seeded bad one,
// naming the hit.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seed(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lekhjs-audit-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}

function audit(dir: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/bundle-audit.mjs'), '--dir', dir], {
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const CLEAN =
  'const document = { pages: [] };\nexport function count(o) { return o.window + document.pages.length; }\n';

describe('bundle-audit', () => {
  it('passes a clean bundle (a local named document and a .window property are fine)', () => {
    expect(audit(seed({ 'index.js': CLEAN, 'headless.js': CLEAN })).status).toBe(0);
  });

  it('fails on pdfkit', () => {
    const r = audit(seed({ 'index.js': 'import PDFDocument from "pdfkit";\nexport { PDFDocument };\n' }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("index.js: contains 'pdfkit'");
  });

  it('fails on a test-only symbol in headless.js', () => {
    const r = audit(seed({ 'headless.js': 'export function createTestRuntime() { return 1; }\n' }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("headless.js: contains the test-only symbol 'createTestRuntime'");
  });

  it('allows test-only code in testing.js', () => {
    expect(audit(seed({ 'testing.js': 'export function createTestRuntime() { return 1; }\n' })).status).toBe(0);
  });

  it('fails on a global window or document reference', () => {
    const r = audit(seed({ 'index.js': 'export const w = () => window.innerWidth + document.title.length;\n' }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("references the global 'window'");
    expect(r.out).toContain("references the global 'document'");
  });

  it('fails on interaction code named by the sourcemap', () => {
    const dir = seed({
      'index.js': 'export const a = 1;\n',
      'index.js.map': JSON.stringify({ version: 3, sources: ['../../src/interaction/InputRouter.ts'], mappings: '' }),
    });
    const r = audit(dir);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('contains interaction code');
  });
  it('fails on recognizer or PDF export code named by the sourcemap (AC-REC-23, REV-10)', () => {
    const dir = seed({
      'headless.js': 'export const a = 1;\n',
      'headless.js.map': JSON.stringify({
        version: 3,
        sources: ['../../src/recognizer/core/Recognizer.ts', '../../src/export/pdf/pdf-export.ts'],
        mappings: '',
      }),
    });
    const r = audit(dir);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('contains recognizer code');
    expect(r.out).toContain('contains PDF export code');
  });
});
