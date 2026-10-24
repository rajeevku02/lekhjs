# Multilingual export suite results: web (Chromium, Firefox, WebKit), 2026-10-24

Suite: `lekhjs/parity/device-checklist/export-i18n/README.md` (round I18N1, Work
`01M4X7TCHFB862XGT68GPY071C`). Run by the agent with `e2e/tests/export-i18n-web.spec.js`.

- Backend: kashi-human on the workstation (`lbs` `1e633b8`); I18N-12 with a disposable OTP account, its folder and boards deleted after.
- Build: the worktree front end on `http://localhost:4005` (vite over lekhboard-capacitor `30111bc` and lekhjs `9b66138`), the TS web board; web PDF script fonts from `https://rajeevku02.github.io/lekhboard/fonts/noto/`.
- Browsers: Playwright Chromium 1181 (all cases), Firefox 1489 and WebKit 2191 (all but I18N-12), 1280 × 800, devicePixelRatio 1, `navigator.language` en-US.
- Machine fonts (they draw the raster exports and the PDF image fallback): a Linux workstation with DejaVu, Free*, Liberation, IPA Gothic, WenQuanYi Zen Hei, Loma (Thai), Unifont and Noto Color Emoji only: **no shaping font for Khmer, Myanmar, Telugu, Gurmukhi, Tibetan, no font for CJK Ext B**. A Windows, Mac or Android raster will look better; these rows say what this machine shows.
- References: `references/<board>/` and `metrics.json` from this run's Chromium PDFs (I18N-01, -05, -07); `references/shaping/` from `suite.mjs shaping` with Noto Serif Tibetan added.

## Cases (Chromium)

