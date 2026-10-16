// The projector (`semantic/projector.ts`): a representative port of the C++ GoogleTest projector
// suites (envelope, options, node kinds, edges and routes, style, notes and the byte budget,
// region, depth cap, free-hand counts), on synthetic boards only.
import { describe, expect, it } from 'vitest';
import { project } from '../../src/semantic';
import { parseProjectOptions, storedLength } from '../../src/semantic/projector';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import type { JsonObject, JsonValue } from '../../src/template';
import { testRuntime } from '../session/helpers';

type J = Record<string, unknown>;

const uid = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = uid('beffffff', 1);
const P2 = uid('beffffff', 2);

function rect(cx: number, cy: number, w: number, h: number, order: number, text = 'r', extra: J = {}): J {
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
      ...extra,
    },
  };
}

function edge(source: string, target: string, ctype: number, params: JsonValue, order: number, extra: J = {}): J {
  return {
    type: 'avabodh.basic.connection',
    source,
    target,
    ctype,
    params,
    texts: [],
    text: '',
    name: '',
    order,
    ...extra,
  };
}

const autoLine = (s: string, t: string, order: number): J =>
  edge(s, t, 1, [{ angle: 0, autotype: 1 }, { angle: 0 }], order);

/** A group member at (cx, cy) in a group centred at (gcx, gcy) of size gw × gh. */
function member(body: J, index: number, cx: number, cy: number, w: number, h: number, g = { cx, cy, w: 1, h: 1 }): J {
  return {
    index,
    orig_cx: cx,
    orig_cy: cy,
    orig_width: w,
    orig_height: h,
    orig_angle: 0,
    xfactor: (cx - g.cx) / g.w,
    yfactor: (cy - g.cy) / g.h,
    object: body,
  };
}

function group(members: Record<string, J>, cx: number, cy: number, w: number, h: number, order: number): J {
  return {
    type: 'avabodh.basic.group',
    name: '',
    order,
    params: { cx, cy, width: w, height: h, angle: 0, orig_width: w, orig_height: h },
    objects: members,
  };
}

function stroke(cx: number, cy: number, order: number): J {
  return {
    type: 'avabodh.basic.unrecognized',
    order,
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ],
    params: { cx, cy, width: 10, height: 5, angle: 0 },
  };
}

interface PageSpec {
  id: string;
  name: string;
  objects: Record<string, J>;
  extra?: J;
}

function board(pages: PageSpec[], title = 'Board'): J {
  const out: Record<string, J> = {};
  pages.forEach((p, i) => {
    out[p.id] = {
      name: p.name,
      order: i + 1,
      canvassizetype: 'infinite',
      canvasname: '',
      size: { width: 0, height: 0, unit: 'point' },
      background: { color: -1 },
      objects: p.objects,
      ...p.extra,
    };
  });
  return {
    info: { author: '', description: '', platform: '1', title, version: '4.2' },
    attributes: { grid: { present: true }, scaling: { scale: 1, unit: 'point' } },
    pages: out,
  };
}

