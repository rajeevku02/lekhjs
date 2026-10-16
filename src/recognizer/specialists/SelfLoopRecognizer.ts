// Freehand self-loop recognizer (port of C++ `recognizer/SelfLoopRecognizer`, Work
// 01M2JX6PXPGZ9C9EQM3A52QMF9, spec freehand-self-loop.md §4-§5).
//
// A freehand stroke that leaves a shape's edge, travels round outside it and comes back to the same
// shape's edge becomes a self-loop connector on that shape. It runs from `consumePath` after
// `ConnectionRecognizer` declines a fresh, non-self-crossing stroke.
//
// The stroke is a loop on S only if all of R1-R8 hold (thresholds from the job's config, distances
// view px):
//   R1 both endpoints resolve to the same connectable shape S
//   R2 each endpoint within connectObjectDistThreshold of S's outline
//   R3 at least selfLoopMinOutsideFraction of the stroke length outside S
//   R4 peak distance h from the outline within
//      [max(selfLoopMinExcursion, selfLoopMinExcursionRatio × min(w, h)),
//       selfLoopMaxExcursionRatio × max(w, h)], and the stroke at least selfLoopMinStrokeLength long
//   R5 the two attach points at least selfLoopMinEndDistance apart
//   R6 the stroke closed by its chord does not enclose the whole of S (all four corners of S's
//      selection rectangle inside it) — a lasso
//   R7 at most selfLoopMaxCorners corners, none sharper than selfLoopMinCornerAngle
//   R8 no stroke point inside another (non-container) object or inside S's title
//
// The connector's type and params are fitted to the stroke: an axis-aligned polyline with 2-4
// near-right corners becomes an orthogonal (MultiLine) loop with one stored segment per stroke
// segment; anything else a pinned curve whose control points are those of a cubic fitted to it.
import {
  CurveFitter,
  getDistance,
  isPointInsidePolygon,
  normalizeAngleInPI,
  Point,
  toDegree,
  type PathComponent,
  type SimplePath,
} from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { CanvasDelegate, ConnectionDetail, ParamMap, Params } from '../delegate/CanvasDelegate';
import type { ObjectId } from '../delegate/RecMutation';

/** C++ `SelfLoopRecognizer::Rule`: the rule a stroke failed; None when it is a loop. */
export const SelfLoopRule = Object.freeze({ None: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6, R7: 7, R8: 8 } as const);
export type SelfLoopRule = (typeof SelfLoopRule)[keyof typeof SelfLoopRule];

/** C++ `SelfLoopRecognizer::Kind`. */
export const SelfLoopKind = Object.freeze({ Curve: 0, Orthogonal: 1 } as const);
export type SelfLoopKind = (typeof SelfLoopKind)[keyof typeof SelfLoopKind];

/** C++ `SelfLoopRecognizer::Result`. */
export interface SelfLoopResult {
  failed: SelfLoopRule;
  kind: SelfLoopKind;
  /** obj1 == obj2 == S, the fitted type and params (canvas units). */
  detail: ConnectionDetail;
  /** The attach points, view px. */
  from: Point;
  to: Point;
  /** The loop's peak distance from the outline, view px. */
  excursion: number;
  corners: number;
}

interface Corner {
  at: Point;
  /** interior angle, degrees (180 = straight) */
  angle: number;
  /** the path component the corner starts */
  component: number;
}

function sub(a: Point, b: Point): Point {
  return new Point(a.x - b.x, a.y - b.y);
}

function length(v: Point): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function strokeLength(pts: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += getDistance(pts[i - 1] as Point, pts[i] as Point);
  return len;
}

/** The direction a path component leaves its first point. */
function startDir(pc: PathComponent): Point {
  if (!pc.isCurve) return sub(pc.segment.point2(), pc.segment.point1());
  const c = pc.curve;
  for (const p of [c.point2, c.point3, c.point4]) {
    const d = sub(p, c.point1);
    if (length(d) > 1e-6) return d;
  }
  return new Point(0, 0);
}

