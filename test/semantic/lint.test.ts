// The layout lint (AC-BE-03 lekhjs side; port of a representative subset of the C++ tier's
// LintDetectTest and LintExemptTest): each issue kind and its confidence band, the elbow-segment
// rule, a vertical label's axis, rotated shapes, negative coordinates in the grid, the
// `only` / `within` filters, the cap, the refusals, an exemption of each type and a connector to a
// group. Boards are synthetic; text is 9 pt per character and 15 pt per line at the stencils' font.
import { describe, expect, it } from 'vitest';
import { lint } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import {
  ACTIVATION,
  ACTOR,
  LANE,
  LIFELINE,
  PAGE,
  PROCESS,
  TEXT,
  board,
  edge,
  group,
  issuesOf,
  lintOf,
  lintRuntime,
  node,
  rules,
  sessionOf,
} from './lint-helpers';

const roundedToTenth = (v: unknown): boolean => typeof v === 'number' && Math.abs(v * 10 - Math.round(v * 10)) < 1e-3;
const num = (v: unknown): number => v as number;
const arr = (v: unknown): number[] => v as number[];
/** Element `i` of `list`, failing the test when it is absent. */
function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`no element ${String(i)}`);
  return v;
}

describe('semantic lint: detection', () => {
  it('shape_overlap high, with area, rect, page and truncated', () => {
    const a = lintOf(board({ a: node(100, 100, 120, 60), b: node(140, 100, 120, 60) }));
    expect(a.ok).toBe(true);
    const found = issuesOf(a, 'shape_overlap');
    expect(found).toHaveLength(1);
    const i = at(found, 0);
    expect(i.confidence).toBe('high');
    expect(i.ids).toEqual(['a', 'b']);
    expect(i.detail['area']).toBeCloseTo(4800, 1);
    expect(arr(i.detail['rect'])).toEqual([80, 70, 80, 60]);
    expect(i.page).toBe(a.page);
    expect(a.truncated).toBe(0);
  });

  it('shape_overlap low on a one-point corner', () => {
    const found = issuesOf(lintOf(board({ a: node(100, 100, 120, 60), b: node(219, 159, 120, 60) })), 'shape_overlap');
    expect(found).toHaveLength(1);
    expect(at(found, 0).confidence).toBe('low');
    expect(num(at(found, 0).detail['area'])).toBeCloseTo(1, 1);
  });

  it('adjacent shapes are not an overlap', () => {
    expect(lintOf(board({ a: node(100, 100, 120, 60), b: node(221, 100, 120, 60) })).issues).toEqual([]);
  });

  it('negative coordinates key apart from their positive mirrors in the grid', () => {
    const found = issuesOf(
      lintOf(
        board({
          a: node(-5000, -3000, 120, 60),
          b: node(-4960, -3000, 120, 60),
          c: node(5000, 3000, 120, 60),
          d: node(-5000, 3000, 120, 60),
          e: node(5000, -3000, 120, 60),
          f: node(-60, -30, 130, 70),
          g: node(20, 10, 60, 40),
        }),
      ),
      'shape_overlap',
    );
    expect(found.map((i) => i.ids.join(',')).sort()).toEqual(['a,b', 'f,g']);
  });

  // lekhjs breaks a word wider than the line, as the native apps do (DR-TXT-03); the C++ backend
  // kept it whole. So an over-long word overflows by height here, and `single_word` (a line still
  // wider than the slot) stays false where the C++ reported true.
  it('text_overflow high: wrapped lines over the slot', () => {
    const found = issuesOf(
      lintOf(
        board({
          p: node(100, 100, 80, 32, { shape: PROCESS, text: 'Authenticate user credentials against directory' }),
        }),
      ),
      'text_overflow',
    );
    expect(found).toHaveLength(1);
    const d = at(found, 0).detail;
    expect(at(found, 0).confidence).toBe('high');
    expect(at(found, 0).ids).toEqual(['p']);
    expect(d['slot']).toBe(0);
    expect(at(arr(d['needed']), 1)).toBeGreaterThan(at(arr(d['available']), 1));
    expect(d['single_word']).toBe(false);
  });

  it('text_overflow low inside the tolerance band', () => {
    // Two 5-letter words (45 pt each, a 9 pt space): 99 pt on one line against a 95 pt slot, so two
    // lines (30 pt) in a 24 pt slot at 1.0×; at 0.9× they are 89.1 pt and fit on one line.
    const found = issuesOf(lintOf(board({ r: node(100, 100, 101, 30, { text: 'ABCDE ABCDE' }) })), 'text_overflow');
    expect(found).toHaveLength(1);
    const d = at(found, 0).detail;
    expect(at(found, 0).confidence).toBe('low');
    expect(d['needed']).toEqual([45, 30]);
    expect(d['available']).toEqual([95, 24]);
    expect(d['single_word']).toBe(false);
  });

  it('an over-long word is broken and overflows by height (DR-TXT-03)', () => {
    const found = issuesOf(
      lintOf(board({ r: node(100, 100, 60, 40, { text: 'Supercalifragilisticexpialidoc' }) })),
      'text_overflow',
    );
    expect(found).toHaveLength(1);
    expect(at(found, 0).confidence).toBe('high');
    expect(at(arr(at(found, 0).detail['needed']), 1)).toBeGreaterThan(at(arr(at(found, 0).detail['available']), 1));
  });

  it('text with newlines that fits reports nothing', () => {
    const a = lintOf(
      board({
        p: node(100, 100, 170, 56, { shape: PROCESS, text: 'Authenticate\nuser credentials\nagainst directory' }),
      }),
    );
    expect(issuesOf(a, 'text_overflow')).toEqual([]);
  });

  it('floating text crossing a shape is a text_overlap, not a shape_overlap', () => {
    const a = lintOf(board({ a: node(100, 100, 120, 60), t: node(160, 100, 45, 15, { shape: TEXT, text: 'Label' }) }));
    const found = issuesOf(a, 'text_overlap');
    expect(found).toHaveLength(1);
    expect(at(found, 0).confidence).toBe('high');
    expect(at(found, 0).ids).toEqual(['a', 't']);
    expect(issuesOf(a, 'shape_overlap')).toEqual([]);
  });

  it('a title over its neighbour is a title_overlap', () => {
    const a = lintOf(
      board({ a: node(100, 100, 64, 64, { shape: ACTOR, title: 'orders-fn' }), b: node(100, 174, 64, 64) }),
    );
    const found = issuesOf(a, 'title_overlap');
    expect(found).toHaveLength(1);
    expect(at(found, 0).ids).toEqual(['a', 'b']);
    expect(arr(at(found, 0).detail['rect'])).toHaveLength(4);
    expect(issuesOf(a, 'shape_overlap')).toEqual([]);
  });

  it('edge_label_overflow: a label longer than its edge', () => {
    const a = lintOf(
      board({
        a: node(100, 100, 40, 40),
        b: node(180, 100, 40, 40),
        e: edge('a', 'b', { texts: [{ text: 'abcdefghijklmnopq', param: 0.5 }] }),
      }),
    );
    const found = issuesOf(a, 'edge_label_overflow');
    expect(found).toHaveLength(1);
    const d = at(found, 0).detail;
    expect(at(found, 0).confidence).toBe('high');
    expect(at(found, 0).ids).toEqual(['e']);
    expect(d['label']).toBe(0);
    expect(at(arr(d['label_size']), 0)).toBeCloseTo(153, 1);
    expect(num(d['visible_length'])).toBeLessThanOrEqual(40.05);
    expect(num(d['visible_length'])).toBeGreaterThan(30);
    expect(d['axis']).toBe('width');
  });

  it('a label on a vertical edge measures its height', () => {
    const a = lintOf(
      board({
        a: node(100, 100, 40, 40),
        b: node(100, 180, 40, 40),
        e: edge('a', 'b', { texts: [{ text: 'a\nb\nc\nd', param: 0.5 }] }),
      }),
    );
    const found = issuesOf(a, 'edge_label_overflow');
    expect(found).toHaveLength(1);
    const d = at(found, 0).detail;
    expect(d['axis']).toBe('height');
    expect(at(arr(d['label_size']), 1)).toBeGreaterThan(num(d['visible_length']));
    expect(at(arr(d['label_size']), 0)).toBeLessThan(num(d['visible_length']));
  });

  it('edge_label_overlap: a label over a shape', () => {
    const a = lintOf(
      board({
        a: node(100, 100, 40, 40),
        b: node(400, 100, 40, 40),
        c: node(250, 110, 60, 12),
        e: edge('a', 'b', { texts: [{ text: 'hello', param: 0.5 }] }),
      }),
    );
    const found = issuesOf(a, 'edge_label_overlap');
    expect(found).toHaveLength(1);
    expect(at(found, 0).ids).toEqual(['e', 'c']);
    expect(at(found, 0).detail['label']).toBe(0);
    expect(issuesOf(a, 'edge_through_shape')).toEqual([]);
  });

  it('edge_through_shape names the node crossed', () => {
    const a = lintOf(
      board({ a: node(100, 100, 40, 40), b: node(250, 100, 40, 40), c: node(400, 100, 40, 40), e: edge('a', 'c') }),
    );
    const found = issuesOf(a, 'edge_through_shape');
    expect(found).toHaveLength(1);
    expect(at(found, 0).ids).toEqual(['e', 'b']);
    expect(at(found, 0).detail['node']).toBe('b');
  });

  it('an elbow label is measured against the segment holding it', () => {
    // s_bend_vertical (autotype 5): down, across at mid height (~60 pt), down.
    const a = lintOf(
      board({
        a: node(100, 100, 40, 40),
        b: node(160, 300, 40, 40),
        e: edge('a', 'b', { ctype: 2, autotype: 5, texts: [{ text: 'abcdefghijkl', param: 0.5 }] }),
      }),
    );
    const found = issuesOf(a, 'edge_label_overflow');
    expect(found).toHaveLength(1);
    expect(num(at(found, 0).detail['visible_length'])).toBeCloseTo(60, 1);
    expect(at(found, 0).confidence).toBe('high');
  });
});

