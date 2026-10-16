// The delta compiler's attribute, page and document operations (semantic/delta/ops-edits.ts): a
// representative port of the C++ Delta{Text,Title,ShapeParams,Style,Arrow,EdgeRoute,EdgeTexts,
// PageDoc,FramesPolicy,Vocabulary} suites over synthetic boards.
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import type { JsonObject, JsonValue } from '../../src/template';
import { testRuntime } from '../session/helpers';

const P = 'pageA';
const A = 'shapeA';
const B = 'shapeB';
const E = 'edgeAB';

const RECT_TEMPLATE = {
  data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
  default: { angle: 0, height: 10, width: 10 },
  draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 0 1' }],
  flags: 31,
  id: 'avabodh.basic.rectangle',
  polygon: true,
};

function rect(order: number, cx: number, text: string, extra: Record<string, JsonValue> = {}): JsonObject {
  return {
    name: '',
    order,
    params: { angle: 0, cx, cy: 150, height: 60, width: 120 },
    template: { ...RECT_TEMPLATE, texts: [{ location: 'default', text }], ...extra },
    type: 'templated',
  };
}

function board(pages: Record<string, JsonValue> = {}, attributes: JsonObject = {}): JsonObject {
  return {
    attributes: { grid: { present: true }, scaling: { scale: 1, unit: 'point' }, ...attributes },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: {
      [P]: {
        background: { color: -1 },
        canvasname: 'Infinite',
        canvassizetype: 'infinite',
        name: 'Page 1',
        order: 0,
        size: { height: 0, unit: 'point', width: 0 },
        objects: {
          [A]: rect(1, 150, 'Start', { style: { fillpaint: { color: -65536, type: 2 } } }),
          [B]: rect(2, 450, 'End'),
          [E]: {
            arrows: {
              end: {
                data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', '0'],
                default: { angle: 0, height: 9, width: 6 },
                draw: [{ path: 'M 0 1 L 2 3 L 4 5 Z' }],
                id: 'avabodh.arrow.str',
                style: { fillpaint: { color: -1, type: 2 } },
              },
            },
            ctype: 2,
            order: 3,
            params: [
              { angle: 0, autotype: 4, dx: 0, dy: 0, step: 40 },
              { angle: 0, dx: 0, dy: 0, step: 40 },
            ],
            source: A,
            target: B,
            text: '',
            texts: [{ param: 0.5, text: 'next' }],
            type: 'avabodh.basic.connection',
          },
        },
      },
      ...pages,
    },
  };
}

const runtime = testRuntime();

function compileOn(doc: JsonObject, ops: JsonValue[], extra: Record<string, JsonValue> = {}): JsonObject {
  const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  const r = s.load(doc);
  expect(r.ok).toBe(true);
  const answer = compile(s, { version: 7, page: P, ops, ...extra });
  s.dispose();
  expect(answer).not.toBeNull();
  return answer as JsonObject;
}

function frames(a: JsonObject): JsonObject[] {
  return (a['frames'] ?? []) as JsonObject[];
}
function frameOf(a: JsonObject, type: string): JsonObject {
  const f = frames(a).find((x) => x['type'] === type);
  expect(f, `no ${type} frame in ${JSON.stringify(a)}`).toBeDefined();
  return f as JsonObject;
}
function changes(f: JsonObject): JsonObject {
  return f['changes'] as JsonObject;
}
function conditions(f: JsonObject): JsonObject {
  return f['conditions'] as JsonObject;
}
function refused(a: JsonObject, code: string, message: string): void {
  expect(a['ok'], JSON.stringify(a)).toBe(false);
  expect(a['error']).toBe(code);
  expect(a['message']).toEqual(expect.stringContaining(message));
}

const obj = (id: string) => `doc.pages.${P}.objects.${id}`;

