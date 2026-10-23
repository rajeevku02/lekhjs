# Android device performance on a Galaxy Tab S6 Lite (NA4 perf android, T21 / DEV-70 / DEV-71 / L-06a), results

Verification 03 §4.3 (T21) and §5 (L-06a), verification 06 §O (DEV-70, DEV-71), spec 07 §7.6. The Android counterpart of [`../iphone8-perf-2026-10-22/results.md`](../iphone8-perf-2026-10-22/results.md) and [`../iphone8-perf-2026-10-22-linemerger/results.md`](../iphone8-perf-2026-10-22-linemerger/results.md), with the same method, metrics, bars and reduction. The lines are aggregates only: synthetic boards (S-syn from `parity/bench/synth.mjs`), the synthetic recognizer corpus (`test/recognizer/corpus`, 362 cases) and lekhcore test board `ipad-flowchart.lekh`. There are no user content, ids or accounts.

## Run, 2026-10-22 evening to 2026-10-23 (agent, on the owner's Mac and tablet over USB)

- **Device.** Samsung Galaxy Tab S6 Lite Wi-Fi (SM-P610), Android 13 (API 33, build `P610XXS7FYD1`, security patch 2025-04-01), Android System WebView 155.0.8059.43. Exynos 9611 (4 × Cortex-A73 at 2.3 GHz + 4 × Cortex-A53), 4 GB RAM (3.8 GB visible; about 1.2 GB of swap in use during the C++ runs).
  - Battery 50–68 %, charging over USB the whole time; battery 27–29 °C; thermal status 0 (none) at every launch; AP sensor 28–37 °C. Up 2 days, not rebooted before the run. The screen stayed on through the existing "stay awake while plugged in" setting (unchanged; no device setting was changed).
  - **Not a perf device in the plan.** The Android floor is the Galaxy Tab A7 Lite; the S6 Lite is in the verification 06 roster as a low/mid device for the S Pen rows (DEV-24, DEV-72), not for DEV-70/71/73. These numbers are **information, not the G3 gate**.
  - **Class against the floor.** The Tab A7 Lite's Helio P22T has eight Cortex-A53 cores and no big cores; the S6 Lite's Cortex-A73 cores are roughly 1.5–2× faster single-threaded, with the same 4 GB class of memory (the A7 Lite has 3 GB). Single-thread work (the recognizer, `drawFrame`, `loadDoc`) should be expected to be about that much slower on the floor; ratios TS/C++ on the same device should carry over better than absolute times.
- **Builds.**
  - C++: lekhboardwebapp `fa71c40` (the owner's H-ROL-1 wasm with hooks, lekhcore `4140fd244e43`, line aggregator `owner-real-2026-10-17`) plus the harness-only `settle({ images })` option — a byte-identical copy of the bundle the iPhone runs used.
  - TS: lekhboardwebapp `62a9647` with the six board files lekhboard-capacitor `cecbccf` changed since that webapp commit's `cp_web` (`BoardHost.ts`, `PointerSource.ts`, `CanvasLayer.ts`, `CxSwitch.tsx`, `CxText.tsx`, `WidgetFrame.tsx`; copied into a scratch export, not into the repository), compiled from lekhjs `eda0f75` (its `src/` is `853e7e6`). `src/recognizer/lines/LineMerger.js` is the owner's file, byte-identical (sha256 `341422a5…`). The worker chunk (`recognizer.worker-22b8f935.js`, and the identical inline blob worker) has 73 private-name references and no `WeakMap`.
  - Both use `VITE_LEKH_TEST_ANY_HOST=1` and `devapi.lekh.app` (checked in the bundles).
- **Where it ran.** In the **Lekh app's Android System WebView**, not in Chrome. The host was a debug build of lekhandroid `f9d3d7c9` with two temporary, uncommitted lines (reverted after the build; `git status` clean): `CapActivity` `setServerUrl("http://127.0.0.1:4016/go")` and `usesCleartextTraffic`. The URL is a trampoline on the Mac (over `adb reverse`) that `location.replace`s to the bench page on `http://127.0.0.1:4006` (also `adb reverse`), so no LAN is involved.
  - Both web builds ran as platform `web` in their iframes: the WebView's `androidBridge` (put on every frame by `addJavascriptInterface`) is removed before the build's scripts run. The two builds' third-party analytics tags were stripped from the bench copies of `index.html`. No timed code changed.
  - The page is served with COOP/COEP but the WebView does **not** make it cross-origin isolated (`crossOriginIsolated` false), so `performance.now()` has 0.1 ms resolution. Hit tests are timed in batches of 200 and recognizer cases as the mean of 5 repeats, as on the iPhone.
  - No devtools were attached during timed launches. WebView debugging was used only for L-06a (untimed).
- **Procedure.** One app launch per engine and run (`am force-stop`, then `am start`; so a fresh app and WebView renderer process each time). Each launch made one discarded warm-up pass and then one measured pass. Launches were interleaved C++, TS, TS, C++, … with 20 s idle between launches. A launch whose app process died before posting would count as a failed run (`cpp_fail`): an unhandled WebView renderer crash ends the app on Android.
  - **Fewer C++ runs on the big boards.** The C++ build's per-pass time grows with the board (basic/685: about 3 min; basic/1500: about 8 min; basic/5000: about 27 min; mostly P-02's 300 synchronous `drawFrame()` calls and the paints between them). At 5 runs the 1,500- and 5,000-object boards alone would have taken about 15 hours, so the C++ runs were cut to **3 on the 1,500-object boards and 2 on basic/5000** (TS stayed at 5), still interleaved (C++, TS, TS, C++, TS, TS, C++, TS). Every verdict below is far from a boundary (ratios ≤ 0.6 against a margin of a few %), so the cut does not change one.
  - The tables come from `parity/bench/verdict.mjs`: per run p95, the metric is the median of the per-run p95s, with the A/A margin.

