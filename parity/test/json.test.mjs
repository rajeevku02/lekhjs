// Self-tests of the comparison tools (node:test; `npm test` in parity/). Synthetic inputs only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { canonicalise, isArrayForm } from '../json/canon.mjs';
import { diff, generalise } from '../json/diff.mjs';
import { LNum, LenientParseError, lenientParse } from '../json/lenient-parse.mjs';
import { attributeGaps, loadGaps } from '../json/gaps.mjs';
import { luaDate } from '../json/normalisers/wireframe-date.mjs';
import * as dateMalformed from '../json/normalisers/date-malformed.mjs';
import * as datepickerWed from '../json/normalisers/datepicker-wed.mjs';
import * as datepickerWeekday from '../json/normalisers/datepicker-weekday.mjs';
import * as fontModifierSize from '../json/normalisers/font-modifier-size.mjs';
import * as legacyConvert from '../json/normalisers/legacy-convert.mjs';
import * as luaDataNumber from '../json/normalisers/lua-data-number.mjs';
import * as placeholderVerbatim from '../json/normalisers/placeholder-verbatim.mjs';
import { applyRules, compileRules, cppFailEntry, matchPrefix } from '../json/rules.mjs';
import { scanText, wordsOutsideVocabulary } from '../register/scan.mjs';

const require = createRequire(import.meta.url);
const tol = require('../json/tolerance.cjs');

describe('lenient-parse', () => {
  it('keeps the int/float token kind, reads nan/inf and raw control characters', () => {
    const { value } = lenientParse('{"a":2,"b":2.0,"c":nan,"d":-inf,"e":"x\ty","f":"\\u00e9"}');
    const v = /** @type {any} */ (value);
    assert.ok(v.a instanceof LNum && v.a.isInt && v.a.value === 2);
    assert.ok(v.b instanceof LNum && !v.b.isInt);
    assert.ok(Number.isNaN(v.c.value));
    assert.equal(v.d.value, -Infinity);
    assert.equal(v.e, 'x\ty');
    assert.equal(v.f, 'é');
  });
  it('counts duplicate keys (last wins) and names an unescaped quote in a key', () => {
    const r = lenientParse('{"k":1,"k":2}');
    assert.equal(r.duplicateKeys, 1);
    assert.equal(/** @type {any} */ (r.value).k.value, 2);
    assert.throws(
      () => lenientParse('{"a"b":1}'),
      (e) => e instanceof LenientParseError && e.code === 'json_unescaped_key',
    );
  });
});

describe('tolerance', () => {
  it('is max(1e-6, 5e-6 · max(|a|, |b|))', () => {
    assert.ok(tol.withinTolerance(47.3, 47.29999923706055));
    assert.ok(tol.withinTolerance(0, 9e-7));
    assert.ok(!tol.withinTolerance(23, 25.7));
    assert.ok(tol.withinTolerance(NaN, NaN));
    assert.equal(tol.colour(4278190080), -16777216);
  });
});

const board = (/** @type {object} */ extra) =>
  JSON.stringify({
    info: { version: '4.2', title: 'Sample' },
    style: { strokepaint: { color: -16777216, type: 2 } },
    pages: { P1: { objects: { O1: { order: 1, type: 3, params: { cx: 10, cy: 20 }, ...extra } } } },
  });

