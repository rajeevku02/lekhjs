// Regenerates test/fixtures/golden/word-wrap/whitespace-latin.json, the AC-TXT-05 golden
// (spec 06 §3.2, verification 05 §2): C++ `TextUtil::getWidth` line splits, and the
// `getTextSize` heights the C++ web build reports (AC-TXT-30's `lineSpacingCompat` oracle), on
// whitespace-only Latin fixtures (no `-`, `/`, `|` or other HY/BA/SY characters, no word wider
// than the line) × 5 widths.
//
// Widths are measured with a deterministic per-character table — the advance widths of Noto Sans
// Regular at 15 px, read with fontkit — so the C++ and the TS wrapper see identical numbers.
// The harness compiles a scratch copy of lekhcore's TextUtil.{h,cpp} unchanged against stub
// Platform/Style/Size headers (number_t = double, the port's numeric model, OQ-46).
//
//   node parity/tools/capture-word-wrap/regen.mjs [--src <lekhcore/src>]
// Builds with g++ -O0 serially. Hold the heavy-job lock when running it.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const args = process.argv.slice(2);
const srcIdx = args.indexOf('--src');
const SRC = path.resolve(srcIdx >= 0 ? (args[srcIdx + 1] ?? '') : path.join(PKG, '..', 'lekhcore', 'src'));
const OUT = path.join(PKG, 'test', 'fixtures', 'golden', 'word-wrap', 'whitespace-latin.json');
const FONT_PX = 15;

// ---- the width table ----
const require = createRequire(path.join(PKG, 'package.json'));
/** @type {{ openSync(p: string): { unitsPerEm: number; glyphForCodePoint(cp: number): { advanceWidth: number } } }} */
const fontkit = require('fontkit');
const font = fontkit.openSync(path.join(PKG, 'fonts', 'noto-sans', 'NotoSans-Regular.ttf'));
/** @type {Record<string, number>} */
const table = {};
for (const ch of ' \t\v\f\r') table[ch] = (font.glyphForCodePoint(0x20).advanceWidth / font.unitsPerEm) * FONT_PX;
for (let cp = 0x21; cp <= 0x7e; cp++) {
  table[String.fromCodePoint(cp)] = (font.glyphForCodePoint(cp).advanceWidth / font.unitsPerEm) * FONT_PX;
}
/** @param {string} s */
const widthOf = (s) => [...s].reduce((w, c) => w + (table[c] ?? 0), 0);

// ---- fixtures (deterministic) ----
let state = 0x2545f4914f6cdd1dn;
const rnd = () => {
  state ^= state >> 12n;
  state ^= (state << 25n) & 0xffffffffffffffffn;
  state ^= state >> 27n;
  return Number(((state * 2685821657736338717n) & 0xffffffffffffffffn) >> 11n) / 9007199254740992;
};
const pick = (/** @type {readonly string[]} */ a) => a[Math.floor(rnd() * a.length)] ?? '';
const WORDS = Object.freeze(
  (
    'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et ' +
    'dolore magna aliqua Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea ' +
    'commodo consequat Duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur ' +
    'Excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum ' +
    'Start Process Decision Database Gateway 2026 v4.3 node, edge. A I x Q W'
  ).split(' '),
);
const SPACES = Object.freeze([' ', ' ', ' ', ' ', '  ', '   ', '\t', ' \t ']);
/** @param {number} i */
function fixture(i) {
  const kind = i % 10;
  const nWords = kind === 0 ? 1 : 2 + Math.floor(rnd() * 24);
  const paragraphs = kind === 3 || kind === 7 ? 2 + Math.floor(rnd() * 3) : 1;
  const paras = [];
  for (let p = 0; p < paragraphs; p++) {
    let s = '';
    if (kind === 5) s += pick(['  ', ' ', '\t']); // leading white space
    for (let w = 0; w < nWords; w++) s += (w > 0 ? pick(SPACES) : '') + pick(WORDS);
    if (kind === 6) s += pick(['  ', ' ', '   ']); // trailing white space
    paras.push(s);
  }
  let text = paras.join(kind === 7 ? '\n\n' : '\n');
  if (kind === 8) text += '\n'; // a final newline adds no line (std::getline)
  if (kind === 9) text = '\n' + text; // an empty first line
  return text;
}
const FIXTURES = Array.from({ length: 40 }, (_, i) => fixture(i));
for (const f of FIXTURES) {
  if (/[-/|]/.test(f)) throw new Error('fixture contains a HY/BA/SY character');
}

/** @param {string} text */
function widthsFor(text) {
  // No word (with any leading white space of its line) may be wider than the line: rule 3 would differ.
  let longest = 0;
  for (const line of text.split('\n')) {
    const lead = /^[ \t\v\f\r]*/.exec(line)?.[0] ?? '';
    const words = line.trim().split(/[ \t\v\f\r]+/);
    words.forEach((w, k) => (longest = Math.max(longest, widthOf((k === 0 ? lead : '') + w))));
  }
  return [1.02, 1.5, 2.3, 4, 9].map((f) => Math.round(longest * f * 64 + 32) / 64);
}

// ---- C++ harness ----
/** @param {string} s */
const cstr = (s) =>
  '"' +
  [...s]
    .map((c) =>
      c === '"' || c === '\\'
        ? '\\' + c
        : c >= ' ' && c <= '~'
          ? c
          : '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0') + '""',
    )
    .join('') +
  '"';

