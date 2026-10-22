# Recognition on an iPhone 8 after the LineMerger optimisation (NA4 perf rerun, DEV-70 / DEV-71), results

A rerun of the recognition rows of [`../iphone8-perf-2026-10-22/results.md`](../iphone8-perf-2026-10-22/results.md) (lekhjs `a915e62`). The same phone, method, corpus, metrics and bars were used, now with the owner's new `src/recognizer/lines/LineMerger.js` (lekhjs `853e7e6`, "Optimizing LineMerger"). T21 was not rerun because it does not use the line merger. The lines are aggregates only: the synthetic recognizer corpus (`test/recognizer/corpus`, 362 cases) and lekhcore test board `ipad-flowchart.lekh`. There are no user content, ids or accounts.

## Run, 2026-10-22 evening (agent, on the owner's Mac and iPhone)

- **Device.** The same iPhone 8 (iPhone10,1) on iOS 16.7.14 (20H370). Battery was 96–98 %, charging over USB, at about 29 °C. This is **not a planned device**, so these numbers are **information, not the G3 gate** (see the earlier file). The app install that was wedged earlier now installs normally.
- **Builds.**
  - TS: lekhboardwebapp `62a9647`, the same webapp commit as before, compiled from lekhjs `853e7e6`. Against the earlier TS build (lekhjs `c409690`), `src/` differs only in `LineMerger.js`, which is byte-identical to the owner's commit (sha256 `341422a5…`).
  - C++: the same lekhboardwebapp `fa71c40` hooked wasm bundle as before, a byte-identical copy (line aggregator `owner-real-2026-10-17`).
  - Both builds use `VITE_LEKH_TEST_ANY_HOST=1`, as before.
- **How the new LineMerger is compiled.**
  - The old file (`a915e62`) shipped already lowered: its own WeakMap-based private-field helpers and a string-array decoder were inside the file.
  - The new file uses native `#private` fields (73 references). The build (Vite 4.4.9 and esbuild 0.18.20, `build.target` `safari17` / `chrome111`) keeps them native and does not lower them.
  - The built worker chunk (`recognizer.worker-cf8d8306.js`, and the identical inline blob worker) has 73 private-name references and no `WeakMap`. The earlier worker chunk had 0 private names and 8 `WeakMap`.
  - The build config was not changed. iOS 16 WebKit supports private fields, so the phone ran them natively.
- **Where it ran.** It ran in the app's WKWebView. The host was a Debug lekhios `d8aa4df` with the owner's uncommitted deployment-target change. A temporary, uncommitted `capacitor.config.json` `server.url` pointed the app at the bench server on the Mac over the LAN, and was reverted after the build. As before, the page is not cross-origin isolated, so the timer has 1 ms resolution, and each recognizer case is the mean of 5 repeats.
- **Procedure.**
  - There was one app launch per engine and run, interleaved C++, TS, TS, C++, … with 5 runs per engine. Each launch made one discarded warm-up pass and then one measured pass.
  - The idle time between launches was 30 s for the first two launches and 5 s after that.
  - The tables come from the same per-run p95 / median-of-runs reduction as before.
- **Harness differences from the earlier run.** None of these touches timed code.
  - **C++ subresources.** In the C++ iframe, the parser-discovered subresources (`bean.min.js`, the entry module, the CSS) reached the bench server without the `lekhbench` cookie. The server then served the TS build's 404s, and the C++ hooks never appeared.
    - The bench server (a scratch copy of `build-device-bench.mjs --serve`) now falls back to the Referer's `engine=` when the cookie is missing.
    - With that fallback, every C++ file came from the C++ build.
  - **Launches that did not load.** Some launches got the `server.url` redirect but never requested the page. Most of them came right after a TS launch.
    - The driver relaunched each one: 3 C++ and 1 TS REC launch, and 2 stroke launches.
    - These were never counted as runs, and no run failed once it had loaded.
  - **Screen lock.** The phone auto-locked between launches. Today `setKeepAwake` did not hold the screen on. Each launch woke the phone into the app.
    - The runs (≤ 0.8 min each) completed in the foreground. For one stroke launch, syslog confirmed the app stayed in the foreground for the whole run.
    - A same-day TS REC launch of the earlier build (old LineMerger, about 5 min per launch) was aborted when the phone locked during it. So the old-TS DEV-70 numbers below are from the earlier file.

