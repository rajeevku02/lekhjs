# Export manual test suite (EXP)

Owner round EX2, Work `01M4X7TCHFB862XGT68GPY071C`. One suite for every host: the web (Playwright
on the workstation), iOS, Mac Catalyst and Android (the native agent on devices). It refines the
H-EXP-1 device rows of verification 06 (DEV-50, DEV-52…DEV-59) into checkable cases with the
exported file's expected size and content.

| File                         | What it is                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `README.md`                  | this suite: reference behaviour, option matrix, fixtures, the cases, how to check a file  |
| `fixtures/export-suite.lekh` | 7-page synthetic board: every page type, backgrounds, an image, blank and duplicate names |
| `fixtures/export-large.lekh` | 3 fixed pages of 5000 × 4000 points: raster cap and banding                               |
| `expected.json`              | per fixture page: canvas type, `getCanvasSize(true)` and the bounds of all objects        |
| `build.mjs`                  | regenerates the two fixtures and `expected.json` (`--check` verifies them)                |
| `suite.mjs`                  | the file cases as data, the expected files, and a checker (`list`, `check`, `inspect`)    |
| `results-template.md`        | the results sheet to copy per host and build                                              |

Also used: `../fixtures/export-matrix.lekh` (fonts, DEV-52), `../fixtures/scripts.lekh` (DEV-56)
and `../fixtures/export-folder/` (DEV-55).

Results go to `lekhjs/parity/device-checklist/<host>-export-<date>/results.md` (verification 06
§1): one line per case and device, `EXP-id | host | device | OS | build | pass/fail | note`.
Aggregates only: no customer boards, ids, e-mail addresses or board URLs.

## 1. How to run it

1. Load the fixtures (§4) into a test account / onto the device.
2. Walk the cases of §5 in order (some depend on the setting the previous one saved; each case
   says what to set, so a case can also be run alone).