describe('semantic lint: rotation, filters, limits', () => {
  it('a rotated shape uses its axis-aligned box', () => {
    const found = issuesOf(
      lintOf(board({ a: node(200, 200, 40, 40, { angle: Math.PI / 4 }), b: node(223, 223, 10, 10) })),
      'shape_overlap',
    );
    expect(found).toHaveLength(1);
    expect(at(arr(at(found, 0).detail['rect']), 0)).toBeCloseTo(218, 1);
    expect(at(arr(at(found, 0).detail['rect']), 2)).toBeCloseTo(10, 1);
    expect(num(at(found, 0).detail['area'])).toBeCloseTo(100, 1);
  });

  const four = () =>
    board({
      a: node(100, 100, 120, 60),
      b: node(140, 100, 120, 60),
      c: node(600, 100, 120, 60),
      d: node(640, 100, 120, 60),
    });

  it('only', () => {
    expect(lintOf(four()).issues).toHaveLength(2);
    const found = lintOf(four(), rules({ only: ['a'] })).issues;
    expect(found.map((i) => i.ids)).toEqual([['a', 'b']]);
  });

  it('within', () => {
    const found = lintOf(four(), rules({ within: [500, 50, 300, 100] })).issues;
    expect(found.map((i) => i.ids)).toEqual([['c', 'd']]);
  });

  it('max and truncated; high before low', () => {
    const objs: Record<string, ReturnType<typeof node>> = {
      lo1: node(100, 1000, 120, 60),
      lo2: node(219, 1059, 120, 60),
    };
    for (let i = 0; i < 60; i++) objs[`n${String(i).padStart(2, '0')}`] = node(100 + 30 * i, 100, 40, 20);
    const capped = lintOf(board(objs), rules({ max: 20 }));
    expect(capped.issues).toHaveLength(20);
    expect(capped.truncated).toBe(40);
    for (const i of capped.issues) expect(i.confidence).toBe('high');
    const all = lintOf(board(objs), rules({ max: 100 }));
    expect(all.issues).toHaveLength(60);
    expect(at(all.issues, 59).confidence).toBe('low');
  });

  it('detail numbers are rounded to 0.1, and an edge kind puts the edge id first', () => {
    const a = lintOf(
      board({
        a: node(100.37, 100.12, 120, 60),
        b: node(140.91, 100.55, 120, 60),
        x: node(400, 300, 40, 40),
        y: node(700, 300, 40, 40),
        m: node(550, 300, 40, 40),
        zz: edge('x', 'y'),
      }),
    );
    const overlap = issuesOf(a, 'shape_overlap');
    expect(overlap).toHaveLength(1);
    const rect = arr(at(overlap, 0).detail['rect']);
    for (const v of rect) expect(roundedToTenth(v)).toBe(true);
    expect(roundedToTenth(at(overlap, 0).detail['area'])).toBe(true);
    expect(rect[0]).toBeCloseTo(80.9, 3);
    expect(rect[2]).toBeCloseTo(79.5, 3);
    expect(issuesOf(a, 'edge_through_shape').map((i) => i.ids)).toEqual([['zz', 'm']]);
    for (const i of a.issues) expect(Object.keys(i).sort()).toEqual(['confidence', 'detail', 'ids', 'kind', 'page']);
  });

  it('refusals: nothing loaded, options not an object, page not on the board', () => {
    const empty = new BoardSession(lintRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
    expect(lint(empty, {})).toEqual({
      ok: false,
      message: 'No document is loaded on this handle, so there is nothing to lint.',
    });
    const s = sessionOf(board({ a: node(100, 100, 40, 40) }));
    expect(lint(s, '[1]')).toEqual({ ok: false, message: 'The lint options are not a JSON object.' });
    expect(lint(s, 'not json')).toEqual({ ok: false, message: 'The lint options are not a JSON object.' });
    expect(lint(s, { page: 'nope' })).toEqual({
      ok: false,
      message: 'There is no page with id "nope" on this board.',
    });
    expect(lint(s, '')).toMatchObject({ ok: true, page: PAGE, issues: [], truncated: 0 });
  });
});

describe('semantic lint: exemptions', () => {
  it('a container holding a shape is not an overlap; a plain box holding one is', () => {
    expect(
      lintOf(board({ lane: node(300, 200, 400, 200, { shape: LANE }), a: node(300, 220, 80, 40) })).issues,
    ).toEqual([]);
    const found = issuesOf(lintOf(board({ bg: node(300, 200, 400, 200), a: node(300, 220, 80, 40) })), 'shape_overlap');
    expect(found.map((i) => i.ids)).toEqual([['a', 'bg']]);
  });

  it('a shape straddling a container is reported', () => {
    const found = issuesOf(
      lintOf(board({ lane: node(300, 200, 400, 200, { shape: LANE }), a: node(500, 200, 80, 40) })),
      'shape_overlap',
    );
    expect(found.map((i) => i.ids)).toEqual([['a', 'lane']]);
  });

  it('members of one group are exempt', () => {
    expect(lintOf(board({ g: group({ a: node(100, 100, 120, 60), b: node(140, 100, 120, 60) }) })).issues).toEqual([]);
  });

  it('an activation on its lifeline is a declared overlay; nested activations too', () => {
    expect(
      lintOf(
        board({
          L: node(100, 250, 100, 300, { shape: LIFELINE }),
          A: node(100, 250, 16, 100, { shape: ACTIVATION }),
          A2: node(106, 260, 16, 60, { shape: ACTIVATION }),
        }),
      ).issues,
    ).toEqual([]);
  });

  it('two see-through lifelines that overlap are still reported', () => {
    const found = issuesOf(
      lintOf(
        board({ L1: node(100, 250, 100, 300, { shape: LIFELINE }), L2: node(150, 250, 100, 300, { shape: LIFELINE }) }),
      ),
      'shape_overlap',
    );
    expect(found.map((i) => i.ids)).toEqual([['L1', 'L2']]);
  });

  it("a connector's own endpoints are exempt", () => {
    const a = lintOf(
      board({
        a: node(100, 100, 40, 40),
        b: node(300, 100, 40, 40),
        e1: edge('a', 'b'),
        e2: edge('a', 'b', { ctype: 2, autotype: 2 }),
      }),
    );
    expect(a.issues).toEqual([]);
  });

  it('an edge crossing a lane (a container) is not through a shape', () => {
    const a = lintOf(
      board({
        lane1: node(100, 200, 200, 300, { shape: LANE }),
        lane2: node(300, 200, 200, 300, { shape: LANE }),
        lane3: node(500, 200, 200, 300, { shape: LANE }),
        a: node(100, 220, 60, 30),
        c: node(500, 220, 60, 30),
        e: edge('a', 'c'),
      }),
    );
    expect(a.issues).toEqual([]);
    const without = issuesOf(
      lintOf(
        board({
          lane1: node(100, 200, 200, 300, { shape: LANE }),
          lane2: node(300, 200, 200, 300, { shape: LANE }),
          lane3: node(500, 200, 200, 300, { shape: LANE }),
          a: node(100, 220, 60, 30),
          c: node(500, 220, 60, 30),
          e: edge('a', 'c'),
        }),
        rules({}, []),
      ),
      'edge_through_shape',
    );
    expect(without.map((i) => i.detail['node'])).toContain('lane2');
  });

  it('a floating text wholly inside a shape is exempt', () => {
    expect(
      lintOf(board({ a: node(100, 100, 120, 60), t: node(100, 100, 45, 15, { shape: TEXT, text: 'Label' }) })).issues,
    ).toEqual([]);
  });

  it("a connector to a group does not pass through that group's own members", () => {
    const a = lintOf(
      board({
        g: group({ a: node(200, 100, 60, 40), b: node(240, 220, 60, 40) }),
        c: node(200, 600, 60, 40),
        d: node(200, 450, 60, 40),
        e: edge('c', 'g'),
      }),
    );
    const through = issuesOf(a, 'edge_through_shape');
    expect(through.map((i) => i.detail['node'])).toEqual(['d']);
  });
});
