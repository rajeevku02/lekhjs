// Corpus parity against the owner-built web wasm (spec 07 §7.4.2; AC-REC-26, -27, -33): every case of
// test/recognizer/corpus/ is recognised by TS on the owner's LineAggregator and compared with the
// reference the wasm recorded (test/recognizer/parity/reference/, parity/tools/rec-parity/capture.mjs).
//
//  - strict: quirks on (the C1/C2 bugs put back); only proven-borderline cases may differ, at most
//    0.5 % of the corpus (OQ-42, DR-REC-04), plus the cases known-differences.json attributes to a
//    register entry (DR-REC-04's float32 vs double coordinate cases, while they stay `tolerance`);
//    the other known groups there (reference defects, line aggregator) are reported, not excused;
//  - product: quirks off; every case beyond the strict differences is attributed to DR-REC-01 or
//    DR-REC-02 by turning that one quirk back on.
//
// The report (counts, case names, register ids; the corpus has no user data) is written to
// parity/out/rec-parity/report.json.
//
// The corpus run takes minutes on the 2-core box (two to four TS recognitions per case), so it runs
// only with REC_PARITY=1 (hold the heavy-job lock):
//   REC_PARITY=1 npx vitest run test/recognizer/parity
// REC_PARITY_PROBES=1 adds the isSingleLine probe (owner question after M1). The MANIFEST check
// (AC-REC-33) always runs.
//
// Line aggregator ids (AC-REC-33): the MANIFEST's `lineAggregatorId` names the C++ aggregator in the
// reference wasm; `tsLineAggregatorId` names the TS module (LineMerger.js) the reference was last
// compared against. The TS id is bumped whenever LineMerger's output changes
// (src/recognizer/lines/LineAggregatorImpl.ts); the AC-REC-33 check then fails until this run is
// repeated and the MANIFEST's `tsLineAggregatorId` / `tsComparedAt` are updated by hand from the
// report (`manifest.tsLineAggregatorId`). capture.mjs writes both as null: a fresh reference has not
// been compared yet.
//
// Besides the borderline rule for discrete outcomes (§7.4.2), the report shows for each tolerance
// failure whether the wasm's own coordinates move past the tolerance under the same ±0.01 px jitter
// (`oracleUnstable`): the stroke is pre-processed into integer pixels (GeoUtil::preProcess) and the
// line split picks pixel indices, so a 0.01 px nudge can move a vertex by whole pixels.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RecognizerQuirks } from '../../../src/recognizer/core';
import {
  defaultLineAggregatorModule,
  lineAggregatorImplModule,
  type LineAggregatorModule,
} from '../../../src/recognizer/lines';
import { PKG_ROOT } from '../../lint/eslint-helpers';
import { compareCase, deviations, outcomeSig, type CaseResult } from './compare';
import { loadCorpus, loadManifest, loadReference, SceneSessions, type ParityCase } from './runner';

const STRICT: RecognizerQuirks = { legacyTakeOut: true, legacyWidthBug: true };
const PRODUCT: RecognizerQuirks = {};
const BORDERLINE_SHARE = 0.005;
const RUN = process.env.REC_PARITY === '1';
const PROBES = process.env.REC_PARITY_PROBES === '1';
const OUT = path.join(PKG_ROOT, 'parity/out/rec-parity');

const { cases, scenes } = loadCorpus();
const manifest = loadManifest();
const sessions = new SceneSessions(scenes);
const caseMs: Record<string, number> = {};

interface KnownGroup {
  readonly id?: string;
  readonly expect?: CaseResult['status'];
  readonly reason: string;
  readonly cases: readonly string[];
}
interface KnownDifferences {
  readonly register: readonly KnownGroup[];
  readonly referenceDefect: readonly KnownGroup[];
  readonly lineAggregator: readonly KnownGroup[];
}
const known = JSON.parse(
  readFileSync(path.join(PKG_ROOT, 'test/recognizer/parity/known-differences.json'), 'utf8'),
) as KnownDifferences;
const knownGroup = (groups: readonly KnownGroup[], name: string): KnownGroup | undefined =>
  groups.find((g) => g.cases.includes(name));

interface Row {
  readonly name: string;
  readonly scene: string;
  readonly strict: CaseResult;
  readonly product: CaseResult;
  /** The wasm's own outcome flips under a ±0.01 px jitter (borderline rule). */
  readonly oracleFlips: boolean;
  /** The wasm's own coordinates move past the tolerance under the jitter (same discrete outcome). */
  readonly oracleUnstable: boolean;
  /** For product-only differences: the register entries whose quirk restores the strict result. */
  readonly attributed: string[];
  readonly tsMs: number;
}

