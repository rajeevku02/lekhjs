// AC-GEN-01: the DataExpression parser keeps every C++ quirk of spec 04 §2, and evaluation reads
// the box, parameters, data, text sizes and stroke widths as C++ does.
import { describe, expect, it } from 'vitest';
import { Size } from '../../src/geometry';
import {
  DataExpressionParser,
  DataStore,
  FunctionCallExpression,
  PrimitiveExpression,
  VariableAccessExpression,
  validateSemanticExpression,
  type ExpressionScope,
} from '../../src/template';

function scope(params: Record<string, number> = {}, texts: Size[] = [], strokes: number[] = []): ExpressionScope {
  return {
    paramValue: (n) => params[n],
    textSize: (i, c) => {
      const s = texts[i];
      if (s === undefined) return null;
      // Echo the constraint into the answer so a test can see which one was passed.
      return new Size(s.width + (c.height > 0 ? c.height / 1000 : 0), s.height + (c.width > 0 ? c.width / 1000 : 0));
    },
    strokeWidth: (i) => strokes[i] ?? 1.5,
  };
}

function ds(w = 100, h = 50, values: number[] = []): DataStore {
  const d = new DataStore();
  d.setWidth(w);
  d.setHeight(h);
  d.setCx(7);
  d.setCy(9);
  d.setAngle(0.25);
  d.values = values;
  return d;
}

const p = new DataExpressionParser();
const val = (src: string, sc: ExpressionScope = scope(), d: DataStore = ds()) => {
  const e = p.compile(src);
  if (e === null) throw new Error(`does not parse: ${src}`);
  return e.value(d, sc);
};

describe('DataExpressionParser quirks (AC-GEN-01)', () => {
  it.each([
    ['w/2', 50],
    ['-w/2', -50],
    ['-h/2 - 3', -28],
    ['(w+h)*2', 300],
    ['w - h - 10', 40],
    ['w / 4 / 5', 5],
    ['2*3+4*5', 26],
    ['.5', 0.5],
    ['1e-05', 1e-5],
    ['1.5E+2', 150],
    ['2e', 2],
    ['.5.5', 0.5],
    ['-(-w)', 100],
    ['min(w, h)', 50],
    ['max(w,h)', 100],
    ['  w  ', 100],
  ])('%s = %d', (src, expected) => {
    expect(val(src)).toBeCloseTo(expected, 12);
  });

  it('an unknown name evaluates to 0', () => {
    expect(val('foo')).toBe(0);
    expect(val('foo + 3')).toBe(3);
  });

  it('a name is a letter followed by letters and digits', () => {
    expect(val('p1', scope({ p1: 4 }))).toBe(4);
    const e = p.compile('a1b2');
    expect(e).toBeInstanceOf(VariableAccessExpression);
    expect((e as VariableAccessExpression).name).toBe('a1b2');
  });

  it('w, h, x, y and a hide parameters with the same name', () => {
    const sc = scope({ w: 1, h: 2, x: 3, y: 4, a: 5, b: 6 });
    expect([val('w', sc), val('h', sc), val('x', sc), val('y', sc), val('a', sc), val('b', sc)]).toEqual([
      100, 50, 7, 9, 0.25, 6,
    ]);
  });

  it('trailing text is ignored by compile, refused by compileAll', () => {
    expect(val('w h')).toBe(100);
    expect(val('w 5')).toBe(100);
    expect(val('1.2.3')).toBeCloseTo(1.2, 12);
    expect(p.compileAll('w h')).toBeNull();
    expect(p.compileAll('w + h')).not.toBeNull();
  });

  it('unary minus only at the start of an expression, a parenthesis or an argument', () => {
    expect(p.compile('w*-0.5')).toBeNull();
    expect(p.compile('w+-1')).toBeNull();
    expect(val('w*(-0.5)')).toBe(-50);
    expect(val('max(-1, -2)')).toBe(-1);
  });

  it('f() does not parse; extra arguments are ignored', () => {
    expect(p.compile('sin()')).toBeNull();
    expect(p.compile('f()')).toBeNull();
    const e = p.compile('sin(0, 5, 6)');
    expect(e).toBeInstanceOf(FunctionCallExpression);
    expect((e as FunctionCallExpression).params).toHaveLength(3);
    expect(val('sin(0, 5, 6)')).toBe(0);
    // min/max need exactly two
    expect(val('min(1, 2, 3)')).toBe(0);
    expect(val('max(1)')).toBe(0);
  });

  it('other parse failures', () => {
    for (const s of ['', '   ', '(w', 'w +', '*w', '#']) expect(p.compile(s), s).toBeNull();
    // a bad character after a complete expression is trailing text
    expect(val('w#2')).toBe(100);
  });

  it('an unknown function evaluates to 0 (its argument is still evaluated)', () => {
    expect(val('foo(3)')).toBe(0);
  });

  it('compiled trees are immutable', () => {
    const e = p.compile('w + 1');
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(new PrimitiveExpression(1))).toBe(true);
  });
});