## DEV-70: recognition time per stroke (AC-REC-29, AC-REC-31), recognizer corpus, 362 cases (326 ordinary, 36 pathological)

The engines were timed as in the earlier file: the TS worker's `timings.recognizeMs` per job, and the C++ `__lekhTest.recognizeStroke` minus the one-point-stroke hook overhead. There were 5 runs per engine. The C++ engine was **re-measured** (5 launches, interleaved): its values are within about 20 % of the earlier ones, so the conditions are comparable. The ratio and verdict use today's C++.

| Measure                                   | TS before (`a915e62`)       | TS after (`853e7e6`)      | C++ today (earlier) | Ratio TS/C++ before → after | Bar                       | Verdict  |
| ----------------------------------------- | --------------------------- | ------------------------- | ------------------- | --------------------------- | ------------------------- | -------- |
| p95 per stroke, ordinary cases (326)      | 169.8 ms                    | 9.2 ms                    | 5.8 ms (6.8 ms)     | 25.0 → 1.59                 | TS ≤ C++ (+10 % with DR)  | **fail** |
| p95 per stroke, pathological sets (36)    | 508.4 ms                    | 26.4 ms                   | 20.8 ms (23.6 ms)   | 21.5 → 1.27                 | —                         | —        |
| p95 per stroke, all cases (362)           | —                           | 14.2 ms                   | 12.0 ms             | — → 1.18                    | —                         | —        |
| max, pathological sets                    | 665 ms (worker total)       | 35 ms (worker total)      | 22.2 ms (28.8 ms)   | —                           | ≤ 300 ms (AC-REC-31, Tab) | pass     |
| jobs over the 1,500 ms watchdog           | 0 of 1,810                  | 0 of 1,810                | —                   | —                           | 0                         | pass     |
| worker cold start, `new Worker` → `ready` | median 707 ms, max 1,301 ms | median 602 ms, max 731 ms | —                   | —                           | ≤ 1.5 s                   | pass     |

- **Per-run TS p95, ordinary cases.** 9.2, 9.2, 9.4, 9.0 and 8.8 ms.
- **Per-run C++ p95.** 5.6, 6.0, 5.8, 5.8 and 5.4 ms. The A/A margin is 3 %.
- **Errors.** No case failed on either engine. No job exceeded the budget.
- **What changed.** TS recognition is about 18× faster on the device (ordinary p95), and the pathological maximum is now well under the 300 ms bar. The ordinary-case p95 is still 1.6× C++, so DEV-70's "TS ≤ C++" row still fails.
- **Round trip.** The TS round trip (post → result) p95 is 10.0 ms on ordinary cases.

## DEV-71: main-thread cost per stroke (AC-REC-30)

The setup was the same as in the earlier file: the TS web build in the app WebView, `ipad-flowchart.lekh` in SmartDraw, 80 synthetic strokes after 5 warm-up strokes, and each result undone. There were 3 launches. An extra diagnostic launch, recorded with syslog, gave the same numbers.

