# Multilingual export suite results: <host>, <date>

Suite: `lekhjs/parity/device-checklist/export-i18n/README.md` (round I18N1). Copy this file to
`lekhjs/parity/device-checklist/export-i18n/results/<host>-<date>.md`.

- Backend: <kashi on the workstation / dev site / other>, `lbs` <commit>, `lekhjs` <commit>.
- Build: <web: lekhboard-capacitor commit and URL / TestFlight or Play internal build and the native commit>.
- Device: <model>, <OS>, browser <name and version>, devicePixelRatio <n>, system language <xx-YY>.
- Run by: <owner / agent>, <date>.
- Checker: `node parity/device-checklist/export-i18n/suite.mjs check <id> --host <host> [--dpr <n>] --toast yes|no <files>`.

## Cases

One line per case. Note: the checker's FAIL lines in short (target, mode, what was extracted),
the toast seen, timings if notable.

| Case     | host   | device   | pass/fail | toast seen | note |
| -------- | ------ | -------- | --------- | ---------- | ---- |
| I18N-01  | <host> | <device> |           |            |      |
| I18N-02  | <host> | <device> |           |            |      |
| I18N-03  | <host> | <device> |           |            |      |
| I18N-04  | <host> | <device> |           |            |      |
| I18N-05  | <host> | <device> |           |            |      |
| I18N-06  | <host> | <device> |           |            |      |
| I18N-07  | <host> | <device> |           |            |      |
| I18N-08  | <host> | <device> |           |            |      |
| I18N-09  | <host> | <device> |           |            |      |
| I18N-10  | <host> | <device> |           |            |      |
| I18N-11  | <host> | <device> |           |            |      |
| I18N-12  | <host> | <device> |           |            |      |
| I18N-13a | <host> | <device> |           |            |      |
| I18N-13b | <host> | <device> |           |            |      |
| I18N-13c | <host> | <device> |           |            |      |
| I18N-14  | <host> | <device> |           |            |      |
| I18N-15  | <host> | <device> |           |            |      |
| I18N-16  | <host> | <device> |           |            |      |

## PDF mode per sample (I18N-01 and I18N-05)

From `--json` (or the e2e spec's `targets/I18N-01.json`): the mode (text / image / outline /
partial / missing) and the face of every sample, regular and bold. Mark a cell that differs from
`samples.json` and give the reason.

| Sample      | regular: mode | face | bold: mode | face |
| ----------- | ------------- | ---- | ---------- | ---- |
| vi          |               |      |            |      |
| pl          |               |      |            |      |
| tr          |               |      |            |      |
| el          |               |      |            |      |
| ru          |               |      |            |      |
| ar          |               |      |            |      |
| he          |               |      |            |      |
| ur          |               |      |            |      |
| fa          |               |      |            |      |
| hi          |               |      |            |      |
| bn          |               |      |            |      |
| ta          |               |      |            |      |
| te          |               |      |            |      |
| kn          |               |      |            |      |
| ml          |               |      |            |      |
| gu          |               |      |            |      |
| pa          |               |      |            |      |
| th          |               |      |            |      |
| lo          |               |      |            |      |
| km          |               |      |            |      |
| my          |               |      |            |      |
| zh-Hans     |               |      |            |      |
| zh-Hant     |               |      |            |      |
| ja          |               |      |            |      |
| ko          |               |      |            |      |
| extb        |               |      |            |      |
| extb-ja     |               |      |            |      |
| emoji-zwj   |               |      |            |      |
| emoji-flags |               |      |            |      |
| emoji-skin  |               |      |            |      |
| am          |               |      |            |      |
| ka          |               |      |            |      |
| hy          |               |      |            |      |
| bo          |               |      |            |      |
| si          |               |      |            |      |
| bidi-ar     |               |      |            |      |
| bidi-he     |               |      |            |      |
| fa-digits   |               |      |            |      |
| nfc         |               |      |            |      |
| nfd         |               |      |            |      |
| combining   |               |      |            |      |
| long        |               |      |            |      |

## Visual checklist (README §6)