describe('evaluation', () => {
  it('d(i) reads the data list; out of range reads 0 (C++ read undefined memory)', () => {
    const d = ds(100, 50, [10, 20, 30]);
    expect(val('d(1)', scope(), d)).toBe(20);
    expect(val('d(2.9)', scope(), d)).toBe(30);
    expect(val('d(3)', scope(), d)).toBe(0);
    expect(val('d(-1)', scope(), d)).toBe(0);
    expect(val('d(0/0)', scope(), d)).toBe(0);
  });

  it('trigonometry in doubles (no float32)', () => {
    expect(val('sin(1)')).toBe(Math.sin(1));
    expect(val('cos(1)')).toBe(Math.cos(1));
    expect(val('tan(1)')).toBe(Math.tan(1));
  });

  it('min/max follow C fmin/fmax for NaN', () => {
    expect(val('min(0/0, 3)')).toBe(3);
    expect(val('max(3, 0/0)')).toBe(3);
  });

  it('tw/th measure text slots with the constraint as the second argument', () => {
    const sc = scope({}, [new Size(40, 12)]);
    expect(val('tw(0)', sc)).toBe(40);
    expect(val('th(0)', sc)).toBe(12);
    expect(val('tw(0, 2000)', sc)).toBeCloseTo(42, 9);
    expect(val('th(0, 3000)', sc)).toBeCloseTo(15, 9);
    expect(val('tw(1)', sc)).toBe(0);
    expect(val('th(-1)', sc)).toBe(0);
  });

  it('sw(i) is the path stroke width, else the scope fallback', () => {
    expect(val('sw(0)', scope({}, [], [4]))).toBe(4);
    expect(val('sw(5)', scope({}, [], [4]))).toBe(1.5);
  });

  it('a non-numeric parameter reads 0', () => {
    const sc: ExpressionScope = { ...scope(), paramValue: () => undefined };
    expect(val('q', sc)).toBe(0);
  });
});

describe('lists', () => {
  it.each([
    ['0 1 2 3 4', [0, 1, 2, 3, 4]],
    ['  5\t6\n', [5, 6]],
    ['', []],
    ['3 -1 4', [3]],
    ['1 x 2', [1, 0]],
    ['1.5 2', [1, 0]],
    ['+3 4', [3, 4]],
    ['-0 2', [0, 2]],
  ])('parseList(%j)', (s, expected) => {
    expect(DataExpressionParser.parseList(s)).toEqual(expected);
  });

  it('parseIntStrList reads numbers (truncated) and names', () => {
    expect(p.parseIntStrList('0 1 2 3 4 5 radius 6')).toEqual([0, 1, 2, 3, 4, 5, 'radius', 6]);
    expect(p.parseIntStrList('1.9 a')).toEqual([1, 'a']);
    expect(p.parseIntStrList('1 - 2')).toBeNull();
    expect(p.parseIntStrList('')).toEqual([]);
  });
});

describe('validateSemanticExpression', () => {
  it.each([
    ['w/2', true, ''],
    ['min(w, h) * sin(0.5)', true, ''],
    ['x', false, 'x'],
    ['d(1)', false, 'd'],
    ['min(w)', false, 'min'],
    ['sin()', false, 'sin'],
    ['foo()', false, 'foo'],
  ])('%s', (s, ok, offending) => {
    const r = validateSemanticExpression(s);
    expect(r.ok).toBe(ok);
    if (!r.ok) expect(r.offending).toBe(offending);
  });

  it('explains a negative operand after an operator', () => {
    const r = validateSemanticExpression('w*-0.5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('w*(-0.5)');
    expect(validateSemanticExpression('  ')).toEqual({ ok: false, offending: '', reason: 'empty expression' });
  });
});
