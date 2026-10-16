// The delta compiler's node and structure operations (semantic/delta/ops-nodes.ts): a
// representative subset of the C++ suites DeltaEnvelope, DeltaPrepass, DeltaAddNode, DeltaAddEdge,
// DeltaAddPath, DeltaDelete, DeltaGroup, DeltaGeometry, DeltaPlacement and DeltaReorder, over
// synthetic boards built the way the C++ support header builds them.
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import type { JsonObject, JsonValue } from '../../src/template';
import { testRuntime } from '../session/helpers';

const runtime = testRuntime();

const uid = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PAGE = uid('c0ffffff', 1);
const obj = (n: number): string => uid('c1000000', n);

function rectBody(cx: number, cy: number, w: number, h: number, order: number, text = 'r'): JsonObject {
  return {
    type: 'templated',
    name: 'Rectangle',
    order,
    params: { cx, cy, width: w, height: h, angle: 0 },
    template: {
      id: 'avabodh.basic.rectangle',
      data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
      draw: ['M 0 1 L 2 3 L 4 5 L 6 7 L 0 1'],
      texts: [{ location: 'default', text }],
      images: '',
      primitive_for_distance: true,
      primitive_for_inside: true,
      primitive_for_intersection: true,
      closed: true,
      rounded: false,
      text_at_centroid: true,
      polygon: true,
      name: 'Rectangle',
    },
  };
}

function autoLine(source: string, target: string, order: number): JsonObject {
  return {
    type: 'avabodh.basic.connection',
    source,
    target,
    ctype: 1,
    params: [{ angle: 0, autotype: 1 }, { angle: 0 }],
    texts: [],
    text: '',
    name: '',
    order,
  };
}

function groupMember(body: JsonObject, index: number, cx: number, cy: number, w: number, h: number): JsonObject {
  return {
    index,
    orig_cx: cx,
    orig_cy: cy,
    orig_width: w,
    orig_height: h,
    orig_angle: 0,
    xfactor: 0,
    yfactor: 0,
    object: body,
  };
}

function board(objects: Record<string, JsonObject>): JsonObject {
  return {
    info: { author: '', description: '', platform: '1', title: 'Board', version: '4.2' },
    attributes: { grid: { present: true }, scaling: { scale: 1, unit: 'point' } },
    pages: {
      [PAGE]: {
        name: 'Only',
        order: 1,
        canvassizetype: 'infinite',
        canvasname: '',
        size: { width: 0, height: 0, unit: 'point' },
        background: { color: -1 },
        objects,
      },
    },
  };
}

function session(b: JsonObject): BoardSession {
  const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  const r = s.load(b);
  expect(r.ok).toBe(true);
  return s;
}

function run(b: JsonObject, ops: JsonValue[], extra: JsonObject = {}): JsonObject {
  const s = session(b);
  const answer = compile(s, { version: 4, page: PAGE, ...extra, ops });
  s.dispose();
  expect(answer).not.toBeNull();
  return answer as JsonObject;
}

interface Frame {
  type: string;
  changes: Record<string, JsonValue>;
  conditions: Record<string, JsonValue>;
}
const framesOf = (a: JsonObject): Frame[] => (a['frames'] ?? []) as unknown as Frame[];
const frameOf = (a: JsonObject, type: string): Frame | undefined => framesOf(a).find((f) => f.type === type);
const objPath = (id: string): string => `doc.pages.${PAGE}.objects.${id}`;

function expectRefusal(a: JsonObject, code: string, op: number | null, ...substrings: string[]): void {
  expect(a['ok'], JSON.stringify(a).slice(0, 400)).toBe(false);
  expect(a['error']).toBe(code);
  if (op === null) expect('op' in a).toBe(false);
  else expect(a['op']).toBe(op);
  for (const s of substrings) expect(a['message'] as string).toContain(s);
  expect(Object.keys(a).sort()).toEqual(op === null ? ['error', 'message', 'ok'] : ['error', 'message', 'ok', 'op']);
}

