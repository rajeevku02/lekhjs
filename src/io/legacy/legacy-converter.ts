// Legacy object types → live objects (port of C++ `ObjectConverter::convert`,
// `L/object/LegacyObjects.cpp:26-179`; spec 03 §10.4, spec 02 `ObjectConverter` and
// `CurveConnectionMigration`).
//
// Legacy types are never held as live objects (OQ-14, AC-ENG-35). The readers parse a legacy
// object into a plain record (`LegacyObject`) and this converter turns it into its templated
// equivalent at once, on every load path (JSON file, cloud `load`, paste, library item, XML). Only
// the parse halves and the converter are ported; legacy drawing, hit testing and writing are not.
//
// Today the XML reader converted every legacy type while the JSON reader converted only
// `freeform` and `curveconnection` and kept the other six live; converting all eight is DR-ENG-12.
//
// Ported as is, including:
//   - a circle's box is its integer-truncated selection rectangle (radius + 1 each side);
//   - a text's box is 1 × 1 at its centre (the text template then sizes itself);
//   - an image's style goes to the object, not to its template, and is never drawn;
//   - a curve uses only its first Bézier and snaps to the grid like a new object;
//   - a free-hand stroke converted from `freeform` is never `closed`;
//   - a stroke and a curve connector get no text or style here: the JSON reader reads them into
//     the converted object afterwards (C++ `afterObjectParse` ran after these two conversions),
//     and from XML they get none;
//   - a curve connector keeps its ends' ids and arrowheads, and loses its labels and (from XML)
//     its style; its params are the automatic-curve ones with the distance factors × 0.22.
// One C++ defect is not reproduced: `convert(CurveConnectionObject*)` returned the raw pointer of
// a `Ptr` that went out of scope, so the converted connector was already freed (a crash or a
// dangling object on every JSON and XML load of a curve connector). Here it simply converts.
import type { BezierCurve, Point } from '../../geometry';
import { Rect, getPointsBound } from '../../geometry';
import type { ArrowHeads } from '../../model';
import {
  ConnectionObject,
  ConnectionParam as P,
  ConnectionType,
  TemplatedObject,
  UnrecognizedObject,
  type LekhObject,
} from '../../model';
import { BezierCurveTemplate, PolygonTemplate, type ShapeTemplate } from '../../template';
import { Style } from '../../style';
import { LoadError } from '../errors';
import type { LoadContext } from '../load-context';

/** The stored `type` of each JSON legacy object kind. */
export const LEGACY_TYPES = Object.freeze({
  circle: 'avabodh.basic.circle',
  ellipse: 'avabodh.basic.ellipse',
  polygon: 'avabodh.basic.polygon',
  freeform: 'avabodh.basic.freeform',
  curve: 'avabodh.basic.curve',
  text: 'avabodh.basic.text',
  image: 'avabodh.basic.image',
  curveconnection: 'avabodh.basic.curveconnection',
} as const);

/** Every legacy `type` string. */
export const LEGACY_TYPE_NAMES: readonly string[] = Object.freeze(Object.values(LEGACY_TYPES));

/** What every legacy object carries (C++ `LekhObject`: `text` and `drawingProfile`). */
export interface LegacyBase {
  text: string;
  readonly style: Style;
}

export type LegacyObject =
  | (LegacyBase & { readonly kind: 'circle'; center: Point; radius: number })
  | (LegacyBase & { readonly kind: 'ellipse'; center: Point; width: number; height: number; rotation: number })
  | (LegacyBase & {
      readonly kind: 'polygon';
      vertices: Point[];
      closed: boolean;
      rounded: boolean;
      readonly arrows: ArrowHeads;
    })
  | (LegacyBase & { readonly kind: 'freeform'; points: Point[] })
  | (LegacyBase & { readonly kind: 'curve'; curves: BezierCurve[]; readonly arrows: ArrowHeads })
  | (LegacyBase & { readonly kind: 'text'; center: Point; rotation: number })
  | (LegacyBase & {
      readonly kind: 'image';
      center: Point;
      width: number;
      height: number;
      rotation: number;
      format: string;
      data: string;
    })
  | (LegacyBase & {
      readonly kind: 'curveconnection';
      srcId: string;
      targetId: string;
      angle1: number;
      angle2: number;
      distFactor1: number;
      distFactor2: number;
      readonly arrows: ArrowHeads;
    });

export type LegacyKind = LegacyObject['kind'];

/** A catalog template the converter needs (C++ `TemplateStore::getTemplate`). */
function catalogTemplate(ctx: LoadContext, id: string): ShapeTemplate {
  const t = ctx.getTemplate(id);
  if (t === null) throw new LoadError('object_parse', { reason: 'legacy_template_missing' });
  return t;
}

/** C++ `CircleObject::getSelectionRectangle`: integer-truncated, one unit of margin. */
function circleRect(center: Point, radius: number): Rect {
  return new Rect(
    Math.trunc(center.x - radius - 1),
    Math.trunc(center.y - radius - 1),
    Math.trunc(2 * radius + 2),
    Math.trunc(2 * radius + 2),
  );
}

