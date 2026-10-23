# Android recognizer performance on a Galaxy Tab S6 Lite after the LineRelation and Span fixes (NA4 perf android rec2, DEV-70 / DEV-71 / L-06a), results

A re-run of the recognition rows of [`../tab-s6-lite-perf-2026-10-22/results.md`](../tab-s6-lite-perf-2026-10-22/results.md) (committed in `653a15b`; "before" below) after the owner's recognizer perf commits `2522141` (LineRelation: `grow` builds the largest window once and costs sub-spans of it) and `38f516f` (Span: `at` / `first` / `last` index the array directly). Same device, harness, pages, host APK, interleaving, reduction and bars as before; only the TS build changed. C++ was re-run the same day for the DEV-70 ratio. T21 was not re-run (no board or render code changed between the two TS builds' lekhjs sources other than these two files). Aggregates only: the synthetic recognizer corpus (`test/recognizer/corpus`, 362 cases) and lekhcore test board `ipad-flowchart.lekh`; no user content, ids or accounts.

## Run, 2026-10-23 (agent, on the owner's Mac and tablet over USB)

- **Device.** Samsung Galaxy Tab S6 Lite Wi-Fi (SM-P610), Android 13 (build `TP1A.220624.014`), Android System WebView 155.0.8059.43, as before. Up 2 days 15 h, not rebooted.
  - Battery 71 % at the start and 76 % at the end, charging over USB throughout (DEV-70 asks for the charger off; noted as before). Battery 28.8–29.9 °C; thermal status 0 at every launch; AP sensor 32.5–39.9 °C.
  - Screen: "stay awake while plugged in" (`stay_on_while_plugged_in` 7) and screen timeout 1,800,000 ms, recorded and left as found.
  - Information, not the G3 gate (the floor is the Galaxy Tab A7 Lite), as before.
- **Builds.**
  - TS: lekhboardwebapp `c209137` (the `cp_web` of lekhboard-capacitor `c173ae1`, its current head; exported to a scratch directory, no extra board files needed), compiled from lekhjs `38f516f`, `VITE_LEKH_TEST_ANY_HOST=1`, `devapi.lekh.app`. Worker chunk `recognizer.worker-6cc8a666.js` (before: `22b8f935`); the inline blob worker decodes to the identical text. The new code is in it: `at(t){return this.items[this.start+t]}` (before: `at(t){return this.absolute(this.start+t)}`) and the window clamp `Math.max(l-d,0),p=Math.min(l+d,c),f=this.agg.getCost(new …` of the new `grow`. `LineMerger.js` unchanged (sha256 `341422a5…`); 73 private-name references, no `WeakMap`, as before.
  - C++: the same byte-identical copy of lekhboardwebapp `fa71c40` (hooked wasm, lekhcore `4140fd244e43`, line aggregator `owner-real-2026-10-17`).
  - Host: the same bench debug APK as before (lekhandroid `f9d3d7c9` plus the two temporary bench lines, built in the earlier run), so the WebView, trampoline (`:4016`), bench server (`:4006`, `adb reverse`), the hidden `androidBridge` and the stripped analytics tags are unchanged. Both builds ran as platform `web`; `crossOriginIsolated` false, 0.1 ms timer; no devtools during timed launches.
- **Procedure.** As before: one app launch per engine and run (`am force-stop`, `am start`), one discarded warm-up pass and one measured pass per launch, each case the mean of 5 repeats; DEV-70 10 launches interleaved C++, TS, TS, C++, C++, TS, TS, C++, C++, TS (5 per engine), then DEV-71 3 launches, 20 s idle between launches. All 13 launches completed (0 failures, 0 errors).

## DEV-70: recognition time per stroke (AC-REC-29, AC-REC-31), 362 cases (326 ordinary, 36 pathological)

