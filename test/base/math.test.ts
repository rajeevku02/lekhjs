import { describe, expect, it } from 'vitest';
import { formatG6, roundHalfUp, solveCubic, solveQuadEquation, toInt } from '../../src/base';

describe('solveQuadEquation', () => {
  it('two, one or no roots, in C++ order', () => {
    expect(solveQuadEquation(1, -3, 2)).toEqual([2, 1]);
    expect(solveQuadEquation(1, 2, 1)).toEqual([-1]);
    expect(solveQuadEquation(1, 0, 1)).toEqual([]);
  });
  it('degrades to linear, and to nothing', () => {
    expect(solveQuadEquation(0, 2, -4)).toEqual([2]);
    expect(solveQuadEquation(0, 0, 1)).toEqual([]);
  });
});

describe('solveCubic', () => {
  const sorted = (r: number[]): number[] => r.slice().sort((a, b) => a - b);
  it('three distinct roots', () => {
    const r = sorted(solveCubic(1, -6, 11, -6));
    expect(r.length).toBe(3);
    r.forEach((v, i) => {
      expect(v).toBeCloseTo(i + 1, 9);
    });
  });
  it('a single real root', () => {
    const r = solveCubic(1, 0, 0, -8);
    expect(r.length).toBe(1);
    expect(r[0]).toBeCloseTo(2, 9);
  });
  it('duplicate roots are merged', () => {
    expect(solveCubic(1, 0, -3, -2)).toEqual([2, -1]); // (x+1)^2 (x-2): discriminant exactly 0
    expect(solveCubic(1, 0, 0, 0)).toEqual([0]);
  });
  it('a = 0 is a quadratic', () => {
    expect(solveCubic(0, 1, -3, 2)).toEqual([2, 1]);
  });
});

describe('C++ numeric conversions', () => {
  it('roundHalfUp is floor(d + 0.5)', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-2);
  });
  it('toInt truncates toward zero', () => {
    expect(toInt(2.9)).toBe(2);
    expect(toInt(-2.9)).toBe(-2);
  });
  it('formatG6 writes what ostream << double writes', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [0.25, '0.25'],
      [-1 / 3, '-0.333333'],
      [0.5, '0.5'],
      [1e-5, '1e-05'],
      [0.0001, '0.0001'],
      [123456, '123456'],
      [1234567, '1.23457e+06'],
      [999999.5, '1e+06'],
      [-0.000123456, '-0.000123456'],
      [100, '100'],
      [12.5, '12.5'],
      [1e100, '1e+100'],
    ];
    for (const [v, s] of cases) expect(formatG6(v)).toBe(s);
  });
});
