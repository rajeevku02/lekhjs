'use strict';

// The C++ side of a library batch in Node (`--cpp node`): ONE instance of the vendored backend
// wasm (`lbs/kashi/vendor/lekhcore`, the core dev's backend runs) in a worker thread, seeded as the
// Node oracle seeds it (parity/oracle/node-oracle-worker.cjs), drawing page 0 through kashi's own
// path: the projection's settle draw and page bounds (`ops.geometryProjection`), then
// `CoreDoc.render` onto an `@napi-rs/canvas` context through kashi's `BackendDrawingPlatform`.
//
// Messages: `{ op: 'init' }` → `{ buildInfo, heapMax }`;
// `{ op: 'bounds', text }` → `{ ok, bounds?, error? }` (the page bounds of the projection);
// `{ op: 'render', text, crop: { minx, miny, maxx, maxy }, scale, background }`
//   → `{ ok, png?, width?, height?, error? }`.

const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');

const KASHI = workerData.kashi;
require(path.join(KASHI, 'test', 'setup', 'env.js'));
process.env.TZ = 'UTC';

let counter = 0;
nodeCrypto.randomUUID = () => {
  counter++;
  return '00000000-0000-4000-8000-' + counter.toString(16).padStart(12, '0');
};

const host = require(path.join(KASHI, 'service', 'mcp', 'core', 'host'));
const ops = require(path.join(KASHI, 'service', 'mcp', 'core', 'ops'));
const canvasLib = require(path.join(KASHI, 'service', 'mcp', 'core', 'canvasLib'));
const stencils = require(path.join(KASHI, 'service', 'mcp', 'stencils'));

let Module = null;

const idsOf = (text) => {
  try {
    return stencils.idsFromDocument(JSON.parse(text)).shapes;
  } catch {
    return [];
  }
};

const init = async () => {
  stencils.init({ dir: path.join(KASHI, 'vendor', 'stencils') });
  Module = await host.init();
  Module.setFormatStampMode(0);
  let heapMax = null;
  try {
    heapMax = Module.heapStats().heapMax;
  } catch {
    // older core
  }
  return { buildInfo: host.buildInfo(), heapMax };
};

/** Loads `text` and runs `fn({ doc, platform })` inside one core operation. */
const withLoaded = async (text, fn) => {
  counter = 0;
  ops.seed(Module, idsOf(text));
  return host.withDoc(({ doc, platform }) => {
    if (!doc.load(text)) return { ok: false, error: doc.message() || 'load failed' };
    return fn({ doc, platform });
  });
};

const pageBounds = (doc, platform) => {
  const projection = ops.geometryProjection(doc, '', platform);
  const page = (projection.pages || [])[0];
  if (!page) return null;
  return { page: page.id, bounds: page.bounds || null };
};

const bounds = async ({ text }) =>
  withLoaded(text, ({ doc, platform }) => {
    const b = pageBounds(doc, platform);
    if (b === null) return { ok: false, error: 'no page' };
    return { ok: true, ...b };
  });

const render = async ({ text, crop, scale, background }) =>
  withLoaded(text, ({ doc, platform }) => {
    const b = pageBounds(doc, platform); // the settle draw kashi's render does first
    if (b === null) return { ok: false, error: 'no page' };
    const width = Math.max(1, Math.round((crop.maxx - crop.minx) * scale));
    const height = Math.max(1, Math.round((crop.maxy - crop.miny) * scale));
    const { createCanvas } = canvasLib();
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (background) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    const drawing = host.createDrawingPlatform(ctx);
    try {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(-crop.minx, -crop.miny);
      const answer = doc.render(
        JSON.stringify({ page: b.page, minx: crop.minx, miny: crop.miny, maxx: crop.maxx, maxy: crop.maxy }),
        drawing.cppObj,
      );
      ctx.restore();
      if (typeof answer === 'string' && answer.length > 0) {
        const parsed = JSON.parse(answer);
        if (parsed && parsed.ok === false) return { ok: false, error: parsed.message || 'render refused' };
      }
    } finally {
      try {
        drawing.cppObj.delete();
      } catch {
        // already gone
      }
    }
    return { ok: true, png: canvas.toBuffer('image/png'), width, height, bounds: b.bounds };
  });

parentPort.on('message', async (msg) => {
  try {
    let value;
    if (msg.op === 'init') value = await init();
    else if (msg.op === 'bounds') value = await bounds(msg);
    else value = await render(msg);
    parentPort.postMessage({ id: msg.id, value });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: String((e && e.stack) || e) });
  }
});