| Case     | host | device                     | pass/fail | toast seen     | note                                                                                                                                                                                                                                                                                                   |
| -------- | ---- | -------------------------- | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I18N-01  | web  | workstation, Chromium 1181 | **fail**  | yes (want yes) | 42 boxes: 28 text, 5 image as expected (extb, bo, 3 emoji), **9 partial**: ar, ur, fa, bidi-ar, fa-digits (Arabic-script extraction, F1), te, pa (image fallback, F2), km (extra េ, F1), nfd (ı for i, F1). Visual: fa-digits digits reversed (F4), my kinzi wrong (F5), si gaps (F6)                  |
| I18N-02  | web  | workstation, Chromium 1181 | pass      | no             | 9 PNGs in `i18n-scripts.zip`; every box inked; within the reference tolerance. Visual: Khmer, Myanmar, Telugu, Gurmukhi, Tibetan unshaped (Unifont), Ext B tofu: machine fonts                                                                                                                         |
| I18N-03  | web  | workstation, Chromium 1181 | pass      | no             | 9 SVGs; every string code point for code point (NFD kept, ZWNJ/ZWJ kept), `"Noto Sans", sans-serif`, `direction="rtl"` on RTL lines                                                                                                                                                                    |
| I18N-04  | web  | workstation, Chromium 1181 | pass      | no             | JPEG 2×, 4 CJK boxes inked                                                                                                                                                                                                                                                                             |
| I18N-05  | web  | workstation, Chromium 1181 | **fail**  | yes (want yes) | 336 boxes: 270 text, 49 image, 17 partial. Fails: ar, fa in every style and family (F1), pa in every style (F2, image), vi and el in **Caveat** (F3: image, though Noto Sans covers them). Bold uses `<script>-Bold` for every downloaded script; italic is the writer's slant                         |
| I18N-06  | web  | workstation, Chromium 1181 | pass      | no             | 2 PNGs; every box inked, within tolerance                                                                                                                                                                                                                                                              |
| I18N-07  | web  | workstation, Chromium 1181 | **fail**  | yes            | 57 boxes. Containers: shape label, free text and connector label give the same result per script (all fine except ar, fa: F1). Wrapping: th-long extracts คำ as คำา, hi-long ो as े+ा (F1), ar-long garbled (F1). Runs: multi, lines, ar-left, ar-right, decorated fail only on their Arabic part (F1) |
| I18N-08  | web  | workstation, Chromium 1181 | **fail**  | no             | my-long ink ×0.33 of the reference: Myanmar drawn by Unifont with a tofu (machine fonts). No box overflows into its gap                                                                                                                                                                                |
| I18N-09  | web  | workstation, Chromium 1181 | pass      | no             | all strings exact; wrapped boxes break at ICU word boundaries (Thai, Khmer, Myanmar), kinsoku holds (ja, zh), long word broken inside, no break inside a cluster                                                                                                                                       |
| I18N-10  | web  | workstation, Chromium 1181 | pass      | no             | one `出口 निर्यात تصدير.zip`; entries `出口 निर्यात تصدير-中文.png`, `-العربية`, `-हिन्दी`, `-Ελληνικά`, `-Emoji 😀`, `-中文-page6`, UTF-8 flag set, names byte-identical                                                                                                                              |
| I18N-11  | web  | workstation, Chromium 1181 | **fail**  | no (want no)   | `出口 निर्यात تصدير.pdf`, 6 pages, name right; only the Arabic page fails (F1)                                                                                                                                                                                                                         |
| I18N-12  | web  | workstation, Chromium 1181 | **fail**  | not recorded   | one `फ़ोल्डर 文件夹.zip` holding `出口 निर्यात تصدير.pdf` and `i18n-layout.pdf`, names right (UTF-8 flag); the PDFs fail as I18N-11 and I18N-07 (F1)                                                                                                                                                   |
| I18N-13a | web  | workstation, Chromium 1181 | pass      | no (want no)   | Latin/Greek/Cyrillic page only                                                                                                                                                                                                                                                                         |
| I18N-13b | web  | workstation, Chromium 1181 | pass      | no (want no)   | emoji page: 3 boxes, 15 images, no toast                                                                                                                                                                                                                                                               |
| I18N-13c | web  | workstation, Chromium 1181 | pass      | yes (want yes) | Others page: Tibetan an image, the toast                                                                                                                                                                                                                                                               |
| I18N-14  | web  | workstation, Chromium 1181 | **fail**  | yes            | offline after I18N-01: identical to I18N-01 (same 9 partial boxes), so the cached fonts are used                                                                                                                                                                                                       |
| I18N-15  | web  | workstation, Chromium 1181 | pass      | yes (want yes) | Cache Storage before going offline held only `NotoSans-Regular.ttf`; offline: Latin/Greek/Cyrillic text, every other script an image, nothing blank, no error dialog                                                                                                                                   |
| I18N-16  | web  | workstation, Chromium 1181 | pass      | no             | 84 texts (labels and samples) identical; the `.lekh` opens with 9 pages                                                                                                                                                                                                                                |

## PDF mode and face per sample (Chromium)

I18N-01 is the full sample on the Scripts board; the bold column is I18N-05's Styles page, which
draws each sample's short form (so `ur`, `te`, `km`, `nfd` pass there: their short form avoids
the failing glyphs).

