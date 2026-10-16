// Synthetic boards for the layout-lint suites, built as stored `.lekh` JSON from the bundled
// catalogue's template bodies (no generator involved), and a session over a measurer whose
// advance is 0.6 × 15 pt per character with a line pitch of 1 — the C++ lint tier's test platform
// (9 × 15 pt per character at the stencils' 15 pt font).
import { lint } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler, createTestRuntime, type TestRuntime } from '../../src/testing';
import type { JsonObject, JsonValue } from '../../src/template';
import { bundledCatalog } from '../io/helpers';

export const RECT = 'avabodh.basic.rectangle';
export const TEXT = 'avabodh.basic.text';
export const PROCESS = 'avabodh.flowchart.process';
export const ACTOR = 'avabodh.uml.actor';
export const LIFELINE = 'avabodh.uml.lifeline';
export const ACTIVATION = 'avabodh.uml.activation';
export const LANE = 'avabodh.container.slh';

type Out = { [k: string]: JsonValue };

let runtime_: TestRuntime | null = null;
export function lintRuntime(): TestRuntime {
  runtime_ ??= createTestRuntime({ catalog: bundledCatalog(), advance: 9, testing: { linePitch: 1 } });
  return runtime_;
}

function body(shape: string): Out {
  const def = bundledCatalog().get(shape);
  if (def === undefined) throw new Error(`no template ${shape} in the bundled catalogue`);
  return JSON.parse(JSON.stringify(def.json)) as Out;
}

export interface NodeOpts {
  readonly shape?: string;
  readonly text?: string;
  readonly title?: string;
  readonly angle?: number;
}

/** A templated object at `cx, cy` of `w × h`. `text` fills the first body slot, `title` the title slot. */
export function node(cx: number, cy: number, w: number, h: number, o: NodeOpts = {}): Out {
  const t = body(o.shape ?? RECT);
  const texts = Array.isArray(t['texts']) ? (t['texts'] as JsonObject[]).map((x) => ({ ...x })) : [];
  if (o.text !== undefined) {
    const slot = texts.find((x) => x['external'] === undefined);
    if (slot !== undefined) slot['text'] = o.text;
    else texts.push({ location: 'default', text: o.text });
  }
  if (o.title !== undefined) {
    const slot = texts.find((x) => x['external'] !== undefined);
    if (slot === undefined) throw new Error('the template has no title slot');
    slot['text'] = o.title;
  }
  t['texts'] = texts;
  return {
    type: 'templated',
    name: '',
    params: { cx, cy, width: w, height: h, angle: o.angle ?? 0 },
    template: t,
  };
}

export interface EdgeOpts {
  readonly autotype?: number;
  readonly ctype?: number;
  readonly texts?: readonly { text: string; param: number }[];
}

/** A connector from `source` to `target` (straight by default). */
export function edge(source: string, target: string, o: EdgeOpts = {}): Out {
  return {
    type: 'avabodh.basic.connection',
    source,
    target,
    ctype: o.ctype ?? 1,
    params: [{ angle: 0, autotype: o.autotype ?? 1 }, { angle: 0 }],
    text: '',
    texts: (o.texts ?? []).map((x) => ({ ...x })),
  };
}

/** A group of `members` (id → object), its box the union of theirs. */
export function group(members: Readonly<Record<string, Out>>): Out {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  const objects: Out = {};
  let index = 0;
  for (const [id, m] of Object.entries(members)) {
    const p = m['params'] as { cx: number; cy: number; width: number; height: number };
    minx = Math.min(minx, p.cx - p.width / 2);
    maxx = Math.max(maxx, p.cx + p.width / 2);
    miny = Math.min(miny, p.cy - p.height / 2);
    maxy = Math.max(maxy, p.cy + p.height / 2);
    objects[id] = {
      orig_cx: p.cx,
      orig_cy: p.cy,
      orig_width: p.width,
      orig_height: p.height,
      orig_angle: 0,
      xfactor: 0,
      yfactor: 0,
      index: index++,
      object: { ...m, order: index },
    };
  }
  const w = maxx - minx;
  const h = maxy - miny;
  return {
    type: 'avabodh.basic.group',
    name: '',
    params: {
      cx: (minx + maxx) / 2,
      cy: (miny + maxy) / 2,
      width: w,
      height: h,
      angle: 0,
      orig_width: w,
      orig_height: h,
    },
    objects,
  };
}

export const PAGE = 'page1';

/** A one-page board of `objects` (id → object), in insertion order. */
export function board(objects: Readonly<Record<string, Out>>): JsonObject {
  const objs: Out = {};
  let order = 100;
  for (const [id, o] of Object.entries(objects)) objs[id] = { ...o, order: order++ };
  return {
    attributes: { grid: { present: true }, scaling: { scale: 1, unit: 'point' } },
    info: { version: '4.2', title: 'Lekh Diagram', author: '', description: '', platform: '1' },
    pages: {
      [PAGE]: {
        background: { color: -1 },
        canvasname: '',
        canvassizetype: 'infinite',
        name: 'Page 1',
        objects: objs,
        order: 1,
        size: { height: 0, unit: 'point', width: 0 },
      },
    },
  };
}

/** A session holding `doc`. */
export function sessionOf(doc: JsonObject): BoardSession {
  const s = new BoardSession(lintRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  const r = s.load(doc);
  if (!r.ok) throw new Error(`load refused: ${r.message}`);
  return s;
}

/** kashi's `lint-rules.json` shape, as the C++ tier's `rules()`. */
export function rules(extra: Readonly<Record<string, JsonValue>> = {}, containers: readonly string[] = [LANE]): Out {
  return {
    containers: [...containers],
    see_through: ['avabodh.uml.lifeline', 'avabodh.uml.line'],
    overlay_pairs: [
      ['avabodh.uml.activation', 'avabodh.uml.lifeline'],
      ['avabodh.uml.activation', 'avabodh.uml.activation'],
      ['avabodh.uml.deletion', 'avabodh.uml.lifeline'],
    ],
    tolerance: 0.9,
    max: 20,
    ...extra,
  };
}

export interface LintIssue {
  readonly kind: string;
  readonly confidence: string;
  readonly page: string;
  readonly ids: string[];
  readonly detail: Record<string, JsonValue>;
}

export interface LintAnswer {
  readonly ok: boolean;
  readonly page?: string;
  readonly issues: LintIssue[];
  readonly truncated: number;
  readonly message?: string;
}

/** Lints `doc`, asserting the lint leaves `serialize` unchanged (AC-BE-08). */
export function lintOf(doc: JsonObject, options: Readonly<Record<string, JsonValue>> = rules()): LintAnswer {
  const s = sessionOf(doc);
  const before = s.serialize({ stamp: 'cloud' });
  const out = lint(s, options) as unknown as LintAnswer;
  if (s.serialize({ stamp: 'cloud' }) !== before) throw new Error('lint changed the document');
  s.dispose();
  return out;
}

export const issuesOf = (a: LintAnswer, kind = ''): LintIssue[] =>
  a.issues.filter((i) => kind === '' || i.kind === kind);
