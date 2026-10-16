// Structural checks on the recognizer sources:
//  - AC-REC-01: nothing in lekhjs ports or imports the dead C++ units (matching/, PolyLineMatcher,
//    geometry/{Canvas,CircularArc,Polyline}, akaar/, bodh/, license/, base/Identity, the dormant
//    ShapeRecognizer, multi-stroke).
//  - AC-REC-03: the recognizer core imports only base/, geometry/ and its own core folders, and
//    touches no DOM, Worker, BoardSession or host global (module state is the lint rule's).
//  - AC-REC-06: the LineAggregatorModule reaches the pipeline only by injection.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const SRC = path.join(PKG_ROOT, 'src');
const REC = path.join(SRC, 'recognizer');
const SELF = import.meta.filename;

function files(dir: string, ext = /\.(ts|mjs|js)$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return files(p, ext);
    return ext.test(d.name) ? [p] : [];
  });
}

/** Every `from '…'` / `import('…')` / `import '…'` specifier, with whether it is type-only. */
function imports(source: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  for (const m of source.matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gms)) {
    out.push({ spec: m[3] as string, typeOnly: m[2] !== undefined });
  }
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm))
    out.push({ spec: m[1] as string, typeOnly: false });
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g))
    out.push({ spec: m[1] as string, typeOnly: true });
  return out;
}

const strip = (s: string): string => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('AC-REC-01: the dead C++ units are not ported', () => {
  const DEAD_DIRS = ['akaar', 'bodh', 'matching', 'license'];
  const DEAD_NAMES = [
    'PolyLineMatcher',
    'ShapeMatcher',
    'PartGenerator',
    'RecPath',
    'ComponentTypes',
    'ShapeRecognizer',
    'MultiStrokeRecognition',
    'MultiStrokeRecognizer',
    'CircularArc',
    'Identity',
  ];
  const all = [...files(SRC), ...files(path.join(PKG_ROOT, 'test'))].filter((f) => f !== SELF);

  it('no directory or file is named after them', () => {
    const hits = all.filter((f) => {
      const rel = path.relative(PKG_ROOT, f).split(path.sep);
      const base = path.basename(f).replace(/\.[^.]+$/, '');
      return rel.some((seg) => DEAD_DIRS.includes(seg)) || DEAD_NAMES.includes(base);
    });
    const geo = files(path.join(SRC, 'geometry')).filter((f) =>
      ['canvas', 'circulararc', 'polyline'].includes(
        path
          .basename(f)
          .replace(/\.[^.]+$/, '')
          .toLowerCase(),
      ),
    );
    expect([...hits, ...geo].map((f) => path.relative(PKG_ROOT, f))).toEqual([]);
  });

  it('no import specifier names them', () => {
    const re = new RegExp(`(^|/)(${[...DEAD_DIRS, ...DEAD_NAMES].join('|')})(/|$)`);
    const hits = all.flatMap((f) =>
      imports(readFileSync(f, 'utf8'))
        .filter((i) => re.test(i.spec))
        .map((i) => `${path.relative(PKG_ROOT, f)}: ${i.spec}`),
    );
    expect(hits).toEqual([]);
  });

  it('no source declares them', () => {
    const re = new RegExp(`\\b(class|function|interface|const|type)\\s+(${DEAD_NAMES.join('|')})\\b`);
    const hits = files(SRC).filter((f) => re.test(strip(readFileSync(f, 'utf8'))));
    expect(hits.map((f) => path.relative(PKG_ROOT, f))).toEqual([]);
  });
});

describe('AC-REC-03: the recognizer core stays in its zone', () => {
  const CORE_DIRS = ['core', 'lines', 'polys', 'shapes', 'paths', 'specialists', 'regularizer'];
  const coreFiles = CORE_DIRS.flatMap((d) => {
    try {
      return files(path.join(REC, d));
    } catch {
      return [];
    }
  });
  const allowedRoots = [path.join(SRC, 'base'), path.join(SRC, 'geometry'), ...CORE_DIRS.map((d) => path.join(REC, d))];

  it('has sources to check', () => {
    expect(coreFiles.length).toBeGreaterThan(10);
  });

  it('imports only base/, geometry/ and the core folders (no packages, no Node, no host)', () => {
    const bad: string[] = [];
    for (const f of coreFiles) {
      for (const i of imports(readFileSync(f, 'utf8'))) {
        if (!i.spec.startsWith('.')) {
          bad.push(`${path.relative(PKG_ROOT, f)}: ${i.spec}`);
          continue;
        }
        const target = path.resolve(path.dirname(f), i.spec);
        if (!allowedRoots.some((r) => target === r || target.startsWith(r + path.sep))) {
          bad.push(`${path.relative(PKG_ROOT, f)}: ${i.spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  // (`process` is left to the no-restricted-globals lint: it is also a method name here.)
  it('names no DOM, Worker, BoardSession or host global', () => {
    const re =
      /\b(window|document|self|globalThis|navigator|Worker|postMessage|BoardSession|MessagePort|setTimeout|performance)\b/;
    const hits = coreFiles.filter((f) => re.test(strip(readFileSync(f, 'utf8'))));
    expect(hits.map((f) => path.relative(PKG_ROOT, f))).toEqual([]);
  });
});

describe('AC-REC-06: the line aggregator is injected', () => {
  const recFiles = files(REC);

  it('only lines/index.ts binds a concrete aggregator', () => {
    const re = /StubLineAggregator['"]|LineAggregatorImpl['"]/;
    const hits = recFiles.filter((f) =>
      imports(readFileSync(f, 'utf8')).some((i) => re.test(`${i.spec}'`) && !i.typeOnly),
    );
    expect(hits.map((f) => path.relative(REC, f))).toEqual([path.join('lines', 'index.ts')]);
  });

  it('LineRelation imports the module type only, and no aggregator', () => {
    const src = readFileSync(path.join(REC, 'lines', 'LineRelation.ts'), 'utf8');
    const agg = imports(src).filter((i) => /LineAggregator/.test(i.spec));
    expect(agg).toEqual([{ spec: './LineAggregatorModule', typeOnly: true }]);
    expect(/stubLineAggregatorModule|defaultLineAggregatorModule/.test(strip(src))).toBe(false);
  });

  it('nothing in the recognizer reads defaultLineAggregatorModule but the module surface', () => {
    const hits = recFiles.filter((f) => /\bdefaultLineAggregatorModule\b/.test(strip(readFileSync(f, 'utf8'))));
    expect(hits.map((f) => path.relative(REC, f)).sort()).toEqual([path.join('lines', 'index.ts'), 'index.ts'].sort());
  });
});
