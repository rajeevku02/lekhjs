// Class-diagram conformance (spec 02 §20; verification 04 §2): AC-CLS-01, -02, -03, -09 and -14.
//
//   node parity/tools/class-map/check-class-map.mjs [--json] [--strict]
//   node parity/tools/class-map/check-class-map.mjs --refresh-names <class-diagram page.md>
//
// - AC-CLS-01/-14: every `class`/`struct` declaration under `lekhcore/src/{lekh,base,math,geometry,
//   fitter,recognizer,regularizer,akaar,bodh,license,resources}` (forward declarations, `enum
//   class` and Lua/QuickJS excluded) appears in Appendix A of `cpp-to-ts-map.md` under its file
//   (or the file's group row, e.g. `akaar/*`) with a code P/M/R/X/D/T; and no Appendix A name is
//   missing from the C++ tree.
// - AC-CLS-02: every P/M target `<module>/<Name>` is an exported name of `lekhjs/src/<module>`
//   (or of the React board for `board/...` targets). Before cutover a target in a module that is
//   not ported yet is listed under its module, not counted as a failure; `--strict` (cutover)
//   fails on any.
// - AC-CLS-03: every exported class and interface of `lekhjs/src` is a name of the class diagram
//   (`class-diagram.names.json`).
// - AC-CLS-09: no exported TS name collides with a code-D/X class of §19 unless Appendix A maps a
//   live C++ class of that name to it.
// Names here are code identifiers and file paths only. Exit 1 on an AC-CLS-01 or -09 failure, or,
// with `--strict`, on any finding.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '..', '..', '..');
const WS = path.resolve(PKG, '..');
const CPP = path.join(WS, 'lekhcore', 'src');
const CPP_DIRS = [
  'lekh',
  'base',
  'math',
  'geometry',
  'fitter',
  'recognizer',
  'regularizer',
  'akaar',
  'bodh',
  'license',
  'resources',
];
const BOARD = path.join(WS, 'lekhboard-capacitor', 'lekh', 'src', 'board');