/** Copies the legacy object's style into the converted object's own style and its template's. */
function takeStyle(obj: TemplatedObject, legacy: LegacyBase): void {
  obj.drawingProfile.copyFrom(legacy.style);
  obj.getDrawingProfile().copyFrom(legacy.style);
}

/**
 * The live object for `legacy`, with id `id` (C++ `ObjectConverter::convert`). A curve connector
 * comes back with no ends: the reader fixes them up with the others.
 */
export function convertLegacy(legacy: LegacyObject, id: string, ctx: LoadContext): LekhObject {
  ctx.note('legacy_converted');
  const oenv = ctx.env.objects;
  const tenv = ctx.templateEnv;
  switch (legacy.kind) {
    case 'polygon': {
      const { template, bound, angle } = PolygonTemplate.getPolygonTemplate(
        tenv,
        legacy.vertices,
        legacy.closed,
        false,
      );
      if (legacy.rounded) template.makeRect(true);
      const obj = new TemplatedObject(oenv, template, bound, angle, null, id);
      obj.drawingProfile.copyFrom(legacy.style);
      template.setText(0, legacy.text);
      obj.getDrawingProfile().copyFrom(legacy.style);
      obj.arrows.copyFrom(legacy.arrows);
      return obj;
    }
    case 'text': {
      const tmpl = catalogTemplate(ctx, 'avabodh.basic.text');
      const obj = new TemplatedObject(oenv, tmpl, Rect.fromCenter(legacy.center, 1, 1), legacy.rotation, null, id);
      obj.drawingProfile.copyFrom(legacy.style);
      tmpl.setText(0, legacy.text);
      obj.getDrawingProfile().copyFrom(legacy.style);
      obj.generateData();
      return obj;
    }
    case 'ellipse': {
      const tmpl = catalogTemplate(ctx, 'avabodh.basic.ellipse');
      const rect = Rect.fromCenter(legacy.center, legacy.width, legacy.height);
      const obj = new TemplatedObject(oenv, tmpl, rect, legacy.rotation, null, id);
      obj.drawingProfile.copyFrom(legacy.style);
      tmpl.setText(0, legacy.text);
      obj.getDrawingProfile().copyFrom(legacy.style);
      return obj;
    }
    case 'circle': {
      const tmpl = catalogTemplate(ctx, 'avabodh.basic.ellipse');
      const obj = new TemplatedObject(oenv, tmpl, circleRect(legacy.center, legacy.radius), 0, null, id);
      obj.drawingProfile.copyFrom(legacy.style);
      tmpl.setText(0, legacy.text);
      obj.getDrawingProfile().copyFrom(legacy.style);
      return obj;
    }
    case 'curve': {
      const bzc = legacy.curves[0];
      if (bzc === undefined) throw new LoadError('object_parse', { reason: 'legacy_curve_empty' });
      const bound = getPointsBound(bzc.render().points);
      const tmpl = new BezierCurveTemplate(tenv, bzc);
      const doc = ctx.doc;
      const snap = oenv.config.snapToGridNewObject && doc !== null ? doc.snapStep() : null;
      const obj = new TemplatedObject(oenv, tmpl, bound, 0, snap, id);
      takeStyle(obj, legacy);
      obj.arrows.copyFrom(legacy.arrows);
      return obj;
    }
    case 'image': {
      const tmpl = catalogTemplate(ctx, 'avabodh.basic.image');
      const rect = Rect.fromCenter(legacy.center, legacy.width, legacy.height);
      const obj = new TemplatedObject(oenv, tmpl, rect, legacy.rotation, null, id);
      tmpl.setImageData(0, legacy.data, legacy.format);
      obj.drawingProfile.copyFrom(legacy.style);
      return obj;
    }
    case 'freeform': {
      const obj = new UnrecognizedObject(oenv, legacy.points, id);
      obj.closed = false;
      return obj;
    }
    case 'curveconnection': {
      const con = new ConnectionObject(oenv, null, null, ConnectionType.Curve, id);
      con.setParams([
        {
          [P.angle1]: legacy.angle1,
          [P.angle2]: 0,
          [P.cdist1]: legacy.distFactor1 * 0.22,
          [P.angleauto]: 1,
          [P.cdistauto]: 1,
        },
        {
          [P.angle1]: legacy.angle2,
          [P.angle2]: 0,
          [P.cdist1]: legacy.distFactor2 * 0.22,
          [P.angleauto]: 1,
          [P.cdistauto]: 1,
        },
      ]);
      con.arrows.copyFrom(legacy.arrows);
      con.srcObjId = legacy.srcId;
      con.targetObjId = legacy.targetId;
      return con;
    }
  }
}

/** A blank legacy base (C++ default `text` and `drawingProfile`). */
export function legacyBase(): LegacyBase {
  return { text: '', style: new Style() };
}