## T21: P-01 load + first frame, P-02 pan/zoom frame, P-03 hit test (C++ web vs TS web, same device)

The iPhone 8 column is the TS/C++ ratio from the iPhone file (`cpp_fail` where the C++ build ended the WebView content process there).

| Metric          | Set                | C++ p95      | TS p95        | Ratio | Runs C++ / TS | Verdict                                    | iPhone 8 ratio |
| --------------- | ------------------ | ------------ | ------------- | ----- | ------------- | ------------------------------------------ | -------------- |
| P-01            | S-syn/basic/300    | 403 ms       | 247 ms        | 0.61  | 5 / 5         | pass                                       | 0.77           |
| P-02            | S-syn/basic/300    | 175 ms       | 2.9 ms        | 0.02  | 5 / 5         | pass                                       | 0.04           |
| P-01            | S-syn/basic/685    | 895 ms       | 420 ms        | 0.47  | 5 / 5         | pass                                       | 0.65           |
| P-02            | S-syn/basic/685    | 366 ms       | 5.4 ms        | 0.01  | 5 / 5         | pass                                       | 0.02           |
| P-01            | S-syn/basic/1500   | 2,248 ms     | 683 ms        | 0.30  | 3 / 5         | pass                                       | cpp_fail       |
| P-02            | S-syn/basic/1500   | 726 ms       | 9.9 ms        | 0.01  | 3 / 5         | pass                                       | cpp_fail       |
| P-03 near       | S-syn/basic/1500   | 7.11 ms/call | 0.037 ms/call | 0.005 | 3 / 5         | pass                                       | ≈0.004         |
| P-03 connection | S-syn/basic/1500   | 2.01 ms/call | 0.039 ms/call | 0.02  | 3 / 5         | pass                                       | ≈0.01          |
| P-01            | S-syn/basic/5000   | 5,730 ms     | 1,571 ms      | 0.27  | 2 / 5         | pass; TS ≤ 10 s                            | cpp_fail       |
| P-02            | S-syn/basic/5000   | 2,429 ms     | 27.5 ms       | 0.01  | 2 / 5         | pass                                       | cpp_fail       |
| P-03 near       | S-syn/basic/5000   | 19.6 ms/call | 0.048 ms/call | 0.002 | 2 / 5         | pass                                       | ≈0.001         |
| P-03 connection | S-syn/basic/5000   | 7.83 ms/call | 0.093 ms/call | 0.01  | 2 / 5         | pass                                       | ≈0.006         |
| P-01            | S-syn/diagram/685  | 1,154 ms     | 575 ms        | 0.50  | 5 / 5         | pass                                       | 0.66           |
| P-02            | S-syn/diagram/685  | 473 ms       | 6.3 ms        | 0.01  | 5 / 5         | pass                                       | 0.02           |
| P-01            | S-syn/diagram/1500 | 2,424 ms     | 951 ms        | 0.39  | 3 / 5         | pass                                       | cpp_fail       |
| P-02            | S-syn/diagram/1500 | 980 ms       | 10.4 ms       | 0.01  | 3 / 5         | pass                                       | cpp_fail       |
| P-03 near       | S-syn/diagram/1500 | 24.3 ms/call | 0.029 ms/call | 0.001 | 3 / 5         | pass                                       | cpp_fail       |
| P-03 connection | S-syn/diagram/1500 | 1.64 ms/call | 0.033 ms/call | 0.02  | 3 / 5         | pass                                       | cpp_fail       |
| P-01            | S-syn/image/300    | 462 ms       | 281 ms        | 0.61  | 5 / 5         | pass                                       | 0.88           |
| P-02            | S-syn/image/300    | 170 ms       | 3.3 ms        | 0.02  | 5 / 5         | pass                                       | 0.04           |
| P-01            | S-syn/image/1500   | 2,377 ms     | 721 ms        | 0.30  | 3 / 5         | pass (C++ halves differ by more than 10 %) | 0.54           |
| P-02            | S-syn/image/1500   | 706 ms       | 9.5 ms        | 0.01  | 3 / 5         | pass                                       | 0.02           |
| P-03 near       | S-syn/image/1500   | 7.03 ms/call | 0.033 ms/call | 0.005 | 3 / 5         | pass                                       | 0.004          |
| P-03 connection | S-syn/image/1500   | 2.17 ms/call | 0.040 ms/call | 0.02  | 3 / 5         | pass                                       | 0.01           |
| P-01            | S-syn/ink/685      | 1,340 ms     | 443 ms        | 0.33  | 5 / 5         | pass                                       | 0.37           |
| P-02            | S-syn/ink/685      | 376 ms       | 5.2 ms        | 0.01  | 5 / 5         | pass                                       | 0.02           |
| P-01            | S-syn/ink/1500     | 2,837 ms     | 825 ms        | 0.29  | 3 / 5         | pass                                       | 0.28           |
| P-02            | S-syn/ink/1500     | 769 ms       | 10.0 ms       | 0.01  | 3 / 5         | pass                                       | 0.01           |
| P-03 near       | S-syn/ink/1500     | 6.57 ms/call | 0.049 ms/call | 0.007 | 3 / 5         | pass                                       | 0.006          |
| P-03 connection | S-syn/ink/1500     | 1.55 ms/call | 0.038 ms/call | 0.02  | 3 / 5         | pass                                       | 0.01           |

