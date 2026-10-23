# Export suite results: web (Chromium), 2026-10-23

Suite: `lekhjs/parity/device-checklist/export-suite/README.md` (owner round EX2, Work
`01M4X7TCHFB862XGT68GPY071C`). Run by the agent with `e2e/tests/export-suite-web.spec.js`.

- Backend: kashi-human on the workstation (`/home/rkumar/lekh/lbs`, `1e633b8`), disposable OTP accounts, boards deleted after.
- Build: the worktree front end on `http://localhost:4005` (vite over lekhboard-capacitor `155252d` and lekhjs `4f0e650`; EXP-47 and the WebKit rows on lekhjs `bbb135f`, which adds the inline-image fix), F1 with the real TS board.
- Browser: Chromium 1181 (Playwright), 1280 x 800, devicePixelRatio 1; Firefox 1489 and WebKit 2191 for the rows below the table.
- Checker: every file case through `suite.mjs checkCase` (the per-expectation lines are kept outside the repository).

| EXP-id | host | device                                  | OS    | build                                        | pass/fail | note                                                                                  |
| ------ | ---- | --------------------------------------- | ----- | -------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| EXP-01 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | PDF, Pages All, background off; JPEG x1, Drawing Area, padding 20                     |
| EXP-02 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | rows per format as cpp:336-346; LEKH no Options title                                 |
| EXP-03 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | page-7, Multiple, all off → All; sub-view shows all 7 on                              |
| EXP-04 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | Full Page hides padding; 35 kept                                                      |
| EXP-05 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | JPEG x3 Full Page 35 background on kept; Pages All                                    |
| EXP-06 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | same on export-large                                                                  |
| EXP-07 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | same after reload                                                                     |
| EXP-08 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | closing without Export saved nothing                                                  |
| EXP-09 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | doc-list popup shows JPEG, x3, Full Page, background on (web: one localStorage key)   |
| EXP-10 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 7 pages, sizes as §5.2                                                                |
| EXP-11 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 2 pages; first fills #e3f2fd, #e8f5e9                                                 |
| EXP-12 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 595.28 x 841.89; texts extractable                                                    |
| EXP-13 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 7 PNGs, sizes and 10 pixel probes                                                     |
| EXP-14 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 2381x3368, 1729x2029, 1482x982                                                        |
| EXP-15 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 881x511; image red, ground #e3f2fd                                                    |
| EXP-16 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 4762x6735; ground #fff3c4                                                             |
| EXP-17 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 2703x3153; white                                                                      |
| EXP-18 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 7 SVGs; root sizes and backgrounds                                                    |
| EXP-19 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 741x491, no background                                                                |
| EXP-20 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 5.0; 7 pages, objects 5,2,2,3,1,1,0; reopened                                         |
| EXP-21 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | transparent ground                                                                    |
| EXP-22 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | a-e: 101x61, 101x61, 125x85, 81x41, 115x75                                            |
| EXP-23 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | a: "Nothing to export.", no file; b: 40x40                                            |
| EXP-24 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 771x521                                                                               |
| EXP-25 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 5000x4000, corners                                                                    |
| EXP-26 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 7905x6324, toast                                                                      |
| EXP-27 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 3 x 6455x5164, toast                                                                  |
| EXP-28 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 5000x4000 JPEG                                                                        |
| EXP-29 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 3 pages 2500x2000 pt                                                                  |
| EXP-30 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | 3 pages; 4 font lines; Noto Sans/Serif/Sans Mono and Caveat embedded                  |
| EXP-31 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | dark (prefers-color-scheme) files byte-identical to light                             |
| EXP-32 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | Cancel in the progress modal: no download                                             |
| EXP-33 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | n/a       | native only                                                                           |
| EXP-34 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | cloud board, doc list: 7 PNGs x2 Full Page                                            |
| EXP-35 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | doc list: 7 SVGs Drawing Area 10, backgrounds                                         |
| EXP-36 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | folder: export-suite.pdf (7 pages), export-matrix.pdf (3); no broken board on the web |
| EXP-37 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | viewer: options Export only; 7 PNGs as EXP-13                                         |
| EXP-38 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | cloud board = on-device board (EXP-13)                                                |
| EXP-39 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | n/a       | native only                                                                           |
| EXP-40 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | n/a       | native only                                                                           |
| EXP-41 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | n/a       | native only                                                                           |
| EXP-42 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | n/a       | native only                                                                           |
| EXP-43 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | n/a       | native only                                                                           |
| EXP-44 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | n/a       | native only                                                                           |
| EXP-45 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | not run   | not automated; the offline font path is covered by export.md §7 (F2)                  |
| EXP-46 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | drawing.png                                                                           |
| EXP-47 | web  | workstation, Chromium 1181 (Playwright) | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | after 65 s: image red (failed before lekhjs bbb135f: blank, no warning)               |