function runAll(module: LineAggregatorModule): Row[] {
  return cases.map((c: ParityCase) => {
    const ref = loadReference(c.name);
    const strictRun = sessions.run(c, module, STRICT);
    const strict = compareCase(strictRun.calls, ref.calls);
    const product = compareCase(sessions.run(c, module, PRODUCT).calls, ref.calls);
    const base = outcomeSig(ref.calls);
    const oracleFlips = ref.jitter.some((j) => outcomeSig(j) !== base);
    const oracleUnstable = ref.jitter.some((j) => outcomeSig(j) === base && deviations(j, ref.calls).over.length > 0);
    const attributed: string[] = [];
    if (strict.status === 'pass' && product.status !== 'pass') {
      if (compareCase(sessions.run(c, module, { legacyTakeOut: true }).calls, ref.calls).status === 'pass')
        attributed.push('DR-REC-01');
      if (compareCase(sessions.run(c, module, { legacyWidthBug: true }).calls, ref.calls).status === 'pass')
        attributed.push('DR-REC-02');
      if (attributed.length === 0) attributed.push('DR-REC-01+DR-REC-02');
    }
    return {
      name: c.name,
      scene: c.scene,
      strict,
      product,
      oracleFlips,
      oracleUnstable,
      attributed,
      tsMs: strictRun.ms,
    };
  });
}

const pct = (xs: number[], q: number): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return Math.round((s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0) * 1000) / 1000;
};

function maxRatios(rows: readonly Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows)
    for (const [k, v] of r.strict.ratio) {
      const key = k.replace(/^\[\]\./, '');
      out[key] = Math.max(out[key] ?? 0, Math.round(v * 1e4) / 1e4);
    }
  return out;
}