const twoRects = (): JsonObject =>
  board({ [obj(1)]: rectBody(100, 100, 80, 40, 1000), [obj(2)]: rectBody(300, 100, 80, 40, 2000) });
const rect = (extra: JsonObject = {}): JsonObject => ({ op: 'add_node', shape: 'avabodh.basic.rectangle', ...extra });

describe('envelope and pre-pass (DeltaEnvelope, DeltaPrepass)', () => {
  it('refuses a batch that is not an object, without a version, or with ops not an array', () => {
    const s = session(twoRects());
    expectRefusal(compile(s, '[1]') as JsonObject, 'invalid_operation', null, 'the batch is not a JSON object');
    expectRefusal(compile(s, { ops: [] }) as JsonObject, 'version_required', null, '`version` is required');
    expectRefusal(
      compile(s, { version: 1, ops: {} }) as JsonObject,
      'invalid_operation',
      null,
      '`ops` must be an array',
    );
    expectRefusal(
      compile(s, { version: 1, page: 'nope', ops: [] }) as JsonObject,
      'page_not_found',
      null,
      'no page "nope"',
    );
    s.dispose();
  });

  it('refuses an unknown op, an op without a name, and a ref used twice', () => {
    expectRefusal(run(twoRects(), [{ op: 'explode' }]), 'invalid_operation', 0, 'unknown op "explode"');
    expectRefusal(run(twoRects(), [{}]), 'invalid_operation', 0, 'must name an `op`');
    expectRefusal(
      run(twoRects(), [rect({ ref: 'a', cx: 0, cy: 0 }), rect({ ref: 'a', cx: 9, cy: 9 })]),
      'invalid_operation',
      1,
      'ref "a" is used twice',
    );
  });

  it('refuses an add_edge whose ref endpoint is created by a later operation', () => {
    const a = run(twoRects(), [{ op: 'add_edge', from: obj(1), to: 'n' }, rect({ ref: 'n', cx: 500, cy: 500 })]);
    expectRefusal(a, 'invalid_operation', 0, 'is defined by operation 1');
  });

  it('an empty batch compiles to the full envelope with no frames', () => {
    const a = run(twoRects(), []);
    expect(a['ok']).toBe(true);
    expect(a['frame_count']).toBe(0);
    expect(a['op_count']).toBe(0);
    expect(a['page']).toBe(PAGE);
    expect(a['conflict_policy']).toBe('per_object');
  });
});

describe('add_node (DeltaAddNode, DeltaAddPath)', () => {
  it('compiles to one addobjects change with no conditions, sized as asked', () => {
    const a = run(twoRects(), [rect({ ref: 'n', cx: 500, cy: 300, width: 120, height: 60 })]);
    expect(a['ok']).toBe(true);
    expect(framesOf(a).map((f) => f.type)).toEqual(['addobjects']);
    const id = (a['created'] as Record<string, string>)['n'] as string;
    const f = frameOf(a, 'addobjects') as Frame;
    expect(Object.keys(f.changes)).toEqual([objPath(id)]);
    expect(f.conditions).toEqual({});
    const stored = f.changes[objPath(id)] as JsonObject;
    expect(stored['params']).toMatchObject({ cx: 500, cy: 300, width: 120, height: 60 });
    expect(a['added']).toEqual([id]);
    expect(a['auto_placed']).toEqual([]);
  });

  it('refuses a missing shape, an unknown stencil, a size of 0 and a z_order of 0', () => {
    expectRefusal(run(twoRects(), [{ op: 'add_node' }]), 'invalid_operation', 0, 'needs a `shape`');
    expectRefusal(
      run(twoRects(), [{ op: 'add_node', shape: 'no.such.shape' }]),
      'unknown_stencil',
      0,
      'no stencil "no.such.shape"',
    );
    expectRefusal(
      run(twoRects(), [rect({ cx: 0, cy: 0, width: 0 })]),
      'invalid_operation',
      0,
      'width must be greater than 0',
    );
    expectRefusal(run(twoRects(), [rect({ cx: 0, cy: 0, z_order: 0 })]), 'invalid_operation', 0, 'z_order 0');
  });

  it('gives a new node the next order past the page', () => {
    const a = run(twoRects(), [rect({ ref: 'n', cx: 0, cy: 0 }), rect({ ref: 'm', cx: 9, cy: 9 })]);
    const f = frameOf(a, 'addobjects') as Frame;
    const created = a['created'] as Record<string, string>;
    expect((f.changes[objPath(created['n'] as string)] as JsonObject)['order']).toBe(2100);
    expect((f.changes[objPath(created['m'] as string)] as JsonObject)['order']).toBe(2101);
  });

  it('refuses `draw` on a catalogue shape and a path without a size', () => {
    expectRefusal(
      run(twoRects(), [rect({ cx: 0, cy: 0, draw: [] })]),
      'invalid_operation',
      0,
      'draw is only accepted with shape "lekh.semantic.path"',
    );
    expectRefusal(
      run(twoRects(), [{ op: 'add_node', shape: 'lekh.semantic.path', draw: [{ path: ['M', 0, 0, 'L', 'w', 'h'] }] }]),
      'invalid_operation',
      0,
      'needs width and height',
    );
  });
});

