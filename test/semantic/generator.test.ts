// The whole-board generator (`semantic/generator.ts`, port of C++ `SemanticGenerator`): the
// content envelope, the page skeleton, the tree's own group checks and, once the delta compiler
// is in, assembly, placement and the load-back. Cases ported from the C++ `Generator*Test`
// suites (`GeneratorSupport.h`'s `isGenRefusal`), synthetic content only.
import { describe, expect, it } from 'vitest';
import { CanvasSizeType } from '../../src/model';
import { compileToNode, generate } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { Unit } from '../../src/style';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import type { JsonObject, JsonValue } from '../../src/template';
import { testRuntime } from '../session/helpers';

const RECT = 'avabodh.basic.rectangle';

const runtime = testRuntime();

function session(): BoardSession {
  return new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
}

type Obj = Record<string, JsonValue>;
const rect = (ref: string, width = 40, height = 20): Obj => ({ ref, shape: RECT, width, height });
const rectAt = (ref: string, cx: number, cy: number): Obj => ({ ...rect(ref), cx, cy });
const group = (id: string, children: JsonValue): Obj => ({ id, children });

interface At {
  readonly page?: number;
  readonly node?: number;
  readonly edge?: number;
}

/** C++ `isGenRefusal`: refused with `code`, `page`/`node`/`edge` exactly as `at`, nothing else carried. */
function expectRefusal(answer: JsonObject, code: string, at: At, substrings: readonly string[] = []): void {
  expect(answer['ok'], JSON.stringify(answer)).toBe(false);
  expect(answer['error'], JSON.stringify(answer)).toBe(code);
  expect(answer['page']).toBe(at.page);
  expect(answer['node']).toBe(at.node);
  expect(answer['edge']).toBe(at.edge);
  const message = typeof answer['message'] === 'string' ? answer['message'] : '';
  for (const s of substrings) expect(message).toContain(s);
  for (const k of Object.keys(answer)) expect(['ok', 'error', 'message', 'page', 'node', 'edge']).toContain(k);
}

function gen(content: JsonValue | string): { answer: JsonObject; s: BoardSession } {
  const s = session();
  return { answer: generate(s, content), s };
}

/** `levels` groups nested one inside the next: `g<levels>` spans `levels` levels. */
function nestedDeep(levels: number): Obj {
  const nodes: Obj[] = [rectAt('s0', 10, 10), rectAt('s1', 80, 10), group('g1', ['s0', 's1'])];
  for (let i = 2; i <= levels; i++) {
    nodes.push(rectAt(`s${String(i)}`, 10 * i, 200));
    nodes.push(group(`g${String(i)}`, [`g${String(i - 1)}`, `s${String(i)}`]));
  }
  return { nodes };
}

function compilerPorted(): boolean {
  try {
    const s = session();
    const page = s.document.pages[0]?.id ?? '';
    compileToNode(s.semanticContext(), {
      version: 0,
      page,
      ops: [
        { op: 'add_node', ref: 'a', shape: RECT, cx: 0, cy: 0 },
        { op: 'add_node', ref: 'b', shape: RECT, cx: 90, cy: 0 },
        { op: 'add_edge', from: 'a', to: 'b' },
        { op: 'group', nodes: ['a', 'b'] },
      ],
    });
    return true;
  } catch (e) {
    return !(e as Error).message.includes('not ported');
  }
}

describe('generator: the content envelope (GeneratorContentMalformed)', () => {
  const node = JSON.stringify(rectAt('a', 10, 10));
  const rows: readonly (readonly [string, string, string])[] = [
    ['not_json', 'nope', 'the content is not a JSON object'],
    ['empty_text', '', 'the content is not a JSON object'],
    ['json_array', '[1,2]', 'the content is not a JSON object'],
    ['json_string', '"board"', 'the content is not a JSON object'],
    ['json_number', '42', 'the content is not a JSON object'],
    ['pages_object', '{"pages":{}}', '`pages` must be an array'],
    ['pages_string', '{"pages":"one"}', '`pages` must be an array'],
    ['pages_null', '{"pages":null}', '`pages` must be an array'],
    ['pages_empty', '{"pages":[]}', '`pages` is empty'],
    ['page_entry_number', '{"pages":[{},3]}', 'a page definition must be an object'],
    ['page_entry_array', '{"pages":[[]]}', 'a page definition must be an object'],
    ['top_nodes_object', '{"nodes":{}}', '`nodes` must be an array'],
    ['top_node_entry_string', `{"nodes":[${node},"x"]}`, 'a node must be an object'],
    ['top_edges_object', '{"edges":{}}', '`edges` must be an array'],
    ['top_edge_entry_number', `{"nodes":[${node}],"edges":[1]}`, 'an edge must be an object'],
    ['page_nodes_string', '{"pages":[{"nodes":"a"}]}', '`nodes` must be an array'],
    ['page_node_entry_array', '{"pages":[{"nodes":[[]]}]}', 'a node must be an object'],
    ['page_edges_number', '{"pages":[{},{"edges":7}]}', '`edges` must be an array'],
    ['page_edge_entry_null', '{"pages":[{"edges":[null]}]}', 'an edge must be an object'],
  ];
  it.each(rows)('%s is refused as a whole', (_label, content, message) => {
    const s = session();
    const before = runtime.ids.next();
    const answer = generate(s, content);
    expectRefusal(answer, 'invalid_operation', {}, [message]);
    // Refused before the skeleton: not one id is minted.
    const after = runtime.ids.next();
    expect(parseInt(after.slice(-12), 16) - parseInt(before.slice(-12), 16)).toBe(1);
  });
});