| Sample      | I18N-01 mode | face                       | I18N-05 bold (short text) mode | face                                                |
| ----------- | ------------ | -------------------------- | ------------------------------ | --------------------------------------------------- |
| vi          | text         | NotoSans-Regular           | text                           | NotoSans-Regular, NotoSans-Bold                     |
| pl          | text         | NotoSans-Regular           | text                           | NotoSans-Regular, NotoSans-Bold                     |
| tr          | text         | NotoSans-Regular           | text                           | NotoSans-Regular, NotoSans-Bold                     |
| el          | text         | NotoSans-Regular           | text                           | NotoSans-Regular, NotoSans-Bold                     |
| ru          | text         | NotoSans-Regular           | text                           | NotoSans-Regular, NotoSans-Bold                     |
| ar          | partial      | NotoSansArabic-Regular     | partial                        | NotoSansArabic-Bold, NotoSansArabic-Regular         |
| he          | text         | NotoSansHebrew-Regular     | text                           | NotoSansHebrew-Bold, NotoSansHebrew-Regular         |
| ur          | partial      | NotoSansArabic-Regular     | text                           | NotoSansArabic-Bold, NotoSansArabic-Regular         |
| fa          | partial      | NotoSansArabic-Regular     | partial                        | NotoSansArabic-Bold, NotoSansArabic-Regular         |
| hi          | text         | NotoSansDevanagari-Regular | text                           | NotoSansDevanagari-Bold, NotoSansDevanagari-Regular |
| bn          | text         | NotoSansBengali-Regular    | text                           | NotoSansBengali-Bold, NotoSansBengali-Regular       |
| ta          | text         | NotoSansTamil-Regular      | text                           | NotoSansTamil-Bold, NotoSansTamil-Regular           |
| te          | partial      | NotoSans-Regular           | text                           | NotoSansTelugu-Bold, NotoSansTelugu-Regular         |
| kn          | text         | NotoSansKannada-Regular    | text                           | NotoSansKannada-Bold, NotoSansKannada-Regular       |
| ml          | text         | NotoSansMalayalam-Regular  | text                           | NotoSansMalayalam-Bold, NotoSansMalayalam-Regular   |
| gu          | text         | NotoSansGujarati-Regular   | text                           | NotoSansGujarati-Bold, NotoSansGujarati-Regular     |
| pa          | partial      | NotoSans-Regular           | image                          | —                                                   |
| th          | text         | NotoSansThai-Regular       | text                           | NotoSansThai-Bold, NotoSansThai-Regular             |
| lo          | text         | NotoSansLao-Regular        | text                           | NotoSansLao-Bold, NotoSansLao-Regular               |
| km          | partial      | NotoSansKhmer-Regular      | text                           | NotoSansKhmer-Bold, NotoSansKhmer-Regular           |
| my          | text         | NotoSansMyanmar-Regular    | text                           | NotoSansMyanmar-Bold, NotoSansMyanmar-Regular       |
| zh-Hans     | text         | NotoSansSC-Regular         | text                           | NotoSansSC-Bold, NotoSansSC-Regular                 |
| zh-Hant     | text         | NotoSansSC-Regular         | text                           | NotoSansSC-Bold, NotoSansSC-Regular                 |
| ja          | text         | NotoSansJP-Regular         | text                           | NotoSansJP-Bold, NotoSansJP-Regular                 |
| ko          | text         | NotoSansKR-Regular         | text                           | NotoSansKR-Bold, NotoSansKR-Regular                 |
| extb        | image        | —                          | image                          | —                                                   |
| extb-ja     | text         | NotoSansJP-Regular         | text                           | NotoSansJP-Bold, NotoSansJP-Regular                 |
| emoji-zwj   | image        | —                          | image                          | —                                                   |
| emoji-flags | image        | —                          | image                          | —                                                   |
| emoji-skin  | image        | —                          | image                          | —                                                   |
| am          | text         | NotoSansEthiopic-Regular   | text                           | NotoSansEthiopic-Bold, NotoSansEthiopic-Regular     |
| ka          | text         | NotoSansGeorgian-Regular   | text                           | NotoSansGeorgian-Bold, NotoSansGeorgian-Regular     |
| hy          | text         | NotoSansArmenian-Regular   | text                           | NotoSansArmenian-Bold, NotoSansArmenian-Regular     |
| bo          | image        | —                          | image                          | —                                                   |
| si          | text         | NotoSansSinhala-Regular    | text                           | NotoSansSinhala-Bold, NotoSansSinhala-Regular       |
| bidi-ar     | partial      | NotoSansArabic-Regular     | text                           | NotoSans-Regular, NotoSans-Bold                     |
| bidi-he     | text         | NotoSansHebrew-Regular     | text                           | NotoSans-Regular, NotoSans-Bold                     |
| fa-digits   | partial      | NotoSansArabic-Regular     | text                           | NotoSansArabic-Bold, NotoSansArabic-Regular         |
| nfc         | text         | NotoSansKR-Regular         | text                           | NotoSans-Regular, NotoSans-Bold                     |
| nfd         | partial      | NotoSansKR-Regular         | text                           | NotoSans-Regular, NotoSans-Bold                     |
| combining   | text         | NotoSans-Regular           | text                           | NotoSans-Regular, NotoSans-Bold                     |
| long        | text         | NotoSans-Regular           | text                           | NotoSans-Regular, NotoSans-Bold                     |

## Firefox and WebKit