describe('auto-placement (DeltaPlacement)', () => {
  const GAP = 24;
  const MARGIN = 40;

  it('on an empty page starts at the margin and stacks a column', () => {
    const a = run(board({}), [rect({ ref: 'a', width: 80, height: 40 }), rect({ ref: 'b', width: 40, height: 20 })]);
    const placed = a['auto_placed'] as { ref: string; cx: number; cy: number }[];
    expect(placed.map((p) => p.ref)).toEqual(['a', 'b']);
    expect(placed[0]).toMatchObject({ cx: MARGIN + 40, cy: MARGIN + 20 });
    expect(placed[1]).toMatchObject({ cx: MARGIN + 40, cy: MARGIN + 20 + 20 + GAP + 10 });
  });

  it('below the content, left-aligned with it, and keeps a coordinate it was given', () => {
    const a = run(twoRects(), [rect({ ref: 'a', width: 40, height: 20 })]);
    const p = (a['auto_placed'] as { cx: number; cy: number }[])[0];
    // content: x 60..340, y 80..120, inflated for the stroke by the same margin on every side
    const pad = 60 - ((p?.cx ?? 0) - 20);
    expect(pad).toBeGreaterThanOrEqual(0);
    expect(pad).toBeLessThan(2);
    expect(p?.cy).toBeCloseTo(120 + pad + GAP + 10, 3);
    const b = run(twoRects(), [rect({ ref: 'b', cx: 100, width: 40, height: 20 })]);
    expect((b['auto_placed'] as { cx: number }[])[0]?.cx).toBe(100);
  });
});

