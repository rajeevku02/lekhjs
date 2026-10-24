# Multilingual export suite (I18N)

Round I18N1, Work `01M4X7TCHFB862XGT68GPY071C`. Checks that every major script is exported
properly in every export format (PDF, PNG, JPEG, SVG, and the `.lekh` round trip), on every host:
the web in any browser, iOS, Mac Catalyst and Android. It sits beside the export suite
(`../export-suite/`, cases EXP-01…47), whose planner rules, file naming, raster sizes and zip
reader it reuses (`../export-suite/suite.mjs`); this suite only adds what is about text. The
behaviour under test is spec 08 and KB `/frontend/lekhjs/export.md` §7 (the PDF font chain) and
`/frontend/lekhjs/fonts.md` §4.1 (the web's downloaded Noto fonts).

It is self-contained: an agent on another machine needs this folder, the `lekhjs` checkout with
`npm install` (pdf.js, `@napi-rs/canvas`) and the app under test; nothing from `access/`.

| File                  | What it is                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`           | this suite                                                                                                                                                      |
| `samples.json`        | **every string**: id, language, script, direction, the text, a short form, its source, its code points, what to look for, and the expected PDF outcome per host |
| `build.mjs`           | regenerates the fixtures and `expected.json` from `samples.json` (`--check` verifies them)                                                                      |
| `fixtures/*.lekh`     | four synthetic boards (§3)                                                                                                                                      |
| `expected.json`       | per fixture page: the export plan inputs and every check target (sample, kind, style, rectangle)                                                                |
| `suite.mjs`           | the cases as data and the checker: `list`, `check`, `inspect`, `reference`, `shaping`, `checklist`                                                              |
| `references/<board>/` | the web PDF of each board rendered by pdf.js (1 px per board point), and `metrics.json`, the ink of every target in them                                        |
| `references/shaping/` | every sample drawn by Skia with HarfBuzz in the same Noto fonts: **what correct shaping and bidi order look like** (§6)                                         |
| `results-template.md` | the results sheet per host                                                                                                                                      |
| `results/`            | results of the runs (`web-chromium-<date>.md`, …)                                                                                                               |

The web automation is the root e2e spec `e2e/tests/export-i18n-web.spec.js`.

## 1. Languages

The owner's list, with these changes:

- **Added Gujarati, Gurmukhi (Punjabi) and Lao.** The web PDF downloads a Noto font for each of
  them (fonts.md §4.1), so they are part of what the chain claims to cover. Gurmukhi turned out to
  fail on the web (results/web-chromium-2026-10-24.md).
- **Added Persian digits** (`fa-digits`, Extended Arabic-Indic digits inside RTL text) to the
  bidi edge cases: digits that are weak left-to-right but belong to the Arabic script are where a
  shaper that decides direction by script goes wrong (it does: results/web-chromium-2026-10-24.md).
- **Ext B split in two**: `extb` (four Cantonese Ext B characters, no kana) and `extb-ja` (𩸽 with
  its kana reading), because the web picks the CJK font by kana/Hangul/browser language, and only
  Noto Sans TC has the former and only Noto Sans JP the latter.
- **Emoji split in three** (ZWJ sequences, flags including the Scotland tag sequence, skin tones
  and keycaps), one row each.
- **NFC / NFD** use Latin marks and a Hangul syllable (NFD = three conjoining jamo), so both the
  mark positioning and the jamo composition are exercised.
- Nothing was dropped. Urdu is tested in the Naskh style of Noto Sans Arabic: no host draws
  Nastaliq in the PDF, and the screen's style depends on the device.

| Group                  | Samples (`samples.json` ids)                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| Latin Greek Cyrillic   | vi (Vietnamese), pl, tr (Turkish İ/ı), el, ru                          |
| RTL                    | ar, he, ur, fa (with ZWNJ in می‌خواهم)                                 |
| Indic                  | hi, bn, ta, te, kn, ml, gu, pa                                         |
| Thai Lao Khmer Myanmar | th, lo, km, my                                                         |
| CJK                    | zh-Hans, zh-Hant, ja, ko                                               |
| CJK Ext B              | extb (𠜎𠜱𠝹𠱓), extb-ja (𩸽)                                          |
| Emoji                  | emoji-zwj, emoji-flags, emoji-skin                                     |
| Others                 | am (Ethiopic), ka, hy, bo (Tibetan), si (Sinhala, ශ්‍රී with ZWJ)      |
| Edge cases             | bidi-ar, bidi-he, fa-digits, nfc, nfd, combining, long                 |
| Layout (layout board)  | multi (seven scripts in one line), lines, ar-left, ar-right, decorated |
| Paragraphs (wrapping)  | th, km, my, zh, ja, ko, ar, hi paragraphs, long-narrow, mixed-long     |

Every string is constructed for this suite (greetings, language names, traditional public-domain
pangrams for Polish, Greek and Russian); `samples.json` gives the source and the code points of
each. **Change a string only in `samples.json`, then run `build.mjs`.**

## 2. What is checked automatically, and how

`suite.mjs check <case> --host <host> <files>` prints a PASS/FAIL line per expectation (NOTE and
WARN lines are information) and exits 1 on any FAIL. Each fixture page lists its **targets**
(`expected.json`): a box whose text is checked, with its rectangle in board points. Per format:

**PDF** (pdf.js, every page):

- **Text.** The text items inside the box, joined top to bottom, left to right, compared with the
  target's string after normalisation: **NFKC**, whitespace and default-ignorable characters
  removed (ZWJ, ZWNJ, bidi controls, variation selectors, tags: they have no glyph, so no PDF
  carries them). Emoji clusters are left out (they are images on every host). The comparison is
  **in order** for left-to-right text without reordering; where the sample says
  `pdfOrder: visual` it is **a multiset of code points after NFKD**, because the PDF holds glyphs
  in visual order: RTL runs (a reader may or may not put them back into logical order), and
  pre-base or two-part vowels (हि is drawn ि+ह and extracts so; கொ is drawn ெ+க+ா and extracts as
  those two parts, which is ொ after canonical decomposition).
- **Mode** of the box: `text` (the text above matched), `image` (no text, an image drawn in the
  box: the image fallback), `outline` (ink but no text and no image: glyph outlines),
  `partial` (some text extracted but not the right text) or `missing` (blank). It must be one the
  sample allows on the host: `samples.json` `expect.pdf[host]`, overridden for bold by
  `expect.bold[host]`. Where an outcome differs by host the reason is written next to it
  (`expect.why`), and `expect.verified[host]` says whether a run on that host has confirmed it.
- **Ink**: the page is rendered by pdf.js and the box must not be blank.
- **Font** (web only): the extracted text uses the expected face (`expect.webFont`, `-Bold` for
  bold: e.g. `NotoSansArabic-Bold`).
- **Toast**: whether "Some text was exported as an image because its font was not available."
  must appear (`yes`, `no` or `either`), from the same expectations: a non-emoji box expected as
  an image raises it, emoji never do. Pass `--toast yes|no` with what you saw; the e2e spec
  records it itself.

**SVG**: the `<tspan>`s inside the box: their text equals the target's string **code point for
code point** (no normalisation: the SVG keeps the board's string, so the NFD row must stay NFD),
the `font-family` names the box's family quoted plus a generic family, RTL lines carry
`direction="rtl"`. Wrapped boxes (the Wrapping page): at least two lines; no line break inside a
grapheme cluster; for Thai, Lao, Khmer and Myanmar every break is an ICU word boundary
(`Intl.Segmenter`); for Japanese and Chinese no line starts with closing punctuation or ends with
an opening one (kinsoku). The lines are the engine's on that host, so this checks each host's
own line breaking.

**PNG / JPEG**: the box is not blank (ink over 0.2 % of it); its ink coverage and ink width are
compared with the reference (`references/metrics.json`, from the web PDF in Noto fonts) within
a factor of 0.35…2.8 for coverage and 0.5…1.8 for width. The tolerance is wide on purpose: a raster
export draws with the **device's** fonts (the screen's fallback), so a heavier or wider face must
pass; what it catches is a box that is empty, a script drawn at a fraction of its size, or a line
cut off. Wrapped boxes: nothing is drawn in the gap to their right (no overflow). Sizes and file
names come from the export suite's rules.

**File names** (I18N-10…12): the names of the files and of a web zip's entries, compared after
NFC (a NOTE reports whether they are also byte-identical: a file system may store names
decomposed), and every non-ASCII zip entry must have the UTF-8 name flag.

**LEKH** (I18N-16): every object's text in the exported board equals the fixture's, code point
for code point; on the web the exported file is opened again.

### What only a human can judge

The checker cannot tell **correct shaping** (a conjunct formed, a vowel placed, Arabic letters
joined), **bidi order** of mixed text on the page, **line-break quality** beyond the rules above,
**tofu boxes** (a box drawn for a missing glyph has ink), or what an **image fallback** looks
like (it is drawn by the host's own fonts). §6 is the visual checklist for those.

## 3. Fixtures

All pages are infinite, so a Drawing Area or PDF export of a page is its objects plus the
padding. Text is Noto Sans 18 unless stated.

| File                | Board name (load it under this name)         | Pages                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `i18n-scripts.lekh` | `i18n-scripts`                               | one page per group of §1 (9 pages); per sample a Latin label box and the sample in a 680-point box                                                                                                                                                                                                                                                                      |
| `i18n-styles.lekh`  | `i18n-styles`                                | Styles: each sample's short form regular / bold / italic / bold italic (Noto Sans 16); Families: in Noto Sans / Noto Serif / Noto Sans Mono / Caveat                                                                                                                                                                                                                    |
| `i18n-layout.lekh`  | `i18n-layout`                                | Containers: per script a shape label, a free text and a connector label; Wrapping: ten 150 × 320 boxes of paragraphs (Thai, Khmer, Myanmar, Chinese, Japanese, Korean, Arabic, Hindi, a 79-letter word, mixed); Runs: seven scripts in one line, three lines in three directions, Arabic left and right aligned, bold italic underline across Arabic, Chinese and Hindi |
| `i18n-names.lekh`   | **`出口 निर्यात تصدير`** (rename it to this) | pages `中文`, `العربية`, `हिन्दी`, `Ελληνικά`, `Emoji 😀`, and `中文` again (a duplicate: file name `-page6`)                                                                                                                                                                                                                                                           |

For I18N-12 a folder named **`फ़ोल्डर 文件夹`** holds the names board and `i18n-layout` (cloud).

**Loading them** (as for the export suite, `../export-suite/README.md` §4):

- **Web, on-device board**: `/?offline=true` → Open → the file; the board is named after the file
  (copy `i18n-names.lekh` to `出口 निर्यात تصدير.lekh` first). The e2e spec uses
  `__lekhTest.loadDoc`.
- **Cloud (any host)**: web doc list → Create new → Upload Lekh file; rename the names board.
- **iOS**: AirDrop or Files → share the `.lekh` to Lekh. **Mac**: double-click it. **Android**
  (debug build): `adb push` + `run-as … cp` into `files/` as in the export suite, or use the cloud
  board. Rename the names board on the device if the host kept the file name.

## 4. Cases

Hosts: W web, I iOS, M Mac, A Android. Every case is a board-panel export (Export → format →
Pages → Export Region Drawing Area, padding 20 → Include Background off → Export) unless stated.
On the web several files arrive as one `<board>.zip` (pass it as it is); on iOS/Mac in one share
sheet / picker; on Android Save gives a zip.

| Id       | Hosts   | Board / pages                                    | Format and options                      | What it shows                                                                                                                                                                      |
| -------- | ------- | ------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I18N-01  | W I M A | i18n-scripts, all                                | PDF                                     | every script: extractable text in the right face, or the documented image fallback; the toast as expected                                                                          |
| I18N-02  | W I M A | i18n-scripts, all                                | PNG x1                                  | 9 PNGs, every box drawn, ink against the reference                                                                                                                                 |
| I18N-03  | W I M A | i18n-scripts, all                                | SVG                                     | 9 SVGs, every string exact (NFD kept), font-family                                                                                                                                 |
| I18N-04  | W I M A | i18n-scripts, CJK (page 5)                       | JPEG x2, Include Background on          | CJK in a JPEG at 2×                                                                                                                                                                |
| I18N-05  | W I M A | i18n-styles, all                                 | PDF                                     | bold, italic, bold italic and the four families per script                                                                                                                         |
| I18N-06  | W I M A | i18n-styles, all                                 | PNG x1                                  | the same as raster                                                                                                                                                                 |
| I18N-07  | W I M A | i18n-layout, all                                 | PDF                                     | shape labels, free text, connector labels, wrapped paragraphs, mixed runs                                                                                                          |
| I18N-08  | W I M A | i18n-layout, all                                 | PNG x1                                  | the same as raster; no overflow of wrapped boxes                                                                                                                                   |
| I18N-09  | W I M A | i18n-layout, all                                 | SVG                                     | the engine's line breaks (word boundaries, kinsoku), strings exact                                                                                                                 |
| I18N-10  | W I M A | `出口 निर्यात تصدير`, all                        | PNG x1                                  | file names `出口 निर्यात تصدير-中文.png` … `-中文-page6.png`; web: one `出口 निर्यात تصدير.zip` with UTF-8 names                                                                   |
| I18N-11  | W I M A | `出口 निर्यात تصدير`, all                        | PDF                                     | one file `出口 निर्यात تصدير.pdf`                                                                                                                                                  |
| I18N-12  | W I M A | doc list: folder `फ़ोल्डर 文件夹` → Export → PDF | —                                       | web: one `फ़ोल्डर 文件夹.zip` holding `出口 निर्यात تصدير.pdf` and `i18n-layout.pdf`; native: those two in one hand-off                                                            |
| I18N-13a | W I M A | i18n-scripts, page 1                             | PDF                                     | Latin, Greek, Cyrillic only: **no toast**                                                                                                                                          |
| I18N-13b | W I M A | i18n-scripts, page 7 (Emoji)                     | PDF                                     | emoji are images, **no toast**                                                                                                                                                     |
| I18N-13c | W I M A | i18n-scripts, page 8 (Others)                    | PDF                                     | Tibetan: on the web an image **with the toast**; native: text (expected)                                                                                                           |
| I18N-14  | W I M A | i18n-scripts, all                                | PDF, **offline** after I18N-01          | the same result as I18N-01 from cached / system fonts (web: DevTools offline or Playwright `setOffline`; native: airplane mode)                                                    |
| I18N-15  | W       | i18n-scripts, all                                | PDF, offline, **no script font cached** | new browser profile; one online PDF of page 1 (loads the PDF code and Noto Sans), then offline: bundled-only scripts are text, the rest images, the toast, nothing blank, no error |
| I18N-16  | W I M A | i18n-scripts                                     | LEKH                                    | every text identical code point for code point; the file opens again                                                                                                               |

## 5. Expected differences per platform

`samples.json` holds them, each with its reason. In short:

| Host    | Where its fonts come from                                                                                                                     | Expected differences                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web     | PDF: the bundled Noto faces, then Noto script fonts downloaded from `rajeevku02.github.io/lekhboard/fonts/noto/`; raster: the browser's fonts | **Tibetan** has no downloaded font: image + toast. **Ext B without kana** gets Noto Sans SC, which lacks it: image + toast. **Han without kana** (zh-Hant, a Japanese text of kanji only) is drawn in Noto Sans SC (mainland shapes) unless the browser language is zh-TW/HK/Hant or ja. PNG/JPEG/SVG use the machine's fonts: on a machine without a font for a script the raster shows tofu or unshaped text (Linux workstation: Khmer, Myanmar, Ext B; results/web-chromium-2026-10-24.md) |
| iOS/Mac | PDF: `getFontData`, the system face CoreText picks; Mac skips faces without outlines (PingFang SC → Hiragino Sans GB)                         | all scripts expected as text (Kailasa for Tibetan); Ext B either text or image (coverage of the system CJK face not known); only zh/ja/ko/ar/hi verified on device so far (EXP-45)                                                                                                                                                                                                                                                                                                            |
| Android | PDF: `getFontData`, the system face (static before variable since EX2)                                                                        | all scripts expected as text; **bold** of scripts that exist only as variable fonts is drawn as outlines (not extractable; lekhjs bd5dd71), so bold allows `outline` for the Indic, SEA, Ethiopic, Georgian, Armenian, Sinhala, Tibetan, Hebrew rows; Han on Samsung is NotoSerifCJK TC (serif shapes; text)                                                                                                                                                                                  |

The first native run should replace the unverified expectations (set `verified` and correct
`pdf` where a host differs, with the reason).

## 6. The visual checklist (human)

Open each exported file next to the references and tick each row. `references/shaping/<group>.png`
is the ground truth for shaping and order (Skia + HarfBuzz, the same Noto fonts the web PDF uses;
Tibetan drawn with Noto Serif Tibetan, which the app does not download);
`references/<board>/<page>.png` is the web PDF as exported on the reference run (including its
known faults, listed in results/web-chromium-2026-10-24.md).

For **every format**, per sample row (the `look` column of `samples.json`, printed by
`suite.mjs checklist`):

1. Every character is there: no tofu box, no `?`, no dotted circle (◌) that is not in the text.
2. Shaping as in `references/shaping`: conjuncts, vowel signs on the correct side, marks not
   colliding, Arabic letters joined, ZWNJ in می‌خواهم keeping the ی unjoined.
3. Direction: RTL rows read right to left; in the bidi rows the numbers keep their digit order
   (۱۲۳٫۴۵, 1,234.50, 2024) and the Arabic/Hebrew words sit as in the reference.
4. NFC and NFD rows look identical.
5. Emoji are single glyphs in colour (a family, not four people; a thumb in a skin tone, not a
   thumb and a square; flags, not letters).
6. Wrapping page: Thai, Khmer and Myanmar break between words, never inside a syllable or between
   a consonant and its sign; no Japanese line starts with 、。」; the long word breaks inside and
   stays in its box; the Arabic paragraph's first words are on the first line, at the right.
7. Styles page: bold is visibly bold in every script; italic slants (scripts without an italic
   face are slanted by the writer); Families page: Latin rows change face per column, other
   scripts keep their script face.
8. PDF only: select and copy a few rows in the platform viewer (Preview, Files, a PDF app):
   the pasted text should read like the sample (RTL and Indic may paste in visual order).

## 7. Running it

### Web here (Chromium, Firefox, WebKit)

Against the worktree front end on `http://localhost:4005` and kashi on `:3000` (agent testing
runbook; RULES of the round), from `<workspace_root>/e2e`, under the heavy lock:

```bash
E2E_BASE_URL=http://localhost:4005 LEKH_BACKEND_LOG=<workspace_root>/logs/kashi-human-out.log \
I18N_EVIDENCE=<a folder outside test-results> npx playwright test tests/export-i18n-web.spec.js
# Firefox / WebKit: add  -c playwright.browsers.config.js --project=firefox  (or webkit), and I18N_HOST=web-firefox
```

`I18N_ONLY=I18N-01,I18N-05` narrows the run. The evidence folder gets `results.jsonl` (one line
per case: ok, toasts, the checker's lines), `files/<case>/` (the downloads) and
`targets/<case>.json` (per target: mode, fonts, extracted text, ink). I18N-12 needs a sign-in
(an OTP read from the backend log): skip it (`I18N_ONLY`) where that log is not readable.

### Web on Windows (Chrome, Edge, Firefox) — another agent

Needs: a checkout of the workspace root (`e2e/`) and `lekhjs` (`npm install` in both;
`npx playwright install chrome msedge firefox`), and **the TS web board at a URL that machine can
reach**. Until the TS board is on the dev site, use an SSH tunnel to the workstation
(`ssh -L 4005:localhost:4005 -L 3000:localhost:3000 <workstation>`) and `http://localhost:4005`
(kashi's CORS accepts that origin); if the owner deploys the work branch to the dev site, use
that URL and `LEKH_API_BASE` of its backend. No account is needed except for I18N-12 (skip it).

```bash
E2E_BASE_URL=http://localhost:4005 I18N_HOST=web-windows-edge I18N_EVIDENCE=C:\i18n\edge \
npx playwright test -c playwright.browsers.config.js --project=msedge tests/export-i18n-web.spec.js
```

Then the visual checklist (§6) on a few of the files in `files/`.

### Safari on the Mac

Playwright's WebKit is not Safari (fonts, downloads, Cache Storage differ). By hand: open the TS
web board in Safari (same URL options as Windows), load the fixtures on-device (`/?offline=true`),
run the cases of §4 from the board panel, and check the downloads on the Mac:
`node parity/device-checklist/export-i18n/suite.mjs check I18N-01 --host web --toast yes|no ~/Downloads/i18n-scripts.pdf`.

### iOS, Mac app, Android — the native agent

As the export suite runs were done: load the fixtures (§3), run each case on the device, copy the
files to the workstation (Files/AirDrop; `adb pull`), and check:

```bash
node parity/device-checklist/export-i18n/suite.mjs check I18N-02 --host android --dpr 2.625 --toast no <files or the zip>
```

`--dpr` is the WebView's `devicePixelRatio` (Android only). Note whether the toast appeared and
pass `--toast`. Add `--json <file>` to keep the per-target modes and fonts for the results.

### References

`suite.mjs reference <i18n-scripts.pdf> <i18n-styles.pdf> <i18n-layout.pdf>` rebuilds
`references/<board>/` and `metrics.json` from the web PDFs of I18N-01, -05 and -07;
`suite.mjs shaping [--noto <lekhboard>/fonts/noto] [<extra fonts>]` rebuilds
`references/shaping/`. Rebuild the metrics when a fixture changes; look at the images before
committing them.

## 8. Results

Copy `results-template.md` to `results/<host>-<date>.md`. Aggregates only: no customer boards,
ids, e-mail addresses or board URLs. Run `npx prettier --write` on it in `lekhjs`.
