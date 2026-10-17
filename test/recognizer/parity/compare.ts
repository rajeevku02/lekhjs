// The comparison of spec 07 §7.4.2 between a TS result and the wasm reference: discrete outcomes
// exactly, coordinates within the decided tolerances (OQ-47).
import type { RecMutation } from '../../../src/recognizer/delegate/RecMutation';

/** The wasm's recorded calls as JSON (ink points as a plain array, or only their count for jitters). */
export type RefCall = Record<string, unknown> & { op: string };

export const TOL = Object.freeze({
  /** Points and segment ends, view px. */
  point: 0.05,
  /** Bezier control points, view px. */
  control: 0.25,
  /** Ellipse width/height, view px. */
  size: 0.05,
  /** Ellipse rotation, rad. */
  rotation: 1e-3,
  /** Connection params/val: relative, or absolute near 0. */
  rel: 1e-3,
});

/** TS mutations as the same plain JSON the wasm records. */
export function toJson(mutations: readonly RecMutation[]): RefCall[] {
  return JSON.parse(
    JSON.stringify(mutations, (_k, v: unknown) => (v instanceof Float64Array ? Array.from(v) : v)),
  ) as RefCall[];
}

type Shape = Record<string, unknown>;

function shapeSig(s: Shape): string {
  if (s.kind === 'ellipse') return `ellipse${s.snap === true ? '+snap' : ''}`;
  const comps = (s.components as Shape[]).map((c) => (c.curve === true ? 'c' : 'l')).join('');
  return `path${s.closed === true ? '-closed' : ''}${s.snap === true ? '+snap' : ''}:${comps}`;
}

const ids = (v: unknown): string => ((v as string[] | undefined) ?? []).slice().sort().join(',');

/** The discrete outcome of one call (spec 07 §7.4.2 "Exact"). */
export function callSig(c: RefCall): string {
  switch (c.op) {
    case 'add':
      return `add[${(c.shapes as Shape[]).map(shapeSig).join(' ')}]`;
    case 'convert':
      return `convert(${ids(c.deleteIds)})[${shapeSig(c.shape as Shape)}]`;
    case 'delete':
      return `delete(${ids(c.ids)})`;
    case 'connect': {
      const keys = (c.params as Shape[]).map((p) => Object.keys(p).sort().join('+')).join(';');
      return `connect(${String(c.obj1Id)}->${String(c.obj2Id)} t${String(c.type)} a${String(c.autoType)} del:${ids(c.deletedIds)} p:${keys})`;
    }
    case 'doubleLineArrow':
      return `doubleLineArrow(${String(c.obj1Id)},${String(c.obj2Id)} ${c.firstSide === true ? 'first' : 'second'})`;
    case 'arrow':
      return `arrow(${String(c.objId)} ${c.add === true ? 'add' : 'remove'} ${c.solid === true ? 'solid' : 'open'})`;
    case 'ink':
      return 'ink';
    default:
      return `?${c.op}`;
  }
}

export const outcomeSig = (calls: readonly RefCall[]): string => calls.map(callSig).join(' | ');

export interface Deviation {
  readonly path: string;
  readonly delta: number;
  readonly limit: number;
}

interface Walk {
  readonly out: Deviation[];
  max: Map<string, number>;
}

function num(w: Walk, path: string, a: unknown, b: unknown, limit: number, relative = false): void {
  const x = Number(a);
  const y = Number(b);
  let d = Math.abs(x - y);
  let lim = limit;
  if (relative) {
    const scale = Math.max(Math.abs(x), Math.abs(y));
    if (scale > 1) lim = limit * scale;
  }
  if (!Number.isFinite(d)) d = Number.POSITIVE_INFINITY;
  const key = path.replace(/\[\d+\]/g, '[]');
  w.max.set(key, Math.max(w.max.get(key) ?? 0, d / lim));
  if (d > lim) w.out.push({ path, delta: d, limit: lim });
}

function pt(w: Walk, path: string, a: unknown, b: unknown, limit: number): void {
  const p = a as { x: number; y: number };
  const q = b as { x: number; y: number };
  num(w, `${path}.x`, p.x, q.x, limit);
  num(w, `${path}.y`, p.y, q.y, limit);
}