describe('add_edge (DeltaAddEdge)', () => {
  it('joins a new node to an existing one in the same addobjects frame', () => {
    const a = run(twoRects(), [
      rect({ ref: 'n', cx: 500, cy: 300 }),
      { op: 'add_edge', ref: 'e', from: obj(1), to: 'n' },
    ]);
    expect(a['ok']).toBe(true);
    const created = a['created'] as Record<string, string>;
    const f = frameOf(a, 'addobjects') as Frame;
    const edge = f.changes[objPath(created['e'] as string)] as JsonObject;
    expect(edge['source']).toBe(obj(1));
    expect(edge['target']).toBe(created['n']);
    expect(edge['ctype']).toBe(1);
    expect(f.conditions).toEqual({});
  });

  it('refuses a route without an edge_type, reach without a u_bend, and both auto_type and route', () => {
    expectRefusal(
      run(twoRects(), [{ op: 'add_edge', from: obj(1), to: obj(2), route: { from: { angle: 0 }, to: { angle: 0 } } }]),
      'invalid_operation',
      0,
      'a `route` needs the `edge_type` it belongs to',
    );
    expectRefusal(
      run(twoRects(), [{ op: 'add_edge', from: obj(1), to: obj(2), reach: 30 }]),
      'invalid_operation',
      0,
      'reach applies to a u_bend_* edge only',
    );
    expectRefusal(
      run(twoRects(), [
        {
          op: 'add_edge',
          from: obj(1),
          to: obj(2),
          auto_type: 'straight',
          edge_type: 'line',
          route: { from: {}, to: {} },
        },
      ]),
      'invalid_operation',
      0,
      'not both',
    );
  });

  it('a line route compiles to its params, with the autotype regenerated', () => {
    const a = run(twoRects(), [
      {
        op: 'add_edge',
        ref: 'e',
        from: obj(1),
        to: obj(2),
        edge_type: 'line',
        auto_type: 'manual',
        route: { from: { angle: 0.5 }, to: { angle: 1.5 } },
      },
    ]);
    const created = a['created'] as Record<string, string>;
    const edge = (frameOf(a, 'addobjects') as Frame).changes[objPath(created['e'] as string)] as JsonObject;
    expect(edge['params']).toEqual([{ angle: 0.5, autotype: 0 }, { angle: 1.5 }]);
  });

  it('a u_bend with reach stores the reach as both end steps', () => {
    const a = run(twoRects(), [
      { op: 'add_edge', ref: 'e', from: obj(1), to: obj(2), auto_type: 'u_bend_down', reach: 33 },
    ]);
    const created = a['created'] as Record<string, string>;
    const params = ((frameOf(a, 'addobjects') as Frame).changes[objPath(created['e'] as string)] as JsonObject)[
      'params'
    ] as JsonObject[];
    expect(params[0]?.['step']).toBe(33);
    expect(params[params.length - 1]?.['step']).toBe(33);
    expect(params[0]?.['autotype']).toBe(7);
  });

  it('a self-loop from sides compiles; one with sides on two nodes is refused', () => {
    const a = run(twoRects(), [
      { op: 'add_edge', ref: 'e', from: obj(1), to: obj(1), from_side: 'right', to_side: 'top' },
    ]);
    expect(a['ok'], JSON.stringify(a).slice(0, 300)).toBe(true);
    expectRefusal(
      run(twoRects(), [{ op: 'add_edge', from: obj(1), to: obj(2), from_side: 'right' }]),
      'invalid_operation',
      0,
      'apply only to a self-loop',
    );
  });

  it('refuses labels that are not an array of objects, and a label position out of range', () => {
    expectRefusal(
      run(twoRects(), [{ op: 'add_edge', from: obj(1), to: obj(2), texts: 'hi' }]),
      'invalid_operation',
      0,
      'is an array of {text, position}',
    );
    expectRefusal(
      run(twoRects(), [{ op: 'add_edge', from: obj(1), to: obj(2), texts: [{ text: 'x', position: 2 }] }]),
      'invalid_operation',
      0,
      'label position is a fraction from 0 to 1',
    );
  });
});

describe('delete and clear_page (DeltaDelete)', () => {
  const withEdge = (): JsonObject =>
    board({
      [obj(1)]: rectBody(100, 100, 80, 40, 1000),
      [obj(2)]: rectBody(300, 100, 80, 40, 2000),
      [obj(3)]: autoLine(obj(1), obj(2), 3000),
    });

  it('delete_node takes its edges, each conditioned on existing', () => {
    const a = run(withEdge(), [{ op: 'delete_node', node: obj(1) }]);
    const f = frameOf(a, 'delobjects') as Frame;
    expect(Object.keys(f.changes).sort()).toEqual([objPath(obj(1)), objPath(obj(3))].sort());
    expect(f.changes[objPath(obj(1))]).toBeNull();
    expect(f.conditions[objPath(obj(3))]).toEqual({ $exists: true });
    expect(a['deleted_edges']).toEqual([obj(3)]);
  });

  it('refuses the wrong kind and an absent object', () => {
    expectRefusal(run(withEdge(), [{ op: 'delete_edge', edge: obj(1) }]), 'invalid_operation', 0, 'use delete_node');
    expectRefusal(run(withEdge(), [{ op: 'delete_node', node: obj(3) }]), 'invalid_operation', 0, 'use delete_edge');
    expectRefusal(run(withEdge(), [{ op: 'delete_node', node: 'ghost' }]), 'object_not_found', 0, 'no object "ghost"');
  });

  it('clear_page nulls each object and conditions on nothing', () => {
    const a = run(withEdge(), [{ op: 'clear_page' }]);
    const f = frameOf(a, 'delobjects') as Frame;
    expect(Object.keys(f.changes).length).toBe(3);
    expect(f.conditions).toEqual({});
  });
});

