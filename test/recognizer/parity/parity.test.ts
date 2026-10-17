// Corpus parity against the owner-built web wasm (spec 07 §7.4.2; AC-REC-26, -27, -33): every case of
// test/recognizer/corpus/ is recognised by TS on the owner's LineAggregator and compared with the
// reference the wasm recorded (test/recognizer/parity/reference/, parity/tools/rec-parity/capture.mjs).
//
//  - strict: quirks on (the C1/C2 bugs put back); only proven-borderline cases may differ, at most
//    0.5 % of the corpus (OQ-42, DR-REC-04);
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
// Besides the borderline rule for discrete outcomes (§7.4.2), the report shows for each tolerance
// failure whether the wasm's own coordinates move past the tolerance under the same ±0.01 px jitter
// (`wasmUnstable`): the stroke is pre-processed into integer pixels (GeoUtil::preProcess) and the
// line split picks pixel indices, so a 0.01 px nudge can move a vertex by whole pixels.
import { mkdirSync, writeFileSync } from 'node:fs';
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

interface Row {
  readonly name: string;
  readonly scene: string;
  readonly strict: CaseResult;
  readonly product: CaseResult;
  /** The wasm's own outcome flips under a ±0.01 px jitter (borderline rule). */
  readonly wasmFlips: boolean;
  /** The wasm's own coordinates move past the tolerance under the jitter (same discrete outcome). */
  readonly wasmUnstable: boolean;
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
    const wasmFlips = ref.jitter.some((j) => outcomeSig(j) !== base);
    const wasmUnstable = ref.jitter.some((j) => outcomeSig(j) === base && deviations(j, ref.calls).over.length > 0);
    const attributed: string[] = [];
    if (strict.status === 'pass' && product.status !== 'pass') {
      if (compareCase(sessions.run(c, module, { legacyTakeOut: true }).calls, ref.calls).status === 'pass')
        attributed.push('DR-REC-01');
      if (compareCase(sessions.run(c, module, { legacyWidthBug: true }).calls, ref.calls).status === 'pass')
        attributed.push('DR-REC-02');
      if (attributed.length === 0) attributed.push('DR-REC-01+DR-REC-02');
    }
    return { name: c.name, scene: c.scene, strict, product, wasmFlips, wasmUnstable, attributed, tsMs: strictRun.ms };
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
  it('AC-REC-33: the reference MANIFEST names the wasm commit, its sha256 and the LineAggregator', () => {
    expect(manifest.wasmCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof manifest.lineAggregatorId).toBe('string');
    expect(String(manifest.lineAggregatorId)).not.toMatch(/stub/i);
    expect(manifest.cases).toBe(cases.length);
    // The TS side runs the owner's module, not the stub.
    expect(defaultLineAggregatorModule).toBe(lineAggregatorImplModule);
  });
});

describe.runIf(RUN)('recognizer corpus parity against the wasm reference (spec 07 §7.4.2)', () => {
  // describe.runIf still runs this body when collecting, so the work itself is gated too.
  const rows = RUN ? runAll(defaultLineAggregatorModule) : [];
  const strictFail = rows.filter((r) => r.strict.status !== 'pass');
  const borderline = strictFail.filter((r) => r.strict.status === 'discrete' && r.wasmFlips);
  const strictUnexplained = strictFail.filter((r) => !borderline.includes(r));
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
      wasmCommit: manifest.wasmCommit,
      wasmSha256: manifest.wasmSha256,
      lineAggregatorId: manifest.lineAggregatorId,
      tsLineAggregatorId: defaultLineAggregatorModule.id,
    },
    cases: rows.length,
    byScene: Object.fromEntries(
      [...new Set(rows.map((r) => r.scene))].map((s) => [s, rows.filter((r) => r.scene === s).length]),
    ),
    strict: {
      pass: rows.length - strictFail.length,
      discrete: strictFail.filter((r) => r.strict.status === 'discrete').length,
      tolerance: strictFail.filter((r) => r.strict.status === 'tolerance').length,
      toleranceWasmUnstable: strictFail.filter((r) => r.strict.status === 'tolerance' && r.wasmUnstable).length,
      borderline: borderline.map((r) => ({ name: r.name, ts: r.strict.ts, cpp: r.strict.cpp })),
      borderlineShare: borderline.length / rows.length,
      unexplained: strictUnexplained.map((r) => ({
        name: r.name,
        status: r.strict.status,
        wasmUnstable: r.wasmUnstable,
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

  it('AC-REC-26: strict run — every case matches, except proven-borderline cases ≤ 0.5 % of the corpus', () => {
    expect(strictUnexplained.map((r) => `${r.name}: ${r.strict.status} ts=${r.strict.ts} cpp=${r.strict.cpp}`)).toEqual(
      [],
    );
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