/** The direction a path component reaches its last point. */
function endDir(pc: PathComponent): Point {
  if (!pc.isCurve) return sub(pc.segment.point2(), pc.segment.point1());
  const c = pc.curve;
  for (const p of [c.point3, c.point2, c.point1]) {
    const d = sub(c.point4, p);
    if (length(d) > 1e-6) return d;
  }
  return new Point(0, 0);
}

/** The angle in degrees between two directions (0 = same direction). */
function turnBetween(a: Point, b: Point): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  let c = (a.x * b.x + a.y * b.y) / (la * lb);
  c = Math.max(-1, Math.min(1, c));
  return toDegree(Math.acos(c));
}

/**
 * Least-squares cubic with fixed ends (chord-length parameters); the fallback when the curve fitter
 * gives no single curve. `pts` has at least two points (the attach points).
 */
function leastSquaresCubic(pts: readonly Point[]): { c1: Point; c2: Point } {
  const p0 = pts[0] as Point;
  const p3 = pts[pts.length - 1] as Point;
  const total = strokeLength(pts);
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let r1x = 0;
  let r1y = 0;
  let r2x = 0;
  let r2y = 0;
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Point;
    if (i > 0) acc += getDistance(pts[i - 1] as Point, p);
    const t = total > 0 ? acc / total : 0;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    const rx = p.x - b0 * p0.x - b3 * p3.x;
    const ry = p.y - b0 * p0.y - b3 * p3.y;
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    r1x += b1 * rx;
    r1y += b1 * ry;
    r2x += b2 * rx;
    r2y += b2 * ry;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) > 1e-9) {
    return {
      c1: new Point((a22 * r1x - a12 * r2x) / det, (a22 * r1y - a12 * r2y) / det),
      c2: new Point((a11 * r2x - a12 * r1x) / det, (a11 * r2y - a12 * r1y) / det),
    };
  }
  // too few points: along the end tangents, a third of the length out
  const d1 = pts.length > 1 ? sub(pts[1] as Point, p0) : new Point(1, 0);
  const d2 = pts.length > 1 ? sub(pts[pts.length - 2] as Point, p3) : new Point(-1, 0);
  const l1 = Math.max(length(d1), 1e-9);
  const l2 = Math.max(length(d2), 1e-9);
  return {
    c1: new Point(p0.x + (d1.x / l1) * (total / 3), p0.y + (d1.y / l1) * (total / 3)),
    c2: new Point(p3.x + (d2.x / l2) * (total / 3), p3.y + (d2.y / l2) * (total / 3)),
  };
}

function newResult(): SelfLoopResult {
  return {
    failed: SelfLoopRule.None,
    kind: SelfLoopKind.Curve,
    detail: { obj1: null, obj2: null, params: [], type: 0, autoType: 0, val: 0 },
    from: new Point(),
    to: new Point(),
    excursion: 0,
    corners: 0,
  };
}

export class SelfLoopRecognizer {
  private readonly config: RecognizerConfig;
  // Per-evaluate state, as the C++ members.
  private canvas: CanvasDelegate | null = null;
  private shape: ObjectId | null = null;
  private centre = new Point();
  private zoom = 1;

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  /**
   * `stroke` is the raw (pre-processed) stroke, `path` the recognizer's path for it (its components
   * give the corners and whether the stroke is a polyline); both in view px. Adds the connector
   * through `addConnection` when the stroke is a loop.
   */
  recognize(
    stroke: readonly Point[],
    path: SimplePath | null,
    excluded: ReadonlySet<ObjectId>,
    canvas: CanvasDelegate,
  ): boolean {
    const result = this.evaluate(stroke, path, excluded, canvas);
    if (result.failed !== SelfLoopRule.None) return false;
    canvas.addConnection(result.detail, excluded);
    return true;
  }

