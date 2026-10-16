// A self-drawn cubic Bézier curve (port of C++ `BezierCurveTemplate`, `L/ShapeTemplate.cpp:1630-1820`):
// its data are the four control points as fractions of the box; draw `M 0 1 C 2 3 4 5 6 7`.
import { formatG6 } from '../../base';
import { BezierCurve, Point, PointType, getPointsBound, type Rect } from '../../geometry';
import type { DrawingPlatform } from '../../render';
import type { Style } from '../../style';
import type { DataStore } from '../expr/data-store';
import type { TemplateEnv } from '../env';
import { BezierCurveShape } from './primitive-shape';
import { ShapeTemplate, type InterestingPoint } from './shape-template';

export const CURVE_TEMPLATE_ID = 'avabodh.basic.curve';
const CURVE_DRAW = 'M 0 1 C 2 3 4 5 6 7';

export class BezierCurveTemplate extends ShapeTemplate {
  /** Without `bz`, an empty curve (the codec fills it); with it, C++ `BezierCurveTemplate(bz[, bound])`: data from the curve, loaded. */
  constructor(env: TemplateEnv, bz?: BezierCurve, bound?: Rect) {
    super(env);
    this.templateId = CURVE_TEMPLATE_ID;
    if (bz !== undefined) {
      if (bound !== undefined) this.setTemplatePointsIn(bz, bound);
      else this.setTemplatePoints(bz);
      this.replacePath(CURVE_DRAW);
      this.usePrimitiveForDistance = true;
      this.usePrimitiveForInsideCheck = true;
      this.usePrimitiveForIntersection = true;
      this.load();
    }
  }

  override clone(): BezierCurveTemplate {
    const tmpl = new BezierCurveTemplate(this.env_);
    this.copy(tmpl);
    return tmpl;
  }

  private curveShape(): BezierCurveShape | null {
    const sp = this.paths_[0]?.shapes()[1];
    return sp instanceof BezierCurveShape ? sp : null;
  }

  private setTemplatePoints(bz: BezierCurve): void {
    this.setTemplatePointsIn(bz, getPointsBound(bz.clone().render([]).points));
  }

  private setTemplatePointsIn(bz: BezierCurve, bound: Rect): void {
    const center = bound.center();
    for (const pt of [bz.point1, bz.point2, bz.point3, bz.point4]) {
      this.dataExpStrs.push(
        `${formatG6((pt.x - center.x) / bound.width)}*w`,
        `${formatG6((pt.y - center.y) / bound.height)}*h`,
      );
    }
  }

  override generateData(ds: DataStore): void {
    super.generateData(ds);
    this.paths_[0]?.updatePoints(ds);
  }

  override getInterestingPoints(ds: DataStore, out: InterestingPoint[]): void {
    const v = this.vertices(ds);
    const p = (i: number) => v[i] ?? new Point();
    out.push(
      { point: p(0), type: PointType.Vertex },
      { point: p(1), type: PointType.Control },
      { point: p(2), type: PointType.Control },
      { point: p(3), type: PointType.Vertex },
    );
  }

  /** The control polygon's two arms, in the selection style. */
  override drawExtraWhenSelected(dp: DrawingPlatform, _ds: DataStore, selectionStyle: Style): void {
    const sp = this.curveShape();
    if (sp === null) return;
    const bz = sp.curve();
    dp.startDrawing(bz.point1, selectionStyle);
    dp.addLineTo(bz.point2);
    dp.moveTo(bz.point3);
    dp.addLineTo(bz.point4);
    dp.endDrawing();
  }

  override afterVertexEditing(ds: DataStore): void {
    this.resetAngle(ds);
  }

  override moveVertexTo(vid: number, pt: Point, ds: DataStore): Point {
    if (ds.angle() !== 0) this.resetAngle(ds);
    const sp = this.curveShape();
    if (sp === null) return pt;
    sp.computePoints(ds);
    const bz = sp.curve().clone();
    const pts = bz.getPoints();
    pts[vid] = pt;
    bz.setPoints(pts);
    const bound = ds.rect();
    this.dataExpStrs = [];
    this.setTemplatePointsIn(bz, bound);
    this.load();
    this.generateData(ds);
    return pt;
  }

  private resetAngle(ds: DataStore): void {
    const sp = this.curveShape();
    if (sp === null) return;
    sp.computePoints(ds);
    const bz = sp.curve().clone();
    const bound = getPointsBound(bz.clone().render([]).points);
    ds.setAngle(0);
    ds.setRect(bound);
    this.dataExpStrs = [];
    this.setTemplatePoints(bz);
    this.load();
    this.generateData(ds);
  }

  override computeArrowPoints(ds: DataStore): void {
    ds.arrowLocations = [];
    const pts = this.vertices(ds);
    const p0 = pts[0];
    const p1 = pts[1];
    const pl = pts.at(-1);
    const pl2 = pts.at(-2);
    if (pts.length > 1 && p0 !== undefined && p1 !== undefined && pl !== undefined && pl2 !== undefined) {
      ds.arrowLocations.push([p0, p1], [pl, pl2]);
    }
  }

  override canFlip(): boolean {
    return true;
  }

  /** 1: mirror left-right; 2: top-bottom. */
  override flip(type: number, ds: DataStore): void {
    const sp = this.curveShape();
    if (sp === null) return;
    sp.computePoints(ds);
    const bz = sp.curve().clone();
    const bound = getPointsBound(bz.clone().render([]).points);
    const c = bound.center();
    const pts = bz.getPoints();
    const flipped =
      type === 1
        ? pts.map((p) => p.withX(c.x + (c.x - p.x)))
        : type === 2
          ? pts.map((p) => p.withY(c.y + (c.y - p.y)))
          : pts;
    const out = new BezierCurve(flipped[0], flipped[1], flipped[2], flipped[3], bz.numPoints);
    ds.setAngle(0);
    ds.setRect(bound);
    this.dataExpStrs = [];
    this.setTemplatePoints(out);
    this.load();
    this.generateData(ds);
  }
}