describe('generator: the skeleton without nodes', () => {
  it('no pages and no nodes is one empty page', () => {
    const { answer, s } = gen({});
    expect(answer['ok']).toBe(true);
    expect(answer['node_count']).toBe(0);
    expect(answer['object_count']).toBe(0);
    expect(s.document.pages).toHaveLength(1);
  });

  it('page names from definitions or the default, and order 1..n', () => {
    const { answer, s } = gen({ name: 'Board', pages: [{ name: 'Intro' }, {}, { name: '' }, { name: 'Last' }] });
    expect(answer['ok']).toBe(true);
    expect(answer['name']).toBe('Board');
    const pages = answer['pages'] as JsonObject[];
    expect(pages.map((p) => p['name'])).toEqual(['Intro', 'Page 2', 'Page 3', 'Last']);
    expect(pages.map((p) => p['order'])).toEqual([1, 2, 3, 4]);
    expect(s.document.pages.map((p) => p.id)).toEqual(pages.map((p) => p['id']));
    expect(s.document.name).toBe('Board');
  });

  it('the implicit page never takes the board name', () => {
    const { answer } = gen({ name: 'Refund process' });
    expect((answer['pages'] as JsonObject[])[0]?.['name']).toBe('Page 1');
  });

  it.each([
    [
      'fixed_cm',
      { type: 'fixed', width: 21, height: 29.7, unit: 'cm' },
      CanvasSizeType.Fixed,
      21,
      29.7,
      Unit.Centimeter,
      '',
    ],
    [
      'name_stored',
      { type: 'fixed', width: 8.5, height: 11, unit: 'inch', name: 'Letter' },
      CanvasSizeType.Fixed,
      8.5,
      11,
      Unit.Inch,
      'Letter',
    ],
    ['empty_name_stored', { type: 'auto', name: '' }, CanvasSizeType.Auto, 0, 0, Unit.Point, ''],
    ['name_on_infinite', { name: 'Infinite' }, CanvasSizeType.Infinite, 0, 0, Unit.Point, 'Infinite'],
    [
      'read_auto_zero_size',
      { type: 'auto', width: 0, height: 0, unit: 'inch' },
      CanvasSizeType.Auto,
      0,
      0,
      Unit.Inch,
      '',
    ],
  ] as const)('canvas %s is stored', (_l, canvas, type, w, h, unit, name) => {
    const { answer, s } = gen({ pages: [{ canvas }] });
    expect(answer['ok'], JSON.stringify(answer)).toBe(true);
    const page = s.document.pages[0];
    expect(page?.canvasSizeType).toBe(type);
    expect(page?.size.width).toBeCloseTo(w, 4);
    expect(page?.size.height).toBeCloseTo(h, 4);
    expect(page?.size.unit).toBe(unit);
    expect(page?.canvasName).toBe(name);
  });

  it.each([
    ['fixed_without_size', { type: 'fixed' }],
    ['fixed_width_only', { type: 'fixed', width: 500 }],
    ['fixed_height_only', { type: 'fixed', height: 500 }],
    ['fixed_negative_width', { type: 'fixed', width: -10, height: 500 }],
    ['fixed_unit_without_size', { type: 'fixed', unit: 'inch' }],
  ] as const)('%s is refused at its page', (_l, canvas) => {
    const { answer } = gen({ pages: [{ canvas }] });
    expectRefusal(answer, 'invalid_operation', { page: 0 });
    expect(answer['message']).toBe('a "fixed" canvas needs a positive width and height');
  });

  it.each([
    [
      'unknown_unit',
      '{"type":"fixed","width":1,"height":1,"unit":"furlong"}',
      'unit is "point", "inch" or "cm", not "furlong"',
    ],
    [
      'legacy_pixel_not_written',
      '{"type":"fixed","width":1,"height":1,"unit":"pixel"}',
      'unit is "point", "inch" or "cm", not "pixel"',
    ],
    ['capitalised_unit', '{"type":"auto","unit":"Inch"}', 'unit is "point", "inch" or "cm", not "Inch"'],
    ['number_unit', '{"type":"auto","unit":7}', 'unit is "point", "inch" or "cm", not "7"'],
    [
      'auto_with_width',
      '{"type":"auto","width":500}',
      'an auto canvas has no size; send canvas_type "fixed" with a width and height',
    ],
    [
      'infinite_with_size',
      '{"type":"infinite","width":320,"height":240}',
      'an infinite canvas has no size; send canvas_type "fixed" with a width and height',
    ],
    [
      'no_type_is_infinite',
      '{"width":320,"height":240}',
      'an infinite canvas has no size; send canvas_type "fixed" with a width and height',
    ],
    ['name_not_a_string', '{"type":"auto","name":7}', 'canvas name is a string'],
  ])('canvas %s is refused at its page', (_l, canvas, message) => {
    const { answer } = gen(`{"pages":[{"name":"Good"},{"canvas":${canvas}}]}`);
    expectRefusal(answer, 'invalid_operation', { page: 1 });
    expect(answer['message']).toBe(message);
  });

  it.each(['fixd', 'infnite', 'Fixed', 'INFINITE', 'auto '])(
    'canvas type typo %j is refused at the envelope',
    (type) => {
      const { answer } = gen({ pages: [{ name: 'Good' }, { canvas: { type } }] });
      expectRefusal(answer, 'invalid_operation', {});
      expect(answer['message']).toBe(`canvas type is "infinite", "fixed" or "auto", not "${type}"`);
    },
  );

  const needs = 'a page margin needs left_right and top_bottom greater than 0; for no margin, leave `margin` out';
  it.each([
    ['not_an_object', '0.5', needs],
    ['missing_top_bottom', '{"left_right":0.5}', needs],
    ['zero', '{"left_right":0,"top_bottom":0.5}', needs],
    ['negative', '{"left_right":0.5,"top_bottom":-1}', needs],
    [
      'stored_names',
      '{"width":0.5,"height":0.5}',
      'a page margin takes left_right and top_bottom (the inset on each side), not width and height',
    ],
    [
      'unknown_member',
      '{"left_right":0.5,"top_bottom":0.5,"show":true}',
      'a page margin has no member "show"; it takes left_right, top_bottom and unit',
    ],
    ['unknown_unit', '{"left_right":0.5,"top_bottom":0.5,"unit":"mm"}', 'unit is "point", "inch" or "cm", not "mm"'],
  ])('margin %s is refused at its page', (_l, margin, message) => {
    const { answer } = gen(`{"pages":[{},{"margin":${margin}}]}`);
    expectRefusal(answer, 'invalid_operation', { page: 1 });
    expect(answer['message']).toBe(message);
  });

  it('a margin is stored, in the page unit by default', () => {
    const { answer, s } = gen({
      pages: [
        {
          canvas: { type: 'fixed', width: 8.5, height: 11, unit: 'inch' },
          margin: { left_right: 0.5, top_bottom: 0.75 },
        },
      ],
    });
    expect(answer['ok']).toBe(true);
    const m = s.document.pages[0]?.margin;
    expect(m?.show).toBe(true);
    expect(m?.size.width).toBeCloseTo(0.5, 5);
    expect(m?.size.height).toBeCloseTo(0.75, 5);
    expect(m?.size.unit).toBe(Unit.Inch);
  });

  it.each([
    ['defaults', undefined, undefined, true, 1, Unit.Point],
    ['grid_object_off', { present: false }, undefined, false, 1, Unit.Point],
    ['grid_bool_off', false, undefined, false, 1, Unit.Point],
    ['scaling_inch', undefined, { scale: 2.5, unit: 'inch' }, true, 2.5, Unit.Inch],
    ['scaling_without_unit_is_points', undefined, { scale: 4 }, true, 4, Unit.Point],
    ['both', { present: false }, { scale: 10, unit: 'cm' }, false, 10, Unit.Centimeter],
  ] as const)('document attributes %s are stored', (_l, grid, scaling, present, scale, unit) => {
    const content: Obj = {};
    if (grid !== undefined) content['grid'] = grid;
    if (scaling !== undefined) content['scaling'] = scaling;
    const { answer, s } = gen(content);
    expect(answer['ok']).toBe(true);
    expect(s.document.grid.present).toBe(present);
    expect(s.document.scaling.value).toBeCloseTo(scale, 5);
    expect(s.document.scaling.unit).toBe(unit);
  });

  it.each([
    ['grid_present_not_bool', 'grid', '{"present":"yes"}', 'grid is {"present": true} or {"present": false}'],
    ['grid_number', 'grid', '1', 'grid is {"present": true} or {"present": false}'],
    ['scaling_zero', 'scaling', '{"scale":0}', 'scaling needs a positive `scale`'],
    ['scaling_negative', 'scaling', '{"scale":-1,"unit":"inch"}', 'scaling needs a positive `scale`'],
    ['scaling_missing_scale', 'scaling', '{"unit":"inch"}', 'scaling needs a positive `scale`'],
    ['scaling_not_object', 'scaling', '2', 'scaling needs a positive `scale`'],
    [
      'scaling_unknown_unit',
      'scaling',
      '{"scale":1,"unit":"furlong"}',
      'unit is "point", "inch" or "cm", not "furlong"',
    ],
  ])('document attribute %s is refused as a whole', (_l, key, json, message) => {
    const { answer } = gen(`{"${key}":${json}}`);
    expectRefusal(answer, 'invalid_operation', {});
    expect(answer['message']).toBe(message);
  });

  it.each([
    ['six', '#aabbcc', 0xaa],
    ['three', '#abc', 0xaa],
  ])('background %s is stored', (_l, color, red) => {
    const { answer, s } = gen({ pages: [{ background: { color } }] });
    expect(answer['ok']).toBe(true);
    expect(s.document.pages[0]?.background.color.red).toBe(red);
  });

  it('a bad background colour is refused naming the value', () => {
    const { answer } = gen({ pages: [{ background: { color: 'red' } }] });
    expectRefusal(answer, 'invalid_operation', {}, ['"red" is not a colour']);
  });
});