  /** The rules and the fit, without adding anything. */
  evaluate(
    stroke: readonly Point[],
    path: SimplePath | null,
    excluded: ReadonlySet<ObjectId>,
    canvas: CanvasDelegate,
  ): SelfLoopResult {
    const cfg = this.config;
    const result = newResult();
    this.canvas = canvas;
    this.zoom = canvas.getZoom();
    if (!(this.zoom > 0)) this.zoom = 1;

    // R1: both ends on the same connectable shape
    result.failed = SelfLoopRule.R1;
    const first = stroke[0];
    const last = stroke[stroke.length - 1];
    if (stroke.length < 2 || first === undefined || last === undefined) return result;
    const shape = canvas.getShapeForSelfLoop(first, last);
    this.shape = shape;
    if (shape === null || excluded.has(shape)) return result;
    this.centre = canvas.shapeCentre(shape);

    // R2: both ends on (near) the outline
    result.failed = SelfLoopRule.R2;
    const onEdge = cfg.connectObjectDistThreshold;
    if (canvas.distanceToOutline(shape, first) > onEdge || canvas.distanceToOutline(shape, last) > onEdge) {
      return result;
    }

    // The attach points: the stroke clipped at the outline, else the nearest outline points of its ends.
    const n = stroke.length;
    const reversed = [...stroke].reverse();
    const start = this.clipStart(stroke);
    const end = this.clipStart(reversed);
    result.from = start.at;
    result.to = end.at;
    const firstOut = start.firstOutside;
    const lastOutRev = end.firstOutside;
    const lastOut = n - 1 - Math.min(lastOutRev, n - 1);
    const trimmed: Point[] = [result.from];
    if (firstOut < n && lastOutRev < n && firstOut <= lastOut) trimmed.push(...stroke.slice(firstOut, lastOut + 1));
    trimmed.push(result.to);

    // R3: mostly outside the shape
    result.failed = SelfLoopRule.R3;
    let total = 0;
    let outside = 0;
    for (let i = 1; i < n; i++) {
      const a = stroke[i - 1] as Point;
      const b = stroke[i] as Point;
      const d = getDistance(a, b);
      const mid = new Point((a.x + b.x) / 2, (a.y + b.y) / 2);
      total += d;
      if (!canvas.isInsideShape(shape, mid)) outside += d;
    }
    if (total <= 0 || outside / total < cfg.selfLoopMinOutsideFraction) return result;

    // R4: a real excursion, neither a flick nor a sweep, and long enough
    result.failed = SelfLoopRule.R4;
    let peak = 0;
    for (const p of stroke) {
      if (!canvas.isInsideShape(shape, p)) peak = Math.max(peak, canvas.distanceToOutline(shape, p));
    }
    result.excursion = peak;
    const bounds = canvas.shapeBounds(shape);
    const lo = Math.max(
      cfg.selfLoopMinExcursion,
      cfg.selfLoopMinExcursionRatio * Math.min(bounds.width, bounds.height),
    );
    const hi = cfg.selfLoopMaxExcursionRatio * Math.max(bounds.width, bounds.height);
    if (peak < lo || peak > hi || total < cfg.selfLoopMinStrokeLength) return result;

    // R5: the ends far enough apart
    result.failed = SelfLoopRule.R5;
    if (getDistance(result.from, result.to) < cfg.selfLoopMinEndDistance) return result;

    // R6: not a lasso — the stroke closed by its chord must not enclose the whole shape. The test
    // points are the corners of S's selection rectangle: a lasso round S contains all four; a loop
    // round one side, an adjacent pair or the opposite side leaves at least one out. No threshold.
    result.failed = SelfLoopRule.R6;
    if (bounds.getPoints().every((corner) => isPointInsidePolygon(trimmed, corner))) return result;

    // R7: few corners, none sharp
    result.failed = SelfLoopRule.R7;
    const corners = path !== null ? this.findCorners(path) : [];
    result.corners = corners.length;
    if (corners.length > cfg.selfLoopMaxCorners) return result;
    for (const c of corners) {
      if (c.angle < cfg.selfLoopMinCornerAngle) return result;
    }

    // R8: not across a neighbour, not through the shape's title
    result.failed = SelfLoopRule.R8;
    for (const p of stroke) {
      if (canvas.isInsideTitle(shape, p) || canvas.isInsideOtherObject(shape, p)) return result;
    }

    result.failed = SelfLoopRule.None;
    result.detail.obj1 = shape;
    result.detail.obj2 = shape;
    result.detail.autoType = 0;
    result.detail.val = 0;
    if (path !== null && this.fitOrthogonal(path, corners, result)) {
      result.kind = SelfLoopKind.Orthogonal;
    } else {
      result.kind = SelfLoopKind.Curve;
      this.fitCurve(trimmed, result);
    }
    return result;
  }

