# Test fonts for the PDF export suites

Subsets of OFL-1.1 fonts (licence: `OFL.txt`), made with fontTools `pyftsubset` for
`test/export/pdf-*.test.ts` and `font-chain.test.ts` (Work 01M4X7TCHFB862XGT68GPY071C, F1):

| File                            | Made from                                                                | Used for                   |
| ------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| `NotoSansArabic-subset.ttf`     | Noto Sans Arabic Regular (notofonts.github.io), U+0600-06FF, U+FE70-FEFF | Arabic runs, bidi          |
| `NotoSansDevanagari-subset.ttf` | Noto Sans Devanagari Regular, U+0900-097F                                | Devanagari runs            |
| `NotoSansSC-subset.otf`         | Noto Sans SC Regular (noto-cjk SubsetOTF, CFF), a few Han and kana       | Han runs, a CFF font       |
| `NotoSansVariable-ascii.ttf`    | Noto Sans `[wdth,wght]` variable (google/fonts), ASCII                   | variable font → outlines   |
| `Restricted-fsType2.ttf`        | bundled Noto Sans Regular, ASCII, OS/2 `fsType` set to 2 and renamed     | restricted font → outlines |
| `NotoSans-RegularBold.ttc`      | bundled Noto Sans Regular and Bold, ASCII, as a two-face collection      | TTC face selection         |