describe('generator: refs across the board', () => {
  it('a ref reused on a later page is refused at the second use', () => {
    const { answer } = gen({
      pages: [{ nodes: [rectAt('a', 10, 10)] }, { nodes: [{ id: 'a', shape: RECT, cx: 10, cy: 10 }] }],
    });
    expectRefusal(answer, 'invalid_operation', { page: 1, node: 0 }, ['ref "a"', 'is already used by page 0 node 0']);
  });

  it("an edge ref repeating a node's ref is refused at the edge", () => {
    const { answer } = gen({
      nodes: [rectAt('a', 10, 10), rectAt('b', 90, 10)],
      edges: [{ ref: 'a', from: 'a', to: 'b' }],
    });
    expectRefusal(answer, 'invalid_operation', { page: 0, edge: 0 }, [
      'ref "a" is already used by page 0 node 0',
      'one object',
    ]);
  });

  it("an edge ref repeating another edge's is refused at the second edge", () => {
    const { answer } = gen({
      pages: [
        { nodes: [rectAt('a', 10, 10), rectAt('b', 90, 10)], edges: [{ ref: 'e', from: 'a', to: 'b' }] },
        { nodes: [rectAt('c', 10, 10), rectAt('d', 90, 10)], edges: [{ ref: 'e', from: 'c', to: 'd' }] },
      ],
    });
    expectRefusal(answer, 'invalid_operation', { page: 1, edge: 0 }, ['page 0 edge 0']);
  });
});