describe('set_text', () => {
  it('replaces the whole template, conditioned on the slot as read, with the geometry probe', () => {
    const a = compileOn(board(), [{ op: 'set_text', node: A, text: 'Go' }]);
    expect(a['ok']).toBe(true);
    expect(frames(a).map((f) => f['type'])).toEqual(['changeattr']);
    const f = frameOf(a, 'changeattr');
    expect(Object.keys(changes(f)).sort()).toEqual(
      ['template', 'params.cx', 'params.cy', 'params.width', 'params.height', 'params.angle']
        .map((k) => `${obj(A)}.${k}`)
        .sort(),
    );
    const t = changes(f)[`${obj(A)}.template`] as JsonObject;
    expect((t['texts'] as JsonObject[])[0]?.['text']).toBe('Go');
    expect(changes(f)[`${obj(A)}.params.cx`]).toBe(150);
    expect(conditions(f)).toEqual({ [`${obj(A)}.template.texts.0.text`]: 'Start' });
  });

  it('refuses an out-of-range index, a cell address on a plain shape, and a missing text', () => {
    refused(
      compileOn(board(), [{ op: 'set_text', node: A, text: 'x', index: 3 }]),
      'invalid_operation',
      'text index 3 is out of range: this shape has 1 text slot(s)',
    );
    refused(
      compileOn(board(), [{ op: 'set_text', node: A, text: 'x', row: 0 }]),
      'invalid_operation',
      'a cell address needs both `row` and `col`',
    );
    refused(compileOn(board(), [{ op: 'set_text', node: A }]), 'invalid_operation', 'set_text needs `text`');
    refused(
      compileOn(board(), [{ op: 'set_text', node: 'nobody', text: 'x' }]),
      'object_not_found',
      'no object "nobody" on page pageA',
    );
    refused(
      compileOn(board(), [{ op: 'set_text', node: E, text: 'x' }]),
      'invalid_operation',
      'set_text addresses a node; "edgeAB" is an edge',
    );
  });

  it('two texts in one batch build on the working template', () => {
    const a = compileOn(board(), [
      { op: 'set_text', node: A, text: 'one' },
      { op: 'set_text', node: A, text: 'two' },
    ]);
    const t = changes(frameOf(a, 'changeattr'))[`${obj(A)}.template`] as JsonObject;
    expect((t['texts'] as JsonObject[])[0]?.['text']).toBe('two');
  });
});

describe('set_title', () => {
  it('refuses a shape without a title and an empty op', () => {
    refused(
      compileOn(board(), [{ op: 'set_title', node: A, text: 'T' }]),
      'invalid_operation',
      'set_title: node shapeA (avabodh.basic.rectangle) has no title; its stencil declares none',
    );
    refused(
      compileOn(board(), [{ op: 'set_title', node: E, text: 'T' }]),
      'invalid_operation',
      'set_title: node edgeAB is an edge',
    );
  });

  it('patches a declared title with text, side and a style pin, each conditioned', () => {
    const titled = board();
    const objects = (titled['pages'] as JsonObject)[P] as JsonObject;
    const shapes = objects['objects'] as Record<string, JsonValue>;
    shapes[A] = rect(1, 150, 'Body', {
      texts: [
        { location: 'default', text: 'Body' },
        { external: 'top', location: 'default', text: 'Title' },
      ],
    });
    const a = compileOn(titled, [{ op: 'set_title', node: A, text: 'New', side: 'bottom', style: { font_size: 20 } }]);
    expect(a['ok'], JSON.stringify(a)).toBe(true);
    const f = frameOf(a, 'changeattr');
    const texts = (changes(f)[`${obj(A)}.template`] as JsonObject)['texts'] as JsonObject[];
    expect(texts[1]).toMatchObject({ external: 'bottom', text: 'New', style: { fontsize: 20 } });
    expect(conditions(f)).toEqual({
      [`${obj(A)}.template.texts.1.text`]: 'Title',
      [`${obj(A)}.template.texts.1.external`]: 'top',
      [`${obj(A)}.template.texts.1.style.fontsize`]: { $exists: false },
    });
    refused(
      compileOn(titled, [{ op: 'set_title', node: A, style: { stroke: '#000000' } }]),
      'invalid_operation',
      'set_title.style.stroke is not a text style key; restyle the node with set_style',
    );
    refused(
      compileOn(titled, [{ op: 'set_title', node: A, side: 'middle' }]),
      'invalid_operation',
      'set_title.side is one of "top", "bottom", "left", "right"',
    );
  });
});

