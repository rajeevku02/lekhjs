// The native generators' contract beyond their drawing (spec 04 §6): the registry builds all seven
// by `shape`, the block they write, their symbol sets, cloning, and `table-v1`'s vertex editing
// (C++ `TableGenerator::getInterestingPoints` / `moveVertexTo`, expectations worked from the C++
// source). The drawing itself is compared with the C++ core in native-golden.test.ts.
import { describe, expect, it } from 'vitest';
import { Point, PointType } from '../../src/geometry';
import {
  BpmnChoreographyGenerator,
  BpmnConversationGenerator,
  BpmnDataObjectGenerator,
  BpmnEventGenerator,
  BpmnGatewayGenerator,
  BpmnTaskGenerator,
  GeneratorRegistry,
  NATIVE_SHAPES,
  TableGenerator,
} from '../../src/generators';
import { DataStore, type InterestingPoint, type JsonObject, type ShapeTemplate } from '../../src/template';
import { testIo } from '../io/helpers';

const CLASSES = {
  'bpmn.activity': BpmnTaskGenerator,
  'bpmn.event': BpmnEventGenerator,
  'bpmn.gateway': BpmnGatewayGenerator,
  'bpmn.conversation': BpmnConversationGenerator,
  'bpmn.dataobject': BpmnDataObjectGenerator,
  'bpmn.choreography': BpmnChoreographyGenerator,
  'table-v1': TableGenerator,
} as const;

function parse(body: JsonObject): ShapeTemplate {
  const t = testIo().codec.templates.parse(body);
  if (t === null) throw new Error('no template');
  t.load();
  return t;
}

describe('the registry (spec 04 §5.2, §6)', () => {
  const registry = GeneratorRegistry.builtin();

  it('builds each of the seven by its shape, onParamChange', () => {
    expect(Object.keys(CLASSES).sort()).toEqual([...NATIVE_SHAPES].sort());
    for (const [shape, cls] of Object.entries(CLASSES)) {
      const g = registry.nativeByShape.get(shape)?.({ type: 'native', shape });
      expect(g).toBeInstanceOf(cls);
      expect(g?.behavior).toBe('onParamChange');
      expect(g?.preserved()).toBeNull();
    }
  });

  it('writes {type, shape, text, interprettext[, embedrefs]}, as C++ serializeGenerator', () => {
    const g = registry.nativeByShape.get('table-v1')?.({ type: 'native', shape: 'table-v1', embedrefs: ['b', 'a'] });
    expect(g?.toJSON()).toEqual({
      type: 'native',
      shape: 'table-v1',
      text: '',
      interprettext: false,
      embedrefs: ['a', 'b'],
    });
    const plain = registry.nativeByShape.get('table-v1')?.({
      type: 'native',
      shape: 'table-v1',
      text: 't',
      interprettext: true,
    });
    expect(plain?.toJSON()).toEqual({ type: 'native', shape: 'table-v1', text: 't', interprettext: true });
    expect(plain?.interpretText()).toBe(true);
    plain?.setInterpretedText('u');
    expect(plain?.interpretedText()).toBe('u');
    expect(plain?.clone().interpretedText()).toBe('u');
  });
});

