// The one-stroke recognition pipeline (port of the live half of C++ `recognizer::Recognizer`,
// `Recognizer.cpp:68-152`; spec 07 §3.2 stages 3-14). Today's stage order is kept exactly; only
// the threading changes (the job runs in the worker against a scene snapshot).
//
// Not ported (multi-stroke only or debug): `debugMakePolyPath`, `debugAddUnrecognizedShape`,
// `addPolyPath`, `recognizeComplexShape`, `makePathFromLines`, the `enableMultiStroke` branch of
// `addPoints`, and the `ShapeMatcher` hand-off (commented out in C++). `strokes_` holds one stroke.
//
// Guards for C++ undefined behaviour (spec 07 §4.3): B2, a stroke with no lines or no path is
// added as plain ink of the pre-processed points (C++ reads `recognizedPath_[0]` of an empty
// vector); B3 is `recognizeStroke`'s (< 2 points).
import {
  GeoShape,
  GeoShapeType,
  hasLoop,
  isConvex,
  LineEquation,
  LineSegment,
  PathComponent,
  Point,
  preProcess,
  SimplePath,
} from '../../geometry';
import { Span } from '../../base';
import type { CanvasDelegate, ObjectId } from '../delegate/CanvasDelegate';
import { LineColl } from '../lines/LineColl';
import { at } from '../lines/RecognizerUtil';
import type { StrokeLine } from '../lines/StrokeLine';
import type { PathPart } from '../paths/Path';
import { PathAggregator } from '../paths/PathAggregator';
import { PathExtender } from '../paths/PathExtender';
import { PathProcessor } from '../paths/PathProcessor';
import type { CxPoly } from '../polys/CxPoly';
import { PolyColl } from '../polys/PolyColl';
import type { PolyEnv } from '../polys/PolyFeatures';
import { Regularizer } from '../regularizer/Regularizer';
import {
  BasicShapeRecognizer,
  recognitionConfigForConnection,
  recognitionConfigForPath,
  recognitionConfigRegular,
  type RecognitionConfig,
} from '../shapes/BasicShapeRecognizer';
import { PolyMatcher } from '../shapes/PolyMatcher';
import { ShapeNames, type RecShape } from '../shapes/RecShape';
import { ShapeAggregator } from '../shapes/ShapeAggregator';
import { ArrowRecognizer } from '../specialists/ArrowRecognizer';
import { ConnectionRecognizer } from '../specialists/ConnectionRecognizer';
import { SelfLoopRecognizer } from '../specialists/SelfLoopRecognizer';
import { DeferringCanvasDelegate } from './DeferringCanvasDelegate';
import { detectClosedShape } from './detectClosedShape';
import type { RecognizerContext } from './RecognizerContext';

/** Above this many lines the stroke is not recognised (C++ `proceed()`). */
export const MAX_RECOGNIZED_LINES = 25;

/** C++ `PI` in `recognizeStar` is `3.14159265` (`base/Const.h`); the port uses Math.PI (OQ-46). */
const PI = Math.PI;

/** C++ `recognizePath`'s copy of a recognised `Path`'s parts into a `SimplePath`. */
function toSimplePath(parts: readonly PathPart[]): SimplePath {
  const sp = new SimplePath();
  for (const pp of parts) sp.push(new PathComponent(pp.isCurve, pp.segment, pp.curve.clone()));
  return sp;
}

export class Recognizer {
  private readonly ctx: RecognizerContext;
  private readonly canvas: CanvasDelegate;
  private readonly env: PolyEnv;
  private readonly bsr = new BasicShapeRecognizer();
  private readonly lineColl: LineColl;
  private readonly polyColl: PolyColl;
  private readonly pathAggregator: PathAggregator;
  private readonly shapeAggregator: ShapeAggregator;

  /** The pre-processed stroke (C++ `strokes_[0]`); empty before `addPoints`. */
  private stroke: Point[] = [];
  private linePoints: Point[] = [];
  private recognizedPath: SimplePath[] = [];
  private recognizedShapes: GeoShape[] = [];
  private deletedObjects: ObjectId[] = [];
  private polyPointsUsedByMatcher: Point[] = [];
  private alternatePath = new SimplePath();
  private alternateDeletedObjects: ObjectId[] = [];
  private convex = false;
  private needRegularization = true;
  /** Snapshot of the shapes before regularisation, for the stage dump. */
  private unregularized: GeoShape[] = [];