describe("generator: the tree's own group checks", () => {
  const ab = [rectAt('a', 10, 10), rectAt('b', 80, 10)];
  it.each([
    ['shape', RECT, 'answers no template'],
    ['cx', 10, 'geometry comes from its members'],
    ['angle', 0.5, 'geometry comes from its members'],
    ['texts', [{ text: 'Card' }], 'answers no template'],
    ['style', { fill: '#fff' }, 'answers no template'],
    ['z_order', 4, "first member's order"],
  ] as const)('a group node carrying %s is refused at the group node', (key, value, message) => {
    const { answer } = gen({ nodes: [...ab, { ...group('card', ['a', 'b']), [key]: value as JsonValue }] });
    expectRefusal(answer, 'invalid_operation', { page: 0, node: 2 }, [`\`${key}\``, message]);
  });

  it('children must be an array of ids', () => {
    expectRefusal(gen({ nodes: [...ab, group('card', 'a')] }).answer, 'invalid_operation', { page: 0, node: 2 }, [
      '`children` must be an array',
    ]);
    expectRefusal(gen({ nodes: [...ab, group('card', ['a', 7])] }).answer, 'invalid_operation', { page: 0, node: 2 }, [
      'every entry of `children`',
    ]);
  });

  it('a cycle in children is refused naming the groups on it', () => {
    const { answer } = gen({ nodes: [...ab, group('g1', ['a', 'g2']), group('g2', ['b', 'g1'])] });
    expectRefusal(answer, 'invalid_operation', { page: 0, node: 2 }, ['cycle', '"g1"', '"g2"']);
    expect(answer['message']).toContain('group "g1" -> group "g2" -> group "g1"');
  });

  it('a group that names itself is a cycle', () => {
    const { answer } = gen({ nodes: [...ab, group('g1', ['a', 'b', 'g1'])] });
    expectRefusal(answer, 'invalid_operation', { page: 0, node: 2 }, ['cycle', '"g1"']);
  });

  it('a node claimed by two parents is refused naming both', () => {
    const { answer } = gen({
      nodes: [...ab, rectAt('c', 150, 10), group('left', ['a', 'b']), group('right', ['b', 'c'])],
    });
    expectRefusal(answer, 'invalid_operation', { page: 0, node: 4 }, ['"b"', '"left"', '"right"']);
  });

  it('a cross-page child is refused', () => {
    const { answer } = gen({ pages: [{ nodes: ab }, { nodes: [rectAt('c', 10, 10), group('card', ['c', 'a'])] }] });
    expectRefusal(answer, 'invalid_operation', { page: 1, node: 1 }, ['"a"', 'same page']);
  });

  it('content deeper than the cap is refused up front', () => {
    const { answer } = gen(nestedDeep(6));
    expectRefusal(answer, 'invalid_operation', { page: 0, node: 12 }, ['6', '5']);
  });
});

