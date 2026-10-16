// Helpers for the object-kind suites: an `ObjectEnv` over the template test environment (text 10
// per character, 12 high), hand-built catalog shapes (the stencil bodies of avabodh.basic.rectangle,
// .ellipse and the two connector arrowheads), and a store over that environment.
import { EngineConfig, type Config } from '../../src/base';
import { Point, Rect } from '../../src/geometry';
import {
  ObjectStore,
  TemplatedObject,
  modificationContext,
  type ModificationContext,
  type ObjectEnv,
} from '../../src/model';
import { Color, Length, Paint, Unit } from '../../src/style';
import { PathInfo, PolygonTemplate, ShapeTemplate, TextInfo, type TemplateEnv } from '../../src/template';
import { fixedClock } from './helpers';
import { testEnv, type TestEnv } from '../template/helpers';

export interface KindsEnv extends ObjectEnv {
  readonly tenv: TestEnv;
}

export const verifyCfg = new EngineConfig({ debug: { verifyIndex: true } });

function arrowhead(tenv: TemplateEnv, id: string): ShapeTemplate | null {
  const t = new ShapeTemplate(tenv);
  t.templateId = id;
  if (id === 'avabodh.arrow.str') {
    t.dataExpStrs = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', '0'];
    t.pathData.push(new PathInfo('M 0 1 L 2 3 L 4 5 Z'));
    t.getStyle().setFillPaint(Paint.solid(new Color(0, 0, 0, 255)));
    t.defaultAttr.width = 6;
    t.defaultAttr.height = 9;
  } else if (id === 'avabodh.arrow.ar') {
    t.dataExpStrs = ['-w/2', '-h/2', 'w/2', '0', '-w/2', 'h/2'];
    t.pathData.push(new PathInfo('M 0 1 L 2 3 L 4 5'));
    t.defaultAttr.width = 6;
    t.defaultAttr.height = 12;
  } else {
    return null;
  }
  t.load();
  return t;
}

export function kindsEnv(config: Config = verifyCfg): KindsEnv {
  const tenv = testEnv();
  let n = 0;
  return {
    config,
    text: tenv.text,
    arrowhead: (id) => arrowhead(tenv, id),
    newId: () => `id${String(++n)}`,
    tenv,
  };
}

/** avabodh.basic.rectangle with one centred text slot. */
export function rectTemplate(env: KindsEnv, text = ''): ShapeTemplate {
  const t = new ShapeTemplate(env.tenv);
  t.templateId = 'avabodh.basic.rectangle';
  t.dataExpStrs = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2', '0', '0', 'w', 'h', '0'];
  t.pathData.push(new PathInfo('M 0 1 L 2 3 L 4 5 L 6 7 L 0 1'));
  const ti = new TextInfo();
  ti.location = '8 9 10 11 12';
  ti.text = text;
  t.textData.push(ti);
  t.usePrimitiveForDistance = true;
  t.usePrimitiveForInsideCheck = true;
  t.usePrimitiveForIntersection = true;
  t.load();
  return t;
}

/** avabodh.basic.ellipse. */
export function ellipseTemplate(env: KindsEnv): ShapeTemplate {
  const t = new ShapeTemplate(env.tenv);
  t.templateId = 'avabodh.basic.ellipse';
  t.dataExpStrs = ['0', '0', 'w', 'h', '0'];
  t.pathData.push(new PathInfo('E 0 1 2 3 4'));
  t.usePrimitiveForDistance = true;
  t.usePrimitiveForInsideCheck = true;
  t.usePrimitiveForIntersection = true;
  t.load();
  return t;
}

/** A closed polygon rectangle (the recognizer's form; implicit-container candidate). */
export function polyRectTemplate(env: KindsEnv): PolygonTemplate {
  const t = new PolygonTemplate(env.tenv);
  t.closed = true;
  t.makeRect(false);
  return t;
}

export function rect(
  env: KindsEnv,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle = 0,
  text = '',
): TemplatedObject {
  return new TemplatedObject(env, rectTemplate(env, text), Rect.fromCenter(new Point(cx, cy), w, h), angle);
}

export function polyRect(env: KindsEnv, cx: number, cy: number, w: number, h: number): TemplatedObject {
  return new TemplatedObject(env, polyRectTemplate(env), Rect.fromCenter(new Point(cx, cy), w, h), 0);
}

export function ellipse(env: KindsEnv, cx: number, cy: number, w: number, h: number): TemplatedObject {
  return new TemplatedObject(env, ellipseTemplate(env), Rect.fromCenter(new Point(cx, cy), w, h), 0);
}

export function kindsStore(env: KindsEnv): ObjectStore {
  return new ObjectStore({ config: env.config, clock: fixedClock() });
}

export function modCtx(env: KindsEnv, store: ObjectStore, step = 8): ModificationContext {
  return modificationContext(env, store, new Length(step, Unit.Point));
}

/** Lays a detached object out (and anything it asks for). */
export function layOut(...objs: { needsLayout(): boolean; layout(env: never): void }[]): void {
  const env = {
    config: verifyCfg,
    ensureLayout: (o: { needsLayout(): boolean; layout(e: unknown): void }) => {
      if (o.needsLayout()) o.layout(env);
    },
    objectById: () => undefined,
  };
  for (const o of objs) if (o.needsLayout()) o.layout(env as never);
}
