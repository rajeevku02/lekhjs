# Export suite fixes (owner round EX2), follow-up run, 2026-10-24

Fixes of Work `01M4X7TCHFB862XGT68GPY071C`, task EX2, for the failures of
`web-export-2026-10-23`, `android-export-2026-10-23`, `ios-export-2026-10-23` and
`mac-export-2026-10-24`. Builds: lekhjs `0ca8294`, lekhboard-capacitor `becb400`+`d7432fd`
(HEAD `d7432fd`), lekhios `bebe202`, lekhandroid `a967b445`. Aggregates only.

| Fix | What | Hosts verified | Result |
|---|---|---|---|
| 1 | One `last_export_params` for the board panel and the doc list (EXP-09) | Mac, web | pass |
| 2 | A face fontkit cannot draw no longer fails the PDF; Mac getFontData hands out a face with outlines; error dialog details (EXP-30, EXP-45) | Mac | pass |
| 3 | A failed board's files are not handed off by a folder export (EXP-36) | Mac, web | pass |
| 4 | Android getFontData ranks family and static faces first; a TrueType variable font at its default instance is embedded (EXP-45) | unit tests only | tablet not connected |
| 5 | Cap counter and usage event at presentation | Mac | pass |
| 6 | Android raster encode with `toDataURL` | web (no regression) | tablet not connected |
| 7 | "Preparing fonts…" instead of "Downloading fonts (0.0 MB)…"; one read per font file | Mac (text) | tablet not connected for timings |

## Mac (MacBook Pro M4, macOS 15.6, Mac Catalyst Debug, dev-configured)

Built in a copy of the lekhios working tree (HEAD `bebe202` plus the owner's uncommitted
deployment-target change), bundle id `com.avabodh.lekh.natest`, ad-hoc signed, with a fresh dev
web bundle (lekhboard-capacitor `d7432fd` + lekhjs `0ca8294`, `apiUrl` devapi.lekh.app, `appUrl`
devdocs.lekh.app) and the command-file harness in the copy only. The screen was locked for the
whole run, so the save / move panels could not be pressed through the Accessibility API; each
export was checked from the files the app handed to `shareFiles` (`tmp/export/<job>/`) and the app
was quit to close the panel.

- EXP-09: a value left in the WebView's `localStorage` by the earlier build (PNG x1 Full Page) was
  moved into the empty native store on the first read and removed from `localStorage`; the doc-list
  popup opened with it. Doc list JPEG x3 Full Page 35, background on → Export → the board panel
  opened at JPEG x3 Full Page, background on. Board panel PNG x2 Drawing Area 12 → Export → the doc
  list opened at PNG x2 Drawing Area. Pass.
- EXP-30: export-matrix PDF, 3 pages: suite checker 0 FAIL (all PASS); Han and kana extractable,
  embedded `HiraginoSansGB-W3`, `AppleSDGothicNeo-Regular`, `GeezaPro`, `KohinoorDevanagari-Regular`
  (before: "An unexpected error occurred while exporting", no file). The fonts phase read
  "Preparing fonts…" for about 12 ms.
- EXP-45 (scripts.lekh PDF): Han, Japanese, Korean, Arabic and Devanagari all extractable. Pass.
- EXP-36: folder (suite + matrix) PDF → 2 files handed off, 7 and 3 pages, both valid. With a
  failure injected in the first board (export-large PNG x2: `getImageData` throws on the second
  band), the hand-off held only the other board's 7 PNGs, no file of the failed board. Pass.
- Fix 5: on-device board, `subscription_expires_at` 0: `num_offline_export_done` was 1 while the
  save panel was still up (before: written only when the panel closed). Settings restored.
- Observation (as in the Mac run): an export started while the "Export Limitations" notice is up
  (shown about 800 ms after a capped user opens an on-device board) never shows its panel and the
  modal stays at "Saving…". Through the real UI the notice is modal, so the export button cannot be
  reached under it; not fixed.

## Web (headless Chromium, own vite on a copy of lekhboardwebapp after `make cp_web`, dev backend)

- EXP-09 both ways (board panel → doc list, doc list → board panel). Pass.
- EXP-13 on a cloud board: 7 PNGs, suite checker 26 PASS, 0 FAIL, 310 ms (the web keeps `toBlob`).
- EXP-36 with the same injected failure: 7 files of the good board, then "Error in exporting some
  of the boards.". Pass.
