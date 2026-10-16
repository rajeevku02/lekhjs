// AC-ENG-17: every string of the C++ wire vocabulary appears verbatim in sync/consts.ts, under the
// C++ name, in its namespace. The header is read in place from the sibling C++ worktree (located
// through parity/fixture-sets.json, AC-ARC-12). The strings edit/ repeats (edit/ and sync/ may not
// import each other) are pinned to the same values.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditKeys, EditUpdateType } from '../../src/edit';
import { consts, msgtypes, updatetypes } from '../../src/sync';
import { CORE_FIXTURES } from '../io/helpers';

const HEADER = path.resolve(CORE_FIXTURES, '..', '..', 'src', 'lekh', 'update', 'Consts.h');

function namespaceStrings(text: string, ns: string): Map<string, string> {
  const start = text.indexOf(`namespace ${ns} {`);
  const body = text.slice(start, text.indexOf('}', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/const std::string (\w+) = "([^"]*)";/g)) out.set(m[1] as string, m[2] as string);
  return out;
}

describe('sync/consts.ts is a literal port of Consts.h (AC-ENG-17)', () => {
  const available = existsSync(HEADER);
  const text = available ? readFileSync(HEADER, 'utf8') : '';

  it.runIf(available).each([
    ['consts', consts as Record<string, string>],
    ['updatetypes', updatetypes as Record<string, string>],
    ['msgtypes', msgtypes as Record<string, string>],
  ])('namespace %s: same names, same strings, nothing extra', (ns, table) => {
    const cpp = namespaceStrings(text, ns);
    expect(cpp.size).toBeGreaterThan(2);
    expect(Object.fromEntries(Object.entries(table))).toEqual(Object.fromEntries(cpp));
  });

  it('edit/ writes the same update types and keys', () => {
    for (const [k, v] of Object.entries(EditUpdateType)) expect((updatetypes as Record<string, string>)[k]).toBe(v);
    for (const [k, v] of Object.entries(EditKeys)) expect((consts as Record<string, string>)[k]).toBe(v);
  });
});
