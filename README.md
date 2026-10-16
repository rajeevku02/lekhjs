# lekhjs

The Lekh diagramming engine in TypeScript, shared by every client and the backend: the document
model, templates and generators, io, sync, editing, the semantic layer, text layout, the drawing
interface, interaction logic, the recognizer and export. It has no DOM, no React and no Node
built-ins; hosts supply those through ports.

- The React board (`lekhboard-capacitor/lekh`, and `lekhboardwebapp/v2` through `make cp_web`)
  compiles `src/` directly through a Vite alias (`lekhjs` → `../../lekhjs/src`).
- The backend (`lbs/kashi`) loads the Node bundle `dist/node/headless.js` through a `file:`
  dependency.

The design is in the Windy knowledge base (see `AGENTS.md`).

## Layers

`src/` holds 17 modules in 14 ranks. A module may import only modules of a **lower** rank; modules of
the same rank never import each other; an upward reference must be `import type`. From outside a
module, only its `index.ts` may be imported, plus exactly three sub-entries: `export/raster`,
`export/pdf` and `recognizer/worker`.

| Rank | Module                                  |
| ---- | --------------------------------------- |
| 0    | `base/`                                 |
| 1    | `geometry/`                             |
| 2    | `style/`                                |
| 3    | `text/`                                 |
| 4    | `render/`                               |
| 5    | `template/`                             |
| 6    | `generators/`                           |
| 7    | `model/`                                |
| 8    | `io/`                                   |
| 9    | `sync/`, `edit/`                        |
| 10   | `semantic/`, `export/`                  |
| 11   | `session/`                              |
| 12   | `recognizer/`                           |
| 13   | `headless/`, `interaction/`             |
| 14   | `testing/` (test-only entry, see below) |

`tools/layers.mjs` is the machine-readable copy of this table; the lint zones are generated from it.

Other rules, all enforced by `npm run check`:

- **No module-level mutable state** (`lekhjs/no-module-state`): no top-level `let`, mutable object,
  collection or class instance. Per-board state hangs off `BoardSession`; shared state off the
  `Runtime`.
- **No ambient globals**: `lib: ["ES2022"]`, no DOM, WebWorker or Node types; time, ids, timers and
  the canvas arrive through ports.
- **Erasable syntax only**: no `enum`, `namespace`, parameter properties or decorators.
- **No import cycles** (`import-x/no-cycle`).
- `src/testing/` (the `lekhjs/testing` entry) is for tests only: nothing in `src/` imports it, and it
  is kept out of `dist/node/index.js` and `dist/node/headless.js`.
- `parity/` (porting-only tools, own `package.json`) is never imported by `src/`.

## Entry points

| Import                     | Node (`dist/node/`) | Front ends (`src/`)              |
| -------------------------- | ------------------- | -------------------------------- |
| `lekhjs`                   | `index.js`          | `src/index.ts`                   |
| `lekhjs/headless`          | `headless.js`       | `src/headless/index.ts`          |
| `lekhjs/interaction`       | —                   | `src/interaction/index.ts`       |
| `lekhjs/recognizer`        | —                   | `src/recognizer/index.ts`        |
| `lekhjs/recognizer/worker` | —                   | `src/recognizer/worker/index.ts` |
| `lekhjs/export/pdf`        | —                   | `src/export/pdf/index.ts`        |
| `lekhjs/testing`           | `testing.js`        | `src/testing/index.ts`           |

## Scripts

Node 24 (`.nvmrc`). lekhjs has no runtime `dependencies`: the libraries it uses are dev
dependencies, inlined into `dist/node` by esbuild and resolved from `node_modules` by Vite.

| Command             | Does                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `npm ci`            | install the dev dependencies                                                               |
| `npm run typecheck` | `tsc` over the build config (`src/`) and the test config (tests, tools)                    |
| `npm run lint`      | ESLint: layers, cycles, module state, globals, `typescript-eslint` strict-type-checked     |
| `npm test`          | vitest (Node, forked workers, at most 2)                                                   |
| `npm run build`     | `.d.ts` into `dist/types`, the Node bundle into `dist/node`, `dist/build-info.json`        |
| `npm run check`     | typecheck, lint, `prettier --check`, test, build, then `tools/bundle-audit.mjs`; must pass |

`dist/build-info.json` records `{ commit, dirty, built_at, node, files_sha256 }`;
`node tools/build-info.mjs --hash` prints a fresh `files_sha256` (over `src/`, `fonts/` and
`stencils/`) for the kashi stale check and the image build.
