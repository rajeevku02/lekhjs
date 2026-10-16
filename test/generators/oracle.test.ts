// AC-GEN-06 (tier T4): every ported wireframe module matches its original Lua script, run in the
// `fengari` Lua VM with the same host functions, over the case grid of `oracle/cases.ts`, except
// for the cases tagged with a difference-register id (spec 04 §13). The text measure is a
// deterministic stub (7 per character of the longest line, 14 per line).
import { describe, expect, it } from 'vitest';
import { WIREFRAME_MODULES, WIREFRAME_TEMPLATES, luaToNumber, outputToTemplateJson } from '../../src/generators';
import type { JsonObject, WireframeKey } from '../../src/template';
import { casesFor, wireframeTemplates, type OracleCase } from './oracle/cases';
import { compareOutputs, type Comparable } from './oracle/compare';
import { LuaGenerator, luaPack } from './oracle/lua-oracle';
import { STUB_HOST, stubMeasure } from './oracle/stub-host';

/**
 * A case whose difference is a signed (or proposed) register entry. Without `patch` the case is
 * skipped; with it, the Lua output is rewritten to the fixed behaviour and then compared strictly,
 * so the rest of the output is still checked.
 */
interface ExpectedDifference {
  readonly dr: string;
  readonly when: (c: OracleCase) => boolean;
  readonly patch?: (lua: Comparable, c: OracleCase) => Comparable;
}

/**
 * Whether `calendar.lua` / `android_datepicker.lua` read the text as a date the way the TS port
 * does. They do not (DR-GEN-05) when the text has fewer than 3 `/` parts (`ys` is nil: an error),
 * a part is not a Lua numeral (`m < 1` / `d < 1` on nil raise; a nil year prints as "nil"), or the
 * month is fractional inside 1..12 (a nil month name: an error).
 */
function luaReadsDate(text: string): boolean {
  const parts = STUB_HOST.split(text, { by: '/' }).map((p) => luaToNumber(p.word));
  if (parts.length < 3) return false;
  const [y, m, d] = parts;
  if (y == null || m == null || d == null) return false;
  return !(m.value >= 1 && m.value <= 12 && !Number.isInteger(m.value));
}