describe('canonicalise + diff', () => {
  it('strips generator scripts, normalises info.version and checks the stamp', () => {
    const id = 'avabodh.wireframe.button';
    const gen = { template: { id, generator: { script: 'return 1', scriptfile: 'x.lua', text: 'Button' } } };
    const js = { template: { id, generator: { script: '/*lekh-js:1:wireframe/button*/x', text: 'Button' } } };
    const c = canonicalise({
      inputText: board(gen),
      cppText: board(gen),
      tsText: board(js).replace('"4.2"', '"5.0"'),
      stamp: 'backend',
    });
    assert.equal(c.stamp.ok, true);
    assert.equal(c.stamp.expected, '5.0');
    assert.equal(c.generatorParts.ok, 2);
    const d = diff(c.cpp, c.ts);
    assert.deepEqual(d.diffs, []);
  });
  it('app pass: TS must stamp 5.0', () => {
    const c = canonicalise({ inputText: board({}), cppText: board({}), tsText: board({}), stamp: 'app' });
    assert.equal(c.stamp.ok, false);
  });
  it('integer members exact and integer tokens; other numbers within tolerance', () => {
    const c = canonicalise({
      inputText: board({}),
      cppText: board({ params: { cx: 10, cy: 20.0000001 } }),
      tsText: board({ order: 1.0, params: { cx: 10, cy: 20 } }).replace('"order":1', '"order":1.0'),
      stamp: 'backend',
    });
    const d = diff(c.cpp, c.ts);
    assert.deepEqual(
      d.diffs.map((x) => `${x.kind} ${x.gpath}`),
      ['int_token /pages/*/objects/*/order'],
    );
    assert.ok(d.tolerance.has('/pages/*/objects/*/params/cy'));
  });
  it('renames minted ids of array-form inputs by position', () => {
    const input = JSON.stringify({ info: { version: '4' }, objects: [{ type: 3 }] });
    const out = (/** @type {string} */ id) =>
      JSON.stringify({
        info: { version: '4.2' },
        pages: { [`p${id}`]: { objects: { [`o${id}`]: { type: 3, ref: `o${id}` } } } },
      });
    assert.ok(isArrayForm(JSON.parse(input)));
    const c = canonicalise({ inputText: input, cppText: out('cpp'), tsText: out('ts'), stamp: 'backend' });
    assert.equal(c.renamedIds, 4);
    assert.deepEqual(diff(c.cpp, c.ts).diffs, []);
  });
  it('Lua under an unknown id is a placeholder: no 5.0 expected, no generated-parts check', () => {
    const gen = {
      template: { id: 'test.sample', generator: { script: '', scriptfile: 'wireframe/button_min.lua' }, texts: [] },
    };
    const c = canonicalise({ inputText: board(gen), cppText: board(gen), tsText: board(gen), stamp: 'backend' });
    assert.equal(c.stamp.expected, '4.2');
    assert.equal(c.stamp.ok, true);
    assert.equal(c.generatorParts.bad, 0);
  });
  it('renames minted group members by position, at any depth', () => {
    const input = JSON.stringify({ info: { version: '4' }, objects: [{ type: 'avabodh.basic.group', objects: [{}] }] });
    const out = (/** @type {string} */ id) =>
      JSON.stringify({
        info: { version: '4.2' },
        pages: {
          P: {
            objects: {
              [`g${id}`]: {
                type: 'avabodh.basic.group',
                objects: { [`m${id}`]: { index: 0, object: { objects: { [`x${id}`]: { index: 0 } } } } },
              },
            },
          },
        },
      });
    const c = canonicalise({ inputText: input, cppText: out('cpp'), tsText: out('ts'), stamp: 'backend' });
    assert.deepEqual(diff(c.cpp, c.ts).diffs, []);
    assert.ok(JSON.stringify(c.ts).includes('#1/1/1/1'));
  });
  it('generalises map keys, ids and indices', () => {
    assert.equal(
      generalise(['pages', 'P1', 'objects', 'O1', 'texts', '[3]', 'text']),
      '/pages/*/objects/*/texts/*/text',
    );
  });
});

describe('register rules', () => {
  const entry = (/** @type {any} */ rule, id = 'R1') => ({
    file: `${id}.yaml`,
    data: { id, rule },
    parseErrors: [],
  });
  it('matches path globs as prefixes; first match wins', () => {
    assert.equal(matchPrefix(['pages', '*', 'objects', '*'], ['pages', 'a', 'objects', 'b', 'params', 'cx']), 4);
    assert.equal(matchPrefix(['**', 'cx'], ['pages', 'a', 'objects', 'b', 'params', 'cx']), 6);
    assert.equal(matchPrefix(['templates'], ['pages']), -1);
  });
  it('ignore / tolerance / when', () => {
    const reg = compileRules([
      entry(
        { json: ['descriptive only', { path: '/pages/*/objects/*', when: { cpp_type_in: [4] }, op: 'ignore' }] },
        'R2',
      ),
      entry({ json: [{ path: '/pages/*/objects/*/params', op: 'tolerance', abs: 5 }] }),
    ]);
    assert.deepEqual(reg.errors, []);
    const cppT = lenientParse(board({ params: { cx: 10, cy: 20 } })).value;
    const tsT = lenientParse(board({ params: { cx: 13, cy: 20 } })).value;
    const d = diff(cppT, tsT);
    const r = applyRules(reg, d.diffs, cppT, tsT);
    assert.equal(r.unexplained.length, 0);
    assert.deepEqual(Object.fromEntries(r.applied), { R1: 1 });
  });
  it('ties a \\u cpp_fail to DR-ENG-01', () => {
    assert.equal(cppFailEntry(compileRules([]), '{"t":"\\u00e9"}', new Set(['DR-ENG-01'])), 'DR-ENG-01');
    assert.equal(cppFailEntry(compileRules([]), '{"t":"x"}', new Set(['DR-ENG-01'])), null);
  });
  it('a normaliser that does not apply (null) passes the path to the next rule', () => {
    const reg = compileRules([
      entry({ json: [{ path: '/pages/*/objects/*', op: 'normalise', normaliser: 'font-modifier-size' }] }, 'R1'),
      entry({ json: [{ path: '/pages/*/objects/*/params', op: 'tolerance', abs: 5 }] }, 'R2'),
    ]);
    const cppT = lenientParse(board({ params: { cx: 10, cy: 20 } })).value;
    const tsT = lenientParse(board({ params: { cx: 13, cy: 20 } })).value;
    const r = applyRules(reg, diff(cppT, tsT).diffs, cppT, tsT);
    assert.equal(r.unexplained.length, 0);
    assert.deepEqual(Object.fromEntries(r.applied), { R2: 1 });
  });
  it('rejects an unknown normaliser', () => {
    const reg = compileRules([entry({ json: [{ path: '/x', op: 'normalise', normaliser: 'nope' }] })]);
    assert.equal(reg.errors.length, 1);
  });
});