- **Every row passes**, and every TS load is under the 10 s ceiling (largest 1.6 s, basic/5000). The A/A margins are 2–9 % (16.5 % for C++ P-01 on image/1500, whose two halves differ by more than 10 %; at a ratio of 0.30 a repeat cannot change the verdict).
- **No C++ crash.** All 89 launches completed (C++ 39 of 39, TS 50 of 50), including the four boards on which the iPhone 8's WKWebView content process died during the C++ pan/zoom path (basic/1500, basic/5000, diagram/1500, image/1500). The C++ renderer reached about 560 MB resident on basic/1500, with about 1.2 GB of the tablet's swap in use.
- **Frames over 50 ms** (the `slow_frames` threshold) in P-02: C++ 300 of 300 on every board and run; TS 0 on every board except basic/5000 (3–4 of 300 per run).
- **P-02 measures different things**, as on the iPhone and the box: both values are the synchronous `drawFrame()` time; TS paints by canvas transform and culls before drawing. These are not rAF intervals.

## DEV-70: recognition time per stroke (AC-REC-29, AC-REC-31), recognizer corpus, 362 cases (326 ordinary, 36 pathological)

The engines were timed as on the iPhone: the TS worker's `timings.recognizeMs` per job (the production worker chunk, line aggregator `lekh-line-merger-1`, the owner's `LineMerger.js`), and the C++ `__lekhTest.recognizeStroke` minus the one-point-stroke hook overhead. 5 runs per engine, each in its own launch, interleaved; each case is the mean of 5 repeats.

