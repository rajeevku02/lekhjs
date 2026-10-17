// The stroke corpus the R3 suites run (spec 07 §7.2 origins: synthetic and seeded only; no user
// strokes). View px, top-left near (0, 0) so a suite can shift them onto a scene. Each entry names
// its origin (AC-REC-34).
import { Point } from '../../../src/geometry';
import {
  Lcg,
  closedPolygon,
  ellipse,
  hatch,
  openPolyline,
  overtrace,
  rect,
  rectTwice,
  scribble,
  spiral,
  triangle,
  zigzag,
} from './lineSets';

export interface CorpusStroke {
  readonly name: string;
  readonly origin: 'synthetic' | 'seed';
  readonly points: readonly Point[];
}

const P = (x: number, y: number): Point => new Point(x, y);

/** Points every `step` px along the polyline `v`. */
function along(v: readonly Point[], step = 4): Point[] {
  const out: Point[] = [];
  const first = v[0];
  if (first === undefined) return out;
  out.push(first);
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1] as Point;
    const b = v[i] as Point;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push(P(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return out;
}

function circle(cx: number, cy: number, r: number, k = 48, sweep = 2 * Math.PI): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= k; i++) {
    const a = (sweep * i) / k;
    out.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return out;
}

function jitter(pts: readonly Point[], seed: number, amp: number): Point[] {
  const rnd = new Lcg(seed);
  return pts.map((p) => P(p.x + (rnd.next() - 0.5) * amp, p.y + (rnd.next() - 0.5) * amp));
}

function shifted(pts: readonly Point[], dx: number, dy: number): Point[] {
  return pts.map((p) => P(p.x - dx, p.y - dy));
}

const fromSet = (s: { name: string; points: readonly Point[] }): CorpusStroke => ({
  name: s.name,
  origin: 'synthetic',
  points: shifted(s.points, 60, 40),
});

export const STROKE_CORPUS: readonly CorpusStroke[] = Object.freeze([
  fromSet(rect()),
  fromSet(triangle()),
  fromSet(ellipse(8)),
  fromSet(ellipse(16)),
  fromSet(rectTwice()),
  fromSet(spiral(10)),
  fromSet(overtrace(10)),
  fromSet(scribble(12, 1234)),
  fromSet(zigzag(6)),
  fromSet(hatch(8)),
  fromSet(closedPolygon('diamond', [P(200, 100), P(280, 180), P(200, 260), P(120, 180)])),
  fromSet(openPolyline('L', [P(100, 100), P(100, 220), P(220, 220)])),
  fromSet(openPolyline('star5', [P(100, 300), P(200, 50), P(300, 300), P(60, 140), P(340, 140), P(100, 300)])),
  { name: 'dot', origin: 'synthetic', points: [P(40, 40)] },
  { name: 'tick', origin: 'synthetic', points: [P(40, 40), P(42, 41)] },
  { name: 'line', origin: 'synthetic', points: along([P(10, 10), P(240, 90)]) },
  {
    name: 'arrow',
    origin: 'synthetic',
    points: along([P(10, 100), P(240, 100), P(215, 85), P(240, 100), P(215, 115)]),
  },
  { name: 'circle', origin: 'synthetic', points: circle(120, 120, 80) },
  { name: 'arc', origin: 'synthetic', points: circle(120, 120, 80, 30, Math.PI) },
  {
    name: 'square-jitter',
    origin: 'seed',
    points: jitter(along([P(20, 20), P(220, 20), P(220, 220), P(20, 220), P(20, 22)]), 7, 3),
  },
  { name: 'circle-jitter', origin: 'seed', points: jitter(circle(140, 140, 90, 64), 11, 4) },
  { name: 'scribble-seed', origin: 'seed', points: shifted(scribble(18, 99).points, 60, 40) },
]);
