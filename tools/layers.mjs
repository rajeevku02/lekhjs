// The lekhjs layer table (spec 01 §2.1) and the lint zones generated from it (§3.2, §3.3).
//
// This file is the one machine-readable copy of the rank table: eslint.config.js and the
// lint tests build their zones from it. `node tools/layers.mjs` prints the table.

/** The 17 modules in 14 ranks. A module may import only modules of a lower rank. */
export const RANKS = Object.freeze(
  /** @type {const} */ ({
    base: 0,
    geometry: 1,
    style: 2,
    text: 3,
    render: 4,
    template: 5,
    generators: 6,
    model: 7,
    io: 8,
    sync: 9,
    edit: 9,
    semantic: 10,
    export: 10,
    session: 11,
    recognizer: 12,
    headless: 13,
    interaction: 13,
  }),
);

/** @typedef {keyof typeof RANKS} ModuleName */

/** @type {readonly ModuleName[]} */
export const MODULES = Object.freeze(/** @type {ModuleName[]} */ (Object.keys(RANKS)));

/**
 * The only deep imports allowed across modules (§3.2 rule 6): each is a sub-entry with its
 * own index.ts. Nothing else may be imported from outside a module but its index.ts.
 */
export const SUB_ENTRIES = Object.freeze(['export/raster', 'export/pdf', 'recognizer/worker']);

/** The test-only entry (rank 14, §4.1): no module under src/ may import it. */
export const TESTING = 'testing';

/** @param {ModuleName} m */
function subEntriesOf(m) {
  return SUB_ENTRIES.filter((s) => s.startsWith(`${m}/`)).map((s) => `./${s.slice(m.length + 1)}/index.ts`);
}

/**
 * Rank zones, for `lekhjs/layers` (import-x `no-restricted-paths` that lets `import type`
 * through, §3.2 rule 2): a value import of a higher-rank module is rejected.
 * Zone paths are relative to the package root (the rule's `basePath`).
 */
export function rankZones() {
  /** @type {{ target: string; from: string; message: string }[]} */
  const zones = [];
  for (const target of MODULES) {
    for (const from of MODULES) {
      const rt = RANKS[target];
      const rf = RANKS[from];
      if (rf <= rt) continue;
      zones.push({
        target: `./src/${target}`,
        from: `./src/${from}`,
        message: `layer rule: '${target}' (rank ${String(rt)}) may not import '${from}' (rank ${String(rf)}); imports go downward only, and an upward reference must be 'import type' (spec 01 §3.2 rules 1-2).`,
      });
    }
  }
  return zones;
}

/**
 * Boundary zones, for `import-x/no-restricted-paths` (type imports included):
 * - same-rank modules may not import each other at all (§3.2 rule 1);
 * - from outside a module, only its index.ts and the three allowed sub-entries may be
 *   imported (§3.2 rule 6);
 * - nothing under src/ may import src/testing/ (§4.1) or parity/ (§7 rule 2);
 * - no module but headless/ (§4.3) imports the root entry src/index.ts.
 */
export function boundaryZones() {
  /** @type {{ target: string | string[]; from: string; except?: string[]; message: string }[]} */
  const zones = [];
  for (const target of MODULES) {
    for (const from of MODULES) {
      if (from === target || RANKS[from] !== RANKS[target]) continue;
      zones.push({
        target: `./src/${target}`,
        from: `./src/${from}`,
        message: `layer rule: '${target}' and '${from}' share rank ${String(RANKS[target])}; same-rank modules may not import each other, not even types (spec 01 §3.2 rule 1).`,
      });
    }
  }
  for (const from of MODULES) {
    zones.push({
      target: [...MODULES.filter((m) => m !== from).map((m) => `./src/${m}`), './src/index.ts', `./src/${TESTING}`],
      from: `./src/${from}`,
      except: ['./index.ts', ...subEntriesOf(from)],
      message: `deep import: import '${from}' through its index.ts (spec 01 §3.2 rule 6); the only allowed sub-entries are ${SUB_ENTRIES.join(', ')}.`,
    });
  }
  zones.push({
    target: [...MODULES.map((m) => `./src/${m}`), './src/index.ts'],
    from: `./src/${TESTING}`,
    message: `'src/${TESTING}' is the test-only entry (rank 14); nothing else under src/ may import it (spec 01 §4.1).`,
  });
  zones.push({
    target: './src',
    from: './parity',
    message: `'parity/' is porting-only tooling; src/ may not import it (spec 01 §7 rule 2).`,
  });
  zones.push({
    target: MODULES.filter((m) => m !== 'headless').map((m) => `./src/${m}`),
    from: './src/index.ts',
    message: `the root entry src/index.ts is not an import target for modules (spec 01 §3.2 rule 6).`,
  });
  return zones;
}

/**
 * `no-restricted-imports` patterns for files under src/: these catch by specifier what the
 * resolved zones above might miss (an import of a path that does not exist yet).
 */
export const SRC_RESTRICTED_IMPORT_PATTERNS = Object.freeze([
  {
    group: ['**/parity', '**/parity/**'],
    message: "'parity/' is porting-only tooling; src/ may not import it (spec 01 §7 rule 2).",
  },
  {
    group: ['lekhjs', 'lekhjs/*'],
    message: 'inside lekhjs, import modules by relative path, not through the package name.',
  },
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'lekhjs has no React (spec 05 R2, AC-UI-01): the React board is lekhboard-capacitor.',
  },
]);

/** Globals that src/ may not touch (§3.2 rule 4, §3.3). */
export const RESTRICTED_GLOBALS = Object.freeze(['window', 'document', 'self', 'navigator', 'globalThis', 'process']);

function printTable() {
  const lines = ['| Rank | Module |', '|---|---|'];
  for (const m of MODULES) lines.push(`| ${String(RANKS[m])} | \`${m}/\` |`);
  lines.push(`| 14 | \`${TESTING}/\` (test-only entry) |`);
  console.log(lines.join('\n'));
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) printTable();