  private findCorners(path: SimplePath): Corner[] {
    // Two pieces each within the axis tolerance of the same axis are one straight run; a sharper
    // turn between consecutive components is a corner.
    const corners: Corner[] = [];
    const straight = 2 * this.config.selfLoopAxisTolerance;
    for (let i = 1; i < path.size; i++) {
      const turn = turnBetween(endDir(path.at(i - 1)), startDir(path.at(i)));
      if (turn > straight) corners.push({ at: path.at(i).firstPoint(), angle: 180 - turn, component: i });
    }
    return corners;
  }

  /** C++ `clipStart(pts, &firstOutside)`; `pts` is never empty here (R1 checked two points). */
  private clipStart(pts: readonly Point[]): { at: Point; firstOutside: number } {
    const canvas = this.canvasOrThrow();
    const shape = this.shape as ObjectId;
    const p0 = pts[0] as Point;
    if (!canvas.isInsideShape(shape, p0)) return { at: canvas.projectToOutline(shape, p0), firstOutside: 0 };
    for (let k = 1; k < pts.length; k++) {
      const pk = pts[k] as Point;
      if (!canvas.isInsideShape(shape, pk)) return { at: this.crossing(pts[k - 1] as Point, pk), firstOutside: k };
    }
    return { at: canvas.projectToOutline(shape, p0), firstOutside: pts.length };
  }

  private crossing(inside: Point, outside: Point): Point {
    const canvas = this.canvasOrThrow();
    const shape = this.shape as ObjectId;
    let inp = inside;
    let out = outside;
    for (let i = 0; i < 20; i++) {
      const mid = new Point((inp.x + out.x) / 2, (inp.y + out.y) / 2);
      if (canvas.isInsideShape(shape, mid)) inp = mid;
      else out = mid;
    }
    return new Point((inp.x + out.x) / 2, (inp.y + out.y) / 2);
  }

  private outwardNormal(at: Point): number {
    // The outline's normal at `at`, on the side away from the centre (as the connection engine
    // orients it): from the nearest outline point of a point just off the outline, radially.
    const canvas = this.canvasOrThrow();
    const radial = sub(at, this.centre);
    const rl = length(radial);
    if (rl < 1e-9) return 0;
    const u = new Point(radial.x / rl, radial.y / rl);
    const off = 6;
    const probe = new Point(at.x + u.x * off, at.y + u.y * off);
    const onOutline = canvas.projectToOutline(this.shape as ObjectId, probe);
    let nrm = sub(probe, onOutline);
    if (length(nrm) < 1e-6) return Math.atan2(u.y, u.x);
    if (nrm.x * radial.x + nrm.y * radial.y < 0) nrm = new Point(-nrm.x, -nrm.y);
    return Math.atan2(nrm.y, nrm.x);
  }

