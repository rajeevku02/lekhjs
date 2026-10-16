// Self-tests of the comparison tools (node:test; `npm test` in parity/). Synthetic inputs only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { canonicalise, isArrayForm } from '../json/canon.mjs';
import { diff, generalise } from '../json/diff.mjs';
import { LNum, LenientParseError, lenientParse } from '../json/lenient-parse.mjs';
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
    const gen = { template: { id: 't', generator: { script: 'return 1', scriptfile: 'x.lua', text: 'Button' } } };
    const js = { template: { id: 't', generator: { script: '/*lekh-js:1:wireframe/button*/x', text: 'Button' } } };
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
