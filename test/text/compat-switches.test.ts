// AC-TXT-30 (lekhjs half): `lineSpacingCompat` and `fontFallbackCompat` are off by default, are
// built only by `lekhjs/testing` (`setTestConfig`), and no product entry exports a way to turn
// them on. The heights-equal-the-C++-oracle half is in word-wrapper.golden.test.ts. The
// `BoardSession` rejection (`testing` set through `lekhjs`) comes with session/.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as main from '../../src/index';
import * as headless from '../../src/headless';
import * as testing from '../../src/testing';
import * as text from '../../src/text';
import { PKG_ROOT } from '../lint/eslint-helpers';

describe('test-only compat switches (AC-TXT-30)', () => {
  it('default off', () => {
    expect(text.TEXT_SWITCHES_OFF).toEqual({
      lineSpacingCompat: false,
      fontFallbackCompat: false,
      linePitch: undefined,
    });
    expect(testing.setTestConfig()).toEqual(text.TEXT_SWITCHES_OFF);
    expect(Object.isFrozen(text.TEXT_SWITCHES_OFF)).toBe(true);
  });

  it('setTestConfig turns them on, frozen, and rejects unknown keys and a bad pitch', () => {
    const c = testing.setTestConfig({ lineSpacingCompat: true, fontFallbackCompat: true });
    expect(c.lineSpacingCompat && c.fontFallbackCompat).toBe(true);
    expect(Object.isFrozen(c)).toBe(true);
    expect(() => testing.setTestConfig({ nope: true } as never)).toThrow(/Unknown test config key/);
    expect(() => testing.setTestConfig({ linePitch: 0 })).toThrow(RangeError);
  });

  it('only lekhjs/testing exports setTestConfig; the product entries do not', () => {
    expect('setTestConfig' in testing).toBe(true);
    for (const entry of [main, headless, text]) {
      expect('setTestConfig' in entry).toBe(false);
      expect('RecordedWidthMeasurer' in entry).toBe(false);
    }
  });

  it('no source under src/ outside testing/ calls setTestConfig or turns a switch on', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'testing') walk(p);
        } else if (p.endsWith('.ts')) {
          const src = readFileSync(p, 'utf8');
          if (/setTestConfig\(|lineSpacingCompat:\s*true|fontFallbackCompat:\s*true/.test(src)) offenders.push(p);
        }
      }
    };
    walk(path.join(PKG_ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});