describe('customer-content scanner', () => {
  it('finds uuids, short ids, e-mail addresses and docids, not ordinary words', () => {
    const kinds = scanText(
      'a 0aa1b2c3-1111-4222-8333-123456789abc b 111111114Ay6byqtQtQyDR c x@y.org docid=abc textalignhorizontalxy',
    ).map((h) => h.kind);
    assert.deepEqual(kinds.sort(), ['docid', 'email', 'short_id', 'uuid']);
  });
  it('lists fixture words outside the vocabulary', () => {
    const v = new Set(['sample', 'text']);
    assert.deepEqual(
      wordsOutsideVocabulary({ pages: { p: { name: 'Sample', texts: [{ text: 'Sample Secret' }] } } }, v),
      ['secret'],
    );
  });
});

describe('normalisers', () => {
  const L = (/** @type {unknown} */ v) => lenientParse(JSON.stringify(v)).value;
  it('lua-data-number: numbers, and the number literals of same-shaped expressions, within tolerance', () => {
    const eq = luaDataNumber.equal;
    assert.equal(eq('23.0', '23'), true);
    assert.equal(eq('1e-05', '0.00001'), true);
    assert.equal(eq('-28.680000305176+14.340000152588', '-28.68000030517578+14.34000015258789'), true);
    assert.equal(eq('-80.5+69.0', '-80.5+ 69'), true);
    assert.equal(eq('-0.0+12.0', '0+12'), true);
    assert.equal(eq('-w/2 + 2.5', '-w/2 + 2.5000001'), true);
    assert.equal(eq('d(14)+6.0', 'd(14)+6'), true);
    assert.equal(eq('-80.5+69.0', '-80.5+70'), false);
    assert.equal(eq('d(14)+6', 'd(15)+6'), false);
    assert.equal(eq('w-3', 'h-3'), false);
    assert.equal(eq('w-3', 'w+-3'), false);
    assert.equal(eq('w', 'h'), null);
    assert.ok(luaDataNumber.deviation('-28.680000305176+1', '-28.68000030517578+1') > 0);
  });
  it('legacy-convert: the TS object is the conversion of the C++ legacy one', () => {
    const cpp = L({
      type: 'avabodh.basic.ellipse',
      order: 2,
      center: { x: 10, y: 20 },
      width: 40,
      height: 30,
      rotation: 0.5,
      text: 'Box',
      style: { strokewidth: 2 },
    });
    const ts = L({
      type: 'templated',
      order: 2,
      params: { cx: 10, cy: 20, width: 40, height: 30, angle: 0.5 },
      template: { id: 'avabodh.basic.ellipse', style: { strokewidth: 2 }, texts: [{ text: 'Box' }] },
    });
    assert.equal(legacyConvert.equal(cpp, ts, undefined), true);
    const moved = L({ ...JSON.parse(JSON.stringify(ts, (_k, x) => (x instanceof LNum ? x.value : x))), order: 3 });
    assert.equal(legacyConvert.equal(cpp, moved, undefined), false);
    assert.equal(legacyConvert.equal(L({ type: 'templated' }), ts, undefined), null);
  });
  it('legacy-convert: an image keeps the stored bytes', () => {
    const cpp = L({
      type: 'avabodh.basic.image',
      order: 1,
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      format: 'png',
      data: 'Q1BQ',
    });
    const ts = (/** @type {string} */ data) =>
      L({
        type: 'templated',
        order: 1,
        params: { cx: 0, cy: 0, width: 4, height: 4, angle: 0 },
        template: { id: 'avabodh.basic.image', images: [{ format: 'png', data }] },
      });
    assert.equal(legacyConvert.equal(cpp, ts('SU5Q'), L({ data: 'SU5Q' })), true);
    assert.equal(legacyConvert.equal(cpp, ts('Q1BQ'), L({ data: 'SU5Q' })), false);
  });
  it('font-modifier-size: only the size may differ, and only with a face-changing modifier', () => {
    const o = (/** @type {number} */ w, /** @type {string | undefined} */ m) =>
      L({
        type: 'templated',
        params: { cx: 0, width: w },
        template: { id: 'avabodh.basic.text', style: m === undefined ? {} : { fontmodifier: m } },
      });
    assert.equal(fontModifierSize.equal(o(10, 'Black'), o(12, 'Black')), true);
    assert.equal(fontModifierSize.equal(o(10, undefined), o(12, undefined)), null);
    assert.equal(fontModifierSize.equal(o(10, 'Regular'), o(12, 'Regular')), null);
    assert.equal(fontModifierSize.equal(o(10, 'Fancy'), o(12, 'Fancy')), null);
  });
  it('placeholder-verbatim: TS writes the stored template back', () => {
    const stored = {
      id: 'test.sample',
      generator: { script: '', scriptfile: 'wireframe/button_min.lua', text: 'Button' },
      texts: [{ text: 'Sample' }],
    };
    const gen = { text: stored.generator.text };
    const ts = L({ ...stored, generator: gen });
    const cpp = L({ id: 'test.sample', generator: { text: 'Button' }, data: ['w'] });
    assert.equal(placeholderVerbatim.equal(cpp, ts, L(stored)), true);
    assert.equal(placeholderVerbatim.equal(cpp, L({ ...stored, generator: gen, texts: [] }), L(stored)), false);
    assert.equal(
      placeholderVerbatim.equal(cpp, L({ id: 'avabodh.wireframe.button', generator: gen }), L(stored)),
      null,
    );
  });
});

