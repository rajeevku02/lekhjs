// TS port of the C++ test/recognizer/LineSetGenerators.h (spec 07 §7.2): synthetic stroke-line sets
// for the convex-poly search. Each generator lays out one stroke as points resampled every 4 px
// (as GeoUtil.preProcess produces) and builds one StrokeLine per segment or chord over a
// contiguous range of those points, bypassing the line aggregator (a stub until the handoff).
// Deterministic: scribble uses the same 64-bit LCG as C++, in BigInt.
import { Span } from '../../../src/base';
import { Point } from '../../../src/geometry';
import { StrokeLine } from '../../../src/recognizer/lines';

const RESAMPLE_STEP = 4.0;

export interface LineSet {
  readonly name: string;
  readonly points: readonly Point[];
  /** Fresh lines (ids unset); call `lines()` again for another LineColl. */
  lines(): StrokeLine[];
}

class StrokeBuilder {
  private readonly name: string;
  private readonly pts: Point[] = [];
  private readonly ranges: [number, number][] = [];
  private mark = 0;

  constructor(name: string) {
    this.name = name;
  }

  start(x: number, y: number): void {
    this.pts.push(new Point(x, y));
    this.mark = 0;
  }

  lineTo(x: number, y: number): void {
    const a = this.pts[this.pts.length - 1] as Point;
    const dx = x - a.x;
    const dy = y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.trunc(d / RESAMPLE_STEP));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.pts.push(new Point(a.x + dx * t, a.y + dy * t));
    }
  }

  /** Ends a line at the current last point (from the previous mark). */
  endLine(): void {
    const last = this.pts.length - 1;
    this.ranges.push([this.mark, last]);
    this.mark = last;
  }

  /** Moves the mark without making a line. */
  skip(): void {
    this.mark = this.pts.length - 1;
  }

  segment(x: number, y: number): void {
    this.lineTo(x, y);
    this.endLine();
  }

  take(): LineSet {
    const points = this.pts.slice();
    const ranges = this.ranges.slice();
    return {
      name: this.name,
      points,
      lines: () => ranges.map(([a, b]) => new StrokeLine(new Span(points, a, b))),
    };
  }
}

/** The C++ `Lcg`: a portable PRNG in [0, 1). */
export class Lcg {
  private s: bigint;

  constructor(seed: number) {
    this.s = BigInt(seed === 0 ? 1 : seed >>> 0);
  }

  next(): number {
    this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number(this.s >> 11n) / 9007199254740992.0;
  }
}

/** n segments of 40 px alternating +60° / -60° from the x axis. */
export function zigzag(n: number): LineSet {
  const b = new StrokeBuilder(`zigzag${String(n)}`);
  let x = 100;
  let y = 100;
  b.start(x, y);
  const dx = 40 * Math.cos(Math.PI / 3);
  const dy = 40 * Math.sin(Math.PI / 3);
  for (let i = 0; i < n; i++) {
    x += dx;
    y += i % 2 === 0 ? -dy : dy;
    b.segment(x, y);
  }
  return b.take();
}

/** n parallel 80 px strokes 6 px apart, joined by 6 px runs that belong to no line. */
export function hatch(n: number): LineSet {
  const b = new StrokeBuilder(`hatch${String(n)}`);
  let y = 100;
  b.start(100, y);
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      y += 6;
      b.lineTo(i % 2 === 0 ? 100 : 180, y);
      b.skip();
    }
    b.segment(i % 2 === 0 ? 180 : 100, y);
  }
  return b.take();
}

/** n chords of an inward spiral, 8 chords per turn, rings 8 px apart, from r = 80. */
export function spiral(n: number): LineSet {
  const b = new StrokeBuilder(`spiral${String(n)}`);
  const at = (i: number): [number, number] => {
    const a = (2 * Math.PI * i) / 8.0;
    const r = 80 - (8.0 * i) / 8.0;
    return [300 + r * Math.cos(a), 300 + r * Math.sin(a)];
  };
  b.start(...at(0));
  for (let i = 1; i <= n; i++) b.segment(...at(i));
  return b.take();
}

/** n chords round a 60 px circle 3 times, with a ±3 px radial wobble. */
export function overtrace(n: number): LineSet {
  const b = new StrokeBuilder(`overtrace${String(n)}`);
  const at = (i: number): [number, number] => {
    const a = (2 * Math.PI * 3.0 * i) / n;
    const r = 60 + 3 * Math.sin(1.7 * i);
    return [300 + r * Math.cos(a), 300 + r * Math.sin(a)];
  };
  b.start(...at(0));
  for (let i = 1; i <= n; i++) b.segment(...at(i));
  return b.take();
}

/** n random chords inside an 80 × 80 px box. */
export function scribble(n: number, seed: number): LineSet {
  const b = new StrokeBuilder(`scribble${String(n)}s${String(seed)}`);
  const rng = new Lcg(seed);
  const x0 = 100 + 80 * rng.next();
  const y0 = 100 + 80 * rng.next();
  b.start(x0, y0);
  for (let i = 0; i < n; i++) {
    const x = 100 + 80 * rng.next();
    const y = 100 + 80 * rng.next();
    b.segment(x, y);
  }
  return b.take();
}

/** One-stroke closed polygon through the corners, back to the first. */
export function closedPolygon(name: string, corners: readonly Point[]): LineSet {
  const b = new StrokeBuilder(name);
  const c0 = corners[0] as Point;
  b.start(c0.x, c0.y);
  for (let i = 1; i <= corners.length; i++) {
    const p = corners[i % corners.length] as Point;
    b.segment(p.x, p.y);
  }
  return b.take();
}

export function rect(): LineSet {
  return closedPolygon('rect', [new Point(100, 100), new Point(220, 100), new Point(220, 180), new Point(100, 180)]);
}

export function triangle(): LineSet {
  return closedPolygon('triangle', [new Point(100, 200), new Point(160, 96), new Point(220, 200)]);
}

/** k chords of a closed ellipse with semi-axes 80 × 50 px. */
export function ellipse(k: number): LineSet {
  const corners: Point[] = [];
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k;
    corners.push(new Point(300 + 80 * Math.cos(a), 300 + 50 * Math.sin(a)));
  }
  return closedPolygon(`ellipse${String(k)}`, corners);
}

/** A rectangle traced twice in one stroke; the second pass 3 px inside the first. */
export function rectTwice(): LineSet {
  const b = new StrokeBuilder('rect_twice');
  b.start(100, 100);
  b.segment(220, 100);
  b.segment(220, 180);
  b.segment(100, 180);
  b.segment(100, 100);
  b.segment(217, 103);
  b.segment(217, 177);
  b.segment(103, 177);
  b.segment(103, 103);
  return b.take();
}

/**
 * Seeded random line sets for the differential test (AC-REC-08): `n` chords of a random walk with
 * steps of 20-60 px, sometimes turning back, inside a 160 px box; lines touch end to end.
 */
export function randomSet(seed: number, n: number): LineSet {
  const b = new StrokeBuilder(`random${String(seed)}_${String(n)}`);
  const rng = new Lcg(seed);
  let x = 100 + 160 * rng.next();
  let y = 100 + 160 * rng.next();
  let heading = 2 * Math.PI * rng.next();
  b.start(x, y);
  for (let i = 0; i < n; i++) {
    heading += (rng.next() - 0.3) * 2.2;
    const len = 20 + 40 * rng.next();
    x = Math.min(260, Math.max(100, x + len * Math.cos(heading)));
    y = Math.min(260, Math.max(100, y + len * Math.sin(heading)));
    b.segment(x, y);
  }
  return b.take();
}