| Measure                                   | Before TS (`853e7e6` src) | After TS (`38f516f`)   | C++ same day (before run) | Ratio after (before) | Bar                                 | Verdict after |
| ----------------------------------------- | ------------------------- | ---------------------- | ------------------------- | -------------------- | ----------------------------------- | ------------- |
| p95 per stroke, ordinary cases (326)      | 16.6 ms                   | 16.3 ms                | 12.0 ms (11.5)            | 1.36 (1.45)          | TS ≤ C++ (+10 % with DR)            | **fail**      |
| p95 per stroke, pathological sets (36)    | 49.6 ms                   | 45.7 ms                | 40.4 ms (40.2)            | 1.13 (1.23)          | —                                   | —             |
| p95 per stroke, all cases (362)           | 26.4 ms                   | 23.4 ms                | 23.0 ms (23.2)            | 1.02 (1.14)          | —                                   | —             |
| max, pathological sets                    | 69.0 ms (worker total)    | 62.4 ms (worker total) | 53.2 ms (46.0)            | —                    | ≤ 300 ms (AC-REC-31, floor A7 Lite) | pass          |
| jobs over the 1,500 ms watchdog           | 0 of 1,810                | 0 of 1,810             | —                         | —                    | 0                                   | pass          |
| worker cold start, `new Worker` → `ready` | median 581, max 617 ms    | median 570, max 575 ms | —                         | —                    | ≤ 1.5 s                             | pass          |

- **Per-run TS p95, ordinary.** 16.32, 16.28, 16.86, 16.08, 16.50 ms (before 16.5–16.8). **Per-run C++ p95 (minus hook overhead).** 11.66, 12.04, 12.10, 11.60, 12.70 ms (before 11.4–12.1). A/A margin 4 %.
- **Round trip** (TS post → result) p95 18.3 ms ordinary (before 19.4 ms). No case failed; no budget-exceeded job.
- **Reading.** On the tablet the fixes take the pathological p95 down 8 % (49.6 → 45.7 ms) and the pathological max 10 % (69 → 62 ms), but the ordinary p95 only 2 % (16.6 → 16.3 ms, within the run-to-run spread). The same-day C++ ordinary p95 is 4 % higher than the day before (12.0 vs 11.5 ms), so the ratio moves from 1.45 to 1.36, still beyond the 10 % a DR-PERF entry could accept: DEV-70's "TS ≤ C++" row **still fails**. Over all 362 cases TS is now level with C++ (1.02).

## DEV-71: main-thread cost per stroke (AC-REC-30)

Same setup as before (TS web build in the app WebView, `ipad-flowchart.lekh` in SmartDraw, 80 synthetic Pointer Events strokes after 5 warm-up strokes, each result undone, 3 launches). The main-thread path does not run the changed recognizer code, so no change was expected.

| Measure                                          | Before (3 launches)                                   | After (3 launches)                                     | Bar                  | Verdict after |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------ | -------------------- | ------------- |
| main-thread cost p95 (snapshot + post + apply)   | 8.4 / 7.7 / 9.1 ms (dispatch 2.4–2.7, apply 6.1–7.1)  | 8.8 / 9.5 / 8.0 ms (dispatch 2.4–2.6, apply 6.3–7.8)   | ≤ 4 ms               | **fail**      |
| main-thread cost max                             | 10.0 / 9.6 / 10.9 ms                                  | 11.6 / 11.3 / 9.0 ms                                   | —                    | —             |
| main-thread blocking attributable to recognition | 0 long tasks; probe gaps > 30 ms 5 / 3 / 3, max 40 ms | 0 long tasks; probe gaps > 30 ms 3 / 8 / 10, max 39 ms | no long task > 50 ms | pass          |
| pointerup → result applied, p50 / p95            | 23.2–24.5 / 33.7–38.6 ms                              | 23.9–24.6 / 35.8–38.9 ms                               | ≤ wasm p95 + 16 ms   | no C++ value  |
| ink-only fallbacks (watchdog, crash, disabled)   | 0 of 240                                              | 0 of 240                                               | 0                    | pass          |

## L-06(a): recognition worker memory over 1,000 strokes (AC-REC-32)

Same method as before (`leak.html`, the new worker chunk, 362-stroke warm-up, CDP `HeapProfiler.collectGarbage` twice per reading, worker and page; untimed, WebView debugging over `adb forward`, after the timed runs).

