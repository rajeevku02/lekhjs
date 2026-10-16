# Bundled fonts: licences

lekhjs bundles four font families. All four are licensed under the SIL Open Font License,
Version 1.1, whose full text travels next to the fonts as `<family>/OFL.txt` (OFL §2) and must be
copied with them into every bundle. None of the four `OFL.txt` files declares a Reserved Font
Name (checked 2026-10-16, OQ-36), so the WOFF2 subsets generated here keep the family names.

The TTFs are the published files, unmodified. The WOFF2 files under each `woff2/` folder are
subsets of those TTFs, cut by `build-fonts.mjs` with fontTools `pyftsubset` to the Google Fonts
subset split and `unicode-range` values (`latin`, `latin-ext`, `greek`, `cyrillic`, `vietnamese`;
Caveat: `latin`, `latin-ext`, `cyrillic`). `fonts.json` records the sha256 of every file.

## Noto Sans

Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic).
Licensed under the SIL Open Font License, Version 1.1. Version 2.015, static unhinted TTFs
(`NotoSans/unhinted/ttf/`) from
https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSans-v2.015/NotoSans-v2.015.zip
(zip sha256 `0c34df072a3fa7efbb7cbf34950e1f971a4447cffe365d3a359e2d4089b958f5`).

## Noto Serif

Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic).
Licensed under the SIL Open Font License, Version 1.1. Version 2.015, static unhinted TTFs
(`NotoSerif/unhinted/ttf/`) from
https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSerif-v2.015/NotoSerif-v2.015.zip
(zip sha256 `0e9a43c8a4b94ac76f55069ed1d7385bbcaf6b99527a94deb5619e032b7e76c1`).

## Noto Sans Mono

Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic).
Licensed under the SIL Open Font License, Version 1.1. Version 2.014, static unhinted TTFs
(`NotoSansMono/unhinted/ttf/`) from
https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSansMono-v2.014/NotoSansMono-v2.014.zip
(zip sha256 `090cf6c5e03f337a755630ca888b1fef463e64ae7b33ee134e9309c05f978732`).

## Caveat

Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat). Licensed under
the SIL Open Font License, Version 1.1. Version 2.000, the static TTFs Google Fonts published in
`google/fonts` at commit `a85fc09e44c70c7159761adfdc9d5dd007792c15` (the last version with static
instances; the variable `Caveat[wght].ttf` is unchanged since):

- https://raw.githubusercontent.com/google/fonts/a85fc09e44c70c7159761adfdc9d5dd007792c15/ofl/caveat/static/Caveat-Regular.ttf
  (sha256 `7af58d70e539c9195cc328617a68c9961ed804a4404b0b818989ba7c013e8776`)
- https://raw.githubusercontent.com/google/fonts/a85fc09e44c70c7159761adfdc9d5dd007792c15/ofl/caveat/static/Caveat-Bold.ttf
  (sha256 `29e5cf4177d79af56c256c24f687fd6a74c3d04c3c4660ccca87b0a6d1fa3452`)
- https://raw.githubusercontent.com/google/fonts/a85fc09e44c70c7159761adfdc9d5dd007792c15/ofl/caveat/OFL.txt
  (sha256 `1f9d81d094273d82f3898a1ee8b598a717d050ecbf5ff7bede105b704880157b`)

## TTF checksums

| File                                      | sha256                                                             |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `noto-sans/NotoSans-Regular.ttf`          | `f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8` |
| `noto-sans/NotoSans-Bold.ttf`             | `87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9` |
| `noto-sans/NotoSans-Italic.ttf`           | `678288f868807d4d64a6f3b51466871d117d915780381ce9d0ed4b3bcbd06d37` |
| `noto-sans/NotoSans-BoldItalic.ttf`       | `3d367743f371f28671d2764e911a53d7c20ec9b6aa8791d059e7090389fc52a5` |
| `noto-serif/NotoSerif-Regular.ttf`        | `a15cfbbc1539d707115111d672d590a3d70d4f74b4c0a315956da20ae19a14e1` |
| `noto-serif/NotoSerif-Bold.ttf`           | `24ad531e6b05ddad8c3d89572d2c93eb86a6b74e652ce7ee3c3e171de68e84c3` |
| `noto-serif/NotoSerif-Italic.ttf`         | `c4b3c971741ecdb40f5a443bce754e8fe91efe761b6ea10c92be7c3597cdadc4` |
| `noto-serif/NotoSerif-BoldItalic.ttf`     | `1bc4f86502eaa368718f6192bee022ea9a703d5af1c18b7d291212657b63074a` |
| `noto-sans-mono/NotoSansMono-Regular.ttf` | `87f8ce0522a6c99b743ee5fc75b4073cfdd575639119672828b7b9944b65b4f4` |
| `noto-sans-mono/NotoSansMono-Bold.ttf`    | `1100772b2f79c102402a1011df5e2226517d0f40ac553a25fb12fdbad8c11b85` |
| `caveat/Caveat-Regular.ttf`               | `7af58d70e539c9195cc328617a68c9961ed804a4404b0b818989ba7c013e8776` |
| `caveat/Caveat-Bold.ttf`                  | `29e5cf4177d79af56c256c24f687fd6a74c3d04c3c4660ccca87b0a6d1fa3452` |
| `*/OFL.txt` (Noto)                        | `cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a` |
| `caveat/OFL.txt`                          | `1f9d81d094273d82f3898a1ee8b598a717d050ecbf5ff7bede105b704880157b` |