## Firefox and WebKit

The e2e config has Chromium only; the board-panel file cases (EXP-10…EXP-24) and the panel cases (EXP-01…EXP-08) were also run with a local config for Firefox and WebKit.

| EXP-id                                      | host | device                    | OS    | build                                        | pass/fail | note                                                                                                                                |
| ------------------------------------------- | ---- | ------------------------- | ----- | -------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| EXP-01…EXP-08                               | web  | workstation, Firefox 1489 | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      |                                                                                                                                     |
| EXP-10…EXP-24                               | web  | workstation, Firefox 1489 | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      |                                                                                                                                     |
| EXP-01…EXP-08                               | web  | workstation, WebKit 2191  | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      |                                                                                                                                     |
| EXP-10…EXP-12, EXP-15…EXP-17, EXP-19…EXP-24 | web  | workstation, WebKit 2191  | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | pass      | EXP-15 failed in the first WebKit run (blank image after the 60 s cache expiry; fixed in lekhjs bbb135f, EXP-47)                    |
| EXP-13, EXP-14, EXP-18                      | web  | workstation, WebKit 2191  | Linux | lekhboard-capacitor 155252d + lekhjs bbb135f | fail      | several files: only the last download arrives (1 of 7, 1 of 3, 1 of 7); single-file exports pass. Open decision, see the EX2 report |

## Re-run after owner round EX3 (several files are one zip on the web)

Owner decision (2026-10-23): on the web an export of several files is one download `<board>.zip`
holding the files under their usual names; one file stays one file (lekhboard-capacitor
`deliver.ts` / `zip.ts`). The checker opens the zip (`suite.mjs check` with `--host web` also
requires that one download). Run against the worktree front end on `:4005` with the EX3
lekhboard-capacitor working tree (uncommitted at run time, committed as the EX3 commit).

| EXP-id                                       | host | device                                                | OS    | build                   | pass/fail | note                                                                                       |
| -------------------------------------------- | ---- | ----------------------------------------------------- | ----- | ----------------------- | --------- | ------------------------------------------------------------------------------------------ |
| EXP-13, EXP-14, EXP-18                       | web  | workstation, Chromium 1181, Firefox 1489, WebKit 2191 | Linux | lekhboard-capacitor EX3 | pass      | one download `export-suite.zip` each (7, 3, 7 files); `unzip -t` clean; was fail in WebKit |
| EXP-31, EXP-46                               | web  | workstation, Chromium 1181, Firefox 1489, WebKit 2191 | Linux | lekhboard-capacitor EX3 | pass      | EXP-31: dark and light zips' files byte-identical                                          |
| EXP-01…EXP-30, EXP-32, EXP-34…EXP-38, EXP-47 | web  | workstation, Chromium 1181                            | Linux | lekhboard-capacitor EX3 | pass      | EXP-36: one `exp-folder-<stamp>.zip` holding the two PDFs; EXP-09 unchanged on the web     |
| EXP-25…EXP-29, EXP-32                        | web  | workstation, Firefox 1489, WebKit 2191                | Linux | lekhboard-capacitor EX3 | pass      | EXP-27: one `export-large.zip` of three 6455 × 5164 PNGs; EXP-32 cancel: no download       |