| Measure                                          | Before (`a915e62`, earlier run) | After (`853e7e6`, 3 launches)                       | Bar                  | Verdict                                        |
| ------------------------------------------------ | ------------------------------- | --------------------------------------------------- | -------------------- | ---------------------------------------------- |
| main-thread cost p95 (snapshot + post + apply)   | 5 / 5 / 5 ms                    | 9 / 9 / 8 ms (dispatch p95 3 ms, apply p95 6–7 ms)  | ≤ 4 ms               | **fail** (see the condition note below)        |
| main-thread cost max                             | 7 / 18 / 9 ms                   | 13 / 11 / 12 ms                                     | —                    | —                                              |
| main-thread blocking attributable to recognition | 0 gaps > 30 ms                  | 20 gaps per launch, each about 1.0 s (max 1,023 ms) | no long task > 50 ms | inconclusive (the same on the old build today) |
| pointerup → result applied, p50 / p95            | 34–36 / 65–67 ms                | 23–25 / 31–34 ms                                    | ≤ wasm p95 + 16 ms   | no C++ value                                   |
| ink-only fallbacks (watchdog, crash, disabled)   | 0 of 240                        | 0 of 240                                            | 0                    | pass                                           |

- **Today's conditions differ from the earlier run.** One launch of the **earlier TS build** (lekhjs `c409690`, the old LineMerger, unchanged files) ran the same day between the runs above. It showed the same 1 s probe gaps:
  - 22 gaps, max 1,003 ms;
  - main-thread cost p95 12 ms, apply p95 9 ms;
  - pointerup → applied p95 62 ms.
- **So the gaps and the higher main-thread cost are not the new LineMerger.** About 1 s gaps from a 10 ms interval look like WebKit timer throttling. The cause was not established; this was the run in which the screen auto-locked between launches.
- **The comparable signal is pointerup → applied.** The old build gave 62 ms today and the new build 31–34 ms. This round trip is about halved by the faster worker.
- **The main-thread cost row should be re-measured** under the earlier conditions before it is read as a regression. The main-thread path (snapshot, post and apply) does not run `LineMerger.js`.

## Desktop comparison (Node 24.15, Apple-silicon Mac, the same 362 cases, in-process `recognizeStroke`)

The bundle was the same `rec-node` harness, built twice with esbuild 0.28 (`target node24`, private fields native). It used each commit's `LineMerger.js` and the same rest of lekhjs `853e7e6`. There were 2 processes × 3 passes per version, interleaved.

| Per stroke | Old LineMerger (`a915e62`) | New LineMerger (`853e7e6`) |
| ---------- | -------------------------- | -------------------------- |
| p50        | 11.5–13.7 ms               | 0.52–0.76 ms               |
| p95        | 87–330 ms                  | 2.5–3.1 ms                 |
| max        | 287–550 ms                 | 9.4–11.9 ms                |

The CPU profile (self time, whole process, including corpus loading and scene setup) changed as follows.

| Share of self time               | Old LineMerger (47.2 s total)                                     | New LineMerger (1.3 s total)                                   |
| -------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `LineMerger.js`                  | 86.5 % (67.8 % in one function, the lowered private-field helper) | 48.0 % (two functions: 25.0 % and 19.8 %)                      |
| garbage collector                | 10.4 %                                                            | 3.1 %                                                          |
| rest of the recognizer           | ≈ 1 %                                                             | ≈ 40 % (StrokeLine 5.2 %, LineRelation 4.2 %, CxPoly 3.5 %, …) |
| module loading and harness setup | ≈ 2 %                                                             | ≈ 9 %                                                          |

The lekhjs recognizer suite (`test/recognizer`, 39 files, 758 tests) passes at `853e7e6`.

## Not run, and why

| Item                                          | Why                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| T21 (P-01 / P-02 / P-03)                      | Not affected by the line merger. The earlier file stands.                                                                               |
| Same-day DEV-70 on the earlier TS build       | Aborted: the phone locked during the ~5 min launch. The before column is the earlier run.                                               |
| DEV-71 under the earlier run's conditions     | The 1 s timer gaps appeared on both builds today. Rerun it with the phone's Auto-Lock set to Never, or once the keep-awake holds again. |
| DEV-74, DEV-57, P-06 vs wasm, planned devices | As in the earlier file.                                                                                                                 |
