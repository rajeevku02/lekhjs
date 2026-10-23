# LineMerger reproductions (Work 01M5MJKJ2HHN35B2BEC0WWQ4J1)

Inputs for aligning `src/recognizer/lines/LineMerger.js` (TS id `lekh-line-merger-2`) with the C++
line aggregator linked into the parity reference wasm (`owner-real-2026-10-17`). These are the 15
strict-parity cases whose only difference from the reference is the line split
(`test/recognizer/parity/known-differences.json` `lineAggregator`; KB
`/frontend/lekhjs/recognition/parity-and-corpus.md` §5.5). The owner deferred them to Work
01M5MJKJ2HHN35B2BEC0WWQ4J1 on 2026-10-23.

All data is synthetic: the strokes are corpus cases of `test/recognizer/corpus/strokes.json`.

| File                          | What                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<case>.json`                 | `points`: the pre-processed stroke (TS `preProcess`, equal to C++ `GeoUtil::preProcess`); `tsLines`: what `LineMerger` returns, as `[startIndex, endIndex]` into `points`; `cppLines`: the segmentations that reproduce the wasm reference exactly (the C++ lines are one of them) |
| `<case>-aggregator-input.txt` | the same points, one `x y` per line, as the aggregator receives them                                                                                                                                                                                                               |
| `inferred-cpp-lines.json`     | all 15 cases: point count, `tsLines`, a `note`, and each line edit that reproduces the reference (`cppLinesReproducingReference`, empty where no single edit does)                                                                                                                 |

Full files are given for the three cases whose wasm result is stable under the ±0.01 px jitter
(`rightTriangle-v11`, `overtrace-v02`, `spiral-v06`); the other 12 are in `inferred-cpp-lines.json`.

**How they were derived** (round REC27, lekhjs 4e949e8, lekhcore b8d8edc, wasm fa71c40 /
sha256 8bd22d24). For each case, a C++ replay harness built the lekhcore recognizer stages in
doubles, ran C++ `GeoUtil::preProcess` on the raw stroke (same points as TS), injected the lines
`LineMerger` returned through a patched `LineAggregator::process`, and answered `getCost` with
`LineMerger.getCost` and every scene query with the TS `SnapshotCanvasDelegate`'s answers; on the
TS lines it gives the TS result bit for bit. A line search then shifted one line boundary by up to
6 points, split one line or merged two, ran the TS stages on each candidate, and kept the
segmentations whose result equals the wasm reference. `LineMerger.js` itself was not read.
