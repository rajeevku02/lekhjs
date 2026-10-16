// ConnectionObject and its routings: auto line / orthogonal / curve / path routes, labels, arrows,
// legacy migration, copy, and the store integration (B9 / DR-ENG-18, B18b / DR-ENG-20, B18c /
// DR-ENG-21, AC-ENG-06, AC-ENG-07).
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../../src/base';
import { Point, Rect } from '../../src/geometry';
import { STYLE_DEFAULTS } from '../../src/style';
import {
  AutoType,
  ConnectionObject,
  ConnectionType,
  GroupObject,
  LineConnection,
  TemplatedObject,
  type ParamMap,
  type Params,
} from '../../src/model';
import { LogPlatform } from '../template/helpers';
import { paintEnv } from './helpers';
import { kindsEnv, kindsStore, layOut, rect } from './kinds';

// connectionLineSeparationFromObject + half of each default stroke.
const GAP = CONFIG_DEFAULTS.connectionLineSeparationFromObject + STYLE_DEFAULTS.strokeWidth;

describe('routes', () => {
  it('an automatic straight line runs centre to centre, stopping the gap short of each outline', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine);
    expect(con.getType()).toBe(ConnectionType.GenericLine);
    layOut(a, b, con);
    const [p1, p2] = con.routePoints();
    expect(p1?.x).toBeCloseTo(20 + GAP);
    expect(p2?.x).toBeCloseTo(180 - GAP);
    expect(con.getAutoType()).toBe(AutoType.AutoLine);
    expect(con.distanceFrom(new Point(100, 10))).toBeCloseTo(10);
    expect(con.selectionRect().width).toBeCloseTo(160 - 2 * GAP);
  });

  it('an automatic orthogonal route (2 legs) between offset shapes', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 200, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.Auto2LineA);
    expect(con.getType()).toBe(ConnectionType.MultiLine);
    layOut(a, b, con);
    const pts = con.routePoints();
    expect(pts.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i] as Point;
      const q = pts[i + 1] as Point;
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
    // B9: the automatic directions are written into the stored segments only by layout.
    const params = con.getParams();
    expect((params[0] as ParamMap)['dx']).toBe(1);
  });

  it('an automatic curve has its control points on the outline normals', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoCurveConnection(env, a, b, Math.PI / 2, -Math.PI / 2, 0.4, 0.4);
    layOut(a, b, con);
    const bz = con.routeCurves()[0];
    expect(bz).toBeDefined();
    expect(con.getArrowPoints()).toHaveLength(2);
    expect(con.selectionRect().width).toBeGreaterThan(0);
    expect(con.getInterestingPoints()).toHaveLength(4);
  });

  it('a path connector lays its stored offsets from both ends', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const params: Params = [
      { angle: 0, dx: 50, dy: -50 },
      { dx: 0, dy: 0 },
      { angle: Math.PI, dx: 50, dy: 50 },
    ];
    const con = ConnectionObject.getConnection(env, a, b, ConnectionType.Path, params);
    layOut(a, b, con);
    const path = con.routePaths()[0];
    expect(path?.size).toBe(3);
    expect(con.getParams()).toEqual(params);
    expect(con.getInterestingPoints()).toHaveLength(4);
  });

  it('B18b (DR-ENG-20): an orthogonal route with no stored segments has empty params', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = new ConnectionObject(env, a, b, ConnectionType.MultiLine);
    expect(con.getParams()).toEqual([]);
    layOut(a, b, con);
    expect(con.routePoints()).toEqual([]);
    const lc = new LineConnection(con, ConnectionType.MultiLine, AutoType.NoAuto);
    expect(lc.getParams()).toEqual([]);
  });
});

describe('labels and arrows', () => {
  it('labels sit at their route position, clip the line and widen the selection rect', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine);
    con.setTexts([{ text: 'Yes', param: 0.5 }]);
    layOut(a, b, con);
    const ti = con.textInfos()[0];
    expect(ti?.center.x).toBeCloseTo(100);
    const dp = new LogPlatform();
    con.paint(dp, paintEnv());
    expect(dp.log.filter((l) => l.startsWith('M')).length).toBe(2); // one gap in the line
    expect(dp.log.some((l) => l === 'text Yes')).toBe(true);
    expect(con.selectionRect().height).toBeGreaterThan(12);
  });

  it('editing: an existing label is found, a tap near the route adds one ("Text")', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine);
    con.setTexts([{ text: 'Yes', param: 0.5 }]);
    store.add(a);
    store.add(b);
    store.add(con);
    expect(store.hit.editableAt(new Point(100, 0))).toBe(con);
    expect(store.hit.editableAt(new Point(60, 3))).toBe(con);
    expect(store.hit.editableAt(new Point(60, 300))).toBeNull();
    con.startTextEditing(new Point(60, 3));
    expect(con.textInfos()).toHaveLength(2);
    expect(con.getTextForEditing()).toBe('Text');
    expect(con.finishTextEditing().index).toBe(1);
    const mt = store.hit.movableTextNear(new Point(102, 2));
    expect(mt?.obj).toBe(con);
    expect(mt?.index).toBe(0);
    expect(con.moveTextNear(0, new Point(150, 4))).toBeCloseTo((150 - 20 - GAP) / (160 - 2 * GAP), 6);
  });

  it('arrowheads at the route ends are laid out and painted', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine);
    con.arrows.setEndKind(true, true);
    layOut(a, b, con);
    const dp = new LogPlatform();
    con.paint(dp, paintEnv());
    expect(dp.log.filter((l) => l === 'Z')).toHaveLength(1);
    expect(con.extent().right()).toBeGreaterThanOrEqual(180 - GAP);
  });
});