describe('symbol sets (C++ updateEmbedRefs)', () => {
  it('a BPMN generator names its whole symbol set, whatever the block stored', () => {
    const task = BpmnTaskGenerator.fromJson({ type: 'native', shape: 'bpmn.activity', embedrefs: ['x.stale'] });
    expect(task.embedReferences()).toEqual(BpmnTaskGenerator.SYMBOLS);
    expect(task.embedReferences()).not.toContain('x.stale');
    expect(task.embedReferences()).toHaveLength(14);
    expect(task.toJSON()['embedrefs']).toEqual([...BpmnTaskGenerator.SYMBOLS]);
    // Timer, Conditional and Terminate are the same symbol in both event maps.
    expect(BpmnEventGenerator.SYMBOLS).toHaveLength(21);
    // `Inclusive` maps to no symbol, so the gateway names five.
    expect(BpmnGatewayGenerator.SYMBOLS).toEqual([
      'avabodh.bpmn.syms.cancelFilled',
      'avabodh.bpmn.syms.complexFilled',
      'avabodh.bpmn.syms.multiple',
      'avabodh.bpmn.syms.parallelMultiple',
      'avabodh.bpmn.syms.parallelMultipleFilled',
    ]);
    expect(BpmnConversationGenerator.SYMBOLS).toEqual(['avabodh.bpmn.syms.subprocess']);
    expect(BpmnDataObjectGenerator.SYMBOLS).toHaveLength(3);
    expect(BpmnChoreographyGenerator.SYMBOLS).toHaveLength(6);
    const all = new Set([
      ...BpmnTaskGenerator.SYMBOLS,
      ...BpmnEventGenerator.SYMBOLS,
      ...BpmnGatewayGenerator.SYMBOLS,
      ...BpmnConversationGenerator.SYMBOLS,
      ...BpmnDataObjectGenerator.SYMBOLS,
      ...BpmnChoreographyGenerator.SYMBOLS,
    ]);
    expect(all.size).toBe(34);
  });

  it('the table keeps the stored embedrefs', () => {
    expect(TableGenerator.fromJson({ embedrefs: ['z', 'a', 'z'] }).embedReferences()).toEqual(['a', 'z']);
  });

  it('partial text manipulation and vertex editing as C++', () => {
    expect(BpmnChoreographyGenerator.fromJson({}).doesPartialTextManipulation()).toBe(true);
    expect(BpmnTaskGenerator.fromJson({}).doesPartialTextManipulation()).toBe(false);
    const table = TableGenerator.fromJson({});
    expect(table.doesPartialTextManipulation()).toBe(true);
    expect(table.canDoVertexEditing()).toBe(true);
    expect(BpmnChoreographyGenerator.fromJson({}).canDoVertexEditing()).toBe(false);
  });
});

/** A 2 × 2 text table without headers; rows 1:1, columns 1:1. */
function table(extra: JsonObject = {}): ShapeTemplate {
  return parse({
    id: 'test.table',
    data: [],
    draw: [],
    generator: { type: 'native', shape: 'table-v1' },
    params: {
      ncols: { value: 2 },
      nrows: { value: 2 },
      col_header: { value: false },
      table_header: { value: false },
      row0: { value: 1.0 },
      col0: { value: 0.5 },
      col1: { value: 0.5 },
      ...extra,
    },
  });
}

function box(t: ShapeTemplate, w: number, h: number, cx: number, cy: number, angle = 0): DataStore {
  const ds = new DataStore();
  ds.setWidth(w);
  ds.setHeight(h);
  ds.setCx(cx);
  ds.setCy(cy);
  ds.setAngle(angle);
  t.generateData(ds);
  return ds;
}

function points(t: ShapeTemplate, ds: DataStore): [number, number][] {
  const out: InterestingPoint[] = [];
  t.getInterestingPoints(ds, out);
  for (const p of out) expect(p.type).toBe(PointType.Attr);
  return out.map((p) => [Math.round(p.point.x * 1e6) / 1e6, Math.round(p.point.y * 1e6) / 1e6]);
}

function param(t: ShapeTemplate, name: string): number | undefined {
  const v = t.params.find((p) => p.name === name)?.value;
  return typeof v === 'number' ? v : undefined;
}