describe.runIf(compilerPorted())('generator: assembly through the delta compiler', () => {
  it('top-level nodes and edges are one page', () => {
    const { answer, s } = gen({ nodes: [rectAt('a', 10, 10), rectAt('b', 90, 10)], edges: [{ from: 'a', to: 'b' }] });
    expect(answer['ok'], JSON.stringify(answer)).toBe(true);
    expect(answer['node_count']).toBe(2);
    expect(answer['edge_count']).toBe(1);
    expect(answer['object_count']).toBe(3);
    expect(Object.keys(answer['created'] as JsonObject).sort()).toEqual(['a', 'b']);
    expect(s.document.pages[0]?.objectStore.objects).toHaveLength(3);
  });

  it('auto-placed nodes form a column below the previous one', () => {
    const { answer, s } = gen({ nodes: [rect('a'), rect('b')] });
    expect(answer['ok'], JSON.stringify(answer)).toBe(true);
    expect(answer['placed']).toBe(2);
    const created = answer['created'] as Record<string, string>;
    const store = s.document.pages[0]?.objectStore;
    const a = store?.getObject(created['a'] ?? '')?.unrotatedRect();
    const b = store?.getObject(created['b'] ?? '')?.unrotatedRect();
    expect(a?.center().x).toBeCloseTo(40 + 20, 3);
    expect(a?.center().y).toBeCloseTo(40 + 10, 3);
    expect(b?.center().y).toBeCloseTo(50 + 10 + 24 + 10, 3);
  });

  it('a duplicate ref on one page is refused at the second node', () => {
    expectRefusal(
      gen({ nodes: [rectAt('a', 10, 10), rectAt('b', 90, 10), rectAt('a', 170, 10)] }).answer,
      'invalid_operation',
      { page: 0, node: 2 },
      ['ref "a"'],
    );
    expectRefusal(gen({ nodes: [rect('a'), rect('a')] }).answer, 'invalid_operation', { page: 0, node: 1 }, [
      'ref "a"',
    ]);
  });

  it('nested groups exactly at the cap are accepted and counted into', () => {
    const { answer } = gen(nestedDeep(5));
    expect(answer['ok'], JSON.stringify(answer)).toBe(true);
    expect(answer['node_count']).toBe(11);
    expect(answer['object_count']).toBe(11);
  });

  it('a group with no members is refused by the compiler at its node', () => {
    const { answer } = gen({ nodes: [rectAt('a', 10, 10), group('card', [])] });
    expectRefusal(answer, 'invalid_operation', { page: 0, node: 1 }, ['a group needs at least two objects']);
  });

  it('a child that is not on the board is refused by the compiler at its node', () => {
    const { answer } = gen({ nodes: [rectAt('a', 10, 10), rectAt('b', 80, 10), group('card', ['a', 'nope'])] });
    expectRefusal(answer, 'object_not_found', { page: 0, node: 2 }, ['nope']);
  });
});