function shape(w: Walk, path: string, a: Shape, b: Shape): void {
  if (a.kind === 'ellipse') {
    pt(w, `${path}.center`, a.center, b.center, TOL.point);
    num(w, `${path}.width`, a.width, b.width, TOL.size);
    num(w, `${path}.height`, a.height, b.height, TOL.size);
    num(w, `${path}.rotation`, a.rotation, b.rotation, TOL.rotation);
    return;
  }
  const ca = a.components as Shape[];
  const cb = b.components as Shape[];
  ca.forEach((c, i) => {
    const d = cb[i] as Shape;
    pt(w, `${path}.components[${String(i)}].p1`, c.p1, d.p1, TOL.point);
    pt(w, `${path}.components[${String(i)}].p2`, c.p2, d.p2, TOL.point);
    if (c.curve === true) {
      pt(w, `${path}.components[${String(i)}].c1`, c.c1, d.c1, TOL.control);
      pt(w, `${path}.components[${String(i)}].c2`, c.c2, d.c2, TOL.control);
    }
  });
}

/** Continuous deviations over the tolerance, for two results with the same discrete outcome. */
export function deviations(
  ts: readonly RefCall[],
  cpp: readonly RefCall[],
): { over: Deviation[]; ratio: Map<string, number> } {
  const w: Walk = { out: [], max: new Map() };
  ts.forEach((a, i) => {
    const b = cpp[i] as RefCall;
    const p = `[${String(i)}].${a.op}`;
    switch (a.op) {
      case 'add':
        (a.shapes as Shape[]).forEach((s, k) => {
          shape(w, `${p}.shapes[${String(k)}]`, s, (b.shapes as Shape[])[k] as Shape);
        });
        break;
      case 'convert':
        shape(w, `${p}.shape`, a.shape as Shape, b.shape as Shape);
        break;
      case 'connect':
        (a.params as Shape[]).forEach((pm, k) => {
          for (const key of Object.keys(pm))
            num(w, `${p}.params[${String(k)}].${key}`, pm[key], (b.params as Shape[])[k]?.[key], TOL.rel, true);
        });
        num(w, `${p}.val`, a.val, b.val, TOL.rel, true);
        break;
      case 'doubleLineArrow':
        for (const s of ['seg1', 'seg2'] as const) {
          pt(w, `${p}.${s}.p1`, (a[s] as Shape).p1, (b[s] as Shape).p1, TOL.point);
          pt(w, `${p}.${s}.p2`, (a[s] as Shape).p2, (b[s] as Shape).p2, TOL.point);
        }
        pt(w, `${p}.center`, a.center, b.center, TOL.point);
        num(w, `${p}.lineDist`, a.lineDist, b.lineDist, TOL.point);
        num(w, `${p}.len`, a.len, b.len, TOL.point);
        break;
      case 'arrow':
        pt(w, `${p}.at`, a.at, b.at, TOL.point);
        break;
      case 'ink': {
        const pa = a.points as number[];
        const pb = b.points as number[];
        if (pa.length !== pb.length)
          w.out.push({ path: `${p}.points.length`, delta: Math.abs(pa.length - pb.length), limit: 0 });
        else
          pa.forEach((v, k) => {
            num(w, `${p}.points[${String(k)}]`, v, pb[k], TOL.point);
          });
        break;
      }
      default:
        break;
    }
  });
  return { over: w.out, ratio: w.max };
}

export type CaseStatus = 'pass' | 'discrete' | 'tolerance';

export interface CaseResult {
  readonly status: CaseStatus;
  readonly ts: string;
  readonly cpp: string;
  readonly over: readonly Deviation[];
  readonly ratio: Map<string, number>;
}

export function compareCase(ts: readonly RefCall[], cpp: readonly RefCall[]): CaseResult {
  const a = outcomeSig(ts);
  const b = outcomeSig(cpp);
  if (a !== b) return { status: 'discrete', ts: a, cpp: b, over: [], ratio: new Map() };
  const { over, ratio } = deviations(ts, cpp);
  return { status: over.length === 0 ? 'pass' : 'tolerance', ts: a, cpp: b, over, ratio };
}