const dir = mkdtempSync(path.join(os.tmpdir(), 'word-wrap-golden-'));
try {
  mkdirSync(path.join(dir, 'lekh'));
  mkdirSync(path.join(dir, 'geometry'));
  mkdirSync(path.join(dir, 'base'));
  cpSync(path.join(SRC, 'lekh', 'TextUtil.h'), path.join(dir, 'lekh', 'TextUtil.h'));
  cpSync(path.join(SRC, 'lekh', 'TextUtil.cpp'), path.join(dir, 'lekh', 'TextUtil.cpp'));
  writeFileSync(path.join(dir, 'base', 'Config.h'), '#pragma once\n');
  writeFileSync(
    path.join(dir, 'geometry', 'Rectangle.h'),
    `#pragma once
typedef double number_t;
namespace avabodh { namespace geometry {
struct Size { number_t width = 0, height = 0; Size() {} Size(number_t w, number_t h): width(w), height(h) {} };
}}
`,
  );
  writeFileSync(
    path.join(dir, 'lekh', 'Platform.h'),
    `#pragma once
#include <string>
#include <vector>
#include "../geometry/Rectangle.h"
namespace avabodh { namespace lekh {
struct Style { number_t fs = 15; number_t effectiveFontSize() const { return fs; } };
typedef Style DrawingProfile;
struct Platform {
  static Platform* currentPlatform;
  virtual geometry::Size measureText(const std::string&, Style*, const geometry::Size&) = 0;
  virtual ~Platform() {}
};
}}
`,
  );
  const tableEntries = Object.entries(table)
    .map(([c, w]) => `{${String(c.charCodeAt(0))}, ${w.toPrecision(17)}}`)
    .join(',\n  ');
  const cases = FIXTURES.flatMap((t, fi) => widthsFor(t).map((w) => `{${String(fi)}, ${cstr(t)}, ${String(w)}}`)).join(
    ',\n  ',
  );
  writeFileSync(
    path.join(dir, 'harness.cpp'),
    `// Generated by parity/tools/capture-word-wrap/regen.mjs.
#include <cstdio>
#include <map>
#include "lekh/TextUtil.h"
using namespace avabodh::lekh;
using avabodh::geometry::Size;
Platform* Platform::currentPlatform = nullptr;
static std::map<int, double> table = {
  ${tableEntries}
};
struct TableMeasure : Platform {
  Size measureText(const std::string& s, Style* st, const Size&) override {
    // As the web: lines() first, then the widest line and fontSize per line.
    std::vector<std::string> lines; TextUtil::instance()->lines(s, &lines);
    double w = 0;
    for (auto& l : lines) { double lw = 0; for (unsigned char c : l) lw += table[c]; if (lw > w) w = lw; }
    return Size(w, st->effectiveFontSize() * lines.size());
  }
};
struct Case { int fixture; const char* text; double width; };
static Case cases[] = {
  ${cases}
};
static void json(const std::string& s) {
  std::putchar('"');
  for (unsigned char c : s) {
    if (c == '"' || c == '\\\\') std::printf("\\\\%c", c);
    else if (c < 0x20) std::printf("\\\\u%04x", c);
    else std::putchar(c);
  }
  std::putchar('"');
}
int main() {
  TableMeasure m; Platform::currentPlatform = &m;
  Style st;
  std::printf("[");
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    std::vector<TextUtil::TextSplit> out;
    TextUtil::instance()->getWidth(cases[i].text, &st, Size(cases[i].width, 0), &out);
    Size sz = TextUtil::instance()->getTextSize(cases[i].text, Size(cases[i].width, 0), &st);
    std::printf("%s{\\"fixture\\":%d,\\"width\\":%.17g,\\"height\\":%.17g,\\"lines\\":[", i ? "," : "", cases[i].fixture, cases[i].width, sz.height);
    for (size_t k = 0; k < out.size(); k++) { if (k) std::putchar(','); json(out[k].text); }
    std::printf("]}");
  }
  std::printf("]\\n");
}
`,
  );
  const exe = path.join(dir, 'harness');
  execFileSync(
    'g++',
    [
      '-std=c++17',
      '-O0',
      '-w',
      '-I',
      dir,
      '-o',
      exe,
      path.join(dir, 'harness.cpp'),
      path.join(dir, 'lekh', 'TextUtil.cpp'),
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  /** @type {{ fixture: number; width: number; height: number; lines: string[] }[]} */
  const results = JSON.parse(execFileSync(exe, { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const golden = {
    about:
      'AC-TXT-05 golden, written by parity/tools/capture-word-wrap/regen.mjs: C++ TextUtil::getWidth line ' +
      'splits and TextUtil::getTextSize heights (the C++ web: font size per line, AC-TXT-30) over whitespace-only ' +
      'Latin fixtures, measured with `table` (Noto Sans Regular advances at 15 px).',
    fontPx: FONT_PX,
    table,
    fixtures: FIXTURES,
    cases: results,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(golden, null, 1) + '\n');
  console.log(`wrote ${path.relative(PKG, OUT)}: ${String(FIXTURES.length)} fixtures, ${String(results.length)} cases`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
