// A self-drawn polygon or polyline (port of C++ `PolygonTemplate`, `L/ShapeTemplate.cpp:1164-1581`):
// its data are the vertices as fractions of the box, its first path joins them, and every vertex
// is editable.
import { formatG6 } from '../../base';
import {
  FitLine,
  Point,
  PointType,
  Quadrilateral,
  Rect,
  angleWithHorizontal,
  getDistance,
  getMidPoint,
  getPointsBound,
  rotateAboutMid,
} from '../../geometry';
import { Style } from '../../style';
import type { DataStore } from '../expr/data-store';
import type { TemplateEnv } from '../env';
import { ShapePathElement, TextSide, type ShapeTextElement } from './shape-element';
import { ShapeTemplate, type InterestingPoint } from './shape-template';
import { TextInfo } from './template-data';

export const POLYGON_TEMPLATE_ID = 'avabodh.basic.polygon';

function defaultTextInfo(): TextInfo {
  const ti = new TextInfo();
  ti.location = 'default';
  ti.style = new Style();
  return ti;
}

/** C++ `getLineShapeBound`: a line's box (height 1) and angle; the vertices laid flat along it. */
function lineShapeBound(vertices: Point[]): { bound: Rect; angle: number } {
  const v0 = vertices[0] ?? new Point();
  const v1 = vertices[1] ?? new Point();
  const width = getDistance(v0, v1);
  const height = 1;
  const mid = getMidPoint(vertices);
  const bound = new Rect(mid.x - width / 2, mid.y - height / 2, width, height);
  const angle = angleWithHorizontal(v0, v1);
  vertices[0] = new Point(bound.x, mid.y);
  vertices[1] = new Point(bound.x + bound.width, mid.y);
  return { bound, angle };
}

export class PolygonTemplate extends ShapeTemplate {
  private savedTextShapes_: ShapeTextElement[] = [];
  private savedTextData_: TextInfo[] = [];
  private isRectangle_ = false;

  /** A polygon with no vertices yet (the codec fills it). */
  constructor(env: TemplateEnv);
  /** C++ `PolygonTemplate(vertices, isClosed)`: text at the centroid. */
  constructor(env: TemplateEnv, vertices: readonly Point[], isClosed: boolean);
  constructor(env: TemplateEnv, vertices?: readonly Point[], isClosed = false) {
    super(env);
    this.templateId = POLYGON_TEMPLATE_ID;
    this.rounded = false;
    if (vertices !== undefined) {
      this.textInCentroid = true;
      this.closed = isClosed;
      this.setTemplate(vertices, isClosed);
    }
  }

  /**
   * C++ `getPolygonTemplate`: a polygon through `pts`, regularised first when asked and enabled
   * (`regulaizeShape`). Returns the template, its box and its angle.
   */
  static getPolygonTemplate(
    env: TemplateEnv,
    pts: readonly Point[],
    isClosed: boolean,
    regularize: boolean,
  ): { template: PolygonTemplate; bound: Rect; angle: number } {
    let angle = 0;
    let vertices = pts.slice();
    let isRect = false;
    if (env.config.regulaizeShape && regularize) {
      const r = PolygonTemplate.regularize(vertices, isClosed, env.config);
      vertices = r.vertices;
      angle = r.angle;
      isRect = r.isRect;
    }
    let bound: Rect;
    if (pts.length === 2) {
      // Special handling for a line.
      const lb = lineShapeBound(vertices);
      bound = lb.bound;
      angle = lb.angle;
    } else {
      bound = getPointsBound(vertices);
    }
    const tmpl = new PolygonTemplate(env, vertices, isClosed);
    tmpl.isRectangle_ = isRect;
    return { template: tmpl, bound, angle };
  }

