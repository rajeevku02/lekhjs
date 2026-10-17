// The difference-register fixtures of the generator framework (spec 04 §14), one minimal case each,
// built from scratch: DR-GEN-03 (minimum size starts at 0), DR-GEN-06 (month info without a time
// zone), DR-GEN-10 (a failing generation warns, and the first one shows the placeholder), DR-GEN-12
// (an unknown generator is kept, not dropped), and the Lua number text of data strings (DR-GEN-13,
// withdrawn).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WireframeGenerator } from '../../src/generators';
import { GeneratorRegistry, GeneratorScriptTable, LuaToJsConverter, monthInfo, num } from '../../src/generators';
import { int, lnum, pnum } from '../../src/generators/wireframe-lua';
import { converterHooks } from '../../src/io';
import { DataStore, type WireframeModule } from '../../src/template';
import { testIo } from '../io/helpers';
import { testEnv } from '../template/helpers';
import { buttonBody, luaButton } from './helpers';

const failing: WireframeModule = {
  key: 'wireframe/button',
  generate() {
    throw new Error('always');
  },
};
const failingIo = () =>
  testIo({
    generators: converterHooks(
      new LuaToJsConverter(
        new GeneratorRegistry({
          modules: [failing],
          scripts: new GeneratorScriptTable({ 'wireframe/button': '/*lekh-js:1:wireframe/button*/x' }),
        }),
      ),
    ),
  });

describe('DR-GEN-03: the generated minimum size starts at 0', () => {
  it('a generator that never succeeded does not resize the box', () => {
    const env = testEnv();
    const t = failingIo().codec.templates.withEnv(env).parse(luaButton());
    t?.load();
    const ds = new DataStore();
    ds.setWidth(5);
    ds.setHeight(3);
    t?.generator?.setDimension(ds);
    expect([ds.width(), ds.height()]).toEqual([5, 3]);
    expect((t?.generator as WireframeGenerator).minSize()).toEqual({ w: 0, h: 0 });
  });
});

describe('DR-GEN-06: month info is time-zone independent', () => {
  it('pure arithmetic: the module reads no clock or Date', () => {
    const src = readFileSync(path.resolve(import.meta.dirname, '../../src/generators/month-info.ts'), 'utf8');
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/\bDate\b|getTimezoneOffset|Intl/);
    expect(monthInfo(3, 2022)).toEqual({ weekdayOfFirst: 3, daysInMonth: 31 });
  });
});

describe('DR-GEN-10: a failing generation warns', () => {
  it('generator_failed, and the placeholder on the first generation', () => {
    const env = testEnv();
    const t = failingIo().codec.templates.withEnv(env).parse(luaButton('x'));
    t?.load();
    expect(env.warnings.map((w) => w.code)).toEqual(['generator_failed']);
    expect(t?.textData.map((d) => d.text)).toEqual(['Unsupported shape']);
  });
});

describe('DR-GEN-12: an unknown generator is kept', () => {
  it('an unknown type is written back, where C++ dropped the block', () => {
    const io = testIo();
    const body = buttonBody({ type: 'native', shape: 'bpmn.future', text: 'x' });
    const t = io.codec.templates.parse(body);
    if (t === null) throw new Error('no template');
    expect(io.codec.templates.serialize(t)['generator']).toEqual(body['generator']);
  });
});

describe('numbers in data strings are written as Lua 5.3 tostring did (DR-GEN-13 withdrawn)', () => {
  // The B4 decision: the ports' data text stays byte-compatible with the C++ (Lua) output stored in
  // boards. A float prints with `%.14g` and `.0` when whole; a value Lua held as an integer prints
  // as digits (`int`), and a parameter is an integer when it is integral (C++ `pushParamsTable`).
  it.each([
    [7.1, '7.1'],
    [60, '60.0'],
    [-0, '-0.0'],
    [0.1 + 0.2, '0.3'],
    [Math.fround(28.68), '28.680000305176'],
    [1e21, '1e+21'],
    [1e-5, '1e-05'],
  ])('num(%d) → %s', (x, s) => {
    expect(num(x)).toBe(s);
  });

  it('integers and parameters', () => {
    expect(int(14)).toBe('14');
    expect(int(-0)).toBe('0');
    expect(lnum(0, true)).toBe('0');
    expect(lnum(0, false)).toBe('0.0');
    expect(pnum(25)).toBe('25');
    expect(pnum(0.5)).toBe('0.5');
  });
});