| Measure                                   | C++                 | TS                        | Ratio | Bar                                 | Verdict  | iPhone 8 (after LineMerger) |
| ----------------------------------------- | ------------------- | ------------------------- | ----- | ----------------------------------- | -------- | --------------------------- |
| p95 per stroke, ordinary cases (326)      | 11.5 ms (hook 11.9) | 16.6 ms                   | 1.45  | TS ≤ C++ (+10 % with DR)            | **fail** | TS 9.2 / C++ 5.8 ms, 1.59   |
| p95 per stroke, pathological sets (36)    | 40.2 ms             | 49.6 ms                   | 1.23  | —                                   | —        | 26.4 / 20.8 ms, 1.27        |
| p95 per stroke, all cases (362)           | 23.2 ms             | 26.4 ms                   | 1.14  | —                                   | —        | 14.2 / 12.0 ms, 1.18        |
| max, pathological sets                    | 46.0 ms             | 69.0 ms (worker total)    | —     | ≤ 300 ms (AC-REC-31, floor A7 Lite) | pass     | 35 ms                       |
| jobs over the 1,500 ms watchdog           | —                   | 0 of 1,810                | —     | 0                                   | pass     | 0 of 1,810                  |
| worker cold start, `new Worker` → `ready` | —                   | median 581 ms, max 617 ms | —     | ≤ 1.5 s                             | pass     | median 602 ms, max 731 ms   |

- **Per-run TS p95, ordinary cases.** 16.5, 16.8, 16.6, 16.8 and 16.5 ms. **Per-run C++ p95.** 12.1, 11.7, 11.5, 11.4 and 11.5 ms. The A/A margin is 2 %.
- **Errors.** No case failed on either engine; no job exceeded the budget.
- **Round trip.** TS post → result p95 is 19.4 ms on ordinary cases.
- **The gap is the same shape as on the iPhone.** TS is 1.45× C++ on ordinary strokes (iPhone 1.59×) and 1.23× on the pathological sets (1.27×), so DEV-70's "TS ≤ C++" row still fails, by more than the 10 % a DR-PERF entry could accept. The pathological maximum (69 ms) is well under the 300 ms bar; on a floor about 1.5–2× slower it would still be about 105–140 ms.
- **Charger.** DEV-70 asks for the charger off; the tablet charged over USB throughout (thermal status 0 at every launch).
- **Cold start includes the fetch** of the worker script from the Mac over `adb reverse`. In the app, the script comes from the bundle, through the inline blob worker.

## DEV-71: main-thread cost per stroke (AC-REC-30)

The setup was the same as on the iPhone: the TS web build in the app WebView, lekhcore test board `ipad-flowchart.lekh` in SmartDraw, 80 synthetic Pointer Events strokes after 5 warm-up strokes, each result undone, 3 launches. Chromium reports `longtask` entries, so blocking was read from them as well as from the 10 ms interval probe.

| Measure                                          | Result (3 launches)                                                | Bar                  | Verdict      | iPhone 8 (after LineMerger) |
| ------------------------------------------------ | ------------------------------------------------------------------ | -------------------- | ------------ | --------------------------- |
| main-thread cost p95 (snapshot + post + apply)   | 8.4 / 7.7 / 9.1 ms (dispatch p95 2.4–2.7 ms, apply p95 6.1–7.1 ms) | ≤ 4 ms               | **fail**     | 9 / 9 / 8 ms                |
| main-thread cost max                             | 10.0 / 9.6 / 10.9 ms                                               | —                    | —            | 13 / 11 / 12 ms             |
| main-thread blocking attributable to recognition | 0 long tasks; probe gaps > 30 ms: 5 / 3 / 3, max 40 ms             | no long task > 50 ms | pass         | inconclusive (1 s gaps)     |
| pointerup → result applied, p50 / p95            | 23.2–24.5 / 33.7–38.6 ms                                           | ≤ wasm p95 + 16 ms   | no C++ value | 23–25 / 31–34 ms            |
| ink-only fallbacks (watchdog, crash, disabled)   | 0 of 240                                                           | 0                    | pass         | 0 of 240                    |

- **The apply half dominates** (p95 6–7 ms of the 8–9 ms), as on the iPhone's second run. The main-thread path does not run `LineMerger.js`.
- **No timer throttling here.** The ~1 s probe gaps seen on the iPhone did not occur (largest gap 40 ms, no long task at all), so this run gives a clean reading of the blocking row; the cost row fails on both devices at about 2× the bar.

## L-06(a): recognition worker memory over 1,000 strokes (AC-REC-32, spec 07 §7.6 memory row)

The production recognition worker of the TS build in the app WebView, strokes from S-rec (the corpus cycled), one at a time. Garbage was collected twice through CDP (`HeapProfiler.collectGarbage`, worker and page) before each `Runtime.getHeapUsage`. This ran untimed, with WebView debugging attached over `adb forward`, after the timed runs.