/** @param {string} dir @param {RegExp} ext @returns {string[]} */
function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** The C++ declarations: `{ file, name }`, file relative to `lekhcore/src`. */
export function cppDeclarations() {
  /** @type {{ file: string, name: string }[]} */
  const out = [];
  for (const d of CPP_DIRS)
    for (const f of walk(path.join(CPP, d), /\.(h|hpp|cpp)$/)) {
      const rel = path.relative(CPP, f).split(path.sep).join('/');
      // As the spec's extraction (a line grep): declarations inside block comments count too.
      const text = readFileSync(f, 'utf8');
      for (const line of text.split('\n')) {
        const l = line.replace(/\/\/.*$/, '');
        const m = /^\s*(?:template\s*<[^>]*>\s*)?(class|struct)\s+(?:[A-Z_]+_API\s+)?([A-Za-z_]\w*)\b(.*)$/.exec(l);
        if (m === null) continue;
        const rest = (m[3] ?? '').trim();
        // A definition: the name is followed by a base list, a body, `final`, or the line ends
        // (brace on the next line). Anything else is a forward declaration or a use (`struct tm *t`).
        if (!/^(?:final\b|:|\{|$)/.test(rest)) continue;
        out.push({ file: rel, name: /** @type {string} */ (m[2]) });
      }
    }
  return out;
}

/**
 * Appendix A rows: file (or group glob) → entries `{ names, code, target }`.
 * @param {string} md
 */
export function parseAppendix(md) {
  const start = md.indexOf('## Appendix A');
  const text = start >= 0 ? md.slice(start) : md;
  /** @type {Map<string, { name: string, code: string, target: string }[]>} */
  const rows = new Map();
  for (const line of text.split('\n')) {
    const cells = line.split(' | ');
    if (!line.startsWith('| `') || cells.length < 3) continue;
    const file = /`([^`]+)`/.exec(cells[0] ?? '')?.[1];
    if (file === undefined) continue;
    const entries = rows.get(file) ?? [];
    for (const cell of cells.slice(1)) {
      const re = /((?:`[^`]+`(?:,\s*)?)+)\s*\*\*([PMRXDT])\*\*\s*([^;|]*)/g;
      for (const m of cell.matchAll(re)) {
        const names = [...(m[1] ?? '').matchAll(/`([^`]+)`/g)].map((x) => /** @type {string} */ (x[1]));
        for (const n of names)
          entries.push({ name: n, code: /** @type {string} */ (m[2]), target: (m[3] ?? '').trim() });
      }
    }
    rows.set(file, entries);
  }
  return rows;
}

/** §19: (namespace, name) of the dropped D/X classes. @param {string} md */
export function parseDropped(md) {
  const a = md.indexOf('## 19.');
  const b = md.indexOf('## Appendix A');
  const text = md.slice(a, b > a ? b : undefined);
  /** @type {{ ns: string, name: string, code: string }[]} */
  const out = [];
  for (const line of text.split('\n')) {
    const cells = line.split(' | ');
    if (!line.startsWith('| `') || cells.length < 3) continue;
    const code = (cells[1] ?? '').trim();
    if (code !== 'D' && code !== 'X') continue;
    const first = cells[0] ?? '';
    const ns = /^\|\s*`([a-z:]+)::`/.exec(first)?.[1] ?? '';
    for (const m of first.matchAll(/`([^`]+)`/g)) {
      const raw = /** @type {string} */ (m[1]);
      if (raw.endsWith('::')) continue;
      const parts = raw.split('::');
      const name = /** @type {string} */ (parts.pop());
      out.push({ ns: parts.length > 0 ? parts.join('::') : ns, name, code });
    }
  }
  return out;
}

/** Exported names per `src/<module>` (classes, interfaces, types, functions, consts). */
export function tsExports() {
  /** @type {Map<string, Map<string, string>>} module → name → kind */
  const out = new Map();
  const add = (/** @type {string} */ root, /** @type {string} */ prefix) => {
    for (const f of walk(root, /\.(ts|tsx|js|jsx)$/)) {
      const rel = path.relative(root, f).split(path.sep);
      const mod = prefix + (rel.length > 1 ? rel[0] : '');
      const text = readFileSync(f, 'utf8');
      const m = out.get(mod) ?? new Map();
      for (const x of text.matchAll(
        /^export\s+(?:declare\s+)?(?:default\s+)?(abstract\s+class|class|interface|type|function|const|let|enum)\s+([A-Za-z_$][\w$]*)/gm,
      ))
        m.set(/** @type {string} */ (x[2]), (x[1] ?? '').replace('abstract ', ''));
      out.set(mod, m);
    }
  };
  add(path.join(PKG, 'src'), '');
  add(BOARD, 'board/');
  return out;
}

/** `<module>/<Name>` targets of an Appendix A entry (`(same)` = the C++ name). @param {{ name: string, target: string }} e */
export function targetsOf(e) {
  /** @type {{ module: string, name: string }[]} */
  const out = [];
  for (const m of e.target.matchAll(/\b((?:board\/)?[a-z][a-z]*(?:\/[a-z]+)*)\/(\(same\)|[A-Z][A-Za-z0-9]*)/g)) {
    const mod = /** @type {string} */ (m[1]);
    const name =
      m[2] === '(same)' ? (e.name.split('::').pop() ?? e.name).replace(/<.*$/, '') : /** @type {string} */ (m[2]);
    out.push({ module: mod, name });
  }
  return out;
}

export function check() {
  const md = readFileSync(path.join(HERE, 'cpp-to-ts-map.md'), 'utf8');
  const rows = parseAppendix(md);
  const decl = cppDeclarations();
  /** @param {string} file */
  const rowFor = (file) => {
    if (rows.has(file)) return rows.get(file);
    for (const [k, v] of rows) if (k.endsWith('/*') && file.startsWith(k.slice(0, -1))) return v;
    return undefined;
  };
  // AC-CLS-01
  /** @type {string[]} */
  const unmapped = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const d of decl) {
    const r = rowFor(d.file);
    const hit = r?.find((e) => (e.name.split('::').pop() ?? e.name).replace(/<.*$/, '') === d.name);
    if (hit === undefined) unmapped.push(`${d.file}: ${d.name}`);
    seen.add(`${d.file}|${d.name}`);
  }
  /** @type {string[]} */
  const stale = [];
  const declByFile = new Map();
  for (const d of decl) declByFile.set(d.file, [...(declByFile.get(d.file) ?? []), d.name]);
  for (const [file, entries] of rows) {
    const files = file.endsWith('/*') ? [...declByFile.keys()].filter((f) => f.startsWith(file.slice(0, -1))) : [file];
    const names = new Set(files.flatMap((f) => declByFile.get(f) ?? []));
    for (const e of entries) {
      const n = (e.name.split('::').pop() ?? e.name).replace(/<.*$/, '');
      if (!names.has(n)) stale.push(`${file}: ${e.name}`);
    }
  }
  // AC-CLS-02
  const ts = tsExports();
  const allTs = new Set([...ts.values()].flatMap((m) => [...m.keys()]));
  /** @type {Record<string, string[]>} */
  const missingByModule = {};
  let pmTargets = 0;
  let pmFound = 0;
  for (const entries of rows.values())
    for (const e of entries) {
      if (e.code !== 'P' && e.code !== 'M') continue;
      for (const t of targetsOf(e)) {
        pmTargets++;
        const mod = ts.get(t.module.split('/')[0] === 'board' ? t.module : (t.module.split('/')[0] ?? ''));
        const found = mod?.has(t.name) === true || allTs.has(t.name);
        if (found) pmFound++;
        else (missingByModule[t.module] ??= []).push(t.name);
      }
    }
  // AC-CLS-03
  const names = new Set(JSON.parse(readFileSync(path.join(HERE, 'class-diagram.names.json'), 'utf8')).names);
  /** @type {Record<string, string[]>} */
  const notInDiagram = {};
  let exportedCI = 0;
  for (const [mod, m] of ts)
    for (const [n, kind] of m) {
      if (kind !== 'class' && kind !== 'interface') continue;
      exportedCI++;
      if (!names.has(n)) (notInDiagram[mod] ??= []).push(kind === 'class' ? n : `${n}?`);
    }
  // AC-CLS-09
  const dropped = parseDropped(md);
  // A TS name equal to a dropped class's short name is allowed when a live C++ class of that name
  // (another file or namespace, coded P/M/T) is ported or merged, or when a P/M target has it.
  const live = new Set(
    [...rows.values()].flatMap((es) =>
      es
        .filter((e) => e.code === 'P' || e.code === 'M' || e.code === 'T')
        .flatMap((e) => [(e.name.split('::').pop() ?? e.name).replace(/<.*$/, ''), ...targetsOf(e).map((t) => t.name)]),
    ),
  );
  /** @type {Map<string, string>} */
  const tsKind = new Map();
  for (const m of ts.values()) for (const [n, k] of m) if (!tsKind.has(n) || k === 'class') tsKind.set(n, k);
  /** @type {string[]} */
  const collisions = [];
  /** @type {string[]} */
  const allowed = [];
  for (const d of dropped) {
    const k = tsKind.get(d.name);
    if (k === undefined) continue;
    const label = `${d.ns ? d.ns + '::' : ''}${d.name} (${d.code}; TS ${k})`;
    if (live.has(d.name) || (k !== 'class' && k !== 'interface')) allowed.push(label);
    else collisions.push(label);
  }
  return {
    cls01: { declarations: decl.length, unmapped, stale },
    cls02: { targets: pmTargets, found: pmFound, missingByModule },
    cls03: { exported: exportedCI, notInDiagram },
    cls09: { dropped: dropped.length, collisions, allowed },
  };
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--refresh-names');
  if (ri >= 0) {
    const page = readFileSync(path.resolve(String(args[ri + 1])), 'utf8');
    const n = new Set([...page.matchAll(/`([A-Z][A-Za-z0-9]*)`/g)].map((m) => m[1]));
    for (const m of page.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) n.add(m[1]);
    const file = path.join(HERE, 'class-diagram.names.json');
    const old = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ comment: old.comment, names: [...n].sort() }, null, 1) + '\n');
    process.stdout.write(`class-diagram.names.json: ${n.size} names\n`);
    process.exit(0);
  }
  const r = check();
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    const mods = Object.entries(r.cls02.missingByModule).sort();
    const nd = Object.entries(r.cls03.notInDiagram).sort();
    const lines = [
      `AC-CLS-01: ${r.cls01.declarations} C++ declarations; unmapped ${r.cls01.unmapped.length}; Appendix A names not in the tree ${r.cls01.stale.length}`,
      ...r.cls01.unmapped.map((x) => `  unmapped ${x}`),
      ...r.cls01.stale.map((x) => `  stale ${x}`),
      `AC-CLS-02: ${r.cls02.targets} P/M targets; found ${r.cls02.found}; missing ${r.cls02.targets - r.cls02.found} in ${mods.length} modules`,
      ...mods.map(
        ([m, ns]) => `  ${m}: ${ns.length} (${[...new Set(ns)].slice(0, 12).join(', ')}${ns.length > 12 ? ', …' : ''})`,
      ),
      `AC-CLS-03: ${r.cls03.exported} exported classes/interfaces; not in the diagram ${nd.reduce((n, [, v]) => n + v.length, 0)} (classes ${nd.reduce((n, [, v]) => n + v.filter((x) => !x.endsWith('?')).length, 0)}; an interface is marked ?)`,
      ...nd.map(
        ([m, ns]) => `  ${m || '(root)'}: ${ns.length} (${ns.slice(0, 15).join(', ')}${ns.length > 15 ? ', …' : ''})`,
      ),
      `AC-CLS-09: ${r.cls09.dropped} dropped (§19) names; collisions ${r.cls09.collisions.length}${r.cls09.collisions.length ? ': ' + r.cls09.collisions.join(', ') : ''}; same short name allowed (live twin, or not a class) ${r.cls09.allowed.length}${r.cls09.allowed.length ? ': ' + r.cls09.allowed.join(', ') : ''}`,
    ];
    process.stdout.write(lines.join('\n') + '\n');
  }
  const hard = r.cls01.unmapped.length + r.cls01.stale.length + r.cls09.collisions.length;
  const soft = r.cls02.targets - r.cls02.found + Object.values(r.cls03.notInDiagram).flat().length;
  process.exit(hard > 0 || (args.includes('--strict') && soft > 0) ? 1 : 0);
}