describe('the date fixes (DR-GEN-05, -07, -08)', () => {
  const DP = 'avabodh.wireframe.androiddatepicker';
  const L = (/** @type {unknown} */ v) => lenientParse(JSON.stringify(v)).value;
  /** A datepicker template whose header box is `w` wide (data entries 13 and 15). @param {number} w */
  const picker = (w, extra = {}) => {
    const data = Array.from({ length: 20 }, (_, i) => String(i));
    data[13] = `-w/2+${String(14 + w / 2)}`;
    data[15] = String(w);
    return L({ id: DP, data, ...extra });
  };
  const input = (/** @type {string} */ text) => L({ id: DP, generator: { text } });

  it('reads the date as the scripts did', () => {
    assert.deepEqual(luaDate('2018/12/25'), { y: 2018, m: 12, d: 25, weekdayOfFirst: 6, weekdayOfSelected: 2 });
    assert.equal(luaDate('2025/10/1')?.weekdayOfFirst, 3);
    assert.equal(luaDate('2024/13/45')?.m, 1);
    assert.equal(luaDate('2024/2/30')?.d, 2);
    for (const bad of ['', 'A', '2022/3', 'alpha/3/4', '2022/x/4', '2022/3/y', '2023/7.5/9']) {
      assert.equal(luaDate(bad), null, bad);
    }
  });

  it('date-malformed: only for a text the scripts could not read, and only when TS drew the shape', () => {
    const cal = (/** @type {string[]} */ data) => L({ id: 'avabodh.wireframe.calendar', data });
    const inCal = (/** @type {string} */ text) => L({ id: 'avabodh.wireframe.calendar', generator: { text } });
    assert.equal(dateMalformed.equal(cal([]), cal(['w', 'h']), inCal('A')), true);
    assert.equal(dateMalformed.equal(cal([]), cal([]), inCal('A')), false);
    assert.equal(dateMalformed.equal(cal([]), cal(['w']), inCal('2022/3/4')), null);
    assert.equal(
      dateMalformed.equal(cal([]), L({ id: 'avabodh.wireframe.calendar', data: ['w'], flags: 1 }), inCal('A')),
      false,
    );
    assert.equal(dateMalformed.equal(L({ id: 'x.y', data: [] }), L({ id: 'x.y', data: ['w'] }), inCal('A')), null);
  });

  it('datepicker-wed and datepicker-weekday: the header box only, each for its own case', () => {
    // 2025/10/1: a Wednesday 1st, selected: "Web" → "Wed" (DR-GEN-07)
    assert.equal(datepickerWed.equal(picker(199.8), picker(200.6), input('2025/10/1')), true);
    assert.equal(datepickerWeekday.equal(picker(199.8), picker(200.6), input('2025/10/1')), null);
    // 2018/12/25: the 1st is a Saturday, the 25th a Tuesday (DR-GEN-08)
    assert.equal(datepickerWeekday.equal(picker(186.5), picker(194.3), input('2018/12/25')), true);
    assert.equal(datepickerWed.equal(picker(186.5), picker(194.3), input('2018/12/25')), null);
    // neither applies when the header was already right
    assert.equal(datepickerWed.equal(picker(1), picker(2), input('2018/12/1')), null);
    assert.equal(datepickerWeekday.equal(picker(1), picker(2), input('2018/12/1')), null);
    // x must move by half the width change; nothing else may differ
    const moved = picker(194.3);
    /** @type {any} */ (moved).data[13] = '-w/2+200';
    assert.equal(datepickerWeekday.equal(picker(186.5), moved, input('2018/12/25')), false);
    const other = picker(194.3);
    /** @type {any} */ (other).data[3] = '-h/2';
    assert.equal(datepickerWeekday.equal(picker(186.5), other, input('2018/12/25')), false);
    assert.equal(datepickerWeekday.equal(picker(186.5), picker(194.3, { flags: 2 }), input('2018/12/25')), false);
  });
});