| Warm-up                       | Worker heap after warm-up | After 1,000 strokes | After 2,000      | After 3,000      | Page heap change | Bar (worker ≤ +5 %, page no growth) | Verdict             |
| ----------------------------- | ------------------------- | ------------------- | ---------------- | ---------------- | ---------------- | ----------------------------------- | ------------------- |
| 362 strokes (one corpus pass) | 4.21 MB                   | 4.32 MB (+2.5 %)    | 4.35 MB (+3.2 %) | 4.37 MB (+3.6 %) | +10 KB (1.98 MB) | pass                                | pass                |
| 50 strokes                    | 3.42 MB                   | 4.27 MB (+24.7 %)   | —                | —                | +10 KB           | —                                   | (warm-up too short) |

- The 50-stroke warm-up has not met every corpus scene yet, so its growth is mostly cache filling; once every scene has been seen, the growth is 2.5 % over 1,000 strokes and slows down (+0.8 %, then +0.4 % per further 1,000). 0 errors, 0 jobs over 1,500 ms.
- The bar's instrument is Chromium's CDP heap; this is the Android WebView's, so the same instrument.

## Comparison with the iPhone 8

- **Absolute speed.** On this tablet single-threaded work is about 1.5–2× slower than on the iPhone 8 (A11), and the C++ frame path up to 3.6×: TS load 247 vs 152 ms (basic/300) and 1,571 vs 810 ms (basic/5000); TS recognition p95 16.6 vs 9.2 ms; C++ recognition 11.5 vs 5.8 ms; C++ P-02 175 vs 48 ms (basic/300).
- **Ratios carry over.** TS/C++ ratios are close on both devices: T21 load 0.27–0.61 here vs 0.28–0.88, frames and hit tests ≈ 0.001–0.02 on both; recognition 1.45 vs 1.59 (ordinary) and 1.23 vs 1.27 (pathological). The verdicts are the same: T21 passes everywhere, DEV-70's TS ≤ C++ row and DEV-71's ≤ 4 ms row fail, the other DEV-70/71 rows pass.
- **Stability.** The C++ web build ended the iPhone's WKWebView content process on four boards; on this tablet (4 GB RAM, Chromium) it completed every launch.

## Not run, and why

| Item                                                                       | Why                                                                                                                     | What the owner must do                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The floor device (Galaxy Tab A7 Lite)                                      | Not available; this is the gate (H-REC-4)                                                                               | Provide the A7 Lite (Android 11, WebView ≥ 111); the same harness runs unchanged (expect C++ big-board launches of an hour or more)              |
| T21 in Chrome (the plan's device browser)                                  | Time: the WebView run took about 10 hours, almost all of it the C++ build on the big boards                             | None needed for information; for the gate, `adb reverse tcp:4006 tcp:4006` and `http://localhost:4006/bench.html?lekhtest=1` in Chrome run as is |
| C++ runs 4–5 on the 1,500-object boards and 3–5 on basic/5000              | Time (see Procedure); every verdict is far from a boundary                                                              | —                                                                                                                                                |
| P-02 rAF-paced variant, P-07a/b export, P-09 long tasks during interaction | Not in the device bench (`parity/bench/page/bench.js` runs P-01–P-03 only)                                              | — (agent work: add them to the bench first)                                                                                                      |
| L-06(b) (forced worker crashes and watchdog fires)                         | Needs the crash and watchdog test hooks in a device page; not built for the device                                      | —                                                                                                                                                |
| DEV-74 (`slow_frames` / `input_stalls_over_1s` vs 3.5.9)                   | Needs the C++ 3.5.9 Android app on the same device and a scripted session in both apps                                  | Install the Play 3.5.9 release beside a TS build (different signing) or on a second identical device                                             |
| P-06 stroke end → shape vs wasm                                            | The C++ web build has no worker (recognition runs inside its pointerup handler), so this harness has no C++ counterpart | —                                                                                                                                                |
| DEV-72 (Android recognition cases M-R1…M-R5 on the Tab S6 Lite)            | A manual owner check, not a perf row                                                                                    | Owner, on this tablet                                                                                                                            |

## Tablet state after the run

- The normal Lekh debug app (lekhandroid `f9d3d7c9`, no bench redirect, its own bundled dev pages) is installed and launches to its sign-in screen.
- The bench origins' storage was cleared from the app's WebView profile. `adb` forwards and reverses are removed. No device setting was changed (screen timeout 30 min and "stay awake while plugged in" as found).
- Battery at the end 68 %, thermal status 0.
