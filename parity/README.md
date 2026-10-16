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
