# lekhjs parity tools (porting only)

This package holds what the port needs and the product never does (spec 01 §7):

- `register/DR-<AREA>-<NN>.yaml`: the difference register, one minimal synthetic fixture per entry;
- `tools/`: the JSON comparison (A), the image comparison (B), the library-shape test and
  `regen-goldens.mjs`, which writes `../test/fixtures/golden/` from the C++ oracle.

Rules:

- It has its own `package.json`, may name the oracle builds by relative path, and is not in
  lekhjs `exports`.
- `src/` may not import it: a lint zone rejects the import (AC-ARC-19).
- Customer boards are read only from the git-ignored workspace-root `corpus/`; reports carry
  counts and register ids only.
- After cutover the oracle-driving code goes; the register summary moves to the knowledge base.

## The corpus runs (W11)

- `corpus/inventory.mjs` → `corpus/inventory.json` (feature flags per board), `corpus/sample.mjs`
  → `corpus/sample/image-sample.json` (the §B.4 sample and the 200-board switches-off subsample),
  `corpus/fetch_res.py` → `corpus/res/` (the sample's `res://` images, read-only prod access).
- `image/run.mjs` (driven in lock-sized chunks by `image/run-chunks.sh`): comparison (B), both
  browser builds, the §B.3 bar, attribution by object flags (`image/attribute.mjs`) and the
  register's `rule.image`; `image/report.mjs` aggregates (counts only), `image/contact.mjs` makes
  local contact sheets.
- `bench/web-bench.mjs`: the client benchmarks of verification 03 §4.1 on the box (P-01…P-04,
  P-07a PNG, P-09), interleaved runs, the §3.3 verdicts.
- `leaks/board-cycle.mjs`: L-01, 50 open / edit / close cycles with heap snapshots analysed by
  memlab (`leaks/package.json`, installed with `PUPPETEER_SKIP_DOWNLOAD=1`); run it on a build
  made with `vite build --minify false` so class names survive.