describe('set_style', () => {
  it('writes the template form, conditioned on the value as read or its absence', () => {
    const a = compileOn(board(), [{ op: 'set_style', node: A, style: { fill: '#00ff00', stroke_width: 3 } }]);
    expect(a['ok'], JSON.stringify(a)).toBe(true);
    const f = frameOf(a, 'changestyle');
    expect(changes(f)).toEqual({
      [`${obj(A)}.template.style.fillpaint`]: { type: 2, color: -16711936 },
      [`${obj(A)}.template.style.strokewidth`]: 3,
    });
    expect(conditions(f)).toEqual({
      [`${obj(A)}.template.style.fillpaint`]: { color: -65536, type: 2 },
      [`${obj(A)}.template.style.strokewidth`]: { $exists: false },
    });
  });

  it('elides a write that changes nothing (B1) and refuses inert and unknown keys', () => {
    const same = compileOn(board(), [{ op: 'set_style', node: A, style: { fill: '#ff0000' } }]);
    expect(same['ok']).toBe(true);
    expect(frames(same)).toEqual([]);
    refused(
      compileOn(board(), [{ op: 'set_style', edge: E, style: { fill: '#ff0000' } }]),
      'invalid_operation',
      '"edgeAB" does not draw fill: an edge draws no fill',
    );
    refused(
      compileOn(board(), [{ op: 'set_style', node: A, style: { colour: '#ff0000' } }]),
      'invalid_operation',
      '"colour" is not a style attribute this surface carries',
    );
    refused(
      compileOn(board(), [{ op: 'set_style', node: A, style: { stroke_width: -1 } }]),
      'invalid_operation',
      'style.stroke_width: -1 is not a width; use 0 or more',
    );
    refused(
      compileOn(board(), [{ op: 'set_style', node: A, style: { dash_array: [0.4] } }]),
      'invalid_operation',
      'style.dash_array: every length truncates to 0',
    );
  });

  it('stores enums, decorations and dashes in the loader form; an edge stores the short form', () => {
    const a = compileOn(board(), [
      {
        op: 'set_style',
        node: A,
        style: {
          font_weight: 'bold',
          text_decoration: ['underline', 'strikethrough'],
          dash_array: [5.7, 2, 1, 1, 9],
          cap_style: 'square',
        },
      },
      { op: 'set_style', edge: E, style: { stroke: '#0000ff' } },
    ]);
    expect(a['ok'], JSON.stringify(a)).toBe(true);
    const c = changes(frameOf(a, 'changestyle'));
    expect(c[`${obj(A)}.template.style.fontweight`]).toBe(2);
    expect(c[`${obj(A)}.template.style.textdecoration`]).toBe(10);
    expect(c[`${obj(A)}.template.style.dasharray`]).toEqual([5, 2, 1, 1]);
    expect(c[`${obj(A)}.template.style.capstyle`]).toBe(3);
    expect(c[`${obj(E)}.style.strokepaint`]).toEqual({ type: 2, color: -16776961 });
  });
});

describe('set_template_params', () => {
  it('refuses a template without parameters and an empty params', () => {
    refused(
      compileOn(board(), [{ op: 'set_template_params', node: A, params: { a: 1 } }]),
      'invalid_operation',
      "this shape's template declares no parameters",
    );
    refused(
      compileOn(board(), [{ op: 'set_template_params', node: A, params: {} }]),
      'invalid_operation',
      'set_template_params needs at least one parameter in `params`',
    );
    refused(
      compileOn(board(), [{ op: 'set_template_params', node: A }]),
      'invalid_operation',
      'set_template_params needs `params` as a name/value object',
    );
  });
});

describe('set_shape', () => {
  it('carries texts and deviations onto the new stencil, conditioned on the template id', () => {
    const a = compileOn(board(), [{ op: 'set_shape', node: A, shape: 'avabodh.basic.ellipse' }]);
    expect(a['ok'], JSON.stringify(a)).toBe(true);
    const f = frameOf(a, 'changeattr');
    const t = changes(f)[`${obj(A)}.template`] as JsonObject;
    expect(t['id']).toBe('avabodh.basic.ellipse');
    expect((t['texts'] as JsonObject[])[0]?.['text']).toBe('Start');
    expect((t['style'] as JsonObject)['fillpaint']).toEqual({ color: -65536, type: 2 });
    expect(conditions(f)).toEqual({ [`${obj(A)}.template.id`]: 'avabodh.basic.rectangle' });
    refused(
      compileOn(board(), [{ op: 'set_shape', node: A, shape: 'no.such' }]),
      'unknown_stencil',
      'no stencil "no.such"',
    );
    refused(
      compileOn(board(), [{ op: 'set_shape', node: A, shape: 'lekh.semantic.path' }]),
      'invalid_operation',
      'set_shape cannot produce a lekh.semantic.path',
    );
  });
});

