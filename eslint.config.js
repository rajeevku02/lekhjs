// ESLint flat config for lekhjs (spec 01 §3.3). Run by `npm run lint` and `npm run check`.
//
// The layer zones are generated from the rank table in tools/layers.mjs:
//   lekhjs/layers                — value imports go downward only (type-only upward is fine)
//   import-x/no-restricted-paths — same-rank imports, deep imports (three allowed
//                                  sub-entries), src/testing/, parity/, the root entry
//   lekhjs/no-module-state       — no module-level mutable state
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';
import lekhjs from './tools/eslint-rules/index.js';
import { RESTRICTED_GLOBALS, SRC_RESTRICTED_IMPORT_PATTERNS, boundaryZones, rankZones } from './tools/layers.mjs';

const root = import.meta.dirname;

/**
 * The structural rules (layers, cycles, module state, globals) for files under src/.
 * Exported so the lint tests (test/lint/) run exactly these over their fixtures.
 * @param {string} basePath the package root the zones are relative to
 * @returns {import('eslint').Linter.Config[]}
 */
export function structuralConfig(basePath) {
  return [
    {
      files: ['src/**/*.ts'],
      languageOptions: { parser: tseslint.parser, sourceType: 'module', ecmaVersion: 2022 },
      plugins: { 'import-x': /** @type {import('eslint').ESLint.Plugin} */ (importX), lekhjs },
      settings: {
        'import-x/resolver-next': [createTypeScriptImportResolver({ project: `${basePath}/tsconfig.build.json` })],
        'import-x/extensions': ['.ts', '.js', '.mjs'],
      },
      rules: {
        'import-x/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],
        'lekhjs/layers': ['error', { basePath, zones: rankZones() }],
        'import-x/no-restricted-paths': ['error', { basePath, zones: boundaryZones() }],
        'no-restricted-imports': ['error', { patterns: [...SRC_RESTRICTED_IMPORT_PATTERNS] }],
        'lekhjs/no-module-state': ['error', { allow: [] }],
        // A generator's script text is never evaluated (AC-GEN-09, spec 04 §5.2).
        'no-eval': 'error',
        'no-new-func': 'error',
        '@typescript-eslint/no-implied-eval': 'off',
        'no-implied-eval': 'error',
        'no-restricted-globals': [
          'error',
          ...RESTRICTED_GLOBALS.map((name) => ({
            name,
            message: `lekhjs has no ambient globals; '${name}' arrives through a port (spec 01 §3.2 rule 4).`,
          })),
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSEnumDeclaration',
            message: 'No enum: use an `as const` object plus a union type (spec 01 §3.2 rule 7).',
          },
          {
            selector: 'TSModuleDeclaration[kind="namespace"]',
            message: 'No namespace (spec 01 §3.2 rule 7).',
          },
          { selector: 'Decorator', message: 'No decorators (spec 01 §3.2 rule 7).' },
          { selector: 'TSParameterProperty', message: 'No parameter properties (spec 01 §3.2 rule 7).' },
        ],
      },
    },
  ];
}

export default defineConfig(
  globalIgnores([
    'node_modules/',
    'dist/',
    'coverage/',
    'test/lint/fixtures/',
    'parity/node_modules/',
    // Parity run output (git-ignored by parity/.gitignore): builds, bundled TS front ends and
    // reports that the harness writes there. It is generated, not source, and a build left there
    // made `npm run check` fail on lint.
    'parity/out/',
    // The owner's proprietary line aggregator (Work 01M4X7TCHFB862XGT68GPY071C, M1), obfuscated on
    // purpose: it is never linted or rewritten (no-module-state, layers, any fixer). Its API is
    // typed and linted through LineMerger.d.ts and LineAggregatorImpl.ts.
    'src/recognizer/lines/LineMerger.js',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: root },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  ...structuralConfig(root),
  {
    // Tooling (config files, tools/, parity/) runs on Node and is plain JS: no type-aware rules.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // CommonJS tooling (parity/json/tolerance.cjs, which kashi's Jest suites require; the oracle
    // drivers over kashi's CommonJS modules).
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['test/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
);
