// Runs one library batch (verification 02 §C.3): both builds load the same batch file, page 0 is
// exported with the §B.2 options, each build is self-diffed (two renders, the second fresh, must be
// byte-identical), the pair is compared under the §B.3 bar, and differing blobs are attributed to
// the batch's grid cells. Agents run batches by hand, one at a time, under the heavy-job lock.
//
//   node parity/library/run-batch.mjs --batch <file.lekh | batch id> [--out <dir>]
//        [--cpp node|browser|none] [--ts node|browser] [--compat on|off] [--lekhjs <dir>]
//        [--scale 1] [--against <v4 run dir>] [--no-selfdiff] [--register <dir>] [--include-proposed]
//        [--ts-commit <sha>]
//
// A batch id (`v3-basic-01`) is read from parity/out/library/<set>/ (build-batches.mjs). `--lekhjs`
// names the lekhjs package whose `dist/node` is under test (default: this one). `--cpp none` with
// `--against` is the v5 check of §C.5 item 2: the TS image against the C++ image of the v4 run
// under the bar, and against the TS image of the v4 run exactly.
//
// Writes into `--out` (default parity/out/library-runs/<run-id>/, git-ignored): cpp.png, ts.png,
// diff.png, result.json, row.txt (the Work comment row of §C.3 step 6), and crops/<cell>.png
// (C++ | TS | diff) for each failing cell. Exit status 0 = PASS, 1 = FAIL, 2 = usage, 75 = lock busy.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  align,
  bar,
  blobs,
  crop,
  decodePng,
  diffImages,
  diffPicture,
  encodePng,
  identical,
  inkPixels,
  maxBlob,
  sideBySide,
} from '../image/diff.mjs';
import { activeEntries, loadRegister } from '../register/load.mjs';
import { holdHeavyLock } from '../tools/lock.mjs';
import { createEngine } from './engines.mjs';
import { GUTTER, PADDING } from './layout.mjs';
import { WS } from './stencil-set.mjs';

const HERE = import.meta.dirname;
const PARITY = path.resolve(HERE, '..');
const LEKHJS = path.resolve(PARITY, '..');
/** TS warnings that fail a batch (§C.3 step 5). */
export const FATAL_WARNINGS = Object.freeze(['unknown_generator', 'generator_failed']);

/**
 * @typedef {import('../image/diff.mjs').Rgba} Rgba
 * @typedef {import('../image/diff.mjs').Blob} Blob
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ n: number, object: string, shape: string, file: string, params: string, rect: Rect }} Cell
 */

/**
 * A cell's rectangle in image pixels, grown by half the gutter so a title or an overhang below or
 * beside the shape is still its own.
 * @param {Rect} r   board points
 * @param {{ x: number, y: number }} origin   the board point at pixel (0, 0)
 * @param {number} scale
 * @param {number} [grow]
 * @returns {Rect}
 */
export function cellPixels(r, origin, scale, grow = GUTTER / 2) {
  return {
    x: (r.x - grow - origin.x) * scale,
    y: (r.y - grow - origin.y) * scale,
    w: (r.w + 2 * grow) * scale,
    h: (r.h + 2 * grow) * scale,
  };
}

/** @param {Rect} a @param {Rect} b */
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Attribution of a diff to cells (§B.6 item 4): per cell its differing pixels, its blobs and the
 * largest; a cell fails when it holds a blob over the limit or ≥ 0.1 % of its own pixels differ.
 * A blob is the cell's when its box meets the cell's grown rectangle.
 * @param {{ mask: Uint8Array, width: number, height: number }} d
 * @param {Blob[]} bl
 * @param {Cell[]} cells
 * @param {{ x: number, y: number }} origin
 * @param {number} scale
 */
