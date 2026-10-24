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