/** The weekday (0 = Sunday) of the day the date text selects, by `Date` in UTC (an independent check). */
function selectedWeekday(text: string): number {
  const [y, m, d] = STUB_HOST.split(text, { by: '/' }).map((p) => luaToNumber(p.word)?.value ?? Number.NaN);
  const year = Math.trunc(y ?? Number.NaN);
  let month = m ?? Number.NaN;
  if (month < 1 || month > 12) month = 1;
  month = Math.trunc(month);
  const at = (day: number) => {
    const t = new Date(0);
    t.setUTCFullYear(year, month - 1, day);
    return t;
  };
  // Day 32 rolls over into the next month by (32 - days in month).
  const inMonth = 32 - at(32).getUTCDate();
  let day = d ?? Number.NaN;
  if (day < 1 || day > inMonth) day = 2;
  return at(Math.trunc(day)).getUTCDay();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MALFORMED_DATE: ExpectedDifference = { dr: 'DR-GEN-05', when: (c) => !luaReadsDate(c.text) };

/** By module key; the ports (G2-G4) add their DR-GEN-04..9 cases here. */
const EXPECTED_DIFFERENCES: Partial<Record<WireframeKey, readonly ExpectedDifference[]>> = {
  'wireframe/calendar': [MALFORMED_DATE],
  'wireframe/android_datepicker': [
    MALFORMED_DATE,
    {
      // 'Web' → 'Wed', and the header names the selected day's weekday, not the 1st's.
      dr: 'DR-GEN-07, DR-GEN-08',
      when: () => true,
      patch: (lua, c) => {
        const texts = (lua.template['texts'] as JsonObject[]).slice();
        const head = texts[1];
        if (head === undefined || typeof head['text'] !== 'string') throw new Error('no header text');
        const fixed = `${WEEKDAYS[selectedWeekday(c.text)] ?? ''}${head['text'].slice(3)}`;
        texts[1] = { ...head, text: fixed };
        return { ...lua, template: { ...lua.template, texts } };
      },
    },
  ],
};

function runTs(key: WireframeKey, c: OracleCase): Comparable | { error: string } {
  const m = WIREFRAME_MODULES.find((x) => x.key === key);
  if (m === undefined) throw new Error(`no module ${key}`);
  try {
    const out = m.generate({ params: c.params, text: c.text }, STUB_HOST);
    return {
      template: outputToTemplateJson(out),
      minW: out.minW,
      minH: out.minH,
      ...(out.disabled !== undefined ? { disabled: out.disabled } : {}),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const pack = luaPack();
const bodies = wireframeTemplates();

describe('the Lua oracle (AC-GEN-06)', () => {
  for (const m of WIREFRAME_MODULES) {
    for (const row of WIREFRAME_TEMPLATES.filter((r) => r.key === m.key)) {
      it(`${m.key} matches ${row.scriptfile} for ${row.id}`, () => {
        const body = bodies.get(row.id);
        const script = pack[row.scriptfile];
        if (body === undefined || script === undefined) throw new Error(`missing ${row.id} or its script`);
        const cases = casesFor(row.id, body);
        expect(cases.length).toBeGreaterThan(10);
        const expected = EXPECTED_DIFFERENCES[m.key] ?? [];
        const failures: string[] = [];
        let tagged = 0;
        for (const c of cases) {
          const lua = new LuaGenerator(script, STUB_HOST).generate(c.params, c.text);
          const ts = runTs(m.key, c);
          let diffs: string[];
          if (!lua.ok || 'error' in ts) {
            // Both fail (the shape keeps its previous output), or one does.
            diffs =
              !lua.ok && 'error' in ts
                ? []
                : [`lua ${lua.ok ? 'ok' : lua.error} vs ts ${'error' in ts ? ts.error : 'ok'}`];
          } else {
            diffs = compareOutputs(lua, ts, c.params, stubMeasure);
          }
          const tag = expected.find((d) => d.when(c));
          if (tag?.patch !== undefined && lua.ok && !('error' in ts)) {
            diffs = compareOutputs(tag.patch(lua, c), ts, c.params, stubMeasure);
          } else if (tag !== undefined) {
            tagged++;
            continue;
          }
          if (diffs.length > 0) failures.push(`${c.label}: ${diffs.slice(0, 3).join('; ')}`);
        }
        expect(failures.slice(0, 10)).toEqual([]);
        expect(tagged).toBeLessThan(cases.length);
      });
    }
  }
});

describe('the oracle harness itself', () => {
  const row = WIREFRAME_TEMPLATES.find((r) => r.id === 'avabodh.wireframe.button');
  const script = row === undefined ? undefined : pack[row.scriptfile];
  const body = bodies.get('avabodh.wireframe.button');
  if (row === undefined || script === undefined || body === undefined) throw new Error('button fixture missing');
  const cases = casesFor(row.id, body);

  it('runs the Lua script for real: most cases produce output, with the stub sizes', () => {
    const results = cases.map((c) => new LuaGenerator(script, STUB_HOST).generate(c.params, c.text));
    const ok = results.filter((r) => r.ok);
    expect(ok.length).toBeGreaterThan(cases.length / 2);
    const first = new LuaGenerator(script, STUB_HOST).generate({ state: 'normal', menu: false, icon: null }, 'Button');
    expect(first).toMatchObject({ ok: true, minW: 7 * 6 + 16, minH: 14 + 4, disabled: false });
  });

  it('detects a port that differs in data, draw, texts or size', () => {
    const c = cases[0];
    if (c === undefined) throw new Error('no case');
    const lua = new LuaGenerator(script, STUB_HOST).generate(c.params, c.text);
    const ts = runTs('wireframe/button', c);
    if (!lua.ok || 'error' in ts) throw new Error('button failed');
    expect(compareOutputs(lua, ts, c.params, stubMeasure)).toEqual([]);
    const data = [...(ts.template['data'] as string[])];
    data[2] = '-w/2+1';
    const variants: Comparable[] = [
      { ...ts, template: { ...ts.template, data } },
      { ...ts, template: { ...ts.template, draw: [{ path: 'M 0 1 L 2 3 Z' }] } },
      { ...ts, template: { ...ts.template, texts: [{ location: 'default', text: 'other' }] } },
      { ...ts, minW: ts.minW + 1 },
      { ...ts, disabled: true },
    ];
    for (const v of variants) expect(compareOutputs(lua, v, c.params, stubMeasure).length).toBeGreaterThan(0);
  });
});