`playwright.browsers.config.js --project=firefox|webkit`, the same cases but I18N-12. The PDF is
built by the same lekhjs code, so the PDF failures F1–F3 repeat in both; the differences from
Chromium:

| Case                           | Firefox                                                                                                                                                                   | WebKit                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I18N-01, -05, -07, -11         | as Chromium                                                                                                                                                               | as Chromium, and **extb blank** (WebKit/Linux draws nothing for a character no font has, where Chromium draws tofu; the image fallback is empty): machine fonts |
| I18N-02, -06                   | extb ink ×4.3–5.3 of the reference: Firefox draws hex-code boxes for Ext B (machine fonts)                                                                                | extb blank, as above                                                                                                                                            |
| I18N-08                        | km-long: 0.38 % ink in the gap right of the box (Unifont Khmer drawn wider than measured; machine fonts)                                                                  | pass                                                                                                                                                            |
| I18N-09                        | my-long breaks at ကား\|လုံ, not an ICU word boundary of Node: Firefox's segmenter breaks Myanmar by syllable (acceptable line break; a platform difference, not a defect) | pass                                                                                                                                                            |
| I18N-14, I18N-15               | as Chromium                                                                                                                                                               | **every image-fallback run missing** (emoji, Tibetan, Ext B; in I18N-15 every non-Latin script): F7                                                             |
| I18N-03, -04, -10, -13a…c, -16 | pass                                                                                                                                                                      | pass                                                                                                                                                            |

## Failures and their causes

