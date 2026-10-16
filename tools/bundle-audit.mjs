// Bundle audit (spec 01 §4.1, §5.3; AC-ARC-10). Part of `npm run check`.
//
// Every dist/node/*.js must contain:
//   - no `pdfkit` or `fontkit` (export/pdf is a separate entry, never in the Node bundle), and no
//     `fengari` (the Lua oracle is a test-only devDependency, AC-GEN-10);
//   - no code from src/interaction/ (kashi never loads interaction code);
//   - no reference to the globals `window` or `document`.
// dist/node/index.js and dist/node/headless.js must also contain no code from src/testing/.
//
// Code origin is read from each bundle's sourcemap (`sources`); the testing check also
// looks for the names src/testing/ exports, so a bundle without a map is still caught.
//
//   node tools/bundle-audit.mjs [--dir <dist/node>]
// Exits 1 and names every hit when the audit fails.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const ROOT = path.resolve(import.meta.dirname, '..');
const NO_TESTING = Object.freeze(['index.js', 'headless.js']);
const FORBIDDEN_LIBS = Object.freeze(['pdfkit', 'fontkit', 'fengari']);
const FORBIDDEN_GLOBALS = Object.freeze(['window', 'document']);
const TESTING_NAMES = Object.freeze([
  'createTestRuntime',
  'RecordedWidthMeasurer',
  'FakeTransport',
  'FakeScheduler',
  'FakeImagePort',
  'setTestConfig',
]);

/** @param {string} file @returns {string[]} */
function sourcesOf(file) {
  const map = `${file}.map`;
  if (!existsSync(map)) return [];
  const parsed = /** @type {{ sources?: string[] }} */ (JSON.parse(readFileSync(map, 'utf8')));
  return (parsed.sources ?? []).map((s) => s.split(path.sep).join('/'));
}

/**
 * Free references to `names` (identifiers in expression position that the file never binds).
 * @param {string} code @param {readonly string[]} names
 */
function freeGlobalRefs(code, names) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  /** @type {Set<string>} */
  const bound = new Set();
  /** @type {{ name: string; line: number }[]} */
  const refs = [];
  /** @param {any} pattern */
  const bind = (pattern) => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier':
        bound.add(pattern.name);
        break;
      case 'ObjectPattern':
        for (const p of pattern.properties) bind(p.type === 'RestElement' ? p.argument : p.value);
        break;
      case 'ArrayPattern':
        for (const e of pattern.elements) bind(e);
        break;
      case 'RestElement':
        bind(pattern.argument);
        break;
      case 'AssignmentPattern':
        bind(pattern.left);
        break;
    }
  };
  walk.fullAncestor(ast, (/** @type {any} */ node, _state, /** @type {any[]} */ ancestors) => {
    switch (node.type) {
      case 'VariableDeclarator':
        bind(node.id);
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) bind(node.id);
        for (const p of node.params) bind(p);
        return;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) bind(node.id);
        return;
      case 'CatchClause':
        bind(node.param);
        return;
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        bind(node.local);
        return;
      case 'Identifier': {
        if (!names.includes(node.name)) return;
        const parent = ancestors[ancestors.length - 2];
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (
          (parent?.type === 'Property' ||
            parent?.type === 'PropertyDefinition' ||
            parent?.type === 'MethodDefinition') &&
          parent.key === node &&
          !parent.computed
        ) {
          if (!(parent.type === 'Property' && parent.shorthand)) return;
        }
        if (
          parent?.type === 'ExportSpecifier' ||
          parent?.type === 'LabeledStatement' ||
          parent?.type === 'BreakStatement' ||
          parent?.type === 'ContinueStatement'
        )
          return;
        refs.push({ name: node.name, line: node.loc?.start.line ?? 0 });
        return;
      }
    }
  });
  return refs.filter((r) => !bound.has(r.name));
}

/** @param {string} dir @returns {string[]} the problems found */
export function auditDir(dir) {
  /** @type {string[]} */
  const problems = [];
  if (!existsSync(dir)) return [`${dir} does not exist: run npm run build first`];
  const bundles = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  if (bundles.length === 0) problems.push(`${dir} has no .js bundles`);
  for (const name of bundles) {
    const file = path.join(dir, name);
    const code = readFileSync(file, 'utf8');
    const sources = sourcesOf(file);
    for (const lib of FORBIDDEN_LIBS) {
      if (code.includes(lib) || sources.some((s) => s.includes(`node_modules/${lib}/`)))
        problems.push(`${name}: contains '${lib}'`);
    }
    for (const s of sources.filter((s) => s.includes('src/interaction/')))
      problems.push(`${name}: contains interaction code (${s})`);
    try {
      for (const r of freeGlobalRefs(code, FORBIDDEN_GLOBALS))
        problems.push(`${name}:${String(r.line)}: references the global '${r.name}'`);
    } catch (e) {
      problems.push(`${name}: could not be parsed (${e instanceof Error ? e.message : String(e)})`);
    }
    if (NO_TESTING.includes(name)) {
      for (const s of sources.filter((s) => s.includes('src/testing/')))
        problems.push(`${name}: contains test-only code (${s})`);
      for (const t of TESTING_NAMES) {
        if (new RegExp(`\\b${t}\\b`).test(code)) problems.push(`${name}: contains the test-only symbol '${t}'`);
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const i = process.argv.indexOf('--dir');
  const dir = path.resolve(i >= 0 ? (process.argv[i + 1] ?? '') : path.join(ROOT, 'dist/node'));
  const problems = auditDir(dir);
  if (problems.length > 0) {
    console.error(`bundle audit FAILED for ${dir}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`bundle audit: ${dir} clean`);
}