3. For a file case, copy the exported files to the workstation and run the checker from `lekhjs`:

   ```bash
   node parity/device-checklist/export-suite/suite.mjs check EXP-13 --host android --dpr 2.625 \
        --doc export-suite ~/exp/EXP-13/*.png
   ```

   `--host` is `web`, `ios`, `mac` or `android`; `--dpr` is `window.devicePixelRatio` of the
   WebView (Android only: there a raster export is `points × devicePixelRatio × scale`, read it
   in `chrome://inspect` → console). `--doc` is the board name the files are named after (default
   the fixture's, `export-suite` / `export-large` / `export-matrix`). It prints a PASS/FAIL line per
   expectation and exits 1 on any failure; `inspect <files>` prints what a file is (size, PDF pages
   and fonts, SVG root) for a note. Needs `npm install` in `lekhjs` (pdf.js, `@napi-rs/canvas`).

4. Fill in the results sheet (copy `results-template.md`).

On the web the file cases are automated by the root e2e spec `e2e/tests/export-suite-web.spec.js`
(Chromium against a front end and kashi), which uses the same `suite.mjs`.

## 2. Reference behaviour (C++), and where TS differs

All citations are `lekhcore/src/lekh/app/`.

- **Panel** (`viewmanager/ExportViewManager.cpp`). Format PDF, JPEG, PNG, SVG, LEKH (cpp:211).
  Option rows per format (cpp:336-346): PDF Pages, Include Background; JPEG Pages, Image Size,
  Export Region, Include Background; PNG Pages, Image Size, Export Region; SVG Pages, Export
  Region, Include Background; LEKH none (and no "Options" title, cpp:349-352). The Export button
  builds the input, exports and then saves the parameters (cpp:253-257).
- **Pages** (cpp:28-87, 283-304): one switch per page, all on at open (cpp:362-367); the row reads
  `All` when every page is on, `Multiple` for more than one, `page-N` for one. Turning every page
  off selects all of them again (cpp:76-81). Pages are never saved.
- **Export Region** (cpp:89-164, 320-325): `Full Page` / `Drawing Area`; only Drawing Area shows
  "Padding Points", an integer field parsed with `std::stoi` (leading integer; `0` when there is
  none, cpp:149-155).
- **Defaults and memory** (h:51-54, cpp:359-370, 485-573): with no saved setting: PDF, all pages,
  Drawing Area, padding 20, x1, background off. The setting `last_export_params` (format,
  padding, scale, include_background, region) is one per app, written only on Export and read
  each time the panel opens. The doc-list export reads and writes the same setting.
- **Plan** (`ExportInputBuilder.cpp:21-41`): a page that is not infinite, with Full Page or in a
  PDF, is its canvas size (`Page::getCanvasSize(true)`: a fixed page converted to points at
  144 per inch; an auto page the objects' extent plus 64, at least 612 × 792); otherwise (an
  infinite page always; Drawing Area) the bounds of all objects plus the padding on each side.
  So **Export Region and padding do nothing for a fixed or auto page in a PDF, and Full Page does
  nothing for an infinite page; padding still applies to an infinite page in a PDF.**
- **File names** (`ExportInputBuilder.cpp:48-77`): one page → `<board>.<ext>`; several →
  `<board>-<page>.<ext>`, `page<N>` for a blank page name, `-page<N>` appended to a duplicate;
  a blank board name → `drawing`. A PDF or `.lekh` is always one file `<board>.<ext>`.
- **Gallery** (Android, `BoardOptionViewManager.cpp:98-114`, `ExportViewManager.cpp:372-384`):
  the active page, JPEG, Drawing Area, padding 20, x1; the panel's constructor has already loaded
  the saved setting, so Include Background is the saved value (cpp:169-171, 359-370).
- **Read-only board** (`BoardOptionViewManager.cpp:243-245`): the board options list Export only.
- **Free cap** (`ExportInputBuilder.cpp:119-141`): a capped user exports an on-device board 5
  times; the 6th shows "Export limit reached".

Where the TS port intentionally differs (lekhjs `src/export/`, KB `/frontend/lekhjs/export.md`):

| Difference                                                                                                                  | Reference                        |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Raster pixel size is `round(plan × scale)` on web/iOS/Mac and `× devicePixelRatio` on Android (C++ web used the DPR)        | export.md §6, §10                |
| A page over 50 MP is scaled to 50 MP and an export over 100 MP in total proportionally, with one toast                      | DR-EXP-04                        |
| Web PDF is vector (PDFKit), not one JPEG per page                                                                           | DR-EXP-01                        |
| A page under 1 point (an empty page at padding 0) is skipped; nothing left → "Nothing to export."                           | DR-EXP-06, AC-EXP-37             |
| Object bounds inflate every object by half its stroke (C++ skips the first object): drawing-area sizes can differ by ≤ 1 pt | DR-ENG-17                        |
| PNG never paints a background, even with the saved Include Background on                                                    | export.md §5 (the row is hidden) |
| A hand-off reached in the background waits for the app to return                                                            | DR-EXP-05                        |

The expected values below come from these rules applied to `expected.json` (whose bounds are the
TS engine's, i.e. after DR-ENG-17).

## 3. Option matrix and how it was reduced

Dimensions: entry point (board panel, doc list, Android gallery) × format (5) × pages (all, one,
subset, all switched off) × image size (x1-x4) × region (2) × padding (0, 20, large, negative,
invalid text) × background (2) × page type (fixed portrait, fixed landscape, auto, infinite,
empty) × content (shapes near and over the page edge, text in four fonts and six scripts, an
image, connectors) × memory (reopen, other board, restart, cancel) × board kind (cloud,
on-device, read-only shared) × size (normal, 20 MP, over the 50/100 MP caps) × host hand-off.

The full product is over 50,000 combinations. The rules of §2 make most of them equivalent:
region and padding are inert for fixed/auto pages in a PDF, background is inert for PNG and
LEKH, image size only matters for JPEG/PNG, and the plan is per page. So the suite is **pairwise
over format × region × background × scale × pages**, with every page type reached in every
format by exporting "All" of the 7-page fixture, plus targeted cases for the known risks (EX1:
sub-view choices lost on Back; region only applying to fixed/auto raster and SVG; PDF of a fixed
page always the full canvas; infinite page = drawing bounds + padding; the caps; names).

| Pair covered              | Cases                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| PDF × background off / on | EXP-10 / EXP-11, EXP-12 (Full Page), EXP-29 (large), EXP-30 (fonts)                              |
| JPEG × region × bg        | Full+on EXP-16, Full+off EXP-28, Drawing+on EXP-15, Drawing+off EXP-17, gallery EXP-40           |
| PNG × region              | Drawing EXP-13, EXP-22, EXP-23; Full EXP-14, EXP-24, EXP-25…27; bg ignored EXP-21                |
| SVG × region × bg         | Full+on EXP-18, Drawing+off EXP-19, Drawing+on EXP-35                                            |
| Scale                     | x1 EXP-13/15/25/28, x2 EXP-14/26/27/34, x3 EXP-17, x4 EXP-16                                     |
| Pages all / one / subset  | all EXP-10/13/18/20/27; one EXP-12/15/16/17/19; subset EXP-11/14; all-off EXP-03                 |
| Page type × format        | every format's "All" case (EXP-10, -13, -18, -20) covers fixed, landscape, auto, infinite, empty |
| Padding                   | 0 EXP-15, 20 EXP-13, 35 EXP-24, 100 EXP-17, negative and invalid EXP-22                          |
| Entry point               | board panel (all), doc list EXP-34…36, gallery EXP-40                                            |
| Board kind                | on-device (web offline board) most cases, cloud EXP-34…36, read-only EXP-37, both EXP-38         |

## 4. Fixtures

`fixtures/export-suite.lekh` (board name **export-suite**). Board points; a fixed page's size is
its stored size at 144 points per inch.

| #   | Page name | Type                         | Canvas (pt)       | Object bounds x, y, w × h (pt) | Background | Contents                                                                                                                 |
| --- | --------- | ---------------------------- | ----------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Fixed A4  | fixed 21 × 29.7 cm, portrait | 1190.55 × 1683.78 | 4.5, 99.5, 1356 × 1461         | #fff3c4    | blue box top left, red square at the left edge (x 5-45), green box **off the page** (x 1240-1360), text box, a connector |
| 2   | Landscape | fixed 11 × 8.5 in, landscape | 1584 × 1224       | 219.5, 189.5, 881 × 511        | #e3f2fd    | an inline red image (220-380, 190-310), a yellow box                                                                     |
| 3   | Auto      | auto                         | 864.5 × 1014.5    | 99.5, 99.5, 701 × 851          | white      | purple and cyan boxes                                                                                                    |
| 4   | Infinite  | infinite                     | —                 | -300.5, -150.5, 701 × 451      | #e8f5e9    | boxes at negative and positive coordinates, a connector                                                                  |
| 5   | (blank)   | infinite                     | —                 | 49.5, 69.5, 101 × 61           | white      | one box; file name `page5`                                                                                               |
| 6   | Infinite  | infinite                     | —                 | -40.5, -40.5, 81 × 81          | white      | one brown box; duplicate name, file name `Infinite-page6`                                                                |
| 7   | Empty     | infinite                     | —                 | 0, 0, 0 × 0                    | white      | nothing                                                                                                                  |

`fixtures/export-large.lekh` (board **export-large**): pages `Large 1…3`, fixed 5000 × 4000 pt,
a 150-point square in each corner (red TL, green TR, blue BL, yellow BR). `export-matrix.lekh`:
pages Fonts, Shapes, Scripts, fixed A4.

**Loading them.**

- **Web, and a cloud board for any host.** Sign in to the test account on the web app, doc list →
  Create new → Upload Lekh file → pick the file. The board appears in My Docs as
  `export-suite`; on a device signed in to the same account it is in the cloud list.
- **Web, on-device board.** `/?offline=true` → Open → pick the file (the board is named after the
  file). The e2e spec loads it with `__lekhTest.loadDoc` instead.
- **iOS.** AirDrop or Files → share the `.lekh` file to Lekh: it is imported into On device and
  opens (DEV-63).
- **Mac.** Double-click the file in Finder: it opens in place (DEV-34).
- **Android** (debug build): `adb push export-suite.lekh /data/local/tmp/` then
  `adb shell run-as com.avabodh.lekh cp /data/local/tmp/export-suite.lekh files/` (the app's
  `documentsDir`, DEV-02), then pull to refresh On device. Or use the cloud board.

Name the board exactly as listed (rename it if the host appended anything), or pass `--doc`.

## 5. Cases

Hosts: W web, I iOS, M Mac, A Android. "Set" means: open board options → Export (on Android:
board options → Export → Export) and choose the listed values; rows hidden for the format keep
the value set while they were visible (choose JPEG first to reach every row). Pages lists the
fixture pages left switched on (1-based). The expected values of the file cases are what
`suite.mjs check <id>` checks; the pixel sizes are for web, iOS and Mac (Android: × DPR, the
checker computes it).

### 5.1 Panel (no file)

| Id     | Hosts   | Preconditions                                                                                    | Steps                                                                                                              | Expected                                                                                                                                                                                                                                                                        |
| ------ | ------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXP-01 | W I M A | No saved setting (fresh install; web: clear the `localStorage` key `setting_last_export_params`) | Open export on export-suite                                                                                        | PDF; rows Pages `All`, Include Background off. Choose JPEG: Image Size x1, Export Region `Drawing Area`; in the region view Padding Points `20` (h:52-54, cpp:359-370)                                                                                                          |
| EXP-02 | W I M A | —                                                                                                | Choose each format in turn                                                                                         | Rows exactly as §2: PDF Pages + Include Background; JPEG Pages, Image Size, Export Region, Include Background; PNG Pages, Image Size, Export Region; SVG Pages, Export Region, Include Background; LEKH no rows and no "Options" title (cpp:336-352)                            |
| EXP-03 | W I M A | —                                                                                                | Pages: switch off 1-6 (only 7 on) → Back; Pages: switch 3 on → Back; Pages: switch 3 and 7 off → Back; Pages again | Row reads `page-7`, then `Multiple`, then `All` (every page was off: all selected again, cpp:76-81); the reopened sub-view shows all seven switches on. The row value is never lost on Back (EX1)                                                                               |
| EXP-04 | W I M A | —                                                                                                | JPEG → Export Region: Full Page → Back; Export Region: Drawing Area, Padding Points `35` → Back; Export Region     | Full Page: no Padding row; main row `Full Page`. Drawing Area: Padding row present with the current padding; main row `Drawing Area`; reopening shows `35`                                                                                                                      |
| EXP-05 | W I M A | —                                                                                                | Set JPEG, x3, Full Page (padding 35), Include Background on, Pages 1 only; Export (any destination); reopen export | JPEG, x3, `Full Page`, background on, padding 35 in the region view; Pages `All` (pages are not saved) (cpp:485-573)                                                                                                                                                            |
| EXP-06 | W I M A | EXP-05 done                                                                                      | Open another board (export-large); open export                                                                     | Same values as EXP-05: the setting is per app, not per board                                                                                                                                                                                                                    |
| EXP-07 | W I M A | EXP-05 done                                                                                      | Restart the app (web: reload; native: kill from the switcher and relaunch); open export                            | Same values as EXP-05                                                                                                                                                                                                                                                           |
| EXP-08 | W I M A | EXP-05 done                                                                                      | Change to SVG, Drawing Area, padding 5; close the panel without Export (tap outside / Back); reopen                | The EXP-05 values (JPEG, x3, Full Page, 35, background on): only Export saves (cpp:253-257)                                                                                                                                                                                     |
| EXP-09 | W I M A | EXP-05 done                                                                                      | Doc list → export-suite → Export                                                                                   | The doc-list popup shows JPEG, x3, Export Region `Full Page`, Include Background on (the same `last_export_params`). Native: known open item (export.md §5: the board panel keeps it in WebView `localStorage`, the doc list in the native setting store); record what is shown |

### 5.2 Files from the board panel (export-suite unless named)

| Id     | Hosts   | Set (format, pages, size, region, padding, background)                                                              | Expected files                                                                                                                                                                                                                                                                     |
| ------ | ------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXP-10 | W I M A | PDF, all, —, Drawing Area, 20, off                                                                                  | One `export-suite.pdf`, 7 pages: 595.28 × 841.89, 792 × 612, 432.25 × 507.25, 370.5 × 245.5, 70.5 × 50.5, 60.5 × 60.5, 20 × 20 pt (fixed/auto = canvas / 2; infinite = (bounds + 2 × 20) / 2, the empty page 40 / 2). No background fill                                           |
| EXP-11 | W I M A | PDF, 2 + 4, —, Drawing Area, 20, on                                                                                 | One `export-suite.pdf`, 2 pages: 792 × 612 (landscape, whole canvas whatever the region) and 370.5 × 245.5; each page's first fill is its background (#e3f2fd, #e8f5e9)                                                                                                            |
| EXP-12 | W I M A | PDF, 1, —, Full Page, 20, off                                                                                       | One `export-suite.pdf`, 1 page 595.28 × 841.89; the texts "Export suite A4" and "A4 top" are selectable/extractable; the green off-page box is not visible (outside the page)                                                                                                      |
| EXP-13 | W I M A | PNG, all, x1, Drawing Area, 20, —                                                                                   | 7 files: `export-suite-Fixed A4.png` 1396 × 1501, `-Landscape` 921 × 551, `-Auto` 741 × 891, `-Infinite` 741 × 491, `-page5` 141 × 101, `-Infinite-page6` 121 × 121, `-Empty` 40 × 40 px. Transparent where nothing is drawn; the off-page green box is included on page 1         |
| EXP-14 | W I M A | PNG, 1 + 3 + 4, x2, Full Page, 20, —                                                                                | 3 files: `-Fixed A4` 2381 × 3368 (canvas × 2, the off-page box cut off, the red edge square at x 10-90), `-Auto` 1729 × 2029, `-Infinite` 1482 × 982 (Full Page does not apply to an infinite page)                                                                                |
| EXP-15 | W I M A | JPEG, 2, x1, Drawing Area, 0, on                                                                                    | `export-suite.jpg` 881 × 511; empty area #e3f2fd; the image red at its place                                                                                                                                                                                                       |
| EXP-16 | W I M A | JPEG, 1, x4, Full Page, —, on                                                                                       | `export-suite.jpg` 4762 × 6735; empty area #fff3c4; the red edge square at x 20-180                                                                                                                                                                                                |
| EXP-17 | W I M A | JPEG, 3, x3, Drawing Area, 100, off                                                                                 | `export-suite.jpg` 2703 × 3153; white around the boxes                                                                                                                                                                                                                             |
| EXP-18 | W I M A | SVG, all, —, Full Page, 20, on                                                                                      | 7 `.svg` files named as EXP-13; root `width`/`height`/`viewBox`: 1190.5512 × 1683.7795, 1584 × 1224, 864.5 × 1014.5, 741 × 491, 141 × 101, 121 × 121, 40 × 40; root `background-color` = the page's colour (white pages: rgb(255, 255, 255)). Opens in a browser / Files / Preview |
| EXP-19 | W I M A | SVG, 4, —, Drawing Area, 20, off                                                                                    | `export-suite.svg` 741 × 491, no background style                                                                                                                                                                                                                                  |
| EXP-20 | W I M A | LEKH, — (no rows)                                                                                                   | `export-suite.lekh`; `info.version` 5.0; 7 pages with 5, 2, 2, 3, 1, 1, 0 objects; opening it (web: Open; iOS: share to Lekh) shows the same board                                                                                                                                 |
| EXP-21 | W I M A | JPEG with background on, then PNG, 2, x1, Drawing Area, 0                                                           | `export-suite.png` 881 × 511, transparent background (PNG has no Include Background)                                                                                                                                                                                               |
| EXP-22 | W I M A | PNG, 5, x1, Drawing Area; type the padding as `` (empty), `abc`, `12abc`, `-10`, `7.9`, one export each (EXP-22a…e) | `export-suite.png` 101 × 61, 101 × 61, 125 × 85, 81 × 41, 115 × 75 (`std::stoi`: leading integer, else 0)                                                                                                                                                                          |
| EXP-23 | W I M A | PNG, 7 (Empty), x1, Drawing Area, padding 0 (a), then 20 (b)                                                        | a: no file; dialog "Nothing to export." b: `export-suite.png` 40 × 40, fully transparent                                                                                                                                                                                           |
| EXP-24 | W I M A | PNG, 4, x1, Full Page, 35                                                                                           | `export-suite.png` 771 × 521 (= Drawing Area with 35)                                                                                                                                                                                                                              |
| EXP-25 | W I M A | export-large: PNG, 1, x1, Full Page                                                                                 | `export-large.png` 5000 × 4000 (20 MP: banded on every host); the four corner colours; no toast                                                                                                                                                                                    |
| EXP-26 | W I M A | export-large: PNG, 1, x2, Full Page                                                                                 | `export-large.png` 7905 × 6324 (50 MP cap); one toast "Image was reduced to 7905 × 6324 to fit"                                                                                                                                                                                    |
| EXP-27 | W I M A | export-large: PNG, all, x2, Full Page                                                                               | 3 files `export-large-Large 1…3.png`, each 6455 × 5164 (100 MP total cap); one toast                                                                                                                                                                                               |
| EXP-28 | W I M A | export-large: JPEG, 1, x1, Full Page, off                                                                           | `export-large.jpg` 5000 × 4000 (banded JPEG), decodes; corners coloured, centre white                                                                                                                                                                                              |
| EXP-29 | W I M A | export-large: PDF, all                                                                                              | `export-large.pdf`, 3 pages 2500 × 2000 pt                                                                                                                                                                                                                                         |
| EXP-30 | W I M A | export-matrix: PDF, all                                                                                             | `export-matrix.pdf`, 3 pages 595.28 × 841.89; each "<font>: The quick brown fox 0123" line extractable; Noto Sans, Noto Serif, Noto Sans Mono and Caveat embedded                                                                                                                  |

### 5.3 Doc list, boards, cancel, hosts

| Id     | Hosts   | Preconditions / steps                                                                                                                             | Expected                                                                                                                                                                                                                                                                                                |
| ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXP-31 | W I M A | Dark theme (Settings → theme dark, or the system in dark mode); repeat EXP-13                                                                     | The same 7 files with the same sizes and colours as in light mode (export draws no theme colours)                                                                                                                                                                                                       |
| EXP-32 | W I M A | export-large: PNG, all, x2 (EXP-27's export); press Cancel in the progress modal while it renders                                                 | The modal closes; no file, no share sheet/download; on a capped account the export count is unchanged. The panel's values were saved (Export was pressed)                                                                                                                                               |
| EXP-33 | I M A   | Any export; dismiss the share sheet / picker without choosing a target                                                                            | No error; nothing written; the export still counts (as 3.5.9)                                                                                                                                                                                                                                           |
| EXP-34 | W I M A | Cloud export-suite. Doc list → its menu → Export: PNG, x2, Export Region Full Page (padding 20 from the region view) → Export                     | 7 files named as EXP-13 (the doc list has no Pages row: all pages) with EXP-14's sizes for pages 1, 3, 4 (2381 × 3368, 1729 × 2029, 1482 × 982) and Drawing Area sizes × 2 for infinite pages                                                                                                           |
| EXP-35 | W I M A | Doc list → Export: SVG, Export Region Drawing Area, Padding points 10, Include Background on                                                      | 7 `.svg` files, each the bounds + 20; root background = the page colour                                                                                                                                                                                                                                 |
| EXP-36 | W I M A | A folder holding cloud export-suite and export-matrix (and, for DEV-55, a broken board): folder menu → Export → PDF                               | One download per file (web) / one hand-off (native): `export-suite.pdf` (7 pages), `export-matrix.pdf` (3 pages). With the broken board: the others delivered, then "Error in exporting some of the boards."                                                                                            |
| EXP-37 | W I M A | Share cloud export-suite **read** with a second test account; open it there; board options                                                        | Board options list Export (no Shortcut Keys, Share, Rename, Delete) (BoardOptionViewManager.cpp:243-245); EXP-13 from there gives the same 7 files                                                                                                                                                      |
| EXP-38 | W I M A | EXP-13 on the on-device board and on the cloud board                                                                                              | Identical sizes and names (board name the same)                                                                                                                                                                                                                                                         |
| EXP-39 | I A     | Free (capped) test account, on-device export-suite: export 6 times (any format)                                                                   | Exports 1-5 deliver; the 6th shows "Export limit reached" with Upgrade, no file. A cloud board is never capped (ExportInputBuilder.cpp:119-141; DEV-07)                                                                                                                                                 |
| EXP-40 | A       | Saved setting: PNG, x4, Full Page, background **on** (export once). Then board options → Export → Save to gallery on page 2 (Landscape)           | One JPEG in the gallery of page 2's Drawing Area with padding 20 at x1 × DPR: (881 + 40) × DPR by (511 + 40) × DPR px; background **#e3f2fd** (C++ uses the saved Include Background, cpp:169-171, 372-384); the saved setting is unchanged afterwards                                                  |
| EXP-41 | A       | Export → Export: EXP-13 (7 files) → Save; then EXP-12 (1 file) → Save; Export and share: EXP-13 → a share target                                  | Several files → `lekh-export.zip` through the document picker holding the 7 PNGs; one file → that file; Share sends all 7 files (`ACTION_SEND_MULTIPLE`) (DEV-54)                                                                                                                                       |
| EXP-42 | I       | EXP-13 and EXP-10                                                                                                                                 | One share sheet holding all files; Save to Files writes them; each opens in Files/Preview; the PDF text is selectable (DEV-52)                                                                                                                                                                          |
| EXP-43 | M       | EXP-13 and EXP-10                                                                                                                                 | The export picker opens once with all files; files written where chosen (DEV-53)                                                                                                                                                                                                                        |
| EXP-44 | I A     | EXP-27 (large); background the app before the hand-off; foreground after 20 s                                                                     | The share sheet / picker opens on return, not dropped; one usage event (DR-EXP-05, DEV-50)                                                                                                                                                                                                              |
| EXP-45 | W I A   | `../fixtures/scripts.lekh`, PDF. Native: airplane mode. Web: offline (DevTools) after one online PDF export                                       | Han, Japanese, Korean, Arabic, Devanagari text extractable from the PDF (pdf.js / `inspect`), emoji as images, no empty boxes (DEV-56)                                                                                                                                                                  |
| EXP-46 | W       | An on-device board with a blank name (web: open a file named ` .lekh`)                                                                            | PNG of one page → `drawing.png` (ExportInputBuilder.cpp:49-52)                                                                                                                                                                                                                                          |
| EXP-47 | W I M A | Open export-suite with page 1 on screen and leave it for 2 minutes (never show page 2); then EXP-15 (JPEG, page 2, Drawing Area 0, background on) | As EXP-15: the image is red, not blank, and no "Some images could not be loaded" toast. The session's image cache evicts an image 60 s after its last paint; C++ keeps an inline image's bitmap on the element (ShapeTemplate.cpp:676-682). Failed on the TS build before EX2 (blank image, no warning) |

## 6. Checking a file on each host

| Host    | Where the files are                                                                                                                                   | How to check                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Web     | the browser's downloads, one per file                                                                                                                 | `suite.mjs check` (the e2e spec does this itself)                         |
| iOS     | share sheet → Save to Files → AirDrop the folder to the Mac / workstation                                                                             | `suite.mjs check --host ios`; open the PDF in Files to try text selection |
| Mac     | the folder chosen in the export picker                                                                                                                | `suite.mjs check --host mac`                                              |
| Android | Export → Save (`lekh-export.zip`, unzip) or a single file; `adb pull` from the chosen folder; gallery: `adb pull` the JPEG from `DCIM/` / `Pictures/` | `suite.mjs check --host android --dpr <window.devicePixelRatio>`          |

Visual checks the checker cannot do (record them in the note): the PDF opens in the platform
viewer, text is selectable, fonts look right, the image is not a placeholder.

## 7. Results

Copy `results-template.md` to `lekhjs/parity/device-checklist/<host>-export-<date>/results.md`,
fill the header (backend, commits, build, device, who ran it) and one line per case. Run
`npx prettier --write <file>` in `lekhjs` so `npm run format:check` stays green.