describe('group and ungroup (DeltaGroup)', () => {
  it('groups two shapes in one convertobjects frame and takes the first member order', () => {
    const a = run(twoRects(), [{ op: 'group', ref: 'g', nodes: [obj(2), obj(1)] }]);
    expect(framesOf(a).map((f) => f.type)).toEqual(['convertobjects']);
    const g = (a['created'] as Record<string, string>)['g'] as string;
    const f = frameOf(a, 'convertobjects') as Frame;
    expect((f.changes[objPath(g)] as JsonObject)['order']).toBe(1000);
    expect(f.changes[objPath(obj(1))]).toBeNull();
    expect(f.conditions[objPath(obj(2))]).toEqual({ $exists: true });
    expect(a['added']).toEqual([g]);
  });

  it('refuses one member, a repeated member and an edge member', () => {
    expectRefusal(run(twoRects(), [{ op: 'group', nodes: [obj(1)] }]), 'invalid_operation', 0, 'at least two objects');
    expectRefusal(run(twoRects(), [{ op: 'group', nodes: [obj(1), obj(1)] }]), 'invalid_operation', 0, 'twice');
    const b = board({
      [obj(1)]: rectBody(100, 100, 80, 40, 1000),
      [obj(2)]: rectBody(300, 100, 80, 40, 2000),
      [obj(3)]: autoLine(obj(1), obj(2), 3000),
    });
    expectRefusal(run(b, [{ op: 'group', nodes: [obj(1), obj(3)] }]), 'invalid_operation', 0, 'is an edge');
  });

  it('ungroup restores the members contiguously at the group order and shifts what is above', () => {
    const g = uid('d1000000', 1);
    const b = board({
      [g]: {
        type: 'avabodh.basic.group',
        name: '',
        order: 100,
        params: { cx: 200, cy: 100, width: 280, height: 40, angle: 0, orig_width: 280, orig_height: 40 },
        objects: {
          [obj(1)]: groupMember(rectBody(100, 100, 80, 40, 1), 0, 100, 100, 80, 40),
          [obj(2)]: groupMember(rectBody(300, 100, 80, 40, 2), 1, 300, 100, 80, 40),
        },
      },
      [obj(3)]: rectBody(500, 100, 80, 40, 101),
    });
    const a = run(b, [{ op: 'ungroup', node: g }]);
    expect(a['ok'], JSON.stringify(a).slice(0, 300)).toBe(true);
    const conv = frameOf(a, 'convertobjects') as Frame;
    expect(conv.changes[objPath(g)]).toBeNull();
    expect((conv.changes[objPath(obj(1))] as JsonObject)['order']).toBe(100);
    expect((conv.changes[objPath(obj(2))] as JsonObject)['order']).toBe(101);
    const attr = frameOf(a, 'changeattr') as Frame;
    expect(attr.changes[`${objPath(obj(3))}.order`]).toBe(102);
    expect(attr.conditions[`${objPath(obj(3))}.order`]).toBe(101);
    expectRefusal(run(b, [{ op: 'ungroup', node: obj(3) }]), 'invalid_operation', 0, 'ungroup addresses a group');
  });
});