describe('recognizer parity reference (spec 07 §7.4.1)', () => {
  it('AC-REC-33: the reference MANIFEST names the wasm commit, its sha256, its LineAggregator and the TS one last compared', () => {
    // Read by key: the JSON keys are AC-REC-33's; the oracle's path and build info live in
    // parity/ (`provenance`), since nothing in test/ names one (AC-ARC-12).
    expect(manifest['provenance']).toBe('parity/tools/rec-parity/reference-provenance.json');
    expect(manifest['wasmCommit']).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest['wasmSha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof manifest.lineAggregatorId).toBe('string');
    expect(String(manifest.lineAggregatorId)).not.toMatch(/stub/i);
    expect(manifest.cases).toBe(cases.length);
    // The TS line aggregator the reference was last compared against is the one the port runs: bump
    // lineAggregatorImplModule.id whenever LineMerger's output changes, re-run the strict parity run
    // (REC_PARITY=1) and record the new id and date here (KB parity-and-corpus.md §5.1, §5.6).
    expect(
      manifest['tsLineAggregatorId'],
      'MANIFEST.tsLineAggregatorId: re-run REC_PARITY=1 and record the TS id it compared',
    ).toBe(lineAggregatorImplModule.id);
    expect(String(manifest['tsComparedAt'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The TS side runs the owner's module, not the stub.
    expect(defaultLineAggregatorModule).toBe(lineAggregatorImplModule);
  });
});

describe.runIf(RUN)('recognizer corpus parity against the wasm reference (spec 07 §7.4.2)', () => {
  // describe.runIf still runs this body when collecting, so the work itself is gated too.
  const rows = RUN ? runAll(defaultLineAggregatorModule) : [];
  const strictFail = rows.filter((r) => r.strict.status !== 'pass');
  const borderline = strictFail.filter((r) => r.strict.status === 'discrete' && r.oracleFlips);
  // Attributed to a register entry: listed under it and failing as the entry says (e.g. DR-REC-04:
  // coordinates only, same discrete outcome).
  const attributedTo = (r: Row): string | undefined => {
    const g = knownGroup(known.register, r.name);
    return g && r.strict.status === g.expect ? g.id : undefined;
  };
  const strictAttributed = strictFail.filter((r) => !borderline.includes(r) && attributedTo(r) !== undefined);
  const notExcused = strictFail.filter((r) => !borderline.includes(r) && !strictAttributed.includes(r));
  const knownDefect = notExcused.filter((r) => knownGroup(known.referenceDefect, r.name));
  const knownLines = notExcused.filter((r) => knownGroup(known.lineAggregator, r.name));
  const strictUnexplained = notExcused.filter((r) => !knownDefect.includes(r) && !knownLines.includes(r));
  // Listed cases that no longer fail as listed: the list needs updating.
  const listed = [...known.register, ...known.referenceDefect, ...known.lineAggregator].flatMap((g) => g.cases);
  const staleKnown = rows
    .filter((r) => listed.includes(r.name))
    .filter((r) => r.strict.status === 'pass' || (knownGroup(known.register, r.name) && !strictAttributed.includes(r)))
    .map((r) => ({ name: r.name, status: r.strict.status }));
  const productExtra = rows.filter((r) => r.strict.status === 'pass' && r.product.status !== 'pass');

  // Owner question (M1): LineMerger has no isSingleLine, so the module answers false. How much
  // would the results move if it answered true? Informational: the corpus run with isSingleLine
  // always true, compared with the default run.
  const alwaysSingle: LineAggregatorModule = {
    ...lineAggregatorImplModule,
    id: 'probe-single',
    isSingleLine: () => true,
  };
  const singleProbe =
    RUN && PROBES
      ? (() => {
          const outcome = cases.map((c, i) => {
            const r = compareCase(sessions.run(c, alwaysSingle, STRICT).calls, loadReference(c.name).calls);
            return { changed: r.ts !== (rows[i] as Row).strict.ts, status: r.status };
          });
          return {
            alwaysTrueChangesOutcome: outcome.filter((o) => o.changed).length,
            alwaysTrueStrictPass: outcome.filter((o) => o.status === 'pass').length,
            alwaysTrueStrictDiscrete: outcome.filter((o) => o.status === 'discrete').length,
            of: cases.length,
          };
        })()
      : null;

  const report = {
    manifest: {
      wasmCommit: manifest['wasmCommit'],
      wasmSha256: manifest['wasmSha256'],
      lineAggregatorId: manifest.lineAggregatorId,
      tsLineAggregatorId: defaultLineAggregatorModule.id,
      lastComparedTsLineAggregatorId: manifest['tsLineAggregatorId'] ?? null,
    },
    cases: rows.length,
    byScene: Object.fromEntries(
      [...new Set(rows.map((r) => r.scene))].map((s) => [s, rows.filter((r) => r.scene === s).length]),
    ),
    strict: {
      pass: rows.length - strictFail.length,
      discrete: strictFail.filter((r) => r.strict.status === 'discrete').length,
      tolerance: strictFail.filter((r) => r.strict.status === 'tolerance').length,
      toleranceOracleUnstable: strictFail.filter((r) => r.strict.status === 'tolerance' && r.oracleUnstable).length,
      borderline: borderline.map((r) => ({ name: r.name, ts: r.strict.ts, cpp: r.strict.cpp })),
      borderlineShare: borderline.length / rows.length,
      attributed: strictAttributed.reduce<Record<string, string[]>>((m, r) => {
        const id = attributedTo(r) as string;
        (m[id] ??= []).push(r.name);
        return m;
      }, {}),
      knownReferenceDefect: knownDefect.map((r) => ({ name: r.name, status: r.strict.status })),
      knownLineAggregator: knownLines.map((r) => ({ name: r.name, status: r.strict.status })),
      staleKnown,
      unexplained: strictUnexplained.map((r) => ({
        name: r.name,
        status: r.strict.status,
        oracleUnstable: r.oracleUnstable,
        ts: r.strict.ts,
        cpp: r.strict.cpp,
        over: r.strict.over.slice(0, 5),
      })),
      maxDeviationOverTolerance: maxRatios(rows),
    },
    product: {
      pass: rows.filter((r) => r.product.status === 'pass').length,
      extraDifferences: productExtra.length,
      attributed: productExtra.reduce<Record<string, number>>((m, r) => {
        for (const a of r.attributed) m[a] = (m[a] ?? 0) + 1;
        return m;
      }, {}),
      cases: productExtra.map((r) => ({ name: r.name, register: r.attributed, ts: r.product.ts, cpp: r.product.cpp })),
    },
    isSingleLineProbe: singleProbe,
    tsRecognizeMs: {
      p50: pct(
        rows.map((r) => r.tsMs),
        0.5,
      ),
      p95: pct(
        rows.map((r) => r.tsMs),
        0.95,
      ),
      max: pct(
        rows.map((r) => r.tsMs),
        1,
      ),
    },
  };
  for (const r of rows) caseMs[r.name] = Math.round(r.tsMs * 10) / 10;
  if (RUN) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, 'ts-timings.json'), `${JSON.stringify(caseMs)}\n`);
    writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  }

  it('AC-REC-26: strict run — every case matches, except proven-borderline cases ≤ 0.5 % of the corpus and register-attributed cases', () => {
    // Known reference defects and line-aggregator cases are listed in the report but still fail here.
    expect(notExcused.map((r) => `${r.name}: ${r.strict.status} ts=${r.strict.ts} cpp=${r.strict.cpp}`)).toEqual([]);
    expect(borderline.length).toBeLessThanOrEqual(Math.floor(BORDERLINE_SHARE * rows.length));
  });

  it('AC-REC-27: product run — every difference beyond the strict run is attributed to DR-REC-01 or DR-REC-02', () => {
    for (const r of productExtra)
      expect(
        r.attributed.every((a) => /^DR-REC-0[12]/.test(a)),
        r.name,
      ).toBe(true);
    // No case that passes strict fails product for any other reason.
    expect(productExtra.filter((r) => r.attributed.length === 0)).toEqual([]);
  });
});