  constructor(ctx: RecognizerContext, canvas: CanvasDelegate) {
    this.ctx = ctx;
    this.canvas = canvas;
    const bsr = this.bsr;
    this.env = {
      config: ctx.config,
      lineAggregator: ctx.lineAggregator,
      quirks: ctx.quirks,
      classifyBasicShape: (poly: CxPoly) => bsr.recognize(poly, recognitionConfigRegular),
    };
    this.lineColl = new LineColl(ctx.config);
    this.polyColl = new PolyColl(this.env);
    this.pathAggregator = new PathAggregator(ctx.config);
    this.shapeAggregator = new ShapeAggregator(ctx.config, ctx.quirks);
  }

  // ---- stage accessors (C++ `Recognizer.h:31-38`), read by the stage dump
  /** The pre-processed stroke. */
  strokePoints(): readonly Point[] {
    return this.stroke;
  }
  lines(): readonly StrokeLine[] {
    return this.lineColl.lines();
  }
  polys(): readonly CxPoly[] {
    return this.polyColl.polys();
  }
  /** C++ `closedPolys()`: `PathAggregator::closedPolys_` is never filled. */
  closedPolys(): readonly CxPoly[] {
    return [];
  }
  shapes(): readonly GeoShape[] {
    return this.recognizedShapes;
  }
  shapesBeforeRegularization(): readonly GeoShape[] {
    return this.unregularized;
  }
  paths(): readonly SimplePath[] {
    return this.recognizedPath;
  }
  deleted(): readonly ObjectId[] {
    return this.deletedObjects;
  }
  /** C++ `isConvex_`. */
  isConvex(): boolean {
    return this.convex;
  }
  /** C++ `needRegularization_` (false after the star). */
  regularizationNeeded(): boolean {
    return this.needRegularization;
  }
  /** C++ `polyPointsUsedByMatcher_`: the vertices the regularizer matches against. */
  matcherPoints(): readonly Point[] {
    return this.polyPointsUsedByMatcher;
  }

  /** C++ `addPoints`: pre-process the stroke and segment it into lines. */
  addPoints(points: readonly Point[]): void {
    this.stroke = preProcess(points);
    const agg = this.ctx.lineAggregator.create(this.ctx.config);
    agg.setPoints(new Span(this.stroke, 0, this.stroke.length - 1));
    agg.process();
    this.lineColl.addLines(agg.lines());
  }

  /** C++ `process()`: recognise, convert, regularise and place, then emit the mutations. */
  process(): void {
    if (this.recognize()) return;

    for (const path of this.recognizedPath) this.recognizedShapes.push(this.convertPath(path));
    this.unregularized = this.recognizedShapes.map(cloneShape);

    if (this.needRegularization) {
      for (const shape of this.recognizedShapes) {
        if (shape.type() !== GeoShapeType.Path) continue;
        new Regularizer(this.ctx.config).regularize(shape.path(), this.polyPointsUsedByMatcher, this.convex);
        if (this.canvas.placePath(shape.path())) shape.setSnap(false);
      }
    }

    if (this.deletedObjects.length > 0 && this.recognizedShapes.length === 1) {
      this.canvas.convert(this.deletedObjects, this.recognizedShapes[0] as GeoShape);
      return;
    }
    if (this.deletedObjects.length > 0) this.canvas.deleteShapes(this.deletedObjects);
    if (this.recognizedShapes.length > 0) this.canvas.addShapes(this.recognizedShapes);
  }

  /**
   * C++ `recognize()`. Returns true when the stroke went to plain ink (nothing else to emit);
   * the C++ `void` version emits the ink from here too.
   */
  private recognize(): boolean {
    this.recognizedPath = [];
    this.recognizedShapes = [];
    this.deletedObjects = [];
    this.polyPointsUsedByMatcher = [];
    this.alternatePath.reset();
    this.alternateDeletedObjects = [];
    this.needRegularization = true;

    if (!this.proceed() || this.lineColl.lines().length === 0) {
      // Too big a drawing for smart mode (C++), or no lines at all (B2): plain ink.
      this.canvas.addUnrecognizedShape(this.stroke);
      return true;
    }

    this.recognizePathInto();
    this.getPathFromLineColl(this.alternatePath);

    if (this.consumePath(null, false)) return false;

    if (this.detectClosedShape()) {
      this.recognizedPath = [];
      return false;
    }

    if (this.extendExistingPath()) {
      // AC-REC-15: a specialist that takes the extended path (only the double-line arrow can:
      // `ArrowRecognizer` gives up on single arrows there) still leaves the extended paths to be
      // deleted, as C++ does. C++ emitted the deletion after the specialist's mutation; here it
      // goes first, so a result is at most `delete` then one other mutation (same final board).
      const deferred = new DeferringCanvasDelegate(this.canvas);
      const consumed = this.consumePath(this.recognizedPath[0] as SimplePath, true, deferred);
      if (consumed && deferred.pending > 0 && this.deletedObjects.length > 0 && this.recognizedPath.length === 0) {
        this.canvas.deleteShapes(this.deletedObjects);
        this.deletedObjects = [];
      }
      deferred.flush();
      if (consumed) return false;
    }

    if (this.recognizedPath.length === 0) {
      // B2: no path to process (C++ reads recognizedPath_[0] of an empty vector).
      this.canvas.addUnrecognizedShape(this.stroke);
      return true;
    }
    this.processPath();
    return false;
  }

