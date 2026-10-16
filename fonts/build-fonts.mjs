// Regenerates the WOFF2 subsets and fonts.json from the committed TTFs (spec 06 §7.2).
// Dev-time only; the outputs are committed, so nothing runs this in a build.
//
//   node fonts/build-fonts.mjs            rebuild woff2/ subsets + fonts.json
//   node fonts/build-fonts.mjs --manifest rewrite fonts.json only (no subsetting)
//   node fonts/build-fonts.mjs --verify   check fonts.json against the files (exit 1 on drift)
//
// Subsetting shells out to fontTools' `pyftsubset` (`pip install fonttools brotli`); set
// PYFTSUBSET to another executable if it is not on PATH. The TTFs themselves are Google's
// published files, unmodified (OQ-36); only the WOFF2 subsets are produced here.
// Manifest metrics are read with fontkit: hhea ascender/descender and head.unitsPerEm, the
// OQ-38 fallback when a canvas has no fontBoundingBox* metrics.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as fontkit from 'fontkit';

const FONTS = import.meta.dirname;

/**
 * The Google Fonts subset split and unicode-range values, as served by the CSS2 API
 * (fonts.googleapis.com/css2, retrieved 2026-10-16). Only the five subsets of OQ-35.
 */
export const SUBSETS = Object.freeze({
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext':
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
  greek: 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF',
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  vietnamese:
    'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
});

const ALL = ['latin', 'latin-ext', 'greek', 'cyrillic', 'vietnamese'];

/**
 * @typedef {{ weight: 400 | 700, style: 'normal' | 'italic', file: string }} FaceSpec
 * @typedef {{ family: string, dir: string, generic: string, subsets: string[],
 *   source: { url: string, version: string }, faces: FaceSpec[] }} FamilySpec
 */

/** Fixed order (spec 06 §7.3): Noto Sans, Noto Serif, Noto Sans Mono, Caveat. @type {FamilySpec[]} */
export const FAMILIES = [
  {
    family: 'Noto Sans',
    dir: 'noto-sans',
    generic: 'sans-serif',
    subsets: ALL,
    source: {
      url: 'https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSans-v2.015/NotoSans-v2.015.zip',
      version: '2.015',
    },
    faces: [
      { weight: 400, style: 'normal', file: 'NotoSans-Regular.ttf' },
      { weight: 700, style: 'normal', file: 'NotoSans-Bold.ttf' },
      { weight: 400, style: 'italic', file: 'NotoSans-Italic.ttf' },
      { weight: 700, style: 'italic', file: 'NotoSans-BoldItalic.ttf' },
    ],
  },
  {
    family: 'Noto Serif',
    dir: 'noto-serif',
    generic: 'serif',
    subsets: ALL,
    source: {
      url: 'https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSerif-v2.015/NotoSerif-v2.015.zip',
      version: '2.015',
    },
    faces: [
      { weight: 400, style: 'normal', file: 'NotoSerif-Regular.ttf' },
      { weight: 700, style: 'normal', file: 'NotoSerif-Bold.ttf' },
      { weight: 400, style: 'italic', file: 'NotoSerif-Italic.ttf' },
      { weight: 700, style: 'italic', file: 'NotoSerif-BoldItalic.ttf' },
    ],
  },
  {
    family: 'Noto Sans Mono',
    dir: 'noto-sans-mono',
    generic: 'monospace',
    subsets: ALL,
    source: {
      url: 'https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSansMono-v2.014/NotoSansMono-v2.014.zip',
      version: '2.014',
    },
    faces: [
      { weight: 400, style: 'normal', file: 'NotoSansMono-Regular.ttf' },
      { weight: 700, style: 'normal', file: 'NotoSansMono-Bold.ttf' },
    ],
  },
  {
    family: 'Caveat',
    dir: 'caveat',
    generic: 'cursive',
    subsets: ['latin', 'latin-ext', 'cyrillic'],
    source: {
      url: 'https://github.com/google/fonts/tree/a85fc09e44c70c7159761adfdc9d5dd007792c15/ofl/caveat/static',
      version: '2.000',
    },
    faces: [
      { weight: 400, style: 'normal', file: 'Caveat-Regular.ttf' },
      { weight: 700, style: 'normal', file: 'Caveat-Bold.ttf' },
    ],
  },
];

/** @param {string} rel path relative to fonts/ */
function fileInfo(rel) {
  const buf = readFileSync(path.join(FONTS, rel));
  return { file: rel, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** @param {string} ttf face file name @param {string} subset */
function woff2Name(ttf, subset) {
  return ttf.replace(/\.ttf$/, `.${subset}.woff2`);
}

/** @param {FamilySpec} fam @param {FaceSpec} face @param {string} subset */
function subsetOne(fam, face, subset) {
  const range = SUBSETS[/** @type {keyof typeof SUBSETS} */ (subset)];
  const out = path.join(FONTS, fam.dir, 'woff2', woff2Name(face.file, subset));
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(
    process.env.PYFTSUBSET ?? 'pyftsubset',
    [
      path.join(FONTS, fam.dir, face.file),
      `--unicodes=${range.replace(/\s/g, '')}`,
      '--flavor=woff2',
      '--layout-features=*',
      '--name-IDs=*',
      '--name-languages=*',
      `--output-file=${out}`,
    ],
    { stdio: 'inherit' },
  );
}

/** @param {string} rel */
function hhea(rel) {
  const font = /** @type {{ ascent: number, descent: number, lineGap: number, unitsPerEm: number }} */ (
    /** @type {unknown} */ (fontkit.openSync(path.join(FONTS, rel)))
  );
  return { ascender: font.ascent, descender: font.descent, lineGap: font.lineGap, unitsPerEm: font.unitsPerEm };
}

export function buildManifest() {
  return {
    $comment: 'Generated by fonts/build-fonts.mjs; do not edit. Paths are relative to lekhjs/fonts/.',
    version: 1,
    defaultFamily: 'Noto Sans',
    subsets: Object.fromEntries(ALL.map((s) => [s, SUBSETS[/** @type {keyof typeof SUBSETS} */ (s)]])),
    families: FAMILIES.map((fam) => ({
      family: fam.family,
      dir: fam.dir,
      generic: fam.generic,
      license: 'OFL-1.1',
      licenseFile: fileInfo(`${fam.dir}/OFL.txt`),
      source: fam.source,
      faces: fam.faces.map((face) => {
        const ttf = `${fam.dir}/${face.file}`;
        return {
          weight: face.weight,
          style: face.style,
          ...hhea(ttf),
          ttf: fileInfo(ttf),
          woff2: fam.subsets.map((subset) => ({
            subset,
            unicodeRange: SUBSETS[/** @type {keyof typeof SUBSETS} */ (subset)],
            ...fileInfo(`${fam.dir}/woff2/${woff2Name(face.file, subset)}`),
          })),
        };
      }),
    })),
  };
}

const MANIFEST = path.join(FONTS, 'fonts.json');

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--verify')) {
    const fresh = `${JSON.stringify(buildManifest(), null, 2)}\n`;
    const committed = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '';
    if (fresh !== committed) {
      console.error('fonts.json does not match the font files; run node fonts/build-fonts.mjs --manifest');
      process.exit(1);
    }
    console.log('fonts.json matches the font files');
    return;
  }
  if (!args.includes('--manifest')) {
    for (const fam of FAMILIES) for (const face of fam.faces) for (const s of fam.subsets) subsetOne(fam, face, s);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(buildManifest(), null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), MANIFEST)} (${statSync(MANIFEST).size} bytes)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
