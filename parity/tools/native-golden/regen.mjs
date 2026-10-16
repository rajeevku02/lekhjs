// Regenerates the native-generator goldens (spec 04 §6, task G5): a synthetic board of every BPMN
// and `table-v1` stencil template under a grid of parameter values, written to
// test/fixtures/native/native-cases.lekh, and the C++ core's load + serialize of it (the Node
// oracle: the vendored backend wasm of lbs/kashi) written to
// test/fixtures/golden/native/native-cases.json. The TS suite (test/generators/native-golden.test.ts)
// loads the same board and compares each object's generated members and the root symbol templates.
//
// The template bodies are the lekhboard v4 stencil entries (bpmn.json, table.json); only their
// parameters, size, style and texts vary. No board content.
//
//   node parity/tools/native-golden/regen.mjs
// Hold the heavy-job lock when running it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const PARITY = path.join(PKG, 'parity');
const require = createRequire(import.meta.url);
const { NodeOracle } = require('../../oracle/node-oracle.cjs');

const sets = JSON.parse(readFileSync(path.join(PARITY, 'fixture-sets.json'), 'utf8'));
const V4 = path.resolve(PKG, sets.stencilsV4);
const BOARD = path.join(PKG, 'test', 'fixtures', 'native', 'native-cases.lekh');
const GOLDEN = path.join(PKG, 'test', 'fixtures', 'golden', 'native', 'native-cases.json');

/**
 * Every template with a native generator in a stencil file, by id.
 * @param {string} file
 */
function nativeTemplates(file) {
  /** @type {Map<string, any>} */
  const out = new Map();
  const walk = (/** @type {any} */ o) => {
    if (Array.isArray(o)) for (const x of o) walk(x);
    else if (o !== null && typeof o === 'object') {
      if (typeof o.id === 'string' && o.generator?.type === 'native' && !out.has(o.id)) out.set(o.id, o);
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(JSON.parse(readFileSync(path.join(V4, file), 'utf8')));
  return out;
}

const T = new Map([...nativeTemplates('bpmn.json'), ...nativeTemplates('table.json')]);

/** @type {{ name: string, body: any, w: number, h: number }[]} */
const cases = [];

/**
 * One case: the stencil body of `id` with parameter values `params` (`undefined` removes one),
 * plus `extra` members (style, texts, data, draw) merged in.
 * @param {string} name
 * @param {string} id
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [extra]
 * @param {number} [w]
 * @param {number} [h]
 */
function add(name, id, params = {}, extra = {}, w = 160, h = 110) {
  const base = T.get(id);
  if (base === undefined) throw new Error(`no stencil template ${id}`);
  const body = structuredClone(base);
  const removed = new Set(Object.entries(params).flatMap(([k, v]) => (v === undefined ? [k] : [])));
  body.params = Object.fromEntries(Object.entries(body.params ?? {}).filter(([k]) => !removed.has(k)));
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    else if (body.params[k] !== undefined && typeof body.params[k] === 'object' && body.params[k] !== null)
      body.params[k] = { ...body.params[k], value: v };
    else body.params[k] = { value: v, order: 999, editor: { type: 255 } };
  }
  Object.assign(body, structuredClone(extra));
  cases.push({ name, body, w, h });
}

// ---- bpmn.activity
const TASK = 'avabodh.bpmn.activities.task';
for (const id of [
  TASK,
  'avabodh.bpmn.activities.transaction',
  'avabodh.bpmn.activities.subprocess',
  'avabodh.bpmn.activities.call',
])
  add(`stencil ${id}`, id);
for (const tt of [
  'None',
  'Send',
  'Receive',
  'Receive Instantiating',
  'User',
  'Manual',
  'Business Rule',
  'Service',
  'Script',
  'bogus',
])
  add(`task type ${tt}`, TASK, { tasktype: tt });
const MARKERS = ['None', 'Sub-Process', 'Loop', 'Parallel', 'Sequential', 'Ad Hoc', 'Compensation'];
for (const m1 of MARKERS)
  for (const m2 of ['None', 'Loop', 'Ad Hoc']) add(`task markers ${m1}/${m2}`, TASK, { marker1: m1, marker2: m2 });
add('task call, stroke 3', TASK, { activity: 'Call Activity' }, { style: { strokewidth: 3 } });
add('task transaction + type + markers', TASK, {
  activity: 'Transcation',
  tasktype: 'User',
  marker1: 'Loop',
  marker2: 'Compensation',
});
add(
  'task without activity param (keeps stored)',
  TASK,
  { activity: undefined },
  { data: ['-w/2', '-h/2', 'w/2', 'h/2'], draw: [{ path: 'M 0 1 L 2 3' }] },
);
add('task activity not a string', TASK, { activity: 7 });

// ---- bpmn.event
const EVT_TYPES = [
  'None',
  'Message',
  'Timer',
  'Escalation',
  'Conditional',
  'Link',
  'Error',
  'Cancel',
  'Compensation',
  'Signal',
  'Multiple',
  'Parallel Multiple',
  'Terminate',
];
for (const group of ['Start', 'Intermediate', 'End', 'Other'])
  for (const type of EVT_TYPES)
    for (const ni of [false, true])
      for (const th of [false, true]) {
        if (group !== 'Intermediate' && th && type !== 'Message') continue;
        add(
          `event ${group} ${type} ni=${ni} throw=${th}`,
          'avabodh.bpmn.event.start',
          { group, type, noninterrupting: ni, throwing: th },
          {},
          50,
          50,
        );
      }
add('event end, stroke 2.5', 'avabodh.bpmn.event.end', {}, { style: { strokewidth: 2.5 } }, 50, 50);
add(
  'event without group (keeps stored)',
  'avabodh.bpmn.event.start',
  { group: undefined },
  { data: ['0', '0', 'w', 'h', '0'], draw: [{ path: 'E 0 1 2 3 4' }] },
  50,
  50,
);
add('event without type', 'avabodh.bpmn.event.intermediate', { type: undefined, noninterrupting: true }, {}, 50, 50);

// ---- bpmn.gateway
for (const type of [
  'None',
  'Exclusive',
  'Event Based',
  'Parallel',
  'Inclusive',
  'Exclusive Event Based',
  'Complex',
  'Parallel Event Based',
])
  add(`gateway ${type}`, 'avabodh.bpmn.gateway', { type }, {}, 60, 60);
add('gateway without type', 'avabodh.bpmn.gateway', { type: undefined }, {}, 60, 60);

// ---- bpmn.conversation
for (const call of [false, true])
  for (const sub of [false, true])
    add(
      `conversation call=${call} sub=${sub}`,
      'avabodh.bpmn.conversation',
      { call, subconversation: sub },
      {},
      60,
      52,
    );
add('conversation call, stroke 4', 'avabodh.bpmn.conversation', { call: true }, { style: { strokewidth: 4 } }, 60, 52);

// ---- bpmn.dataobject
for (const type of ['None', 'Collection', 'Input', 'Output'])
  add(`dataobject ${type}`, 'avabodh.bpmn.dataobject', { type }, {}, 40, 56);
add('dataobject without type', 'avabodh.bpmn.dataobject', { type: undefined }, {}, 40, 56);

// ---- bpmn.choreography
const CHOREO = 'avabodh.bpmn.choreography';
add('choreography stencil', CHOREO);
for (const n of [1, 2, 3, 5])
  for (const top of [true, false])
    for (const [inp, resp] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ])
      add(
        `choreography n=${n} top=${top} in=${inp} resp=${resp}`,
        CHOREO,
        { participants: n, activetop: top, input: inp, response: resp },
        {},
        140,
        160,
      );