export function attribute(d, bl, cells, origin, scale) {
  const limit = maxBlob(scale);
  const per = cells.map((c) => {
    const px = cellPixels(c.rect, origin, scale);
    let count = 0;
    const x0 = Math.max(0, Math.floor(px.x));
    const y0 = Math.max(0, Math.floor(px.y));
    const x1 = Math.min(d.width, Math.ceil(px.x + px.w));
    const y1 = Math.min(d.height, Math.ceil(px.y + px.h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) count += d.mask[y * d.width + x] ?? 0;
    const mine = bl.filter((b) => intersects(px, b));
    const largest = mine.reduce((m, b) => Math.max(m, b.pixels), 0);
    const area = Math.max(1, (x1 - x0) * (y1 - y0));
    return { cell: c, px, count, largest, fails: largest > limit || count / area >= 0.001 };
  });
  const orphans = bl.filter((b) => !per.some((p) => intersects(p.px, b)));
  return { per, orphans };
}

/**
 * The image rules of register entries that claim cells (`rule.image.cells`): shape id → entry ids.
 * @param {string} dir
 * @param {boolean} acceptedOnly
 */
export function cellRules(dir, acceptedOnly) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const e of activeEntries(loadRegister(dir), { acceptedOnly })) {
    const cells = e.data?.['rule']?.['image']?.['cells'];
    if (!Array.isArray(cells)) continue;
    for (const s of cells) out.set(String(s), [...(out.get(String(s)) ?? []), String(e.data['id'])]);
  }
  return out;
}

/**
 * Register entries whose image rule re-frames TS on the reference's origin (`rule.image.align`).
 * @param {string} dir
 * @param {boolean} acceptedOnly
 * @returns {string[]}
 */
export function alignRules(dir, acceptedOnly) {
  return activeEntries(loadRegister(dir), { acceptedOnly })
    .filter((e) => e.data?.['rule']?.['image']?.['align'] === 'reference-origin')
    .map((e) => String(e.data['id']));
}