  private processPath(): void {
    const pp = new PathProcessor(this.recognizedPath[0] as SimplePath, this.alternatePath);
    if (!pp.process()) return;
    const shape = pp.shape();
    if (shape !== null) {
      this.recognizedShapes.push(shape);
      this.recognizedPath = [];
    } else {
      this.recognizedPath = [pp.path()];
    }
    this.convex = true;
    this.polyPointsUsedByMatcher = pp.convexPoints().slice();
    if (pp.usedAlternatePath()) this.deletedObjects = this.alternateDeletedObjects.slice();
  }

  /** C++ `recognizePath()`: the stroke's line ends, its convexity, and the path-context paths. */
  private recognizePathInto(): void {
    this.linePoints = [];
    for (const line of this.lineColl.lines()) {
      if (this.linePoints.length === 0) this.linePoints.push(line.firstPoint());
      this.linePoints.push(line.lastPoint());
    }
    this.convex = this.linePoints.length > 2 ? isConvex(this.linePoints) : true;
    this.recognizedPath = this.recognizePath(recognitionConfigForPath);
  }

  /** C++ `recognizePath(conf, result)`: in-order polys, split, classified with `conf`, into paths. */
  private recognizePath(conf: RecognitionConfig): SimplePath[] {
    this.lineColl.setLineSearchInOrder(true);
    this.polyColl.setLines(this.lineColl);
    this.polyColl.process();
    this.polyColl.splitExtensions();
    for (const item of this.polyColl.polys()) item.recognize((p) => this.bsr.recognize(p, conf));

    this.pathAggregator.reset();
    this.pathAggregator.setPolyColl(this.polyColl);
    this.pathAggregator.process();
    return this.pathAggregator.paths().map((item) => toSimplePath(item.path()));
  }

  /**
   * C++ `consumePath`: arrows, then (no self-crossing) connections and self-loops, or (crossing)
   * the star. `thePath` null: the connection-context path of the stroke is used.
   */
  private consumePath(thePathIn: SimplePath | null, extended: boolean, canvas: CanvasDelegate = this.canvas): boolean {
    let thePath = thePathIn;
    let linePts: readonly Point[] = this.linePoints;
    if (thePath === null) {
      const userPaths = this.recognizePath(recognitionConfigForConnection);
      if (userPaths.length === 1) thePath = userPaths[0] as SimplePath;
    } else {
      linePts = thePath.points();
    }
    if (thePath === null || this.recognizedPath.length !== 1) return false;
    const current = this.recognizedPath[0] as SimplePath;

    const excluded = new Set<ObjectId>(this.deletedObjects);
    const config = this.ctx.config;

    if (new ArrowRecognizer(config).recognize(current, extended, excluded, canvas)) {
      this.recognizedPath = [];
      return true;
    }

    if (!hasLoop(linePts)) {
      if (new ConnectionRecognizer(config).recognize(thePath, current, this.convex, excluded, canvas)) {
        this.recognizedPath = [];
        this.deletedObjects = [];
        return true;
      }
      // A fresh stroke from a shape's edge, round outside it and back to the same shape: a
      // self-loop connector. (C++ also requires `strokes_.size() == 1`, always true here.)
      if (!extended && config.recognizeConnection && config.recognizeSelfLoop) {
        if (new SelfLoopRecognizer(config).recognize(this.stroke, thePath, excluded, canvas)) {
          this.recognizedPath = [];
          this.deletedObjects = [];
          return true;
        }
      }
    } else if (this.recognizeStar(thePath)) {
      return true;
    }
    return false;
  }

  /** C++ `detectClosedShape()` around R1's `detectClosedShape` with the `ShapeAggregator` stage. */
  private detectClosedShape(): boolean {
    const r = detectClosedShape(this.lineColl, this.polyColl, this.ctx, this.shapeAggregator);
    if (r.overLineCap || r.budgetExceeded) return false;
    this.recognizedShapes = [];
    if (r.detected) {
      this.convex = true;
      for (const sp of r.shapes) this.recognizedShapes.push(this.convertRecShape(sp));
    }
    return r.detected;
  }