**F1. Text extracted from the web PDF is wrong for glyphs that are not one-to-one with
characters** (ar, ur, fa, bidi-ar, fa-digits, km, nfd, th-long, hi-long, every Arabic run on
every page). The ToUnicode CMap is written by PDFKit from fontkit's `glyph.codePoints`, **one
entry per glyph id, from the first time the glyph is used** (pdfkit `js/pdfkit.browser.mjs:3591-3592`,
`EmbeddedFont.encode`; CMap at `:3688`). Noto Sans Arabic draws ة, ي, ق, خ, ی … as a dotless base
glyph plus separate dot glyphs, so the base glyph maps to whichever letter used it first (ة
extracts as ه, ح as خ, ی as ي/ٹ) and the dot glyphs, which have no code points, map to `<>` and
extract as control characters (U+0001…U+001E). The same rule loses a two-part vowel's identity
where the font reuses a glyph: Khmer ោ extracts as េ+ោ, Thai ำ as ำ+า, Devanagari ो as े+ा, and
NFD i+◌̈ as ı+◌̈ (the font's ccmp swaps in dotless ı). The PDF draws correctly; only copy, search
and accessibility get the wrong text. lekhjs hands each run to `doc.text` (lekhjs
`src/export/pdf/pdf-text-writer.ts:155`). A fix would be an `/ActualText` span per run (PDFKit's
marked content) or per-run ToUnicode, owner to decide.

**F2. Telugu and Gurmukhi are drawn as images on the web PDF** (te in I18N-01, pa everywhere; the
toast is raised). fontkit 2.0.4 throws `Cannot read properties of null (reading 'xCoordinate')`
laying out these Noto fonts: a mark-to-base anchor offset of NULL (allowed by OpenType) is
dereferenced (`node_modules/fontkit/dist/module.mjs:9962` `applyAnchor` → `:9972` `getAnchor`).
lekhjs then refuses the face (`src/export/pdf/font-embedding.ts:158` `layoutWorks`, or
`pdf-font-resolver.ts:149` drops it in `prepare`) and draws the run with the host canvas, which
on this machine has no Telugu/Gurmukhi shaping font. Whether it throws depends on the run's text
(`తెలుగు` alone lays out; the full sample does not; `ਪੰਜਾਬੀ` alone throws). Fix: guard null anchors
in fontkit (patch) or skip the lookup.

**F3. In Caveat (and any bundled family lacking a script), Greek and Vietnamese become images**
(I18N-05 Families: el, vi). The box's primary font is Caveat; its uncovered clusters ask the
providers for a fallback, but the bundled source answers only the requested family
(`src/export/pdf/bundled-font-source.ts:49-50`), the primary is skipped (`pdf-font-resolver.ts:350`)
and the default family is tried only for the primary (`pdf-font-resolver.ts:285-286`); the web
provider has no Greek/Latin download. So the run is an image (with the toast) although Noto Sans,
bundled, covers it; on screen the browser falls back to another face. Fix: try
`DEFAULT_FONT_FAMILY` for uncovered runs before the image fallback.

**F4. Persian (Extended Arabic-Indic) digits are reversed in the PDF**: `۱۲۳٫۴۵` is drawn
`۵۴٫۳۲۱` (visual only; not caught automatically — the extracted characters are all there).
The digits are bidi class EN, so they sit at an even level and `BidiResolver.runText` passes
them unchanged (`src/export/pdf/bidi-resolver.ts:77`), but fontkit chooses the run's direction
from its Unicode script (Arabic) and reverses the glyphs (`fontkit module.mjs:6249`); PDFKit
calls `layout(text, features)` without a direction (`pdfkit.browser.mjs:3527`). The canvas, PNG
and SVG are right. Arabic-Indic digits (U+0660…) take the same path.

**F5. Myanmar kinzi is not formed in the PDF**: in မင်္ဂလာပါ the kinzi (င်္) should be a small
mark above ဂ (references/shaping); the PDF draws င, ် and a stacking sign ္ below it. fontkit's
layout returns the three as separate glyphs, not reordered (`fontkit.layout` output: `8[င] 381[်]
380[္] 6[ဂ]`). Visual only.

**F6. Sinhala has gaps inside words in the PDF** (`ආයු  බෝවන්`, `ශ්‍රී  ලංකා`): fontkit gives
the vowel sign ු (U+0DD4) an advance of 739 units with an x offset of −802 instead of a zero
advance, so the pen moves on after the mark. Visual only.

**F7. WebKit offline: image-fallback runs are dropped from the PDF** (I18N-14, I18N-15). Under
Playwright's offline emulation `Blob.arrayBuffer()` of the canvas's `toBlob` rejects with
`NotReadableError` (lekhboard-capacitor `src/board/export/browserCanvas.ts:67`), `RunImageFallback`
catches it and returns no image (lekhjs `src/export/pdf/run-image-fallback.ts:55-57`), and the
run is left out silently (the toast still appears). Real Safari offline is not verified (the
emulation may be the cause), but the silent drop is a product gap: a run whose image cannot be
encoded vanishes without a warning of its own.

**Ext B (not a failure, a documented web limitation):** `extb` is an image on the web because
Han without kana asks for Noto Sans SC (`src/export/pdf/web-script-font-provider.ts:55-68`),
which lacks it, although Noto Sans TC has all four characters; the image is drawn by the host's
fonts, so on this machine it is tofu. Japanese text without kana (日本語) also gets SC shapes.

**Raster on this machine (not product failures):** Khmer, Myanmar, Telugu, Gurmukhi and Tibetan
are drawn by Unifont without shaping, Ext B as tofu: the raster export uses the browser's fonts,
as the screen does. Only my-long fell outside the reference tolerance (I18N-08).

## Visual checklist (agent, Chromium)

Checked by eye on the PDF renders (`references/scripts/`, `layout/`) against
`references/shaping/`: Latin, Greek, Cyrillic, Hebrew, Arabic, Urdu, Persian (ZWNJ kept the ی of
می unjoined), Devanagari, Bengali, Tamil, Kannada, Malayalam, Gujarati, Thai, Lao, Khmer, CJK,
Ethiopic, Georgian, Armenian, the bidi rows (but F4), NFC = NFD, the combining stacks, the long
word wrapped inside its box, emoji single and coloured: right. Wrong: F4, F5, F6; te, pa, bo, extb
are the host's image (unshaped / tofu on this machine).

## Observations

- In WebKit the :4005 front end also requested `https://devapi.lekh.app/status` and
  `…/v1.1/usage/events` (failed offline); unrelated to export, noted for the owner.
- The export of the 9-page scripts board took 10–25 s with all script fonts downloaded the first
  time (about 50 MB from GitHub Pages) and 5 s from Cache Storage.