describe('set_arrow', () => {
  it('replaces an end, clears one with null, and refuses a closed shape', () => {
    const a = compileOn(board(), [{ op: 'set_arrow', edge: E, start: 'avabodh.arrow.str', end: null }]);
    expect(a['ok'], JSON.stringify(a)).toBe(true);
    const f = frameOf(a, 'changearrow');
    expect((changes(f)[`${obj(E)}.arrows.start`] as JsonObject)['id']).toBe('avabodh.arrow.str');
    expect(changes(f)[`${obj(E)}.arrows.end`]).toBeNull();
    expect(conditions(f)).toEqual({ [obj(E)]: { $exists: true } });
    refused(
      compileOn(board(), [{ op: 'set_arrow', node: A, end: 'avabodh.arrow.str' }]),
      'invalid_operation',
      'is a closed shape (avabodh.basic.rectangle)',
    );
    refused(
      compileOn(board(), [{ op: 'set_arrow', edge: E, end: 'no-such-head' }]),
      'unknown_stencil',
      'no arrowhead "no-such-head"',
    );
    refused(
      compileOn(board(), [{ op: 'set_arrow', edge: E }]),
      'invalid_operation',
      'set_arrow needs `start`, `end`, or both',
    );
  });
});

describe('set_edge_texts', () => {
  it('replaces the labels, drops empty ones, conditions on the edge existing', () => {
    const a = compileOn(board(), [
      { op: 'set_edge_texts', edge: E, texts: [{ text: 'a', position: 0.25 }, { text: '' }, { text: 'b' }] },
    ]);
    const f = frameOf(a, 'changeconnectiontexts');
    expect(changes(f)).toEqual({
      [`${obj(E)}.texts`]: [
        { text: 'a', param: 0.25 },
        { text: 'b', param: 0.5 },
      ],
    });
    expect(conditions(f)).toEqual({ [obj(E)]: { $exists: true } });
    refused(
      compileOn(board(), [{ op: 'set_edge_texts', edge: E, texts: [{ text: 'a', position: 2 }] }]),
      'invalid_operation',
      'label position is a fraction from 0 to 1; got 2',
    );
    refused(
      compileOn(board(), [{ op: 'set_edge_texts', edge: E, texts: [{ text: 'a', at: 1 }] }]),
      'invalid_operation',
      '"at" is not part of an edge label',
    );
  });
});

describe('set_edge_route', () => {
  it('re-asserting the auto type writes nothing; a reach on a non-U-bend is refused', () => {
    const same = compileOn(board(), [{ op: 'set_edge_route', edge: E, auto_type: 's_bend_horizontal' }]);
    expect(same['ok'], JSON.stringify(same)).toBe(true);
    expect(frames(same)).toEqual([]);
    refused(
      compileOn(board(), [{ op: 'set_edge_route', edge: E, reach: 30 }]),
      'invalid_operation',
      'reach applies to a u_bend_* edge only',
    );
    refused(
      compileOn(board(), [{ op: 'set_edge_route', edge: E }]),
      'invalid_operation',
      'set_edge_route needs either an `auto_type` or a `route`',
    );
    refused(
      compileOn(board(), [{ op: 'set_edge_route', edge: E, edge_type: 'path' }]),
      'invalid_operation',
      'an edge cannot be converted to `path`',
    );
    refused(
      compileOn(board(), [{ op: 'set_edge_route', edge: E, from_side: 'top' }]),
      'invalid_operation',
      'apply only to a self-loop; "shapeA" and "shapeB" are different nodes',
    );
  });

  it('an automatic route switch writes the engine-derived params', () => {
    const a = compileOn(board(), [{ op: 'set_edge_route', edge: E, auto_type: 'straight' }]);
    expect(a['ok'], JSON.stringify(a)).toBe(true);
    const c = changes(frameOf(a, 'changeconnectionparams'));
    const params = c[`${obj(E)}.params`] as JsonObject[];
    expect(params[0]?.['autotype']).toBe(1);
  });
});