| Sample      | Language                              | Text                                                                                                     | Look for                                                                                                                                                                 | PDF / PNG / SVG ok? |
| ----------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| vi          | Vietnamese                            | Tiếng Việt có dấu: Ặ ặ Ẩ ẩ Ỡ ỡ Ữ ữ đ                                                                     | two marks on one letter (breve or circumflex plus a tone mark), not overlapping; đ with its bar                                                                          |                     |
| pl          | Polish                                | Zażółć gęślą jaźń                                                                                        | ogonek under ą ę, acute on ó ś ć ź ń, dot on ż                                                                                                                           |                     |
| tr          | Turkish                               | İstanbul ılık; Iı İi Şş Ğğ                                                                               | capital İ has a dot, ı has none; cedilla on Ş ş                                                                                                                          |                     |
| el          | Greek                                 | Ξεσκεπάζω την ψυχοφθόρα βδελυγμία                                                                        | tonos accents on ά ό ί                                                                                                                                                   |                     |
| ru          | Russian                               | Съешь же ещё этих мягких французских булок                                                               | ё with diaeresis                                                                                                                                                         |                     |
| ar          | Arabic                                | السلام عليكم ورحمة الله                                                                                  | letters joined, read right to left; lam-alef ligature لا in السلام; the word order right to left                                                                         |                     |
| he          | Hebrew                                | שלום עולם, עברית                                                                                         | right to left; final mem ם at the word end; the comma after עולם on its left                                                                                             |                     |
| ur          | Urdu                                  | اردو: یہ ٹھیک ہے                                                                                         | Urdu letters ٹ (tteh), ھ (do-chashmi he), ہ, ے (bari ye) joined; Naskh style is expected (not Nastaliq) where the font is Noto Sans Arabic                               |                     |
| fa          | Persian                               | من می‌خواهم فارسی بنویسم                                                                                 | ZWNJ: in می‌خواهم the ی of می is NOT joined to خ, but the word has no space either                                                                                       |                     |
| hi          | Hindi                                 | हिन्दी: क्षत्रिय, कार्य, श्री                                                                            | ि drawn left of its consonant (हि, त्रि); conjuncts क्ष, न्द, त्र; reph र् as a hook above य in कार्य; श्री                                                              |                     |
| bn          | Bengali                               | বাংলা: শিক্ষা, রাষ্ট্র                                                                                   | ি left of শ; conjuncts ক্ষ and ষ্ট্র                                                                                                                                     |                     |
| ta          | Tamil                                 | தமிழ்: வணக்கம், கொண்டு                                                                                   | two-part vowel ொ: ெ left and ா right of க in கொ; pulli dots (்)                                                                                                          |                     |
| te          | Telugu                                | తెలుగు: ప్రపంచం, క్షేమం                                                                                  | subjoined ర under ప in ప్ర; క్ష conjunct                                                                                                                                 |                     |
| kn          | Kannada                               | ಕನ್ನಡ: ಪ್ರಪಂಚ, ಕ್ಷೇಮ                                                                                     | subjoined forms ನ್ನ, ಪ್ರ, ಕ್ಷ                                                                                                                                            |                     |
| ml          | Malayalam                             | മലയാളം: ലോകം, അവൻ, ക്ഷ                                                                                   | two-part vowel ോ around ല; chillu ൻ; conjunct ക്ഷ                                                                                                                        |                     |
| gu          | Gujarati                              | ગુજરાતી: નમસ્તે, ક્ષમા                                                                                   | conjuncts સ્ત, ક્ષ; ુ below ગ                                                                                                                                            |                     |
| pa          | Punjabi (Gurmukhi)                    | ਪੰਜਾਬੀ: ਸਤ ਸ੍ਰੀ ਅਕਾਲ                                                                                     | subjoined ਰ in ਸ੍ਰੀ; tippi ੰ                                                                                                                                             |                     |
| th          | Thai                                  | สวัสดีชาวโลก ภาษาไทย                                                                                     | vowel and tone marks stacked above/below (สวัสดี, ไทย) without colliding                                                                                                 |                     |
| lo          | Lao                                   | ສະບາຍດີ ພາສາລາວ                                                                                          | marks above and below                                                                                                                                                    |                     |
| km          | Khmer                                 | សួស្តីពិភពលោក ភាសាខ្មែរ                                                                                  | subscript consonants (coeng): ស្ត, ខ្ម; pre-base vowel េ left of ល, ែ around ខ្ម                                                                                         |                     |
| my          | Burmese                               | မင်္ဂလာပါ မြန်မာဘာသာ                                                                                     | kinzi င်္ drawn above ဂ; medial ြ wrapping around မ in မြ                                                                                                                |                     |
| zh-Hans     | Chinese (Simplified)                  | 简体中文：你好，世界！                                                                                   | Simplified forms 简 体; full-width punctuation                                                                                                                           |                     |
| zh-Hant     | Chinese (Traditional)                 | 繁體中文：你好，世界！                                                                                   | Traditional forms 繁 體; on the web the PDF draws them with Noto Sans SC (Han → SC unless the browser language is zh-TW/HK), so mainland glyph shapes are expected there |                     |
| ja          | Japanese                              | 日本語：こんにちは、カタカナ、漢字                                                                       | kana and kanji; Japanese glyph shapes (Noto Sans JP on the web because the text has kana)                                                                                |                     |
| ko          | Korean                                | 한국어: 안녕하세요 세계                                                                                  | Hangul syllables                                                                                                                                                         |                     |
| extb        | CJK Extension B (Cantonese)           | 𠜎𠜱𠝹𠱓                                                                                                 | four Han characters, none a tofu box                                                                                                                                     |                     |
| extb-ja     | CJK Extension B in Japanese           | 𩸽（ほっけ）                                                                                             | 𩸽 is a single fish-radical character, not a box                                                                                                                         |                     |
| emoji-zwj   | Emoji ZWJ sequences                   | 👨‍👩‍👧‍👦 👩🏽‍💻 🧑‍🤝‍🧑                                                                                                 | each ZWJ sequence is ONE glyph (a family, a woman technologist, people holding hands), not its parts side by side                                                        |                     |
| emoji-flags | Emoji flags                           | 🇮🇳 🇯🇵 🇧🇷 🏳️‍🌈 🏴󠁧󠁢󠁳󠁣󠁴󠁿                                                                                           | five flags; a platform without the Scotland flag shows a black flag, never letters                                                                                       |                     |
| emoji-skin  | Emoji skin tones and keycaps          | 👍🏻 👍🏼 👍🏽 👍🏾 👍🏿 1️⃣ #️⃣                                                                                     | five thumbs in five skin tones (not a thumb plus a colour square); keycaps 1 and #                                                                                       |                     |
| am          | Amharic (Ethiopic)                    | ሰላም ለዓለም፣ አማርኛ                                                                                           | Ethiopic syllables; ፣ is the Ethiopic comma                                                                                                                              |                     |
| ka          | Georgian                              | გამარჯობა მსოფლიო, ქართული                                                                               | Mkhedruli letters                                                                                                                                                        |                     |
| hy          | Armenian                              | Բարեւ աշխարհ, Հայերեն                                                                                    | Armenian capitals Բ Հ                                                                                                                                                    |                     |
| bo          | Tibetan                               | བཀྲ་ཤིས་བདེ་ལེགས། བོད་ཡིག                                                                                | stacked ཀྲ; tsheg dots ་ between syllables; shad །                                                                                                                       |                     |
| si          | Sinhala                               | ආයුබෝවන්, ශ්‍රී ලංකා                                                                                     | two-part vowel ෝ; ශ්‍රී written with ZWJ as the rakaransaya (conjunct) form                                                                                              |                     |
| bidi-ar     | Mixed bidi, LTR paragraph             | Order 66 costs 1,234.50 ريال (العربية 2024) today                                                        | the Arabic words read right to left inside the English sentence; 1,234.50 and 2024 keep their digit order; the parentheses mirror correctly                              |                     |
| bidi-he     | Mixed bidi, RTL paragraph             | עברית with English and 123 מספרים                                                                        | paragraph is right to left (starts at the right with עברית); "with English and 123" reads left to right inside it                                                        |                     |
| fa-digits   | Persian digits                        | قیمت ۱۲۳٫۴۵ تومان                                                                                        | Extended Arabic-Indic digits ۱۲۳٫۴۵ read left to right inside the RTL line                                                                                               |                     |
| nfc         | Precomposed (NFC)                     | café naïve Ệ 한                                                                                          | looks identical to the NFD row below                                                                                                                                     |                     |
| nfd         | Decomposed (NFD)                      | café naïve Ệ 한                                                                                        | looks identical to the NFC row above: marks on their letters, 한 one syllable block (not three jamo)                                                                     |                     |
| combining   | Combining-mark stacks                 | ậ́ ǭ x̰̱̃ é́́                                                                                                  | marks stacked above and below their base letter, not drawn after it or on top of each other                                                                              |                     |
| long        | Very long unbroken string             | Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft                         | one word wider than its box: broken inside the word, every letter present, nothing outside the box                                                                       |                     |
| multi       | Several scripts in one line           | Latin 中文 العربية हिन्दी ไทย ქართული 😀 end                                                             | each script in its own shape, in this order left to right except the Arabic word, which reads right to left; the emoji in colour                                         |                     |
| lines       | Three lines, three directions         | First line in English / سطر عربي ثانٍ / तीसरी पंक्ति हिन्दी                                              | three lines; the Arabic line is right to left                                                                                                                            |                     |
| ar-left     | Arabic, left aligned                  | السلام عليكم ورحمة الله                                                                                  | the Arabic line starts at the left edge of the box                                                                                                                       |                     |
| ar-right    | Arabic, right aligned                 | السلام عليكم ورحمة الله                                                                                  | the Arabic line ends at the right edge of the box                                                                                                                        |                     |
| decorated   | Bold italic underline across scripts  | مرحبا 你好 नमस्ते                                                                                        | bold, slanted, one underline under all three words                                                                                                                       |                     |
| th-long     | Thai paragraph                        | ภาษาไทยไม่มีการเว้นวรรคระหว่างคำจึงต้องตัดคำตามพจนานุกรม                                                 | broken between words (ภาษาไทย                                                                                                                                            | ไม่มี               | การ…), never inside a syllable |     |
| km-long     | Khmer paragraph                       | ភាសាខ្មែរមិនមានដកឃ្លារវាងពាក្យទេ ដូច្នេះត្រូវកាត់ពាក្យតាមវចនានុក្រម                                      | broken between words, never between a consonant and its subscript (្)                                                                                                    |                     |
| my-long     | Burmese paragraph                     | မြန်မာဘာသာတွင်စကားလုံးများကြားတွင်နေရာလွတ်မရှိပါ                                                         | broken between syllables/words, never between a consonant and its medial or vowel sign                                                                                   |                     |
| zh-long     | Chinese paragraph                     | 这是一个没有空格的中文段落用于检查固定宽度的文本框是否在框内正确换行并且不会溢出到框外面去               | broken between any two characters; no line starts with ，。                                                                                                              |                     |
| ja-long     | Japanese paragraph                    | 日本語の文章は単語の間に空白がないので任意の文字の間で改行できます。「括弧」や句読点、は行頭に来ません。 | no line starts with 、。」 (kinsoku); no line ends with 「                                                                                                               |                     |
| ko-long     | Korean paragraph                      | 한국어는 단어 사이에 띄어쓰기를 사용하지만 긴 문장은 여러 줄로 나뉘어야 합니다.                          | broken at spaces (or between syllables), syllable blocks intact                                                                                                          |                     |
| ar-long     | Arabic paragraph                      | هذا نص عربي طويل يجب أن يلتف على عدة أسطر داخل المربع الضيق                                              | each line right to left, the first words on the first line at the right; letters joined                                                                                  |                     |
| hi-long     | Hindi paragraph                       | यह एक लंबा हिन्दी वाक्य है जो संकरे बक्से में कई पंक्तियों में टूटना चाहिए                               | broken at spaces; no conjunct split across lines                                                                                                                         |                     |
| long-narrow | Very long unbroken string, narrow box | Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft                         | broken inside the word on many lines, nothing to the right of the box                                                                                                    |                     |
| mixed-long  | Mixed Latin and CJK paragraph         | Lekh は whiteboard アプリ with 中文 text and English words mixed together.                               | Latin words not broken inside; CJK broken anywhere                                                                                                                       |                     |

## Observations

<anything not covered by a case: the platform viewer's copy/paste, the progress modal, timings>
