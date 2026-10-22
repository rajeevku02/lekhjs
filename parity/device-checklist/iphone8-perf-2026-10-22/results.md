# iOS device performance on an iPhone 8 (NA4 perf, T21 / DEV-70 / DEV-71), results

Verification 03 §4.3 (T21), verification 06 §O (DEV-70, DEV-71, DEV-74), spec 07 §7.6. The lines are aggregates only: synthetic boards (S-syn from `parity/bench/synth.mjs`) and the synthetic recognizer corpus (`test/recognizer/corpus`). No user content, ids or accounts.

## Run, 2026-10-22 (agent, on the owner's Mac and iPhone)

- **Device.** iPhone 8 (iPhone10,1), iOS 16.7.14 (20H370), 2 GB RAM. Battery between 84 and 90 %, charging over USB, about 29 °C. The phone was not rebooted before the run. It is **not a planned device**: the floors are the iPad 6th gen (iPadOS 17) and the Galaxy Tab A7 Lite. iOS 16 is below the port's iOS 17 minimum, so the owner temporarily lowered `IPHONEOS_DEPLOYMENT_TARGET` to install the app (not committed). These numbers are **information, not the G3 gate**.
- **Builds.**
  - C++: lekhboardwebapp `fa71c40` (the owner's H-ROL-1 wasm with hooks, lekhcore `4140fd244e43`, line aggregator `owner-real-2026-10-17`), plus the harness-only `settle({ images })` option of the box run (P2, `oracle-settle.diff`).
  - TS: lekhboardwebapp `62a9647`, compiled from lekhjs `c409690`.
  - Both builds use `VITE_LEKH_TEST_ANY_HOST=1` and are built by `parity/bench/build-device-bench.mjs`.
- **Where it ran.** It ran in the **app's WKWebView**, not in Safari. The host was a Debug build of lekhios `98c8e5a` (dev bundle, `devapi.lekh.app`). A temporary, uncommitted `capacitor.config.json` `server.url` pointed the app at the bench server on the Mac over the LAN, and `setKeepAwake` kept the screen on.
  - Safari, the plan's device browser, could not be used: the phone's Auto-Lock suspends the tab, and Safari's Web Inspector is off.
  - Both web builds ran as platform `web` inside the WebView, with the native bridge hidden from their iframes.
  - The page is not cross-origin isolated (plain HTTP on a LAN address), so WebKit's `performance.now()` has 1 ms resolution. Hit tests are timed in batches of 200 and recognizer cases as the mean of 5 repeats (§3.2.5).
- **Procedure.** One app launch, and so a fresh WebView content process, per engine and run. Each launch made one discarded warm-up pass and then one measured pass. Launches were interleaved C++, TS, TS, C++, … with 5 runs per engine, and 30 s idle between launches instead of 3 minutes.
  - A launch whose content process was terminated is counted as a failed run (`cpp_fail`). Capacitor reloads the page after a termination, and the harness detects the reload.
  - The tables come from `parity/bench/verdict.mjs`: per run p95, the metric is the median of the per-run p95s, with the A/A margin.

## T21: P-01 load + first frame, P-02 pan/zoom frame, P-03 hit test (C++ web vs TS web, same device)

| Metric          | Set                | C++ p95         | TS p95        | Ratio  | Verdict                                    |
| --------------- | ------------------ | --------------- | ------------- | ------ | ------------------------------------------ |
| P-01            | S-syn/basic/300    | 198 ms          | 152 ms        | 0.77   | pass                                       |
| P-02            | S-syn/basic/300    | 48 ms           | 2 ms          | 0.04   | pass                                       |
| P-01            | S-syn/basic/685    | 334 ms          | 217 ms        | 0.65   | pass                                       |
| P-02            | S-syn/basic/685    | 101 ms          | 2 ms          | 0.02   | pass                                       |
| P-01            | S-syn/basic/1500   | cpp_fail        | 354 ms        | —      | cpp_fail; TS ≤ 10 s                        |
| P-02            | S-syn/basic/1500   | cpp_fail        | 4 ms          | —      | cpp_fail                                   |
| P-03 near       | S-syn/basic/1500   | 2.4 ms/call     | 0.01 ms/call  | ≈0.004 | pass (C++ from 2 P-03-only launches)       |
| P-03 connection | S-syn/basic/1500   | 0.90 ms/call    | 0.01 ms/call  | ≈0.01  | pass (C++ from 2 P-03-only launches)       |
| P-01            | S-syn/basic/5000   | cpp_fail        | 810 ms        | —      | cpp_fail; TS ≤ 10 s                        |
| P-02            | S-syn/basic/5000   | cpp_fail        | 13 ms         | —      | cpp_fail                                   |
| P-03 near       | S-syn/basic/5000   | 8.4–9.0 ms/call | 0.01 ms/call  | ≈0.001 | pass (C++ from 2 P-03-only launches)       |
| P-03 connection | S-syn/basic/5000   | 3.4–3.6 ms/call | 0.02 ms/call  | ≈0.006 | pass (C++ from 2 P-03-only launches)       |
| P-01            | S-syn/diagram/685  | 419 ms          | 276 ms        | 0.66   | pass                                       |
| P-02            | S-syn/diagram/685  | 165 ms          | 3 ms          | 0.02   | pass (C++ halves differ by more than 10 %) |
| P-01            | S-syn/diagram/1500 | cpp_fail        | 422 ms        | —      | cpp_fail; TS ≤ 10 s                        |
| P-02            | S-syn/diagram/1500 | cpp_fail        | 6 ms          | —      | cpp_fail                                   |
| P-03 near       | S-syn/diagram/1500 | cpp_fail        | 0.01 ms/call  | —      | cpp_fail                                   |
| P-03 connection | S-syn/diagram/1500 | cpp_fail        | 0.01 ms/call  | —      | cpp_fail                                   |
| P-01            | S-syn/image/300    | 196 ms          | 172 ms        | 0.88   | pass                                       |
| P-02            | S-syn/image/300    | 46 ms           | 2 ms          | 0.04   | pass                                       |
| P-01            | S-syn/image/1500   | 714 ms          | 386 ms        | 0.54   | pass (C++ 2 of 5 launches completed)       |
| P-02            | S-syn/image/1500   | 236 ms          | 4 ms          | 0.02   | pass (C++ 2 of 5)                          |
| P-03 near       | S-syn/image/1500   | 2.73 ms/call    | 0.01 ms/call  | 0.004  | pass (C++ 2 of 5)                          |
| P-03 connection | S-syn/image/1500   | 0.98 ms/call    | 0.01 ms/call  | 0.01   | pass (C++ 2 of 5)                          |
| P-01            | S-syn/ink/685      | 558 ms          | 205 ms        | 0.37   | pass                                       |
| P-02            | S-syn/ink/685      | 135 ms          | 3 ms          | 0.02   | pass (C++ halves differ by more than 10 %) |
| P-01            | S-syn/ink/1500     | 1,275 ms        | 353 ms        | 0.28   | pass                                       |
| P-02            | S-syn/ink/1500     | 283 ms          | 4 ms          | 0.01   | pass                                       |
| P-03 near       | S-syn/ink/1500     | 2.65 ms/call    | 0.015 ms/call | 0.006  | pass                                       |
| P-03 connection | S-syn/ink/1500     | 0.82 ms/call    | 0.01 ms/call  | 0.01   | pass                                       |

- **TS.** TS completed every launch (50 of 50). Every row that can be compared passes, and every TS load is under the 10 s ceiling.
- **C++.** The C++ web build ended the WebView content process in these launches:
  - basic/1500: 5 of 5;
  - basic/5000: 5 of 5;
  - diagram/1500: 5 of 5;
  - image/1500: 3 of 5.

  The crashes happened during the pan/zoom path (P-02). Probe launches with only P-01 and P-02 still crashed (basic/1500 and basic/5000, 2 of 2 each). Launches with only P-03 completed, and those give the C++ P-03 values above.

- **P-02 measures different things.** On both builds P-02 is the synchronous `drawFrame()` time, as on the box. The TS value is small because TS paints by canvas transform and culls before drawing. These are not rAF intervals.

## DEV-70: recognition time per stroke (AC-REC-29, AC-REC-31), recognizer corpus, 362 cases (326 ordinary, 36 pathological)

How each engine was timed:

- **TS.** The production recognition worker chunk of the TS build (line aggregator `lekh-line-merger-1`, the owner's `LineMerger.js`) received one job per case, with the snapshot the page client builds. The metric is the worker's `timings.recognizeMs`.
- **C++.** The C++ build's `__lekhTest.recognizeStroke` runs synchronously on the main thread. Its time includes the board load and redraw, so the same call with a one-point stroke was subtracted as hook overhead.
- **Runs.** 5 runs per engine, each in its own launch.

| Measure                                   | C++               | TS                          | Ratio | Bar                       | Verdict  |
| ----------------------------------------- | ----------------- | --------------------------- | ----- | ------------------------- | -------- |
| p95 per stroke, ordinary cases (326)      | 6.8 ms (hook 7.0) | 169.8 ms                    | 25.0  | TS ≤ C++ (+10 % with DR)  | **fail** |
| p95 per stroke, pathological sets (36)    | 23.6 ms           | 508.4 ms                    | 21.5  | —                         | —        |
| max, pathological sets                    | 28.8 ms           | 665 ms (worker total)       | —     | ≤ 300 ms (AC-REC-31, Tab) | **fail** |
| jobs over the 1,500 ms watchdog           | —                 | 0 of 1,810                  | —     | 0                         | pass     |
| worker cold start, `new Worker` → `ready` | —                 | median 707 ms, max 1,301 ms | —     | ≤ 1.5 s                   | pass     |

- **Errors.** No case failed on either engine.
- **Cause.** The gap matches known issue R5 (handover-to-native §8.1.4).
  - A Node CPU profile of the TS corpus run on the Mac puts about 67 % of the time in `LineMerger.js`'s lowered private-field helper (`__privateAdd`, a WeakMap or WeakSet insertion per object), and 11 % in GC.
  - `LineMerger.js` was left byte-identical.
  - The ratio was similar on the Mac: about 20× in WebKit and Node.
- **Cold start includes the LAN fetch.** The cold start loads the worker script from the Mac. In the app, the script comes from the bundle, through the inline blob worker.

## DEV-71: main-thread cost per stroke (AC-REC-30)

Setup:

- The TS web build ran in the app WebView, with lekhcore test board `ipad-flowchart.lekh` in SmartDraw.
- Each launch drew 80 synthetic Pointer Events strokes (box, zigzag, loop, arrow) over its shapes after 5 warm-up strokes, as `e2e/perf/recognizer-mainthread.spec.js` does.
- Each result was undone, so the board stayed at 12 objects.
- There were 3 launches.

| Measure                                          | Result (3 launches)                                | Bar                  | Verdict                                        |
| ------------------------------------------------ | -------------------------------------------------- | -------------------- | ---------------------------------------------- |
| main-thread cost p95 (snapshot + post + apply)   | 5 / 5 / 5 ms (dispatch p95 2–3 ms, apply p95 3 ms) | ≤ 4 ms               | **fail** (1 ms over, at 1 ms timer resolution) |
| main-thread cost max                             | 7 / 18 / 9 ms                                      | —                    | —                                              |
| main-thread blocking attributable to recognition | 0 gaps > 30 ms in a 10 ms interval probe           | no long task > 50 ms | pass                                           |
| pointerup → result applied, p50 / p95            | 34–36 / 65–67 ms                                   | ≤ wasm p95 + 16 ms   | no C++ value                                   |
| ink-only fallbacks (watchdog, crash, disabled)   | 0 of 240                                           | 0                    | pass                                           |

WebKit has no `longtask` entries, so main-thread blocking was read from an interval probe.

## Not run, and why

| Item                                                     | Why                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| T21 in Safari (the plan's device browser)                | The phone's Auto-Lock suspends Safari, and its Web Inspector is off. With Auto-Lock set to Never, `bench.html` runs in Safari as is.                  |
| DEV-74 (`slow_frames` / `input_stalls_over_1s` vs 3.5.9) | Needs the C++ 3.5.9 native app on the same device (App Store or TestFlight, not the dev TS build installed here) and a scripted session in both apps. |
| DEV-57 / AC-EXP-07 (60 MP PNG)                           | An iPad 6th gen row.                                                                                                                                  |
| P-06 stroke end → shape vs wasm                          | The C++ web build has no worker. Its recognition runs inside the pointerup handler, so there is no C++ counterpart in this harness.                   |
| Planned devices                                          | iPad 6th gen (iPadOS 17) and Galaxy Tab A7 Lite (floors, gating); Tab A9/A9+, iPad 9th gen, S24/S25 Ultra and an Apple-silicon Mac (information).     |