function session(b: J): BoardSession {
  const s = new BoardSession(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  const r = s.load(b);
  expect(r).toEqual({ ok: true });
  return s;
}

function proj(b: J, options: J | string = {}): J {
  const p = project(session(b), options as JsonValue);
  expect(p).not.toBeNull();
  return p as unknown as J;
}

const pageAt = (p: J, i: number): J => (p['pages'] as J[])[i] as J;
const nodesOf = (p: J, i = 0): J[] => pageAt(p, i)['nodes'] as J[];
const edgesOf = (p: J, i = 0): J[] => pageAt(p, i)['edges'] as J[];
const nodeOf = (p: J, id: string): J | undefined => nodesOf(p).find((n) => n['id'] === id);
const notesOf = (p: J): string[] => p['notes'] as string[];

const A = uid('aaaaaaaa', 1);
const B = uid('aaaaaaaa', 2);
const E = uid('eeeeeeee', 1);

const twoBoxes = (): J =>
  board([
    {
      id: P1,
      name: 'Page 1',
      objects: { [A]: rect(100, 100, 80, 40, 1, 'A'), [B]: rect(300, 100, 80, 40, 2, 'B'), [E]: autoLine(A, B, 3) },
    },
  ]);

describe('options', () => {
  it('empty text and an empty object give the defaults', () => {
    for (const o of ['', {}]) {
      const opts = parseProjectOptions(o);
      expect(opts).toMatchObject({
        docid: '',
        pageId: '',
        hasRegion: false,
        includeStyle: true,
        maxBytes: 0,
        hasVersion: false,
      });
    }
  });
  it('invalid JSON is refused and projects nothing', () => {
    expect(parseProjectOptions('{nope')).toBeNull();
    expect(project(session(twoBoxes()), '{nope')).toBeNull();
  });
  it('version as an integer and as a float; region normalised; max_bytes only when positive', () => {
    expect(parseProjectOptions({ version: 42 })).toMatchObject({ version: 42, hasVersion: true });
    expect(parseProjectOptions({ version: 42.0 })).toMatchObject({ version: 42, hasVersion: true });
    expect(parseProjectOptions({ version: 'x', max_bytes: 'y' })).toMatchObject({ hasVersion: false, maxBytes: 0 });
    expect(parseProjectOptions({ region: { minx: 10, miny: 20, maxx: 0, maxy: 5 } })).toMatchObject({
      hasRegion: true,
      minx: 0,
      maxx: 10,
      miny: 5,
      maxy: 20,
    });
    expect(parseProjectOptions({ region: { minx: 1, miny: 2, maxx: 3 } })).toMatchObject({ hasRegion: false });
    expect(parseProjectOptions({ max_bytes: 0 })).toMatchObject({ maxBytes: 0 });
    expect(parseProjectOptions({ max_bytes: 900 })).toMatchObject({ maxBytes: 900 });
  });
  it('nothing loaded projects to null', () => {
    const s = new BoardSession(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
    expect(project(s, {})).toBeNull();
  });
});

describe('envelope', () => {
  it('name precedence: store name, then document name, then info.title; docid and version only when given', () => {
    const p = proj(twoBoxes(), { docid: 'D1', name: 'Stored', version: 7 });
    expect(p).toMatchObject({
      docid: 'D1',
      name: 'Stored',
      version: 7,
      format: 'lekh.semantic/1',
      truncated: false,
      notes: [],
    });
    const q = proj(twoBoxes());
    expect(q['name']).toBe('Board');
    expect('docid' in q).toBe(false);
    expect('version' in q).toBe(false);
  });
  it('grid and scaling as stored', () => {
    const p = proj(twoBoxes());
    expect(p['grid']).toEqual({ present: true });
    expect(p['scaling']).toEqual({ scale: 1, unit: 'point' });
  });
  it('every page with order = index; one page by id names the others; an unknown page gives none', () => {
    const b = board([
      { id: P1, name: 'One', objects: { [A]: rect(0, 0, 10, 10, 1) } },
      { id: P2, name: 'Two', objects: {} },
    ]);
    const all = proj(b);
    expect((all['pages'] as J[]).map((pg) => [pg['id'], pg['order']])).toEqual([
      [P1, 0],
      [P2, 1],
    ]);
    const one = proj(b, { page: P2 });
    expect((one['pages'] as J[]).length).toBe(1);
    expect(notesOf(one)).toEqual([`this response carries one page; the other pages are ${P1} (One)`]);
    const none = proj(b, { page: 'nope' });
    expect((none['pages'] as J[]).length).toBe(0);
    expect(notesOf(none)[0]).toContain(`${P1} (One), ${P2} (Two)`);
  });
  it('canvas, margin and background', () => {
    const b = board([
      {
        id: P1,
        name: 'P',
        objects: {},
        extra: {
          canvassizetype: 'fixed',
          canvasname: 'A4',
          size: { width: 8.27, height: 11.69, unit: 'inch' },
          margin: { width: 0.5, height: 0.75, unit: 'inch' },
          background: { color: -16776961 },
        },
      },
    ]);
    const pg = pageAt(proj(b), 0);
    expect(pg['canvas']).toEqual({ type: 'fixed', width: 8.27, height: 11.69, unit: 'inch', name: 'A4' });
    expect(pg['margin']).toEqual({ left_right: 0.5, top_bottom: 0.75, unit: 'inch' });
    expect(pg['background']).toEqual({ color: '#0000ff' });
    expect('bounds' in pg).toBe(false);
    expect(pg['freehand']).toBe(0);
    expect('depth_omitted' in pg).toBe(false);
  });
  it('bounds is the union of the stroked visual rectangles', () => {
    const pg = pageAt(proj(twoBoxes()), 0);
    const b = pg['bounds'] as J;
    expect(b['minx']).toBeLessThanOrEqual(60);
    expect(b['maxx']).toBeGreaterThanOrEqual(340);
    expect(b['miny']).toBeLessThanOrEqual(80);
    expect(b['maxy']).toBeGreaterThanOrEqual(120);
  });
});

describe('nodes', () => {
  it('a shape node carries its id, shape, geometry, z_order, texts and flags', () => {
    const n = nodeOf(proj(twoBoxes()), A) as J;
    expect(n).toMatchObject({
      id: A,
      kind: 'shape',
      shape: 'avabodh.basic.rectangle',
      shape_name: 'Rectangle',
      cx: 100,
      cy: 100,
      width: 80,
      height: 40,
      z_order: 1,
      texts: [{ text: 'A' }],
      generated: false,
      interpret_text: false,
    });
    expect('angle' in n).toBe(false);
    expect('parent' in n).toBe(false);
  });
  it('a rotated node carries its angle rounded to six significant digits', () => {
    const b = board([{ id: P1, name: 'P', objects: { [A]: rect(10, 10, 20, 20, 1) } }]);
    ((b['pages'] as J)[P1] as J)['objects'] = {
      [A]: {
        ...rect(10.123456789, 10, 20, 20, 1),
        params: { cx: 10.123456789, cy: 10, width: 20, height: 20, angle: 1.5707963 },
      },
    };
    const n = nodeOf(proj(b), A) as J;
    expect(n['cx']).toBe(10.1235);
    expect(n['angle']).toBe(1.5708);
  });
  it('a group lists its members with parent and editable, and members carry no z_order', () => {
    const g = uid('99999999', 1);
    const G1 = { cx: 70, cy: 50, w: 60, h: 20 };
    const b = board([
      {
        id: P1,
        name: 'P',
        objects: {
          [g]: group(
            {
              [A]: member(rect(50, 50, 20, 20, 0), 0, 50, 50, 20, 20, G1),
              [B]: member(rect(90, 50, 20, 20, 0), 1, 90, 50, 20, 20, G1),
            },
            70,
            50,
            60,
            20,
            1,
          ),
        },
      },
    ]);
    const p = proj(b);
    const gn = nodeOf(p, g) as J;
    expect(gn).toMatchObject({ kind: 'group', children: [A, B], z_order: 1 });
    expect('editable' in gn).toBe(false);
    expect('shape' in gn).toBe(false);
    const a = nodeOf(p, A) as J;
    expect(a).toMatchObject({ parent: g, editable: false });
    expect('z_order' in a).toBe(false);
  });
  it('a group nested past the depth cap keeps an empty children and the page says depth_omitted', () => {
    let body: J = rect(0, 0, 10, 10, 0);
    let innerId = uid('dddddddd', 0);
    const ids: string[] = [innerId];
    for (let level = 1; level <= 7; level++) {
      const id = uid('dddddddd', level);
      body = group(
        { [innerId]: member(body, 0, 0, 0, 10, 10, { cx: 0, cy: 0, w: 10, h: 10 }) },
        0,
        0,
        10,
        10,
        level === 7 ? 1 : 0,
      );
      innerId = id;
      ids.push(id);
    }
    const b = board([{ id: P1, name: 'P', objects: { [innerId]: body } }]);
    const p = proj(b);
    const pg = pageAt(p, 0);
    expect(pg['depth_omitted']).toBe(2);
    expect(notesOf(p)).toContain('2 object(s) omitted: nested more than 5 groups deep');
    const deepest = nodesOf(p).find(
      (n) => n['children'] !== undefined && (n['children'] as string[]).length === 0,
    ) as J;
    expect(deepest['kind']).toBe('group');
  });
  it('free-hand strokes: top-level ones are counted, grouped ones listed with their box only', () => {
    const g = uid('99999999', 1);
    const s1 = uid('ffffffff', 1);
    const s2 = uid('ffffffff', 2);
    const G2 = { cx: 60, cy: 50, w: 50, h: 20 };
    const b = board([
      {
        id: P1,
        name: 'P',
        objects: {
          [s1]: stroke(10, 10, 1),
          [g]: group(
            {
              [A]: member(rect(50, 50, 20, 20, 0), 0, 50, 50, 20, 20, G2),
              [s2]: member(stroke(80, 50, 0), 1, 80, 50, 10, 5, G2),
            },
            60,
            50,
            50,
            20,
            2,
          ),
        },
      },
    ]);
    const p = proj(b);
    expect(pageAt(p, 0)['freehand']).toBe(2);
    expect(nodeOf(p, s1)).toBeUndefined();
    expect(nodeOf(p, s2)).toEqual({
      id: s2,
      kind: 'freehand',
      cx: 80,
      cy: 50,
      width: 10,
      height: 5,
      parent: g,
      editable: false,
    });
    expect(notesOf(p)).toContain(
      '2 free-hand drawing(s) are not included in nodes; board_render shows them, 1 of them inside groups, listed as kind "freehand" with their box only',
    );
  });
});

describe('edges and routes', () => {
  it('an automatic edge states auto_type and omits route; arrowheads read by name', () => {
    const b = twoBoxes();
    ((b['pages'] as J)[P1] as J)['objects'] = {
      ...(((b['pages'] as J)[P1] as J)['objects'] as J),
      [E]: { ...autoLine(A, B, 3), texts: [{ text: 'go', param: 0.25 }] },
    };
    const e = edgesOf(proj(b))[0] as J;
    expect(e).toMatchObject({ id: E, from: A, to: B, edge_type: 'line', auto_type: 'straight', z_order: 3 });
    expect('route' in e).toBe(false);
    expect(e['texts']).toEqual([{ text: 'go', position: 0.25 }]);
  });
  it('a manual orthogonal edge carries segments', () => {
    const b = board([
      {
        id: P1,
        name: 'P',
        objects: {
          [A]: rect(100, 100, 80, 40, 1),
          [B]: rect(300, 200, 80, 40, 2),
          [E]: edge(
            A,
            B,
            2,
            [
              { angle: 0, autotype: 0, step: 100, dx: 1, dy: 0 },
              { step: 100, dx: 0, dy: 1 },
              { step: 60, dx: 1, dy: 0, angle: 3.14159 },
            ],
            3,
          ),
        },
      },
    ]);
    const e = edgesOf(proj(b))[0] as J;
    expect(e['edge_type']).toBe('orthogonal');
    const route = e['route'] as J;
    expect(Array.isArray(route['segments'])).toBe(true);
    expect((route['segments'] as J[]).every((s) => 'dx' in s && 'dy' in s)).toBe(true);
  });
  it('a region keeps only edges with both endpoints emitted and notes one-sided ones', () => {
    const p = proj(twoBoxes(), { region: { minx: 0, miny: 0, maxx: 200, maxy: 200 } });
    expect(nodesOf(p).map((n) => n['id'])).toEqual([A]);
    expect(edgesOf(p)).toEqual([]);
    expect(notesOf(p)).toEqual(['1 edge(s) omitted: an endpoint was not projected (1 outside the region)']);
    const q = proj(twoBoxes(), { region: { minx: 1000, miny: 1000, maxx: 2000, maxy: 2000 } });
    expect(notesOf(q)).toEqual([]);
  });
});

describe('style', () => {
  it('deviations only, renamed, and dropped by include_style false', () => {
    const b = board([
      {
        id: P1,
        name: 'P',
        objects: {
          [A]: rect(0, 0, 20, 20, 1, 'x', {
            style: { strokewidth: 2.5, fillpaint: { type: 2, color: -65536 }, fontweight: 2, textdecoration: 2 },
          }),
        },
      },
    ]);
    const n = nodeOf(proj(b), A) as J;
    expect(n['style']).toEqual({
      stroke_width: 2.5,
      fill: '#ff0000',
      font_weight: 'bold',
      text_decoration: ['underline'],
    });
    const m = nodeOf(proj(b, { include_style: false }), A) as J;
    expect('style' in m).toBe(false);
  });
});

describe('the byte budget', () => {
  it('no cap, no truncation; a tight cap truncates at an object boundary and says so', () => {
    expect(proj(twoBoxes())['truncated']).toBe(false);
    const full = proj(twoBoxes(), { max_bytes: 100000 });
    expect(full['truncated']).toBe(false);
    const cut = proj(twoBoxes(), { max_bytes: 900 });
    expect(cut['truncated']).toBe(true);
    expect(notesOf(cut).some((t) => t.includes('reached its output budget'))).toBe(true);
    const tiny = proj(twoBoxes(), { max_bytes: 1 });
    expect(nodesOf(tiny)).toEqual([]);
  });
  it('storedLength measures C++ JsonParser::store text: sorted keys, no spaces, UTF-8, %g floats', () => {
    const v: JsonObject = { b: 1, a: [true, null, 'é"'], c: 0.1234567 };
    expect(storedLength(v)).toBe('{"a":[true,null,"é\\""],"b":1,"c":0.123457}'.length + 1);
  });
});