describe('pages', () => {
  it('add_page names, orders and sizes a page like the board it joins', () => {
    const a = compileOn(board(), [{ op: 'add_page' }, { op: 'add_page', name: 'Second', order: 0 }]);
    expect(a['ok'], JSON.stringify(a)).toBe(true);
    const added = a['added_pages'] as string[];
    expect(added).toHaveLength(2);
    const c = changes(frameOf(a, 'addpages'));
    const first = c[`doc.pages.${added[0] ?? ''}`] as JsonObject;
    const second = c[`doc.pages.${added[1] ?? ''}`] as JsonObject;
    expect(first['name']).toBe('Page 2');
    expect(first['order']).toBe(100);
    expect(first['canvassizetype']).toBe('infinite');
    expect(second['name']).toBe('Second');
    expect(second['order']).toBe(-100);
  });

  it('delete_page keeps one page; rename and resize condition what they change', () => {
    refused(
      compileOn(board(), [{ op: 'delete_page', page: P }]),
      'invalid_operation',
      'a board must keep at least one page',
    );
    const r = compileOn(board(), [{ op: 'rename_page', name: 'Main' }]);
    const f = frameOf(r, 'changepageattr');
    expect(changes(f)).toEqual({ [`doc.pages.${P}.name`]: 'Main' });
    expect(conditions(f)).toEqual({ [`doc.pages.${P}.name`]: 'Page 1' });

    const z = compileOn(board(), [{ op: 'resize_page', canvas_type: 'fixed', width: 8, height: 11, unit: 'inch' }]);
    expect(z['ok'], JSON.stringify(z)).toBe(true);
    const zc = changes(frameOf(z, 'changepageattr'));
    expect(zc[`doc.pages.${P}.size`]).toEqual({ height: 11, unit: 'inch', width: 8 });
    expect(zc[`doc.pages.${P}.canvassizetype`]).toBe('fixed');
    expect(zc[`doc.pages.${P}.canvasname`]).toBe('Custom');
    refused(
      compileOn(board(), [{ op: 'resize_page', width: 100 }]),
      'invalid_operation',
      'an infinite canvas has no size',
    );
    refused(
      compileOn(board(), [{ op: 'resize_page', unit: 'mile' }]),
      'invalid_operation',
      'unit is "point", "inch" or "cm", not "mile"',
    );
  });

  it('set_page_background and set_page_margin', () => {
    const b = compileOn(board(), [{ op: 'set_page_background', color: '#000000' }]);
    const bf = frameOf(b, 'changebackground');
    expect(changes(bf)).toEqual({ [`doc.pages.${P}.background`]: { color: -16777216 } });
    expect(conditions(bf)).toEqual({ [`doc.pages.${P}.background.color`]: -1 });
    const m = compileOn(board(), [{ op: 'set_page_margin', left_right: 20, top_bottom: 30 }]);
    const mf = frameOf(m, 'changepageattr');
    expect(changes(mf)).toEqual({ [`doc.pages.${P}.margin`]: { height: 30, unit: 'point', width: 20 } });
    expect(conditions(mf)).toEqual({ [`doc.pages.${P}.margin`]: null });
    const none = compileOn(board(), [{ op: 'set_page_margin', remove: true }]);
    expect(frames(none)).toEqual([]);
    refused(
      compileOn(board(), [{ op: 'set_page_margin', left_right: 0, top_bottom: 1 }]),
      'invalid_operation',
      'set_page_margin needs left_right and top_bottom greater than 0',
    );
  });
});

describe('document', () => {
  it('set_grid and set_scaling write only a change, with default-tolerant conditions', () => {
    const same = compileOn(board(), [{ op: 'set_grid', present: true }]);
    expect(frames(same)).toEqual([]);
    const g = compileOn(board(), [{ op: 'set_grid', present: false }]);
    const gf = frameOf(g, 'changegrid');
    expect(changes(gf)).toEqual({ 'doc.attributes.grid.present': false });
    expect(conditions(gf)).toEqual({ 'doc.attributes.grid.present': { $in: [true, null] } });
    const s = compileOn(board(), [{ op: 'set_scaling', scale: 2, unit: 'cm' }]);
    const sf = frameOf(s, 'changescaling');
    expect(changes(sf)).toEqual({ 'doc.attributes.scaling': { scale: 2, unit: 'cm' } });
    expect(conditions(sf)).toEqual({
      'doc.attributes.scaling.scale': { $in: [1, null] },
      'doc.attributes.scaling.unit': { $in: ['point', null] },
    });
    refused(
      compileOn(board(), [{ op: 'set_scaling', scale: 0 }]),
      'invalid_operation',
      'set_scaling needs a positive `scale`',
    );
  });
});

describe('frames and policy', () => {
  it('orders frames by type and under strict conditions each on the version', () => {
    const a = compileOn(
      board(),
      [
        { op: 'set_style', node: A, style: { stroke_width: 7 } },
        { op: 'set_text', node: B, text: 'x' },
      ],
      { conflict_policy: 'strict' },
    );
    expect(frames(a).map((f) => f['type'])).toEqual(['changeattr', 'changestyle']);
    expect(frames(a).map((f) => conditions(f))).toEqual([{ version: 7 }, { version: 8 }]);
  });

  it('refuses an unknown member with the op vocabulary', () => {
    refused(
      compileOn(board(), [{ op: 'set_edge_texts', edge: E, texts: [], colour: 1 }]),
      'invalid_operation',
      'set_edge_texts has no member "colour"; it takes edge and texts',
    );
  });
});