describe('legacy content and copy', () => {
  it('legacy segment texts become positioned labels, once', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine);
    con.legacyTexts = ['old'];
    expect(con.hasLegacyContent()).toBe(true);
    layOut(a, b, con);
    expect(con.counters.migrations).toBe(1);
    expect(con.textInfos().map((t) => [t.text, t.param])).toEqual([['old', 0.5]]);
    con.invalidate();
    layOut(con);
    expect(con.counters.migrations).toBe(1);
  });

  it('an old auto C connector gets its step fixed by half the narrower end', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 0, 200, 60, 40);
    const con = new ConnectionObject(env, a, b, ConnectionType.MultiLine);
    con.setOldLineParams(50, AutoType.Auto3LineC);
    con.onDeserialize();
    expect(con.needsParamFix()).toBe(true);
    layOut(a, b, con);
    expect((con.getParams()[0] as ParamMap)['step']).toBe(30);
  });

  it('getCopy keeps type, params, labels and arrows between new ends', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.Auto2LineB);
    con.setTexts([{ text: 'x', param: 0.3 }]);
    con.arrows.setStartKind(true, false);
    const c = con.getCopy(rect(env, 0, 0, 10, 10), rect(env, 50, 50, 10, 10));
    expect(c.getType()).toBe(ConnectionType.MultiLine);
    expect(c.getParams()).toEqual(con.getParams());
    expect(c.textInfos()[0]?.text).toBe('x');
    expect(c.arrows.start()).not.toBeNull();
    expect(c.id).not.toBe(con.id);
  });
});

describe('in a store', () => {
  it('AC-ENG-06: moving one shape with two connectors lays out exactly those three', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const c = rect(env, 0, 200, 40, 40);
    const d = rect(env, 400, 400, 40, 40);
    for (const o of [a, b, c, d]) store.add(o);
    store.add(ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine));
    store.add(ConnectionObject.getAutoConnection(env, a, c, AutoType.Auto2LineA));
    store.flushLayout();
    a.setRect(new Rect(10, 10, 40, 40));
    expect(store.flushLayout()).toBe(3);
    expect(store.flushLayout()).toBe(0);
  });

  it('AC-ENG-07 / B9 (DR-ENG-18): an end moved by a change routes at the flush, not at a query', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 5000, 0, 40, 40); // far off any view
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine);
    for (const o of [a, b, con]) store.add(o);
    store.flushLayout();
    const before = con.routePoints()[1];
    b.setRect(Rect.fromCenter(new Point(5000, 300), 40, 40));
    // Reading the connector does not route it (C++ re-routed inside getSelectionRectangle).
    expect(con.routePoints()[1]).toBe(before);
    expect(con.selectionRect().height).toBeLessThan(1);
    store.flushLayout();
    expect(con.routePoints()[1]?.y).toBeGreaterThan(250);
    expect(con.selectionRect().height).toBeGreaterThan(250);
  });

  it('B18c (DR-ENG-21): connectionsOf a group includes an edge attached to the group itself', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const m1 = rect(env, 0, 0, 40, 40);
    const m2 = rect(env, 100, 0, 40, 40);
    const g = new GroupObject(env, [m1, m2]);
    const other = rect(env, 400, 0, 40, 40);
    store.add(g);
    store.add(other);
    const toGroup = ConnectionObject.getAutoConnection(env, g, other, AutoType.AutoLine);
    const toMember = ConnectionObject.getAutoConnection(env, m1, other, AutoType.AutoLine);
    store.add(toGroup);
    store.add(toMember);
    expect(store.connectionsOf(g)).toEqual([toGroup, toMember]);
  });

  it('an end replaced in the store by id is picked up at the next layout', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const a = rect(env, 0, 0, 40, 40);
    const b = rect(env, 200, 0, 40, 40);
    const con = ConnectionObject.getAutoConnection(env, a, b, AutoType.AutoLine);
    for (const o of [a, b, con]) store.add(o);
    store.flushLayout();
    store.remove(b);
    const b2 = new TemplatedObject(env, b.shapeTemplate(), Rect.fromCenter(new Point(200, 300), 40, 40), 0, null, b.id);
    store.add(b2);
    store.flushLayout();
    expect(con.second).toBe(b2);
    expect(con.routePoints()[1]?.y).toBeGreaterThan(100);
  });
});