describe('move, resize, rotate (DeltaGeometry)', () => {
  it('move_node writes params and conditions on the values read', () => {
    const a = run(twoRects(), [{ op: 'move_node', node: obj(1), cx: 150 }]);
    const f = frameOf(a, 'changeattr') as Frame;
    expect(f.changes).toEqual({ [`${objPath(obj(1))}.params.cx`]: 150 });
    expect(f.conditions).toEqual({ [`${objPath(obj(1))}.params.cx`]: 100 });
  });

  it('refuses a size of 0 and an op with no value', () => {
    expectRefusal(
      run(twoRects(), [{ op: 'resize_node', node: obj(1), width: 0 }]),
      'invalid_operation',
      0,
      'width must be greater than 0',
    );
    expectRefusal(
      run(twoRects(), [{ op: 'rotate_node', node: obj(1) }]),
      'invalid_operation',
      0,
      'rotate_node needs at least one of the values it changes',
    );
  });
});

describe('reorder (DeltaReorder)', () => {
  const five = [1000, 2000, 3000, 4000, 5000];
  const ordersBoard = (orders: readonly number[]): JsonObject =>
    board(Object.fromEntries(orders.map((o, i) => [obj(i + 1), rectBody(100 * (i + 1), 100, 80, 40, o)])));

  const rows: [string, readonly number[], number, string, number][] = [
    ['front_from_bottom', five, 1, 'front', 5100],
    ['front_from_middle', five, 3, 'front', 5100],
    ['back_from_middle', five, 3, 'back', 900],
    ['back_from_top', five, 5, 'back', 900],
    ['forward_from_bottom', five, 1, 'forward', 2500],
    ['forward_from_middle', five, 3, 'forward', 4500],
    ['forward_from_below_top', five, 4, 'forward', 5100],
    ['backward_from_top', five, 5, 'backward', 3500],
    ['backward_from_middle', five, 3, 'backward', 1500],
    ['backward_from_above_bottom', five, 2, 'backward', 900],
    ['forward_odd_gap', [1000, 1003, 1010], 1, 'forward', 1006],
    ['backward_odd_gap', [1000, 1007, 1010], 3, 'backward', 1004],
    ['forward_gap_of_two', [1000, 1002, 1004], 1, 'forward', 1003],
    ['backward_negative', [-5000, -3000, -1000], 3, 'backward', -4000],
    ['forward_negative', [-5000, -3000, -1000], 1, 'forward', -2000],
  ];
  it.each(rows)('%s', (_label, orders, target, to, expected) => {
    const a = run(ordersBoard(orders), [{ op: 'reorder', node: obj(target), to }]);
    const f = frameOf(a, 'changeattr') as Frame;
    const path = `${objPath(obj(target))}.order`;
    expect(Object.keys(f.changes)).toEqual([path]);
    expect(f.changes[path]).toBe(expected);
    expect(f.conditions[path]).toBe(orders[target - 1]);
  });

  it('emits no frame at the end it is already at', () => {
    for (const [target, to] of [
      [5, 'forward'],
      [1, 'backward'],
      [5, 'front'],
      [1, 'back'],
    ] as const) {
      const a = run(ordersBoard(five), [{ op: 'reorder', node: obj(target), to }]);
      expect(a['frame_count']).toBe(0);
      expect(a['op_count']).toBe(1);
    }
  });

  it('refuses an unknown direction and an object the batch creates', () => {
    expectRefusal(
      run(ordersBoard(five), [{ op: 'reorder', node: obj(1), to: 'up' }]),
      'invalid_operation',
      0,
      'must be front, back, forward or backward, not "up"',
    );
    expectRefusal(
      run(ordersBoard(five), [rect({ ref: 'n', cx: 0, cy: 0 }), { op: 'reorder', node: 'n', to: 'front' }]),
      'invalid_operation',
      1,
      'is created by this batch (operation 0)',
    );
  });
});
