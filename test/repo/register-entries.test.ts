// The difference register (spec 11 §7): every entry names itself, carries a status, and points at
// a fixture that exists (or at none yet, when the module that fixes it is still to be ported).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DIR = path.join(ROOT, 'parity', 'register');
const FILES = readdirSync(DIR).filter((f) => /^DR-[A-Z]+-\d\d\.yaml$/.test(f));

function field(text: string, key: string): string | undefined {
  return new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1]?.trim();
}

describe('difference register entries', () => {
  it('has entries', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES)('%s: id, area, status and fixture', (f) => {
    const text = readFileSync(path.join(DIR, f), 'utf8');
    const id = f.replace(/\.yaml$/, '');
    expect(field(text, 'id')).toBe(id);
    expect(field(text, 'area')).toBe(id.split('-')[1]);
    expect(['proposed', 'accepted', 'rejected']).toContain(field(text, 'status'));
    const fixture = field(text, 'fixture');
    expect(fixture).toBeDefined();
    if (fixture !== 'null') expect(existsSync(path.join(ROOT, fixture as string))).toBe(true);
  });
});
