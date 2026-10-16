// AC-REC-07 (spec 07 §7.3): the ported CxPolyBudgetTest golden cases.
//  - cxpoly-golden.txt is the C++ set golden (poly count and the sorted line-id sets), as shipped.
//  - cxpoly-order.json is the ordered golden from the C++ PolyColl built with doubles
//    (parity/tools/cxpoly-golden/regen.mjs): the polys in order, their parts, closed flags,
//    features and the PolySplitter output. `fixed` is C2-fixed C++ (the TS default); `legacy` is
//    the C++ as is, matched by TS with quirks.legacyWidthBug (DR-REC-02).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CxPoly } from '../../../src/recognizer/polys';
import { GOLDEN_CASES, ORDER_CASES } from '../support/cases';
import { makeEnv, runPolys } from '../support/env';

const GOLDEN_DIR = path.join(import.meta.dirname, '../golden');

function readSetGolden(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(path.join(GOLDEN_DIR, 'cxpoly-golden.txt'), 'utf8').split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    out.set(line.slice(0, line.indexOf(' ')), line);
  }
  return out;
}

/** C++ `format`: "<key> polys=<n> {1,2} {3} ..." with the sets sorted. */
function formatSets(key: string, polys: readonly CxPoly[]): string {
  const sets = polys.map((p) => p.lineIdList());
  sets.sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
    }
    return a.length - b.length;
  });
  return [`${key} polys=${String(polys.length)}`, ...sets.map((s) => `{${s.join(',')}}`)].join(' ');
}

describe('CxPoly set golden (C++ cxpoly-golden.txt)', () => {
  const golden = readSetGolden();
  const params = GOLDEN_CASES.flatMap((c) =>
    c.nearby
      ? [
          { c, inOrder: true },
          { c, inOrder: false },
        ]
      : [{ c, inOrder: true }],
  );
  it.each(params.map((p) => [`${p.c.label}/${p.inOrder ? 'inorder' : 'nearby'}`, p] as const))('%s', (key, p) => {
    const { pc } = runPolys(p.c.make(), p.inOrder);
    expect(golden.has(key)).toBe(true);
    expect(formatSets(key, pc.polys())).toBe(golden.get(key));
  });
});

type Parts = [number, number, number, number][];
interface GPoly {
  ids: number[];
  parts?: Parts;
  turn: number;
  closed: boolean;
  almostClosed?: boolean;
  perimeter?: number;
  width?: number;
  height?: number;
  totalAngle?: number;
  segments?: number;
  mainAngles?: number[];
  smoothness?: number;
  smoothness2?: number;
}
interface GCase {
  name: string;
  mode: 'inorder' | 'nearby';
  lines: number;
  budgetExceeded: boolean;
  polys: GPoly[];
  featured: GPoly[];
  split: { id: number; poly: GPoly }[];
}
interface OrderGolden {
  fixed: GCase[];
  legacy: GCase[];
}

/** The file keeps `ids` as "1,2,3" and `parts` as "x1 y1 x2 y2,…" (compact once formatted). */
function revive(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (key === 'ids') return value === '' ? [] : value.split(',').map(Number);
  if (key === 'parts') return value === '' ? [] : value.split(',').map((p) => p.split(' ').map(Number));
  return value;
}

const order = JSON.parse(readFileSync(path.join(GOLDEN_DIR, 'cxpoly-order.json'), 'utf8'), revive) as OrderGolden;

const TOL = 1e-9;
function close(actual: number, expected: number, what: string): void {
  const tol = TOL * Math.max(1, Math.abs(expected));
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${what}: ${String(actual)} != ${String(expected)}`);
  }
}

function checkParts(p: CxPoly, parts: Parts, what: string): void {
  expect(p.lines.length, what).toBe(parts.length);
  p.lines.forEach((lp, i) => {
    const g = parts[i] as [number, number, number, number];
    close(lp.start.x, g[0], `${what} part ${String(i)} start.x`);
    close(lp.start.y, g[1], `${what} part ${String(i)} start.y`);
    close(lp.end.x, g[2], `${what} part ${String(i)} end.x`);
    close(lp.end.y, g[3], `${what} part ${String(i)} end.y`);
  });
}

function checkCase(variant: 'fixed' | 'legacy', g: GCase): void {
  const c = ORDER_CASES.find((x) => x.label === g.name);
  if (c === undefined) throw new Error(`no case ${g.name}`);
  const env = makeEnv(variant === 'legacy' ? { legacyWidthBug: true } : {});
  const { pc } = runPolys(c.make(), g.mode === 'inorder', env);
  const what = `${variant} ${g.name}/${g.mode}`;
  expect(c.make().lines().length, what).toBe(g.lines);
  expect(pc.budgetExceeded(), what).toBe(g.budgetExceeded);

  // The search's polys in order, as it left them.
  const polys = pc.polys();
  expect(
    polys.map((p) => ({ ids: p.lines.map((lp) => lp.line.id), turn: p.turnDir, closed: p.closed() })),
    what,
  ).toEqual(g.polys.map((p) => ({ ids: p.ids, turn: p.turn, closed: p.closed })));

  // Their features.
  g.featured.forEach((gp, i) => {
    const p = polys[i] as CxPoly;
    const w = `${what} poly ${String(i)}`;
    const f = p.features();
    checkParts(p, gp.parts ?? [], w);
    expect(p.closed(), w).toBe(gp.closed);
    expect(p.almostClosed(), w).toBe(gp.almostClosed);
    close(f.perimeter, gp.perimeter ?? NaN, `${w} perimeter`);
    close(f.width, gp.width ?? NaN, `${w} width`);
    close(f.height, gp.height ?? NaN, `${w} height`);
    close(f.totalAngle, gp.totalAngle ?? NaN, `${w} totalAngle`);
    expect(f.segments.length, w).toBe(gp.segments);
    expect(
      f.mainAngles.map((a) => a.segId),
      w,
    ).toEqual(gp.mainAngles);
    close(p.smoothness(), gp.smoothness ?? NaN, `${w} smoothness`);
    close(p.smoothness2(), gp.smoothness2 ?? NaN, `${w} smoothness2`);
  });

  // PolySplitter's output.
  if (g.budgetExceeded) return;
  pc.splitExtensions();
  const split = pc.polys();
  expect(
    split.map((p) => ({ id: p.id, ids: p.lines.map((lp) => lp.line.id), turn: p.turnDir, closed: p.closed() })),
    what,
  ).toEqual(g.split.map((s) => ({ id: s.id, ids: s.poly.ids, turn: s.poly.turn, closed: s.poly.closed })));
  g.split.forEach((s, i) => {
    if (s.poly.parts !== undefined) checkParts(split[i] as CxPoly, s.poly.parts, `${what} split ${String(i)}`);
  });
}

describe('CxPoly ordered golden (C++ PolyColl in doubles)', () => {
  it('covers every ordered case in both variants', () => {
    expect(order.fixed.length).toBe(29);
    expect(order.legacy.length).toBe(29);
  });
  it.each(order.fixed.map((g) => [`${g.name}/${g.mode}`, g] as const))('fixed (C2 on) %s', (_k, g) => {
    checkCase('fixed', g);
  });
  it.each(order.legacy.map((g) => [`${g.name}/${g.mode}`, g] as const))('legacy (quirk) %s', (_k, g) => {
    checkCase('legacy', g);
  });
});