- lekhboardwebapp `v2/test` in the copy: 46 files, 881 passed.

## Not verified on device

The Galaxy Tab S6 Lite and the iPhone 8 were not connected during this run (`adb devices` and the
USB list empty throughout), so fixes 4, 6 and 7 (timings) on Android and fixes 1, 3, 5 on the
iPhone were not run on the devices; they are covered by unit tests only. To do on the tablet: EXP-09,
EXP-36, EXP-45 (Devanagari extractable), a 7-page PNG export (EXP-13) timed, the PDF fonts phase text
and its duration (before: about 25 s).

## iPhone (iPhone 8, iOS 16.7.14, Debug, dev-configured), 2026-10-24, after the EX3 reconcile

Build: lekhboard-capacitor `30111bc` (the six EX2 fix commits rebased onto the owner's EX3
`0f9d4e3`; EX2 fix 1 reduced to a 3 s timeout on the native read, EX3's settings store kept) +
lekhjs `ef460c7`, `vite build` with `apiUrl` devapi.lekh.app / `appUrl` devdocs.lekh.app (no other
backend host in the bundle), in a copy of the lekhios working tree (`bebe202` plus the owner's
uncommitted deployment-target change), the command-file harness in the copy only (as in
`ios-export-2026-10-23`). Native UI could not be tapped: share sheets were screenshotted and ended
by relaunching the app, and the files handed to `shareFiles` were pulled from `tmp/export/<job>/`.
Native calls (`setSetting`, `shareFiles`, `showDialog`, the usage-event POST) were timed by a
wrapper around `Capacitor.toNative` in the WebView. Aggregates only.

| Fix / case | Result | Evidence |
|---|---|---|
| 1, EXP-09 board panel → doc list | pass | The native store started empty, and the WebView `localStorage` held an SVG value. The board panel opened with the defaults (PDF, background off): the old WebView value was ignored, as EX3 intends. Then PNG x2 Drawing Area 12 → Export. The native setting held that value while the sheet was still up, and the doc-list popup opened with PNG x2 Drawing Area padding 12. |
| 1, EXP-09 doc list → board panel | pass | The doc list was set to JPEG x3 Full Page 35, background on → Export. After a relaunch, the board panel opened at JPEG x3 Full Page, background on. |
| 3, EXP-36 | pass | The cloud folder held the export-suite board and export-large, and the export was PNG x2. An injected failure (`getImageData` throws on its 2nd call) failed export-large, which was exported first. One share sheet, "Save 7 Images", got only the suite's 7 PNGs: valid, each exactly 2 × the EXP-13 size. No export-large file was handed off or left in `tmp/export`. One `board_exported` event was sent. In a second run, `shareFiles` was answered by the harness, and the app then called the native `showDialog` "Error" / "Error in exporting some of the boards.". |
| 5, board panel | pass | The capped user had `subscription_expires_at` 0, set after launch. A LEKH export from an on-device board wrote `num_offline_export_done` 1 at +56 ms and sent `board_exported` at +58 ms. `shareFiles` was called at +58 ms and still had not resolved 12 s later, with the sheet up. |
| 5, doc list | pass | On-device board, LEKH: the counter went 1 → 2 at +229 ms and the event was sent at +237 ms, both before `shareFiles` (still pending while the sheet was up). |
| EXP-13 (regression) | pass | One share sheet, "Save 7 Images". `suite.mjs check --host ios`: 26 PASS, 0 FAIL. |
| EXP-45 | pass | scripts.lekh PDF with the network cut (`dvt condition` 100 % loss, confirmed from the WebView). Han, Japanese, Korean, Arabic and Devanagari are extractable. Embedded fonts: PingFangSC-Regular, NotoSans-Regular, AppleSDGothicNeo-Regular, GeezaPro, KohinoorDevanagari-Regular. The fonts phase read "Preparing fonts…" (fix 7) for about 0.4 s. |
| 2, error dialog | pass | Injected failure on a board-panel PNG x2 export of export-large. The native dialog text was "An unexpected error occurred while exporting. Please reach out to support with following details:", then `export_internal`, then the detail `TypeError @ <bundle frame>` (no message text). |

- The EX2 fix-1 one-time move of a WebView value into the native store (verified on the Mac above)
  was dropped in the reconcile. On this build an EX1 value in `localStorage` is ignored, as EX3
  specifies.
- iOS 16 kept a SpringBoard "iPhone is not Activated" alert over the app for most of the run. It
  did not block the WebView or the share sheets. The app's own native alerts queue behind it, which
  is why the EXP-36 dialog was read from the `showDialog` call.
- Afterwards the dev-cloud folder and boards were deleted. The on-device fixtures, the export temp
  files and the harness files were removed from the phone. The app's preferences were restored from
  the copy taken before the run, the WebView export key was set back to its recorded value, and a
  Debug build without the harness was installed.

## Galaxy Tab S6 Lite (SM-P610, Android 13, devicePixelRatio 1.5), 2026-10-24, after the EX3 reconcile

Build: debug APK, dev-configured, built in a copy of lekhandroid `a967b445` (`git archive`, so
without the owner's uncommitted bundle files) with a fresh web bundle of lekhboard-capacitor
`30111bc` + lekhjs `ef460c7` (`vite build`, `apiUrl` devapi.lekh.app / `appUrl` devdocs.lekh.app,
no other backend host in the bundle), `./gradlew :lekhDiagram:assembleDebug`, installed with
`install -r` over the previous debug build. Android System WebView 155.0.8059.43, as in the
`android-export-2026-10-23` run (Google Play updated it to 155.0.8059.46 when airplane mode was
turned off after EXP-45; the timings below are all on .43). Driving: CDP on the debug WebView for the
panels, `adb input` / `uiautomator` for the document picker and native dialogs, files saved through
the picker into Downloads and pulled. Native calls (`setSetting`, `shareFiles`, `showDialog`,
`getFontData`, the usage-event POST) were timed by a wrapper around `Capacitor.toNative`, and the
encode calls by a wrapper around `toDataURL` / `toBlob`. For the timed runs no DevTools session
stayed attached: the export was started over CDP, then the session was closed until the file was
saved. Aggregates only.

| Fix / case | Result | Evidence |
|---|---|---|
| 1, EXP-09 board panel → doc list | pass | The native `last_export_params` started empty, and the WebView `localStorage` held an EX1 LEKH value. The board panel opened with the defaults (PDF, background off): the WebView value was ignored. Then JPEG x3 Full Page 35, background on → Export. The native setting held exactly that, and the doc-list popup opened with JPEG, x3, Full Page, background on. |
| 1, EXP-09 doc list → board panel | pass | The doc list was set to PNG x2 Drawing Area 12, background on → Export. The board panel then opened at PNG, x2, Drawing Area, padding 12. |
| 1, Save to gallery | pass | The background setting came from the doc list's native write. Save to gallery on page 2 gave one JPEG in `Pictures/`, 1382 × 827. The ground was #e4f2fd (≈ #e3f2fd), so the background was on. Before EX2 the background was always off. |
| 3, EXP-36 | pass | The cloud folder held export-large and export-suite. Folder → Export → PDF made one `shareFiles` with 2 files and gave one Save (`lekh-export.zip`): export-suite.pdf has 7 pages, export-large.pdf 3 × 2500 × 2000 pt. A second run used PNG x2 with an injected failure (`getImageData` throws on its 2nd call), which failed export-large, the board exported first. One `shareFiles` held only the suite's 7 PNGs, each 2 × the EXP-13 size (± 1 px). One `board_exported` event was sent. Then came the native "Error / Error in exporting some of the boards.". `cache/export` held no file of export-large, only the suite's 7 PNGs and the native zip. |
| 3, several files (EX3 note) | as expected | Android Save zips several files today, but the zip is still named `lekh-export.zip`: TS passes `zipName` (`export-suite.zip`, `zz-agent-test-ex2-android.zip`), and the native side ignores it until its EX3 half lands. Share was not run. |
| 4, EXP-45 | pass | scripts.lekh → PDF, in airplane mode (offline confirmed from the WebView), cold app. Han, Japanese, Korean, Arabic and Devanagari are all extractable. Before, Devanagari was not. Every script is drawn and emoji are images (rendered with pdf.js). Fonts `getFontData` returned: Han and Japanese `NotoSerifCJK-Regular.ttc` #3 (NotoSerifCJKtc-Regular, static); Korean `SamsungKorean-Regular.ttf` (static); Arabic `NotoNaskhArabicUI-Regular.ttf` (static); Devanagari `SECDevanagari-Regular.otf` (static CFF, sans; before: `NotoSerifDevanagari-VF.ttf`). EXP-30 (export-matrix PDF): suite checker 14 PASS, 0 FAIL. |
| 6, EXP-13 timing | pass | PNG x1, all 7 pages, Drawing Area 20 (the settings of the original run). Two runs; in each, the first encode to "Saving…" took about 0.6 s for all 7 pages. Before: about 13 s per page ("Rendering page i of n…"), about 55 s in all. The modal's first text was "Saving…": the pages were done too soon for "Rendering page i of n…" to be seen. `toDataURL` per page: 280–288 ms for 2094 × 2252, 39–66 ms for the next three pages, 15–19 ms for the two small ones, 1 ms for 60 × 60. In the same WebView `toBlob` of 741 × 891 still takes 4.07–4.11 s (`toDataURL` 49–73 ms; before 4.06 s / 142 ms). "Saving…" (writing, native zip, picker) took about 5.3 s, and Export to the file in Downloads about 9.6 s. Suite checker `--host android --dpr 1.5`: 26 PASS, 0 FAIL on both zips. |
| 7, PDF fonts phase | pass | The modal read "Preparing fonts…", never "Downloading fonts (0.0 MB)…". It lasted 4.1 s for scripts.lekh (offline, cold app) and 4.7 s for export-matrix. Before: about 25 s. The `getFontData` calls took 32–59 ms each, except the first of a session (616–627 ms). |
| 5, board panel | pass | Capped: `subscription_expires_at` set to 0. On-device board, LEKH → Export. `num_offline_export_done` was written 1 at +371 ms and `board_exported` was sent at +398 ms. `shareFiles` was called at +399 ms and was still pending with the document picker up, when the native preference already read 1. |
| 5, doc list | pass | On-device board, LEKH: the counter went 1 → 2 at +261 ms and the event was sent at +302 ms. Both came before the picker closed (`shareFiles` still pending). |
| EXP-33 (regression) | pass | The picker was dismissed with Back. `shareFiles` resolved `{handedOff: false}`. There was no dialog, Downloads was unchanged, and the counter stayed at its value (counted once). |
| EXP-13, EXP-40 (regression) | pass | As above. |

- New observation (Samsung fonts): a Han or Japanese run in a Noto Sans box gets the serif,
  Traditional-Chinese face of NotoSerifCJK (`collectionIndex` 3, NotoSerifCJKtc), while the
  screen draws it in Samsung's sans CJK. Two causes. First, Samsung's `fonts.xml` registers
  `SECCJK-Regular.ttc` (sans) and `NotoSerifCJK-Regular.ttc`, not the `NotoSansCJK-Regular.ttc`
  that is in `/system/fonts`, and `FontData.familyScore` decides sans by file name, so SECCJK
  scores no better than the serif face. Second, `scriptLanguage` takes the language from the
  first code point (Han → `zh` for the Japanese line too), and `localeScore` matches only the
  language, so a `zh-Hant` face wins. The text is still extractable, but the glyph style differs
  from the screen. Suspected: lekhandroid `FontData.java` `familyScore` / `scriptLanguage` /
  `localeScore`. Not fixed.
- The doc-list export of the cloud export-suite spent about 4 s in "Preparing…" (the board's
  content fetched from the dev backend); not compared before.
- Afterwards the dev-cloud folder and its two boards were deleted. The on-device fixtures, the
  saved exports (Downloads, Pictures) and the app's `cache/export` were removed. The app's
  preferences (`last_export_params` empty, `subscription_expires_at` and the counter as found),
  `files/` and the WebView's local storage were restored from the copy taken before the run. The
  app was signed out, as found. Airplane mode is off, with Wi-Fi and Bluetooth on as before. No adb
  forwards remain. Restoring the copy with a host-made tar first left the app's data directory
  mode 755 (so `run-as` refused) and macOS `._*` files; the mode was set back to 700 through the
  debug app's JDWP, and the stray files and the other modes were fixed with `run-as`. The
  debug build above is installed and launches to the sign-in screen.
