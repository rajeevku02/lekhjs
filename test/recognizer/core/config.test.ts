// AC-REC-35: RecognizerConfig defaults equal C++ base/Config.cpp. AC-REC-05: no recognizer source
// reads a config field that RecognizerConfig does not declare.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, EngineConfig } from '../../../src/base';
import {
  RECOGNIZER_CONFIG_DEFAULTS,
  RECOGNIZER_CONFIG_KEYS,
  recognizerConfigFrom,
  recognizerConfigWith,
} from '../../../src/recognizer/core';
import { PKG_ROOT } from '../../lint/eslint-helpers';

/** Transcribed from C++ `Config::init()` (base/Config.cpp). */
const CPP_DEFAULTS: Record<string, number | boolean> = {
  recognizeConnection: true,
  recognizeSelfLoop: true,
  closedShapeMaxLines: 16,
  cxPolyMaxPolys: 3000,
  lineCollConnectDist: 12,
  lineAggregatorMaxJoinCost: 7,
  linePartEqualityDelta: 4,
  angleReductionAreaThreshold: 0.65,
  closePointDistance: 28,
  closePointDistanceShort: 15,
  maxDistForPolygonClosing: 150,
  polygonSmallClosingDist: 6,
  parallelogramRegularizeAngle: 12,
  curveSideStretchRatio: 0.38,
  multiStrokePathJoinDist: 18,
  multiStrokeTrimFactor: 0.14,
  multiStrokeTrimFactorSingle: 0.25,
  endPointDistForArrow: 30,
  arrowDrawBoundLimit: 100,
  minLenOfArrow: 6,
  maxAngleForArrow: 60,
  maxAngleForArrowOnCurve: 85,
  maxAngleFor2LinArrowRecognition: 45,
  minLineDistFor2LineArrow: 8,
  connectionLinesAngleRangeStart: 60,
  connectionLinesAngleRangeEnd: 120,
  connectObjectDistThreshold: 32,
  selfLoopMinOutsideFraction: 0.7,
  selfLoopMinExcursion: 20,
  selfLoopMinExcursionRatio: 0.1,
  selfLoopMaxExcursionRatio: 1.5,
  selfLoopMinStrokeLength: 60,
  selfLoopMinEndDistance: 40,
  selfLoopMaxCorners: 4,
  selfLoopMinCornerAngle: 60,
  selfLoopAxisTolerance: 15,
};

describe('RecognizerConfig defaults (AC-REC-35)', () => {
  it('equal C++ Config.cpp, field for field', () => {
    expect({ ...RECOGNIZER_CONFIG_DEFAULTS }).toEqual(CPP_DEFAULTS);
    expect([...RECOGNIZER_CONFIG_KEYS].sort()).toEqual(Object.keys(CPP_DEFAULTS).sort());
  });

  it('are the engine defaults, and follow the engine config', () => {
    for (const k of RECOGNIZER_CONFIG_KEYS) expect(RECOGNIZER_CONFIG_DEFAULTS[k]).toBe(CONFIG_DEFAULTS[k]);
    const cfg = recognizerConfigFrom(new EngineConfig({ cxPolyMaxPolys: 10, recognizeSelfLoop: false }));
    expect(cfg.cxPolyMaxPolys).toBe(10);
    expect(cfg.recognizeSelfLoop).toBe(false);
    expect(Object.isFrozen(cfg)).toBe(true);
    // Plain data: it crosses postMessage unchanged.
    expect(JSON.parse(JSON.stringify(cfg))).toEqual({ ...cfg });
  });

  it('does not carry multi-stroke or main-thread fields', () => {
    for (const k of ['enableMultiStroke', 'multiStrokeWaitMS', 'recognizeShape', 'logRawPoints']) {
      expect(k in RECOGNIZER_CONFIG_DEFAULTS).toBe(false);
    }
  });

  it('rejects an unknown override', () => {
    expect(() => recognizerConfigWith({ ['enableMultiStroke' as 'cxPolyMaxPolys']: 1 })).toThrow(TypeError);
  });
});

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/** Field names read off something called `config`/`cfg` (C++ `Config::instance().x`, `cfg.x`). */
function configReads(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/\b(?:config|cfg|Config)\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) names.push(m[1] as string);
  return names;
}

describe('recognizer sources read only declared config fields (AC-REC-05)', () => {
  const SRC = path.join(PKG_ROOT, 'src', 'recognizer');

  it('the scanner sees config reads', () => {
    expect(configReads('const a = ctx.config.lineCollConnectDist + cfg.foo; this.env.config?.bar')).toEqual([
      'lineCollConnectDist',
      'foo',
      'bar',
    ]);
  });

  it('every read field is in RecognizerConfig', () => {
    const declared = new Set<string>(RECOGNIZER_CONFIG_KEYS);
    const unknown: string[] = [];
    let reads = 0;
    for (const f of tsFiles(SRC)) {
      const text = readFileSync(f, 'utf8')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      for (const name of configReads(text)) {
        reads++;
        if (!declared.has(name)) unknown.push(`${path.relative(PKG_ROOT, f)}: ${name}`);
      }
    }
    expect(unknown).toEqual([]);
    expect(reads).toBeGreaterThan(5);
  });

  it('no recognizer source but RecognizerConfig.ts touches the engine Config', () => {
    const hits = tsFiles(SRC)
      .filter((f) => !f.endsWith(path.join('core', 'RecognizerConfig.ts')))
      .filter((f) => /\b(EngineConfig|CONFIG_DEFAULTS)\b/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(PKG_ROOT, f))).toEqual([]);
  });
});