describe('owned gaps', () => {
  it('attributes diffs under a gap template id, a native shape or a root template key', () => {
    // A synthetic gaps file, so the test outlives the tasks that close the real entries.
    const dir = mkdtempSync(path.join(tmpdir(), 'gaps-'));
    const file = path.join(dir, 'gaps.json');
    writeFileSync(
      file,
      JSON.stringify({
        gaps: [
          { owner: 'G3', reason: 'r', template_ids: ['avabodh.wireframe.iospagecontrol'] },
          { owner: 'G5', reason: 'r', native_shapes: ['bpmn.*'], root_templates: ['avabodh_bpmn_syms_*'] },
        ],
      }),
    );
    const gaps = loadGaps(file);
    rmSync(dir, { recursive: true });
    const cppT = lenientParse(
      JSON.stringify({
        pages: {
          P: {
            objects: {
              A: { template: { id: 'avabodh.wireframe.iospagecontrol' } },
              B: { template: { id: 'x', generator: { type: 'native', shape: 'bpmn.activity' } } },
              C: { template: { id: 'y' } },
            },
          },
        },
        templates: { avabodh_bpmn_syms_loop: {} },
      }),
    ).value;
    const d = (/** @type {string[]} */ p) => ({ path: p, gpath: '', kind: /** @type {const} */ ('value') });
    const r = attributeGaps(
      gaps,
      [
        d(['pages', 'P', 'objects', 'A', 'params', 'width']),
        d(['pages', 'P', 'objects', 'B', 'template', 'data']),
        d(['templates', 'avabodh_bpmn_syms_loop']),
        d(['pages', 'P', 'objects', 'C', 'params']),
      ],
      cppT,
      cppT,
    );
    assert.equal(r.unexplained.length, 1);
    assert.deepEqual(Object.fromEntries(r.gaps), { G3: 1, G5: 2 });
  });
});

describe('customer report', () => {
  it('counts C++ outputs with raw control characters, and scrub-check passes gap owners', async () => {
    const { RAW_CTRL } = await import('../json/compare.mjs');
    const { report } = await import('../json/report.mjs');
    assert.equal(RAW_CTRL.test('{"a":"x\u0001y"}'), true);
    assert.equal(RAW_CTRL.test('{"a":"x\n\r\t\b\fy"}'), false);
    const dir = mkdtempSync(path.join(tmpdir(), 'report-'));
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ pipeline: 'p1', stamp: 'app', customer: true }));
    const recs = [
      { idx: 'b000001', status: 'equal', cpp_raw_ctrl: true },
      { idx: 'b000002', status: 'gap', gap: { G3: 2 } },
      { idx: 'b000003', status: 'equal' },
    ];
    writeFileSync(path.join(dir, 'results.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const r = report(dir);
    rmSync(dir, { recursive: true });
    assert.equal(r.summary['cpp_raw_ctrl'], 1);
    assert.deepEqual(r.summary['gap_owners'], { G3: 1 });
  });
});