  /** C++ `regualize`: snaps a quad, a two-segment polyline or a line (polishing level 2). */
  static regularize(
    input: readonly Point[],
    isClosed: boolean,
    config: TemplateEnv['config'],
  ): { vertices: Point[]; angle: number; isRect: boolean } {
    const vertices = input.slice();
    let angle = 0;
    let isRect = false;
    const polishingLevel = 2;
    const [a, b, c, d] = vertices;
    if (vertices.length === 4 && a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
      const qd = new Quadrilateral(a, b, c, d);
      qd.regularize(config);
      let q = qd.points();
      isRect = qd.isRectangle();
      if (qd.angle() !== 0) {
        q = rotateAboutMid(q, -qd.angle());
        angle = qd.angle();
      }
      vertices.splice(0, 4, ...q);
    }
    if (vertices.length === 3 && !isClosed) {
      const line1 = new FitLine(vertices[0] ?? new Point(), vertices[1] ?? new Point(), polishingLevel);
      const line2 = new FitLine(vertices[1] ?? new Point(), vertices[2] ?? new Point(), polishingLevel);
      line1.regularize();
      line2.regularize();
      const dx = line2.startPoint.x - line1.endPoint.x;
      const dy = line2.startPoint.y - line1.endPoint.y;
      vertices[0] = line1.startPoint;
      vertices[1] = line1.endPoint;
      vertices[2] = new Point(line2.endPoint.x - dx, line2.endPoint.y - dy);
    }
    if (vertices.length === 2) {
      const line = new FitLine(vertices[0] ?? new Point(), vertices[1] ?? new Point(), polishingLevel);
      line.regularize();
      vertices[0] = line.startPoint;
      vertices[1] = line.endPoint;
    }
    return { vertices, angle, isRect };
  }

  override clone(): PolygonTemplate {
    const tmpl = new PolygonTemplate(this.env_);
    this.copy(tmpl);
    tmpl.closed = this.closed;
    tmpl.textInCentroid = this.textInCentroid;
    tmpl.rounded = this.rounded;
    return tmpl;
  }

  isClosed(): boolean {
    return this.closed;
  }
  isRounded(): boolean {
    return this.rounded;
  }
  /** C++ `isRecatngle` (typo fixed in the name only). */
  isRectangle(): boolean {
    return this.isRectangle_;
  }

  /** One path of exactly one line command (after its moves). */
  isLine(): boolean {
    const path = this.paths_[0];
    if (this.paths_.length !== 1 || path === undefined) return false;
    let lineCount = 0;
    for (const se of path.shapes()) {
      if (se.command === 'M') continue;
      if ('VHLZ'.includes(se.command)) lineCount++;
      else return false;
      if (lineCount > 1) break;
    }
    return lineCount === 1;
  }

  override load(): void {
    if (this.textData.length === 0) this.textData.push(defaultTextInfo());
    super.load();
    if (this.rounded) {
      this.usePrimitiveForInsideCheck = false;
      this.usePrimitiveForIntersection = false;
      this.usePrimitiveForDistance = false;
    } else {
      const first = this.pathData[0];
      if (first !== undefined && this.boundPath_ === null) {
        const bp = new ShapePathElement();
        bp.parse(first.drawCmds);
        bp.onLoad();
        this.boundPath_ = bp;
      }
      this.usePrimitiveForInsideCheck = true;
      this.usePrimitiveForIntersection = true;
      this.usePrimitiveForDistance = true;
    }
  }

  override computeArrowPoints(ds: DataStore): void {
    ds.arrowLocations = [];
    if (this.isClosed()) return;
    const pts = this.vertices(ds);
    const p0 = pts[0];
    const p1 = pts[1];
    const pl = pts.at(-1);
    const pl2 = pts.at(-2);
    if (pts.length > 1 && p0 !== undefined && p1 !== undefined && pl !== undefined && pl2 !== undefined) {
      ds.arrowLocations.push([p0, p1], [pl, pl2]);
    }
  }

  override generateData(ds: DataStore): void {
    super.generateData(ds);
    if (this.textInCentroid) {
      const ctr = getMidPoint(this.vertices(ds));
      const t0 = this.texts_[0];
      if (t0 !== undefined && t0.external() === TextSide.None) t0.setTextCenter(ctr);
    }
  }

  override getInterestingPoints(ds: DataStore, out: InterestingPoint[]): void {
    this.editableVerticesPts_ = [];
    if (!this.rounded) {
      const vpts = this.vertices(ds);
      vpts.forEach((p, i) => {
        out.push({ point: p, type: PointType.Vertex });
        this.editableVerticesPts_.push(2 * i, 2 * i + 1);
      });
    }
    if (this.isClosed()) out.push({ point: new Point(ds.cx(), ds.cy()), type: PointType.Center });
  }