for (const marker of ['None', 'Loop', 'Parallel', 'Sequential'])
  for (const ch of ['Task', 'Sub-Choreography', 'Call'])
    for (const top of [true, false])
      add(
        `choreography ${marker} ${ch} top=${top}`,
        CHOREO,
        { marker, choreography: ch, activetop: top },
        {},
        140,
        160,
      );
add(
  'choreography stored texts trimmed',
  CHOREO,
  { participants: 2 },
  {
    texts: [
      { location: 'default', text: 'Alice' },
      { location: 'default', text: 'Ping' },
      { location: 'default', text: 'Bob' },
      { location: 'default', text: 'Carol' },
      { location: 'default', text: 'Dave' },
    ],
  },
);
add(
  'choreography stored texts extended',
  CHOREO,
  { participants: 4 },
  { texts: [{ location: 'default', text: 'Alice' }] },
);
add('choreography call, stroke 3', CHOREO, { choreography: 'Call' }, { style: { strokewidth: 3 } });
add('choreography participants not an int', CHOREO, { participants: 3.5 });

// ---- table-v1
for (const id of [
  'avabodh.table.std',
  'avabodh.table.nh',
  'avabodh.table.ct',
  'avabodh.bpmn.vlanes',
  'avabodh.bpmn.hlanes',
])
  if (T.has(id)) add(`stencil ${id}`, id, {}, {}, 250, 250);
for (const id of [...T.keys()].filter((k) => T.get(k).generator.shape === 'table-v1'))
  if (!cases.some((c) => c.name === `stencil ${id}`)) add(`stencil ${id}`, id, {}, {}, 250, 250);