describe('D2 normalisers', () => {
  const L = (/** @type {unknown} */ v) => lenientParse(JSON.stringify(v)).value;
  it('empty-text-line: an empty floating text box, one line taller in TS, params/height only', async () => {
    const m = await import('../json/normalisers/empty-text-line.mjs');
    const box = (/** @type {string} */ text, /** @type {number} */ h) =>
      L({
        params: { width: 8, height: h },
        template: { id: 'avabodh.basic.text', texts: [{ location: 'default', text }] },
      });
    assert.equal(m.equal(box('', 8), box('', 23), undefined, ['params', 'height']), true);
    assert.equal(m.equal(box('', 8), box('', 8), undefined, ['params', 'width']), null);
    assert.equal(m.equal(box('x', 8), box('x', 23), undefined, ['params', 'height']), null);
    assert.equal(m.equal(box('', 30), box('', 23), undefined, ['params', 'height']), false);
  });
  it('phantom-page: only a page the input stored with objects alone, name and order only', async () => {
    const m = await import('../json/normalisers/phantom-page.mjs');
    const c = L({ name: '', order: 0, objects: {} });
    const t = L({ name: 'Recovered 2', order: 3, objects: {} });
    const phantom = L({ objects: {} });
    assert.equal(m.equal(c, t, phantom, ['name']), true);
    assert.equal(m.equal(c, t, phantom, ['order']), true);
    assert.equal(m.equal(c, t, phantom, ['objects', 'x']), null);
    assert.equal(m.equal(c, t, L({ name: '', objects: {} }), ['name']), null);
    assert.equal(m.equal(c, L({ name: 'Page', order: 1, objects: {} }), phantom, ['name']), false);
  });
  it('geometry-precision: within 2e-5 of the coordinate magnitudes along the group chain', async () => {
    const m = await import('../json/normalisers/geometry-precision.mjs');
    const g = (/** @type {number} */ w) =>
      L({
        params: { cx: 12000, cy: -9000 },
        objects: { m: { object: { params: { cx: 0.5, cy: -0.7, width: w, height: 20 } } } },
      });
    const rest = ['objects', 'm', 'object', 'params', 'width'];
    assert.equal(m.equal(g(40.4318), g(40.4321), undefined, rest), true);
    assert.equal(m.equal(g(40.4), g(41.4), undefined, rest), null);
    assert.equal(m.equal(g(40.4318), g(40.4321), undefined, ['objects', 'm', 'object', 'template', 'id']), null);
    const top = (/** @type {number} */ cy) => L({ params: { cx: 300, cy, width: 100, height: 50 } });
    assert.equal(m.equal(top(0), top(-1.43e-5), undefined, ['params', 'cy']), true);
    const rot = (/** @type {number} */ angle) => L({ params: { cx: 1, cy: 1, width: 10, height: 10, angle } });
    assert.equal(m.equal(rot(-0.785405), rot(5.497787143782138), undefined, ['params', 'angle']), true);
    assert.equal(m.equal(rot(-0.785405), rot(0.785405), undefined, ['params', 'angle']), null);
    const far = (/** @type {number} */ angle) =>
      L({
        params: { cx: 233, cy: 12717 },
        objects: { m: { object: { params: { cx: 556, cy: 10370, width: 2, height: 2, angle } } } },
      });
    const restA = ['objects', 'm', 'object', 'params', 'angle'];
    assert.equal(m.equal(far(-0.523537), far(-0.523374), undefined, restA), true);
    assert.equal(m.equal(far(-0.5235), far(-0.6), undefined, restA), null);
  });
  it('a normaliser sees the differing path below the matched one', () => {
    const reg = compileRules([
      {
        file: 'x',
        data: { id: 'DR-FMT-01', rule: { json: [{ path: '/pages/*', op: 'normalise', normaliser: 'phantom-page' }] } },
        parseErrors: [],
      },
    ]);
    const cpp = L({ pages: { P: { name: '', order: 0, objects: {} } } });
    const ts = L({ pages: { P: { name: 'Recovered', order: 1, objects: {} } } });
    const input = L({ pages: { P: { objects: {} } } });
    const d = (/** @type {string} */ k) => ({
      path: ['pages', 'P', k],
      gpath: `/pages/*/${k}`,
      kind: /** @type {const} */ ('value'),
    });
    const r = applyRules(reg, [d('name'), d('order')], cpp, ts, input);
    assert.equal(r.unexplained.length, 0);
    assert.deepEqual(Object.fromEntries(r.applied), { 'DR-FMT-01': 2 });
  });
});