  override afterRotation(): void {
    /* C++: empty */
  }

  override afterVertexEditing(ds: DataStore): void {
    let vpts = this.vertices(ds);
    let bound = getPointsBound(vpts);
    if (bound.width < 1) bound = new Rect(bound.x, bound.y, 1, bound.height);
    if (bound.height < 1) bound = new Rect(bound.x, bound.y, bound.width, 1);
    const c = bound.center();
    vpts.forEach((pt, i) => {
      this.moveEditableVertex(i, (pt.x - c.x) / bound.width, (pt.y - c.y) / bound.height);
    });
    let angle = 0;
    if (vpts.length === 2) {
      vpts = this.vertices(ds);
      const lb = lineShapeBound(vpts);
      bound = lb.bound;
      angle = lb.angle;
      this.setTemplate(vpts, this.closed);
    }
    ds.setAngle(angle);
    ds.setRect(bound);
    this.generateData(ds);
  }

  /** Rebuilds data and path from `vertices` (C++ `setTemplate`), keeping the texts. */
  setTemplate(vertices: readonly Point[], isClosed: boolean): void {
    this.dataExpStrs = [];
    const b = getPointsBound(vertices);
    const center = b.center();
    const w = b.width < 1 ? 1 : b.width;
    const h = b.height < 1 ? 1 : b.height;
    let path = 'M ';
    vertices.forEach((v, i) => {
      this.dataExpStrs.push(`${formatG6((v.x - center.x) / w)}*w`, `${formatG6((v.y - center.y) / h)}*h`);
      if (i !== 0) path += ' L ';
      path += ` ${String(2 * i)} ${String(2 * i + 1)}`;
    });
    if (isClosed) path += ' L 0 1';
    this.replacePath(path);
    if (this.textData.length === 0) this.textData.push(defaultTextInfo());
    this.usePrimitiveForDistance = false;
    this.usePrimitiveForIntersection = false;
    this.usePrimitiveForInsideCheck = false;
    this.saveTextData();
    this.load();
    this.restoreTextData();
  }

  /** A rectangle (C++ `makeRect`): rounded uses one `R`, sharp a closed four-point path. */
  makeRect(rounded: boolean): void {
    this.rounded = rounded;
    if (rounded) {
      this.dataExpStrs = ['0', '0', 'w', 'h', '0'];
      this.replacePath('R 0 1 2 3 4 4 4');
    } else {
      this.dataExpStrs = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
      this.replacePath('M 0 1 L 2 3 L 4 5 L 6 7 L 0 1');
    }
    this.boundPathStr = '';
    this.saveTextData();
    this.load();
    this.restoreTextData();
  }

  override canFlip(): boolean {
    return !this.rounded;
  }

  /** 1: mirror left-right; 2: top-bottom. */
  override flip(type: number, ds: DataStore): void {
    let vpts = this.vertices(ds);
    const center = getMidPoint(vpts);
    if (type === 1) vpts = vpts.map((p) => p.withX(center.x + (center.x - p.x)));
    else if (type === 2) vpts = vpts.map((p) => p.withY(center.y + (center.y - p.y)));
    let rect: Rect;
    let angle = 0;
    if (vpts.length === 2) {
      // Special handling for a line.
      const lb = lineShapeBound(vpts);
      rect = lb.bound;
      angle = lb.angle;
    } else {
      rect = getPointsBound(vpts);
    }
    this.setTemplate(vpts, this.closed);
    ds.setAngle(angle);
    ds.setRect(rect);
    this.generateData(ds);
  }

  private saveTextData(): void {
    if (this.textData.length === this.texts_.length) {
      this.savedTextShapes_ = this.texts_;
      this.savedTextData_ = this.textData;
      this.texts_ = [];
      this.textData = [];
    } else {
      this.savedTextData_ = [];
      this.savedTextShapes_ = [];
    }
  }

  private restoreTextData(): void {
    if (this.savedTextData_.length > 0) {
      this.textData = this.savedTextData_;
      this.texts_ = this.savedTextShapes_;
      // load() ran without the texts, so without the title's layout.
      this.loadTitleLayout();
    }
    this.savedTextData_ = [];
    this.savedTextShapes_ = [];
    this.initGroupStyle();
  }
}