  private fitOrthogonal(path: SimplePath, corners: readonly Corner[], result: SelfLoopResult): boolean {
    if (path.curveCount() > 0 || path.size === 0) return false;
    if (corners.length < 2 || corners.length > 4) return false;
    // near-right corners: between selfLoopMinCornerAngle and its supplement (60-120 by default)
    const minCorner = this.config.selfLoopMinCornerAngle;
    for (const c of corners) {
      if (c.angle < minCorner || c.angle > 180 - minCorner) return false;
    }
    const vertices: Point[] = [result.from, ...corners.map((c) => c.at), result.to];
    const tolerance = this.config.selfLoopAxisTolerance;
    const params: Params = [];
    let lastHorizontal = -1;
    for (let i = 1; i < vertices.length; i++) {
      const d = sub(vertices[i] as Point, vertices[i - 1] as Point);
      if (length(d) < 1e-6) return false;
      const fromX = toDegree(Math.atan2(Math.abs(d.y), Math.abs(d.x)));
      const offAxis = Math.min(fromX, 90 - fromX);
      if (offAxis > tolerance) return false;
      const horizontal = Math.abs(d.x) >= Math.abs(d.y) ? 1 : 0;
      if (horizontal === lastHorizontal) return false;
      lastHorizontal = horizontal;
      const pm: ParamMap = {};
      if (horizontal === 1) {
        pm.step = Math.abs(d.x) / this.zoom;
        pm.dx = d.x < 0 ? -1 : 1;
        pm.dy = 0;
      } else {
        pm.step = Math.abs(d.y) / this.zoom;
        pm.dx = 0;
        pm.dy = d.y < 0 ? -1 : 1;
      }
      params.push(pm);
    }
    // vertices has at least four points (two corners), so params is not empty.
    const front = params[0] as ParamMap;
    const back = params[params.length - 1] as ParamMap;
    front.autotype = 0;
    front.angle = Math.atan2(result.from.y - this.centre.y, result.from.x - this.centre.x);
    back.angle = Math.atan2(result.to.y - this.centre.y, result.to.x - this.centre.x);
    result.detail.type = 2; // MultiLine
    result.detail.autoType = 0;
    result.detail.params = params;
    return true;
  }

  private fitCurve(trimmed: readonly Point[], result: SelfLoopResult): void {
    const p0 = trimmed[0] as Point;
    const p3 = trimmed[trimmed.length - 1] as Point;
    let c1 = new Point();
    let c2 = new Point();
    let fitted = false;

    // the recognizer's curve fitting (as BasicShapeRecognizer::makeCurve)
    if (trimmed.length >= 8) {
      const curves = CurveFitter.fitSingle(trimmed, 70);
      const bz = curves[0];
      if (curves.length === 1 && bz !== undefined && bz.numPoints === 4) {
        c1 = bz.point2;
        c2 = bz.point3;
        fitted =
          Number.isFinite(c1.x) &&
          Number.isFinite(c1.y) &&
          Number.isFinite(c2.x) &&
          Number.isFinite(c2.y) &&
          getDistance(p0, c1) > 1e-3 &&
          getDistance(p3, c2) > 1e-3;
      }
    }
    if (!fitted) ({ c1, c2 } = leastSquaresCubic(trimmed));

    const endParams = (at: Point, control: Point): ParamMap => {
      const v = sub(control, at);
      return {
        angle1: Math.atan2(at.y - this.centre.y, at.x - this.centre.x),
        angle2: normalizeAngleInPI(Math.atan2(v.y, v.x) - this.outwardNormal(at)),
        cdist1: length(v) / this.zoom,
        angleauto: 0,
        cdistauto: 0,
      };
    };
    result.detail.params = [endParams(p0, c1), endParams(p3, c2)];
    result.detail.type = 0; // Curve
    result.detail.autoType = 0;
  }

  private canvasOrThrow(): CanvasDelegate {
    if (this.canvas === null) throw new Error('SelfLoopRecognizer: no canvas outside evaluate');
    return this.canvas;
  }
}