/** @param {string} p */
const git = (p) => {
  try {
    return execFileSync('git', ['-C', p, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * @param {string} spec  a .lekh path or a batch id
 * @returns {{ file: string, id: string, manifest: any }}
 */
function resolveBatch(spec) {
  let file = spec;
  if (!spec.endsWith('.lekh')) {
    const set = spec.split('-')[0] ?? '';
    file = path.join(PARITY, 'out', 'library', set, `${spec}.lekh`);
  }
  file = path.resolve(file);
  if (!existsSync(file))
    throw new Error(`no batch file ${file} (build it: node parity/library/build-batches.mjs --set <set>)`);
  const manifestFile = file.replace(/\.lekh$/, '.manifest.json');
  if (!existsSync(manifestFile)) throw new Error(`no manifest beside the batch: ${manifestFile}`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  return { file, id: manifest.batch, manifest };
}

/**
 * Renders twice (the second fresh) and checks the self-diff.
 * @param {any} engine
 * @param {string} text
 * @param {import('./engines.mjs').RenderOpts} opts
 * @param {boolean} selfdiff
 */
async function renderChecked(engine, text, opts, selfdiff) {
  const t0 = performance.now();
  const first = await engine.render(text, opts);
  const ms = Math.round(performance.now() - t0);
  if (!first.ok || !selfdiff) return { ...first, ms, selfdiff: null };
  const second = await engine.render(text, { ...opts, fresh: true });
  if (!second.ok) return { ...second, ms, selfdiff: null };
  return {
    ...first,
    ms,
    selfdiff: identical(first.img, second.img)
      ? 0
      : diffImages(first.img, second.img, { threshold: 0, includeAA: true }).count,
  };
}

/**
 * Compares two renders of one batch and builds the result.
 * @param {{ a: any, b: any, cells: Cell[], rules: Map<string, string[]>, scale: number }} x
 */
export function compareRenders(x) {
  const { a, b, cells, rules, scale } = x;
  let A = a.img;
  let B = b.img;
  let origin = a.origin;
  const dims = { cpp: [A.width, A.height], ts: [B.width, B.height] };
  const sameDims =
    A.width === B.width && A.height === B.height && a.origin.x === b.origin.x && a.origin.y === b.origin.y;
  if (!sameDims) {
    const al = align(A, a.origin, B, b.origin, scale);
    A = al.a;
    B = al.b;
    origin = al.origin;
  }
  const d = diffImages(A, B);
  const bl = blobs(d.mask, d.width, d.height);
  const page = bar(d, bl, scale);
  const att = attribute(d, bl, cells, origin, scale);
  const failing = att.per.filter((p) => p.fails);
  // §C.3 step 4: a failing cell whose shape an accepted entry lists is removed from the count.
  const claimed = failing.filter((p) => rules.has(p.cell.shape));
  const claimedPx = claimed.reduce((n, p) => n + p.count, 0);
  const unclaimedBlobs = bl.filter((bb) => !claimed.some((p) => intersects(p.px, bb)));
  const after = bar({ count: d.count - claimedPx, total: d.total }, unclaimedBlobs, scale);
  const emptyCpp = [];
  const emptyTs = [];
  for (const c of cells) {
    const px = cellPixels(c.rect, origin, scale, 0);
    if (inkPixels(A, px) === 0) emptyCpp.push(c.shape);
    if (inkPixels(B, px) === 0) emptyTs.push(c.shape);
  }
  return { A, B, d, bl, page, after, att, failing, claimed, sameDims, dims, origin, emptyCpp, emptyTs };
}

async function main() {
  const { values } = parseArgs({
    options: {
      batch: { type: 'string' },
      out: { type: 'string' },
      cpp: { type: 'string', default: 'node' },
      ts: { type: 'string', default: 'node' },
      compat: { type: 'string', default: 'on' },
      lekhjs: { type: 'string' },
      kashi: { type: 'string' },
      builds: { type: 'string' },
      scale: { type: 'string', default: '1' },
      against: { type: 'string' },
      'no-selfdiff': { type: 'boolean', default: false },
      register: { type: 'string', default: path.join(PARITY, 'register') },
      'accepted-only': { type: 'boolean', default: true },
      // Triage view (§D step 3): proposed entries claim cells too. A phase exit counts accepted only.
      'include-proposed': { type: 'boolean', default: false },
      // The lekhjs commit a browser TS build was made from (its hooks do not report one).
      'ts-commit': { type: 'string' },
    },
  });
  if (
    values.batch === undefined ||
    !['node', 'browser', 'none'].includes(values.cpp) ||
    !['node', 'browser'].includes(values.ts)
  ) {
    process.stderr.write(
      'usage: run-batch.mjs --batch <file.lekh | id> [--out <dir>] [--cpp node|browser|none] [--ts node|browser]\n' +
        '       [--compat on|off] [--lekhjs <dir>] [--scale 1] [--against <v4 run dir>] [--no-selfdiff]\n',
    );
    process.exit(2);
  }
  holdHeavyLock();
  const batch = resolveBatch(values.batch);
  const text = readFileSync(batch.file, 'utf8');
  const scale = Number(values.scale);
  const compat = values.compat !== 'off';
  const selfdiff = !values['no-selfdiff'];
  const runId = `${batch.id}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
  const out = path.resolve(values.out ?? path.join(PARITY, 'out', 'library-runs', runId));
  mkdirSync(out, { recursive: true });
  const engineOpts = {
    ...(values.lekhjs ? { lekhjs: values.lekhjs } : {}),
    ...(values.kashi ? { kashi: values.kashi } : {}),
    ...(values.builds ? { builds: values.builds } : {}),
    compat,
  };
  const cpp =
    values.cpp === 'none' ? null : createEngine('cpp', /** @type {'node' | 'browser'} */ (values.cpp), engineOpts);
  const ts = createEngine('ts', /** @type {'node' | 'browser'} */ (values.ts), engineOpts);
  /** @type {Record<string, any>} */
  const result = {
    batch: batch.id,
    file: path.relative(LEKHJS, batch.file),
    batch_sha256: batch.manifest.sha256,
    cells: batch.manifest.cells.length,
    shapes: batch.manifest.shapes,
    started_at: new Date().toISOString(),
    options: {
      region: 'drawing',
      padding: PADDING,
      scale,
      background: true,
      compat,
      cpp: values.cpp,
      ts: values.ts,
      register: values['include-proposed'] ? 'accepted+proposed' : 'accepted',
    },
    parity_commit: git(LEKHJS),
    lekhboard_commit: git(path.join(WS, 'lekhboard')),
  };
  /** @type {string[]} */
  const problems = [];
  try {
    result['identity'] = { cpp: cpp ? await cpp.identity() : null, ts: await ts.identity() };
    // The lekhjs under test: its build record, else its checkout, else (no --lekhjs) this one.
    const tsId = result['identity'].ts;
    const browserCommit = tsId.build?.commit && tsId.build.commit !== 'unknown' ? tsId.build.commit : null;
    result['lekhjs_commit'] =
      values['ts-commit'] ??
      tsId.commit ??
      browserCommit ??
      (values.lekhjs ? git(values.lekhjs) : null) ??
      (values.lekhjs || values.ts === 'browser' ? null : result['parity_commit']);
    result['lekhjs_files_sha256'] = tsId.files_sha256 ?? null;

    // Node renders share one crop: the C++ page bounds (the projection's, as board_render crops a
    // page) plus the export padding; without C++, the TS objects' bounds. The browser builds crop
    // themselves (region 'drawing') and are aligned on their origins.
    /** @type {import('./engines.mjs').Box | null} */
    let cropBox = null;
    // §C.5: a TS-only run against a reference run draws the reference's crop, so the pair aligns.
    const refResult = values.against
      ? JSON.parse(readFileSync(path.join(path.resolve(values.against), 'result.json'), 'utf8'))
      : null;
    const refCrop = refResult?.crop ?? null;
    // A browser reference run crops itself, so its images are placed by the origins it recorded.
    if (values.ts === 'browser' && refResult !== null && refCrop === null && !refResult.render?.ts?.origin)
      throw new Error(
        `--against ${values.against}: the reference run recorded no export origins (run it again with this harness)`,
      );
    if (values.cpp === 'none' && values.ts === 'node' && refCrop !== null) {
      cropBox = refCrop;
      result['crop'] = cropBox;
    } else if (values.cpp === 'node' || (values.cpp === 'none' && values.ts === 'node')) {
      let b = null;
      if (cpp !== null) {
        const r = await /** @type {import('./engines.mjs').NodeCppEngine} */ (cpp).bounds(text);
        if (!r.ok || !r.bounds) throw new Error(`C++ page bounds: ${r.error ?? 'none'}`);
        b = r.bounds;
      } else {
        const probe = await ts.render(text, { crop: { minx: 0, miny: 0, maxx: 1, maxy: 1 }, scale, padding: PADDING });
        if (!probe.ok || !probe.bounds) throw new Error(`TS bounds: ${probe.error ?? 'none'}`);
        b = probe.bounds;
      }
      cropBox = { minx: b.minx - PADDING, miny: b.miny - PADDING, maxx: b.maxx + PADDING, maxy: b.maxy + PADDING };
      result['crop'] = cropBox;
    }
    const opts = { crop: cropBox, scale, padding: PADDING };
    const rc = cpp ? await renderChecked(cpp, text, opts, selfdiff) : null;
    let rt = await renderChecked(ts, text, opts, selfdiff);
    // §D step 4: page bounds that differ only by a register entry with `rule.image.align:
    // reference-origin` (DR-ENG-17, a half-stroke shift that no whole-pixel alignment undoes) are
    // re-drawn by TS on the reference's frame, and the entry is listed as applied.
    const alignIds = alignRules(values.register, values['accepted-only'] && !values['include-proposed']);
    if (
      values.ts === 'browser' &&
      rc?.ok &&
      rt.ok &&
      rc.origin &&
      rt.origin &&
      alignIds.length > 0 &&
      (rc.origin.x !== rt.origin.x || rc.origin.y !== rt.origin.y)
    ) {
      const s = rc.scale ?? scale;
      const frame = { x: rc.origin.x, y: rc.origin.y, width: rc.img.width / s, height: rc.img.height / s };
      const again = await renderChecked(ts, text, { ...opts, frame }, selfdiff);
      if (again.ok) {
        result['bounds_rule'] = { register: alignIds, cpp_origin: rc.origin, ts_origin: rt.origin, frame };
        rt = again;
      }
    }
    // §C.5: a TS-only run against a reference run whose TS image was re-drawn on the C++ frame
    // re-draws on that same frame, so both comparisons see what the reference run compared.
    const refFrame = refResult?.bounds_rule?.frame ?? null;
    if (values.ts === 'browser' && rc === null && rt.ok && refFrame !== null) {
      const again = await renderChecked(ts, text, { ...opts, frame: refFrame }, selfdiff);
      if (again.ok) {
        result['bounds_rule'] = {
          register: refResult.bounds_rule.register,
          from: refResult.batch,
          ts_origin: rt.origin,
          frame: refFrame,
        };
        rt = again;
      }
    }
    result['render'] = {
      cpp: rc
        ? {
            ok: rc.ok,
            ms: rc.ms,
            selfdiff: rc.selfdiff,
            error: rc.error ?? null,
            size: rc.img ? [rc.img.width, rc.img.height] : null,
            origin: rc.origin ?? null,
            scale: rc.scale ?? null,
          }
        : null,
      ts: {
        ok: rt.ok,
        ms: rt.ms,
        selfdiff: rt.selfdiff,
        error: rt.error ?? null,
        size: rt.img ? [rt.img.width, rt.img.height] : null,
        origin: rt.origin ?? null,
        scale: rt.scale ?? null,
      },
    };
    /** @type {{ level: string, code: string }[]} */
    const warnings = rt.warnings ?? [];
    const fatal = warnings.filter((w) => FATAL_WARNINGS.includes(w.code));
    result['ts_warnings'] = Object.fromEntries(
      [...new Set(warnings.map((w) => w.code))].map((c) => [c, warnings.filter((w) => w.code === c).length]),
    );
    if (fatal.length > 0)
      problems.push(`TS warned ${[...new Set(fatal.map((w) => w.code))].join(', ')} (${fatal.length})`);
    if (rc && !rc.ok) problems.push(`C++ render failed: ${rc.error}`);
    if (!rt.ok) problems.push(`TS render failed: ${rt.error}`);
    if (rc?.selfdiff) problems.push(`C++ self-diff ${rc.selfdiff} px (nondeterministic)`);
    if (rt.selfdiff) problems.push(`TS self-diff ${rt.selfdiff} px (nondeterministic)`);
    if (rt.img) writeFileSync(path.join(out, 'ts.png'), encodePng(rt.img));
    if (rc?.img) writeFileSync(path.join(out, 'cpp.png'), encodePng(rc.img));

    const rules = cellRules(values.register, values['accepted-only'] && !values['include-proposed']);
    /** @type {{ label: string, ref: any, refName: string, threshold0?: boolean }[]} */
    const pairs = [];
    if (rc?.ok && rt.ok) pairs.push({ label: 'cpp_vs_ts', ref: rc, refName: 'cpp' });
    if (values.against && rt.ok) {
      const dir = path.resolve(values.against);
      const prev = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8'));
      const cropOrigin = prev.crop ? { x: prev.crop.minx, y: prev.crop.miny } : null;
      const load = (/** @type {string} */ f, /** @type {'cpp' | 'ts'} */ side) => ({
        ok: true,
        img: decodePng(readFileSync(path.join(dir, f))),
        origin: cropOrigin ?? prev.render?.[side]?.origin ?? { x: 0, y: 0 },
        scale,
      });
      if (existsSync(path.join(dir, 'cpp.png')))
        pairs.push({ label: 'against_cpp', ref: load('cpp.png', 'cpp'), refName: `${prev.batch} cpp` });
      if (existsSync(path.join(dir, 'ts.png')))
        pairs.push({
          label: 'against_ts_exact',
          ref: load('ts.png', 'ts'),
          refName: `${prev.batch} ts`,
          threshold0: true,
        });
      result['against'] = { run: path.relative(LEKHJS, dir), batch: prev.batch };
    }
    result['comparisons'] = {};
    for (const p of pairs) {
      const cmp = compareRenders({ a: p.ref, b: rt, cells: batch.manifest.cells, rules, scale });
      /** @type {Record<string, any>} */
      const row = {
        reference: p.refName,
        same_dims: cmp.sameDims,
        dims: cmp.dims,
        differing_pixels: cmp.d.count,
        fraction: cmp.page.fraction,
        largest_blob: cmp.page.largestBlob,
        blobs_over_limit: cmp.page.oversized,
        failing_cells: cmp.failing.map((f) => ({
          n: f.cell.n,
          shape: f.cell.shape,
          params: f.cell.params,
          pixels: f.count,
          largest_blob: f.largest,
        })),
        claimed_cells: cmp.claimed.map((f) => ({ shape: f.cell.shape, register: rules.get(f.cell.shape) })),
        orphan_blobs: cmp.att.orphans.length,
        empty_cells: { reference: cmp.emptyCpp, ts: cmp.emptyTs },
      };
      if (p.threshold0) {
        const exact = identical(cmp.A, cmp.B);
        row['status'] = exact ? 'pass' : 'fail';
        if (!exact) problems.push(`${p.label}: TS image differs from ${p.refName} (threshold 0)`);
      } else {
        row['status'] = cmp.page.pass ? 'pass' : cmp.after.pass ? 'pass_rules' : 'fail';
        if (row['status'] === 'fail')
          problems.push(
            `${p.label}: ${cmp.failing.length} failing cells, ${(cmp.page.fraction * 100).toFixed(4)} % differing, largest blob ${cmp.page.largestBlob} px`,
          );
        if (!cmp.sameDims) row['bounds'] = 'dimensions or origin differ; aligned on board coordinates (§B.2 item 4)';
      }
      // A cell the reference draws and TS leaves blank, or either build blank (§C.3 step 5).
      const blank = [...new Set([...cmp.emptyCpp, ...cmp.emptyTs])];
      if (blank.length > 0)
        problems.push(
          `${p.label}: ${blank.length} cells drew nothing (${blank.slice(0, 5).join(', ')}${blank.length > 5 ? ', …' : ''})`,
        );
      result['comparisons'][p.label] = row;
      if (p.label === 'cpp_vs_ts' || pairs.length === 1 || p.label === 'against_cpp') {
        const pic = diffPicture(cmp.A, cmp.B);
        writeFileSync(path.join(out, `${p.label === 'cpp_vs_ts' ? 'diff' : p.label}.png`), encodePng(pic));
        if (cmp.failing.length > 0) {
          mkdirSync(path.join(out, 'crops'), { recursive: true });
          for (const f of cmp.failing.slice(0, 200)) {
            const parts = [cmp.A, cmp.B, pic].map((img) => crop(img, f.px));
            writeFileSync(
              path.join(out, 'crops', `${p.label}-${String(f.cell.n).padStart(4, '0')}.png`),
              encodePng(sideBySide(parts)),
            );
          }
        }
      }
    }
    if (pairs.length === 0 && problems.length === 0) problems.push('nothing to compare (no reference image)');
  } catch (e) {
    problems.push(`harness: ${String(/** @type {Error} */ (e)?.message ?? e)}`);
  } finally {
    if (cpp) await cpp.close();
    await ts.close();
  }
  result['problems'] = problems;
  result['status'] = problems.length === 0 ? 'PASS' : 'FAIL';
  result['finished_at'] = new Date().toISOString();
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  const main = result['comparisons']?.['cpp_vs_ts'] ?? result['comparisons']?.['against_cpp'];
  const failingIds = main ? [...new Set(main.failing_cells.map((/** @type {any} */ f) => f.shape))] : [];
  const regIds = [
    ...new Set([
      ...(result['bounds_rule']?.register ?? []),
      ...(main ? main.claimed_cells.flatMap((/** @type {any} */ c) => c.register) : []),
    ]),
  ];
  // A pass that leans on proposed entries is register-listed, not a phase-exit pass.
  const statusText =
    result['status'] === 'PASS' && regIds.length > 0 && values['include-proposed']
      ? 'PASS (register-listed, proposed)'
      : result['status'];
  const cppId = result['identity']?.cpp;
  const wasm = cppId
    ? `${cppId.runtime} ${cppId.commit ?? cppId.build?.commit ?? '?'}/${String(cppId.wasm_sha256 ?? cppId.build?.wasmSha256 ?? '').slice(0, 8)}`
    : 'none';
  const row =
    `| ${batch.id} | ${batch.manifest.cells.length} | ${statusText} | ${failingIds.join(', ') || '—'} | ${regIds.join(', ') || '—'} | ` +
    `${result['lekhjs_commit'] ? String(result['lekhjs_commit']).slice(0, 7) : `files ${String(result['lekhjs_files_sha256'] ?? '?').slice(0, 8)}`} | ${wasm} |`;
  writeFileSync(path.join(out, 'row.txt'), row + '\n');
  process.stdout.write(
    `${row}\n${problems.map((p) => `  - ${p}`).join('\n')}${problems.length ? '\n' : ''}result: ${out}\n`,
  );
  process.exit(result['status'] === 'PASS' ? 0 : 1);
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + '\n');
    process.exit(1);
  });
}