describe('D2 data normalisers', () => {
  const L = (/** @type {unknown} */ v) => lenientParse(JSON.stringify(v)).value;
  it('six-digit-data: one unit in the sixth significant digit, same tokens', async () => {
    const m = await import('../json/normalisers/six-digit-data.mjs');
    const t = (/** @type {string} */ s) => L({ data: ['0', s] });
    const rest = ['data', '[1]'];
    assert.equal(m.equal(t('d(18)+(h/2-d(18))*0.144286'), t('d(18)+(h/2-d(18))*0.144285'), undefined, rest), true);
    assert.equal(m.equal(t('d(18)+(h/2-d(18))*0.144286'), t('d(18)+(h/2-d(18))*0.144283'), undefined, rest), null);
    assert.equal(m.equal(t('d(18)*0.144286'), t('d(19)*0.144286'), undefined, rest), null);
  });
  it('empty-line-generator-data: only for a generator text with a blank line, same tokens', async () => {
    const m = await import('../json/normalisers/empty-line-generator-data.mjs');
    const t = (/** @type {string} */ text, /** @type {string} */ s) => L({ generator: { text }, data: [s] });
    const rest = ['data', '[0]'];
    assert.equal(m.equal(t('a\n\nb', '-h/2+24.0'), t('a\n\nb', '-h/2+31.5'), undefined, rest), true);
    assert.equal(m.equal(t('a\nb', '-h/2+24.0'), t('a\nb', '-h/2+31.5'), undefined, rest), null);
    assert.equal(m.equal(t('a = b\n=\nc', '2.0'), t('a = b\n=\nc', '17.0'), undefined, rest), true);
    assert.equal(m.equal(t('a\n\nb', '-h/2+24.0'), t('a\n\nb', '-w/2+31.5'), undefined, rest), null);
  });
});

describe('array-form member renaming', () => {
  it('pairs minted group members by index, whatever order each engine minted them in', () => {
    const input = JSON.stringify({
      objects: [{ id: 1, type: 'avabodh.basic.group', objects: [{ index: 1 }, { index: 0 }] }],
    });
    const doc = (/** @type {string[]} */ ids, /** @type {number[]} */ idx) =>
      JSON.stringify({
        pages: {
          P: {
            objects: {
              G: {
                objects: { [ids[0] ?? '']: { index: idx[0], w: idx[0] }, [ids[1] ?? '']: { index: idx[1], w: idx[1] } },
              },
            },
          },
        },
      });
    const r = canonicalise({
      inputText: input,
      cppText: doc(['ka', 'kb'], [0, 1]),
      tsText: doc(['kc', 'kd'], [1, 0]),
      stamp: 'app',
    });
    const { diffs } = diff(r.cpp, r.ts);
    assert.deepEqual(
      diffs.filter((d) => !d.path.includes('info')),
      [],
    );
  });
});

