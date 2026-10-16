// A self-drawn free path of lines and cubics (port of C++ `PathTemplate`, `L/ShapeTemplate.cpp:1824-2097`).
import { formatG6 } from '../../base';
import { LineSegment, PathComponent, PointType, Rect, SimplePath, getPointsBound, type Point } from '../../geometry';
import { Style } from '../../style';
import type { DataStore } from '../expr/data-store';
import type { TemplateEnv } from '../env';
import { BezierCurveShape, LineShape, MoveToCommand } from './primitive-shape';
import { ShapeTemplate, type InterestingPoint } from './shape-template';
import { PathInfo } from './template-data';

export const PATH_TEMPLATE_ID = 'avabodh.basic.path';

/** A point's data pair relative to `rect` (C++ lambda `ds`): `fx*w`, `fy*h`, or "0" on a flat side. */
function dataPair(pt: Point, rect: Rect): [string, string] {
  const c = rect.center();
  const x = rect.width > 0 ? `${formatG6((pt.x - c.x) / rect.width)}*w` : '0';
  const y = rect.height > 0 ? `${formatG6((pt.y - c.y) / rect.height)}*h` : '0';
  return [x, y];
}

export class PathTemplate extends ShapeTemplate {
  constructor(env: TemplateEnv) {
    super(env);
    this.templateId = PATH_TEMPLATE_ID;
    this.usePrimitiveForDistance = true;
    this.usePrimitiveForIntersection = true;
    this.usePrimitiveForInsideCheck = true;
  }

  /** C++ `PathTemplate::from`: the template and the path's bounds. */
  static from(env: TemplateEnv, parts: SimplePath): { template: PathTemplate; bound: Rect } {
    const tmpl = new PathTemplate(env);
    const bound = tmpl.setFrom(parts);
    tmpl.closed = parts.closed();
    return { template: tmpl, bound };
  }

  override clone(): PathTemplate {
    const tmpl = new PathTemplate(this.env_);
    this.copy(tmpl);
    return tmpl;
  }

  closedPath(): boolean {
    return this.closed;
  }

  override generateData(ds: DataStore): void {
    super.generateData(ds);
    for (const p of this.paths_) p.updatePoints(ds);
  }

  override getInterestingPoints(ds: DataStore, out: InterestingPoint[]): void {
    const parts = this.getPathParts(ds);
    parts.components.forEach((pc, i) => {
      if (i === 0) {
        out.push({ point: pc.isCurve ? pc.curve.point1 : pc.segment.point1(), type: PointType.Vertex });
      }
      if (pc.isCurve) {
        out.push({ point: pc.curve.getSingleControl(), type: PointType.Control });
        out.push({ point: pc.curve.point4, type: PointType.Vertex });
      } else {
        out.push({ point: pc.segment.point2(), type: PointType.Vertex });
      }
    });
  }

  override drawExtraWhenSelected(): void {
    /* C++: empty */
  }

  /** Moves vertex `vid` (0: the start; then per part a control and an end, or an end). Reloads; does not regenerate (as C++). */
  override moveVertexTo(vid: number, to: Point, ds: DataStore): Point {
    const parts = this.getPathParts(ds);
    if (parts.size === 0) return to;
    if (vid === 0) {
      parts.at(0).setFirstPoint(to);
    } else {
      let pid = 1;
      for (const pc of parts.components) {
        if (pc.isCurve) {
          if (vid === pid) {
            pc.curve.moveSingleControlPoint(to);
            break;
          } else if (vid === pid + 1) {
            pc.curve.point4 = to;
            break;
          }
          pid += 2;
        } else {
          if (vid === pid) {
            pc.segment = pc.segment.withPoint2(to);
            break;
          }
          pid++;
        }
      }
    }
    const bound = this.setFrom(parts);
    ds.setRect(bound);
    ds.setAngle(0);
    this.load();
    return to;
  }

  override computeArrowPoints(ds: DataStore): void {
    const parts = this.getPathParts(ds);
    if (parts.size === 0) return;
    ds.arrowLocations = [];
    const first = parts.front();
    ds.arrowLocations.push(
      first.isCurve ? [first.curve.point1, first.curve.point2] : [first.segment.point1(), first.segment.point2()],
    );
    const last = parts.back();
    ds.arrowLocations.push(
      last.isCurve ? [last.curve.point4, last.curve.point3] : [last.segment.point2(), last.segment.point1()],
    );
  }

  /** Rebuilds data and draw from `pps` (C++ `setFrom`); returns the bounds of the parts. */
  setFrom(pps: SimplePath): Rect {
    this.pathData = [];
    if (pps.size === 0) return new Rect();
    let bound = new Rect();
    pps.components.forEach((pp, i) => {
      const rect = pp.isCurve
        ? getPointsBound(pp.curve.clone().render([]).points)
        : new Rect(pp.segment.p1.x, pp.segment.p1.y, 0, 0).include(pp.segment.p2);
      bound = i === 0 ? rect : bound.includeRect(rect);
    });

    let did = 0;
    const data: string[] = [];
    const front = pps.front();
    const first = front.isCurve ? front.curve.point1 : front.segment.point1();
    data.push(...dataPair(first, bound));
    let draw = `M ${String(did)} ${String(did + 1)}`;
    did += 2;
    for (const pp of pps.components) {
      if (pp.isCurve) {
        data.push(
          ...dataPair(pp.curve.point2, bound),
          ...dataPair(pp.curve.point3, bound),
          ...dataPair(pp.curve.point4, bound),
        );
        draw += ` C ${[0, 1, 2, 3, 4, 5].map((k) => String(did + k)).join(' ')}`;
        did += 6;
      } else {
        data.push(...dataPair(pp.segment.point2(), bound));
        draw += ` L ${String(did)} ${String(did + 1)}`;
        did += 2;
      }
    }
    if (pps.closed()) draw += ' Z ';
    this.dataExpStrs = data;
    this.pathData.push(new PathInfo(draw, new Style()));
    return bound;
  }

  /** The path's parts as laid out now (C++ `getPathParts`): empty unless one path starting with M. */
  getPathParts(ds: DataStore): SimplePath {
    const parts = new SimplePath();
    if (this.paths_.length !== 1) return parts;
    const pe = this.paths_[0]?.shapes() ?? [];
    const mv = pe[0];
    if (!(mv instanceof MoveToCommand)) return parts;
    mv.computePoints(ds);
    let prev = mv.lastPoint();
    for (let i = 1; i < pe.length; i++) {
      const s = pe[i];
      if (s === undefined) continue;
      s.computePoints(ds);
      if (s instanceof LineShape) {
        const pt = s.lastPoint();
        parts.push(PathComponent.ofSegment(new LineSegment(prev, pt)));
        prev = pt;
      } else if (s instanceof BezierCurveShape) {
        const curve = s.curve().clone();
        parts.push(PathComponent.ofCurve(curve));
        prev = curve.point4;
      }
    }
    return parts;
  }
}