const TABLE = 'avabodh.table.std';
for (const [r, c] of [
  [1, 1],
  [3, 2],
  [2, 4],
  [0, -1],
])
  for (const th of [false, true])
    for (const ch of [false, true])
      add(
        `table ${r}x${c} th=${th} ch=${ch}`,
        TABLE,
        { nrows: r, ncols: c, table_header: th, col_header: ch },
        {},
        300,
        200,
      );
for (const orient of ['Normal', 'Along Lane'])
  for (const cell of ['text', 'container', 'other'])
    add(
      `table ${orient} ${cell}`,
      TABLE,
      { ncols: 3, nrows: 2, header_orientation: orient, cell_type: cell, table_header: true, col_header: true },
      {},
      300,
      200,
    );
for (const rl of [false, true])
  for (const cl of [false, true])
    for (const lb of [false, true])
      add(
        `table lines r=${rl} c=${cl} below=${lb}`,
        TABLE,
        { ncols: 3, nrows: 3, show_row_lines: rl, show_col_lines: cl, line_below_header: lb },
        {},
        300,
        200,
      );
add(
  'table sizes given and repeated',
  TABLE,
  { ncols: 4, nrows: 3, col0: 2, col1: 1, row0: 0.25, row1: 0.5 },
  {},
  400,
  300,
);
add('table zero sizes', TABLE, { ncols: 2, nrows: 2, col0: 0, col1: 0, row0: 0, row1: 0 }, {}, 200, 200);
add(
  'table stray size params dropped',
  TABLE,
  { ncols: 2, nrows: 2, col5: 0.3, row7: 0.2, rowx: 1, coldata: 'x' },
  {},
  200,
  200,
);
add(
  'table default header texts',
  TABLE,
  { ncols: 2, table_header: true, col_header: true, default_table_header: 'Orders', default_col_header: 'Field' },
  {},
  240,
  200,
);
add(
  'table stored cell texts matched by row/col',
  TABLE,
  { ncols: 2, nrows: 2, table_header: true, col_header: true },
  {
    texts: [
      { location: 'default', text: 'cell 1,1', row: 1, col: 1 },
      { location: 'default', text: 'head', row: -2, col: 0, style: { fontsize: 20 } },
      { location: 'default', text: 'col B', row: -1, col: 1 },
      { location: 'default', text: 'cell 0,0', row: 0, col: 0 },
      { location: 'default', text: 'orphan', row: 5, col: 5 },
      { location: 'default', text: 'no cell' },
    ],
  },
  240,
  200,
);
add('table stroke 5', TABLE, { ncols: 2, nrows: 2 }, { style: { strokewidth: 5 } }, 200, 200);
add('table rows/cols not ints', TABLE, { ncols: 2.5, nrows: 'three' }, {}, 200, 200);

// ---- the board
const PAGE = 'native-page';
/** @type {Record<string, any>} */
const objects = {};
cases.forEach((c, i) => {
  const id = `00000000-0000-4000-9000-${(i + 1).toString(16).padStart(12, '0')}`;
  objects[id] = {
    type: 'templated',
    name: c.name,
    order: 100 + i,
    params: { cx: 200 + (i % 10) * 450, cy: 200 + Math.floor(i / 10) * 450, width: c.w, height: c.h, angle: 0 },
    template: c.body,
  };
});
const board = {
  info: {
    author: '',
    description: 'native generator cases (G5)',
    platform: '1',
    title: 'Native generators',
    version: '4.2',
  },
  pages: { [PAGE]: { name: 'Native', order: 1, canvassizetype: 'infinite', objects } },
};
const text = `${JSON.stringify(board, null, 1)}\n`;

const oracle = new NodeOracle();
try {
  const id = await oracle.identity();
  const out = await oracle.load(text, { stamp: 'app' });
  if (!out.ok) throw new Error(`the C++ core did not load the board: ${out.error ?? 'unknown'}`);
  mkdirSync(path.dirname(BOARD), { recursive: true });
  mkdirSync(path.dirname(GOLDEN), { recursive: true });
  writeFileSync(BOARD, text);
  const golden = JSON.parse(out.json);
  golden['_oracle'] = { kind: id.kind, commit: id.commit, wasm_sha256: id.wasm_sha256 };
  writeFileSync(GOLDEN, `${JSON.stringify(golden)}\n`);
  console.log(`${cases.length} cases; wrote ${path.relative(PKG, BOARD)} and ${path.relative(PKG, GOLDEN)}`);
} finally {
  await oracle.close();
}