describe('A1 normalisers', () => {
  const L = (/** @type {unknown} */ v) => lenientParse(JSON.stringify(v)).value;
  const FIX = path.join(import.meta.dirname, '..', 'fixtures', 'DR-ENG-29');
  const read = (/** @type {string} */ f) => readFileSync(path.join(FIX, f), 'utf8');

  it('draw-restyle: the C++ web output of the fixture equals the TS one under DR-ENG-29 only', async () => {
    const { loadRegister, activeEntries } = await import('../register/load.mjs');
    const c = canonicalise({
      inputText: read('connector-draw-restyle.lekh'),
      cppText: read('connector-draw-restyle.cpp-web.json'),
      tsText: read('connector-draw-restyle.ts-web.json'),
      stamp: 'app',
    });
    const { diffs } = diff(c.cpp, c.ts);
    assert.ok(diffs.length >= 9, 'the fixture reproduces the C++ draw-time restyle');
    const reg = compileRules(activeEntries(loadRegister()));
    const r = applyRules(reg, diffs, c.cpp, c.ts, c.input ?? undefined);
    assert.deepEqual(r.unexplained, []);
    assert.deepEqual([...r.applied.keys()], ['DR-ENG-29']);
  });
  it('draw-restyle: connectors only, the restyle exactly, the stored style kept by TS', async () => {
    const m = await import('../json/normalisers/draw-restyle.mjs');
    assert.equal(m.overWhite(-2130771968), -32897);
    assert.equal(m.overWhite(-16776961), -16776961);
    const head = (/** @type {any} */ style) => ({ id: 'avabodh.arrow.str', style });
    const conn = (/** @type {any} */ style, /** @type {any} */ hs) => {
      /** @type {Record<string, unknown>} */
      const o = { type: 'avabodh.basic.connection', arrows: { end: head(hs) } };
      if (style !== undefined) o['style'] = style;
      return L(o);
    };
    const stored = { fillpaint: { color: -1, type: 2 } };
    const blue = { strokepaint: { color: -16776961, type: 2 } };
    const input = conn(blue, stored);
    const ts = conn(blue, stored);
    const cpp = conn({ ...blue, fillpaint: { type: 1 } }, { ...blue, fillpaint: { color: -16776961, type: 2 } });
    assert.equal(m.equal(cpp, ts, input, ['style', 'fillpaint']), true);
    assert.equal(m.equal(cpp, ts, input, ['arrows', 'end', 'style', 'fillpaint', 'color']), true);
    assert.equal(m.equal(cpp, ts, input, ['params', 'width']), null);
    // A head filled with another colour than the connector's stroke is not the restyle.
    const wrong = conn({ ...blue, fillpaint: { type: 1 } }, { ...blue, fillpaint: { color: -65536, type: 2 } });
    assert.equal(m.equal(wrong, ts, input, ['arrows', 'end', 'style', 'fillpaint', 'color']), false);
    // TS changed the stored head: not this entry's.
    const tsMoved = conn(blue, { fillpaint: { color: -16776961, type: 2 } });
    assert.equal(m.equal(cpp, tsMoved, input, ['arrows', 'end', 'style', 'fillpaint', 'color']), null);
    // Not a connector.
    const shape = L({ type: 'templated', style: { fillpaint: { type: 1 } } });
    assert.equal(m.equal(shape, L({ type: 'templated' }), L({ type: 'templated' }), ['style']), null);
    // The input already had a fill: not the draw's no-fill.
    assert.equal(m.equal(cpp, ts, conn({ ...blue, fillpaint: { type: 1 } }, stored), ['style', 'fillpaint']), null);
  });
});

describe('cpp_oom browser retry (G1)', () => {
  const board = (/** @type {object} */ style) =>
    JSON.stringify({ info: { version: '4.2' }, style, pages: { p: { name: 'P', order: 1, objects: {} } } });
  const base = async () => {
    const { compareBoard } = await import('../json/compare.mjs');
    const reg = compileRules([]);
    return { compareBoard, reg, filed: new Set(), board: { idx: 'b1', file: 'x.lekh' }, inputText: board({}) };
  };
  it('an out-of-memory Node oracle with no retry stays cpp_oom', async () => {
    const { compareBoard, ...a } = await base();
    const r = compareBoard({
      ...a,
      cpp: { ok: false, oom: true },
      ts: { ok: true, json: board({}) },
      stamp: 'app',
      customer: true,
    });
    assert.equal(r.status, 'cpp_oom');
    assert.equal(r.browser_retry, 'unavailable');
  });
  it('a board the browser oracle loaded is compared; the root style is not checked', async () => {
    const { compareBoard, ...a } = await base();
    const r = compareBoard({
      ...a,
      cpp: { ok: true, json: board({ fontsize: 15 }).replace('"4.2"', '"5.0"') },
      ts: { ok: true, json: board({ fillpaint: { type: 1 } }).replace('"4.2"', '"5.0"') },
      stamp: 'app',
      customer: true,
      retry: 'ok',
    });
    assert.equal(r.status, 'equal');
    assert.equal(r.oracle, 'browser');
    assert.equal(r.root_style_ok, null);
  });
  it('a browser retry that crashed again is cpp_oom with its outcome', async () => {
    const { compareBoard, ...a } = await base();
    const r = compareBoard({
      ...a,
      cpp: { ok: false, oom: true },
      ts: { ok: true, json: board({}) },
      stamp: 'app',
      customer: true,
      retry: 'oom',
    });
    assert.equal(r.status, 'cpp_oom');
    assert.equal(r.browser_retry, 'oom');
  });
});
