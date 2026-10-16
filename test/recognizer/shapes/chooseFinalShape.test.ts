// AC-REC-10 (spec 07 §4.2, DR-REC-01): the shape ShapeColl.takeOut picks is the final shape with
// the largest perimeter attribute, the first one on ties; `legacy` gives the C++ answer.
import { describe, expect, it } from 'vitest';
import { chooseFinalShape } from '../../../src/recognizer/shapes/chooseFinalShape';

interface S {
  name: string;
  final: boolean;
  perimeter?: number;
}

const pick = (shapes: S[], legacy = false): string | undefined =>
  chooseFinalShape(
    shapes,
    (s) => s.final,
    (s) => s.perimeter,
    legacy,
  )?.name;

describe('chooseFinalShape (C1)', () => {
  it('takes the max-perimeter final shape, even when it is the first one', () => {
    const shapes: S[] = [
      { name: 'a', final: true, perimeter: 300 },
      { name: 'b', final: true, perimeter: 120 },
      { name: 'c', final: false, perimeter: 900 },
    ];
    expect(pick(shapes)).toBe('a');
    // C++: the first final shape never wins when another final shape has a perimeter.
    expect(pick(shapes, true)).toBe('b');
  });

  it('takes the later shape when it is longer', () => {
    const shapes: S[] = [
      { name: 'a', final: true, perimeter: 100 },
      { name: 'b', final: true, perimeter: 250 },
      { name: 'c', final: true, perimeter: 200 },
    ];
    expect(pick(shapes)).toBe('b');
    expect(pick(shapes, true)).toBe('b');
  });

  it('keeps the first on ties (strict >)', () => {
    const shapes: S[] = [
      { name: 'a', final: true, perimeter: 200 },
      { name: 'b', final: true, perimeter: 200 },
    ];
    expect(pick(shapes)).toBe('a');
    expect(pick(shapes, true)).toBe('b');
  });

  it('counts a missing perimeter as 0', () => {
    expect(
      pick([
        { name: 'a', final: true },
        { name: 'b', final: true, perimeter: 1 },
      ]),
    ).toBe('b');
    expect(
      pick([
        { name: 'a', final: true, perimeter: 1 },
        { name: 'b', final: true },
      ]),
    ).toBe('a');
    expect(
      pick([
        { name: 'a', final: true },
        { name: 'b', final: true },
      ]),
    ).toBe('a');
    expect(
      pick(
        [
          { name: 'a', final: true },
          { name: 'b', final: true },
        ],
        true,
      ),
    ).toBe('a');
  });

  it('returns null without a final shape', () => {
    expect(pick([])).toBeUndefined();
    expect(pick([{ name: 'a', final: false, perimeter: 5 }])).toBeUndefined();
    expect(pick([{ name: 'a', final: false, perimeter: 5 }], true)).toBeUndefined();
  });

  it('a single final shape wins in both modes', () => {
    const shapes: S[] = [
      { name: 'x', final: false, perimeter: 50 },
      { name: 'a', final: true, perimeter: 10 },
    ];
    expect(pick(shapes)).toBe('a');
    expect(pick(shapes, true)).toBe('a');
  });
});