| Worker heap         | Before           | After            | Bar       | Verdict |
| ------------------- | ---------------- | ---------------- | --------- | ------- |
| after warm-up       | 4.21 MB          | 4.21 MB          | —         | —       |
| after 1,000 strokes | 4.32 MB (+2.5 %) | 4.31 MB (+2.5 %) | ≤ +5 %    | pass    |
| after 2,000         | 4.35 MB (+3.2 %) | 4.35 MB (+3.2 %) | —         | —       |
| after 3,000         | 4.37 MB (+3.6 %) | 4.36 MB (+3.6 %) | —         | —       |
| page heap change    | +10 KB           | +10 KB           | no growth | pass    |

0 errors and 0 jobs over 1,500 ms in 3,000 strokes; 1,000 strokes took 10.9 s (before 11.6 s).

## Desktop (Node 24.15, the owner's Mac): before / after and where the time goes

The 362-case corpus through `recognizeStroke` with the production line aggregator (as in the iPhone LineMerger run's `rec-node.ts`), bundled with esbuild from a `git archive` of each commit; the third of three passes per process, 5 processes per commit, alternating; medians.

| Measure (pass 3)       | `653a15b` (= `853e7e6` src) | `38f516f` | Change |
| ---------------------- | --------------------------- | --------- | ------ |
| p95, ordinary (326)    | 1.65 ms                     | 1.28 ms   | −22 %  |
| p95, pathological (36) | 4.65 ms                     | 3.65 ms   | −22 %  |
| p95, all (362)         | 2.55 ms                     | 1.96 ms   | −23 %  |
| max                    | 9.18 ms                     | 7.34 ms   | −20 %  |
| sum over 362 cases     | 291 ms                      | 238 ms    | −18 %  |

CPU profile (one process per commit, 3 passes plus corpus and scene setup, 0.1 ms sampling), self time:

| Module / function                              | `653a15b`         | `38f516f`         |
| ---------------------------------------------- | ----------------- | ----------------- |
| profile total                                  | 1,171 ms          | 998 ms            |
| `LineMerger.js` (all)                          | 54.7 % (≈ 641 ms) | 49.6 % (≈ 495 ms) |
| its hottest function (minified `n`)            | 28.9 %            | 38.6 %            |
| its second (minified `i`)                      | 23.2 %            | 8.8 %             |
| `LineRelation.ts` (`grow`, `addPoints`)        | 4.3 % (2.2 + 1.5) | 5.7 % (2.8 + 2.6) |
| `StrokeLine.ts` (`points`)                     | 4.5 % (3.1)       | 5.3 % (3.5)       |
| `span.ts`                                      | 1.2 %             | < 1 %             |
| garbage collector                              | 3.0 %             | 2.6 %             |
| `ellipseFitter.ts`, `CxPoly.ts`, `PolyNode.ts` | 2.9, 2.8, 1.7 %   | 3.0, 2.9, 2.0 %   |

- Most of the saving shows up inside `LineMerger.js` (its second-hottest function drops from 23 % to 9 % of the profile; `LineMerger.js` reads its points through `Span`), not in `LineRelation.ts` itself. About half of all recognizer time is still in `LineMerger.js`, now mostly in one function.
- On the Mac the change is about −22 % at every percentile; on the tablet's WebView it is −2 % (ordinary) to −8 % (pathological). The likely reason is that V8 in the WebView had already been inlining the bounds-checked `Span.absolute` on these paths, or that the device time is dominated by work the fixes do not touch; this run does not separate the two.

## Not run, and why

As in the earlier file, plus: **T21** was not re-run (recognizer-only change; the earlier T21 rows stand). The floor device (Galaxy Tab A7 Lite) is still the gate.

## Tablet state after the run

- A normal (non-bench) Lekh debug build of the current code is installed: lekhboard-capacitor `c173ae1` built dev-configured (`devapi.lekh.app` / `devdocs.lekh.app` only; no `api.lekh.app` / `docs.lekh.app` in the bundle) against lekhjs `38f516f` (worker chunk `recognizer.worker-6cc8a666.js`, the same hash as the bench), packaged in a copy of lekhandroid `f9d3d7c9` with no bench redirect. It launches to its sign-in screen.
- The bench origins' storage and cookie were cleared from the app's WebView profile; `adb` reverses and forwards removed; the bench server stopped. No device setting changed.