  /** C++ `recognizeStar`: five crossing straight strokes become a regular six-pointed outline. */
  private recognizeStar(path: SimplePath): boolean {
    if (path.size !== 5) return false;
    if (path.components.some((c) => c.isCurve)) return false;

    const intersects: boolean[][] = [];
    for (let i = 0; i < 5; i++) {
      const row: boolean[] = [];
      for (let j = 0; j < 5; j++) {
        if (i === j) {
          row.push(false);
          continue;
        }
        const p1 = path.at(i).firstPoint();
        const p2 = path.at(i).lastPoint();
        const p3 = path.at(j).firstPoint();
        const p4 = path.at(j).lastPoint();
        row.push(LineEquation.through(p1, p2).touches(p3, p4) && LineEquation.through(p3, p4).touches(p1, p2));
      }
      intersects.push(row);
    }
    for (let i = 0; i < 5; i++) {
      const row = intersects[i] as boolean[];
      if (!row[(i + 2) % 5] || !row[(i + 3) % 5]) return false;
    }

    const bound = this.lineColl.bound();
    const r = (bound.height + bound.width) / 4;
    const center = bound.center();
    const vertices: Point[] = [];
    let angle = PI / 6;
    for (let i = 0; i < 12; i++) {
      const er = i % 2 !== 0 ? r / 3 : r;
      vertices.push(new Point(center.x + er * Math.cos(angle), center.y - er * Math.sin(angle)));
      angle += PI / 6;
    }
    vertices.push(vertices[0] as Point);
    const star = new SimplePath();
    for (let i = 0; i < vertices.length - 1; i++) {
      star.push(PathComponent.ofSegment(new LineSegment(at(vertices, i), at(vertices, i + 1))));
    }
    star.setClosed(true);
    this.recognizedPath = [star];
    this.needRegularization = false;
    return true;
  }

  /** C++ `extendExistingPath()`. */
  private extendExistingPath(): boolean {
    const userPath = this.recognizePath(recognitionConfigRegular);
    if (userPath.length !== 1) return false;
    const path = userPath[0] as SimplePath;
    if (path.size === 0) return false;
    const hasCurve = path.curveCount() > 0;

    const extender = new PathExtender(path, this.canvas, this.ctx.config);
    if (!extender.extend()) return false;
    this.deletedObjects.push(...extender.deletedObjects());
    this.recognizedPath = [path];

    if (hasCurve && this.alternatePath.size > 0) {
      const alt = new PathExtender(this.alternatePath, this.canvas, this.ctx.config);
      if (alt.extend()) {
        this.alternateDeletedObjects = alt.deletedObjects().slice();
      } else {
        this.alternatePath.reset();
        this.alternateDeletedObjects = [];
      }
    } else {
      this.alternateDeletedObjects = [];
      this.alternatePath.reset();
    }
    return true;
  }

  private proceed(): boolean {
    return this.lineColl.lines().length <= MAX_RECOGNIZED_LINES;
  }

  /** C++ `getPathFromLineColl`: one straight component per line. */
  private getPathFromLineColl(path: SimplePath): void {
    for (const item of this.lineColl.lines()) {
      path.push(PathComponent.ofSegment(new LineSegment(item.firstPoint(), item.lastPoint())));
    }
  }

  /** C++ `convertShape(recognizer::Shape)`. */
  private convertRecShape(sp: RecShape): GeoShape {
    const shape = new GeoShape();
    if (sp.name === ShapeNames.ellipse) {
      shape.setEllipse(sp.ellipse);
    } else if (sp.name === ShapeNames.polygon || sp.name === ShapeNames.poly) {
      const isClosed = sp.name === ShapeNames.polygon;
      let vertices: readonly Point[] = sp.points;
      if (isClosed) {
        this.polyPointsUsedByMatcher = sp.points.slice();
        const polym = new PolyMatcher(vertices);
        polym.process();
        vertices = polym.vertices();
      }
      const path = new SimplePath();
      for (let i = 0; i < vertices.length - 1; i++) {
        path.push(PathComponent.ofSegment(new LineSegment(at(vertices, i), at(vertices, i + 1))));
      }
      if (isClosed && vertices.length > 0) {
        path.push(PathComponent.ofSegment(new LineSegment(at(vertices, vertices.length - 1), at(vertices, 0))));
        path.setClosed(true);
      }
      shape.setPath(path);
    } else if (sp.name === ShapeNames.curve) {
      const path = new SimplePath();
      path.push(PathComponent.ofCurve(sp.curve.clone()));
      shape.setPath(path);
    }
    return shape;
  }

  /** C++ `convertShape(SimplePath*)`. */
  private convertPath(path: SimplePath): GeoShape {
    const shape = new GeoShape();
    shape.setPath(path);
    return shape;
  }
}

function cloneShape(s: GeoShape): GeoShape {
  const c = new GeoShape();
  if (s.type() === GeoShapeType.Ellipse) c.setEllipse(s.ellipse());
  else c.setPath(s.path());
  c.setSnap(s.snap());
  return c;
}