describe('table-v1 vertex editing (C++ TableGenerator)', () => {
  it('the column edges along the bottom, then the row edges along the right', () => {
    const t = table();
    const ds = box(t, 200, 100, 100, 50);
    expect(points(t, ds)).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
      [200, 0],
      [200, 50],
    ]);
  });

  it('a clone has no layout state until it generates', () => {
    const t = table();
    const g = t.generator as TableGenerator;
    const out: InterestingPoint[] = [];
    g.clone().getInterestingPoints(t, box(t, 200, 100, 100, 50), out);
    expect(out).toEqual([]);
  });

  it('dragging an inner column edge sets the hidden column sizes, clamped 8 from its neighbours', () => {
    const t = table();
    const ds = box(t, 200, 100, 100, 50);
    const out = t.moveVertexTo(1, new Point(130, 77), ds);
    expect([out.x, out.y]).toEqual([130, 77]);
    expect([param(t, 'col0'), param(t, 'col1')]).toEqual([130, 70]);
    expect([ds.width(), ds.cx()]).toEqual([200, 100]);
    expect(t.dataExpStrs).toContain('-w/2+w*0.65');

    const clamped = t.moveVertexTo(1, new Point(199, 0), ds);
    expect(clamped.x).toBe(192);
    expect([param(t, 'col0'), param(t, 'col1')]).toEqual([192, 8]);
  });

  it('dragging the right column edge widens the box and moves the bottom edge too', () => {
    const t = table();
    const ds = box(t, 200, 100, 100, 50);
    const out = t.moveVertexTo(2, new Point(250, 120), ds);
    expect([out.x, out.y]).toEqual([250, 120]);
    expect([ds.width(), ds.cx(), ds.height(), ds.cy()]).toEqual([250, 125, 120, 60]);
    expect([param(t, 'col0'), param(t, 'col1'), param(t, 'row0'), param(t, 'row1')]).toEqual([100, 150, 50, 70]);
    // `row1` was not a parameter: it is added hidden, order 999.
    const row1 = t.params.find((p) => p.name === 'row1');
    expect([row1?.order, row1?.editor.type]).toEqual([999, 255]);
  });

  it('dragging the top row edge moves the top of the box and the right edge', () => {
    const t = table();
    const ds = box(t, 200, 100, 100, 50);
    // vid = ncols + 1 + 0: the top edge.
    const out = t.moveVertexTo(3, new Point(230, -20), ds);
    expect([out.x, out.y]).toEqual([230, -20]);
    expect([ds.height(), ds.cy(), ds.width(), ds.cx()]).toEqual([120, 40, 230, 115]);
    expect([param(t, 'row0'), param(t, 'row1')]).toEqual([70, 50]);
  });

  it('works in the shape frame of a rotated box', () => {
    const t = table();
    const ds = box(t, 200, 100, 100, 50, Math.PI / 2);
    const pts = points(t, ds);
    // The bottom-left corner (0, 100) about the centre (100, 50) by 90°: (50, -50).
    expect(pts[0]?.[0]).toBeCloseTo(50);
    expect(pts[0]?.[1]).toBeCloseTo(-50);
    const out = t.moveVertexTo(1, new Point(50, 30), ds);
    // (50, 30) back in the box frame is (80, 100).
    expect(param(t, 'col0')).toBeCloseTo(80);
    expect(out.x).toBeCloseTo(50);
    expect(out.y).toBeCloseTo(30);
  });

  it('size parameters past the table are dropped, missing ones repeat the previous', () => {
    const t = table({ col5: { value: 0.3 }, row7: { value: 2 }, rowx: { value: 'a' }, ncols: { value: 3 } });
    expect(t.params.map((p) => p.name)).not.toContain('col5');
    expect(t.params.map((p) => p.name)).not.toContain('row7');
    expect(t.params.map((p) => p.name)).toContain('rowx');
    const ds = box(t, 300, 100, 150, 50);
    // col0 0.5, col1 0.5, col2 repeats 0.5: three equal columns.
    expect(points(t, ds).slice(0, 4)).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
      [300, 100],
    ]);
  });
});

describe('the choreography texts', () => {
  it('one text per participant plus the task, defaults for new ones', () => {
    const t = parse({
      id: 'test.choreo',
      data: [],
      draw: [],
      generator: { type: 'native', shape: 'bpmn.choreography' },
      params: { participants: { value: 3 } },
      texts: [{ location: 'default', text: 'Alice' }],
    });
    expect(t.textData.map((x) => x.text)).toEqual(['Alice', 'Task', 'Participant', 'Participant']);
    const n = t.params.find((p) => p.name === 'participants');
    if (n === undefined) throw new Error('no participants');
    n.value = 2;
    t.load();
    expect(t.textData.map((x) => x.text)).toEqual(['Alice', 'Task', 'Participant']);
  });
});
