import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { crop } from './diff.mjs';

// Object flags for the attribution of image differences (verification 02 §B.6 item 1), read from
// the board JSON both builds loaded: per top-level object id of a map-form page (the ids the TS
// build reports through `__lekhTest.objects`), the union of the object's and its members' flags.
// A register entry's `rule.image.attribute.object_flag` claims the diff blobs over objects with
// that flag. Array-form (offline) pages mint new ids on load and get no flags.
//
// Flags: multiline-text, cjk-text (CJK or another script that wraps between graphemes: Thai, Lao,
// Khmer, Myanmar), text-direction (a paragraph starting right-to-left),
// legacy-type, lua-generator, wireframe-generator, native-generator, connector:<ctype>, image,
// ink, group, gradient-fill, dash, rotated, font-family, font-modifier, empty-text-measure,
// single-line-text (a non-empty text without a line break), core-embed (DR-GEN-15), route-tie
// (a connector, DR-ENG-26), rotated-ellipse-end (a connector, DR-ENG-28).

/** Code-point ranges (inclusive). */
const CJK_RANGES = [
  [0x0e00, 0x0eff], // Thai, Lao (DR-TXT-03: they wrap between graphemes, as CJK)
  [0x1000, 0x109f], // Myanmar
  [0x1100, 0x11ff], // Hangul Jamo
  [0x1780, 0x17ff], // Khmer
  [0x2e80, 0x2fdf], // CJK radicals
  [0x3000, 0x30ff], // CJK symbols and punctuation, Hiragana, Katakana
  [0x3100, 0x31ff], // Bopomofo, Hangul compatibility Jamo, Katakana extensions
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xffef], // half- and full-width forms
  [0x20000, 0x2fa1f], // CJK extensions B…
];
const RTL_RANGES = [
  [0x0590, 0x08ff],
  [0xfb1d, 0xfdff],
  [0xfe70, 0xfefe],
];
/** @param {number} cp @param {number[][]} rs */
const inRanges = (cp, rs) => rs.some(([a, b]) => cp >= (a ?? 0) && cp <= (b ?? 0));
/** @param {string} s @param {(cp: number) => boolean} f */
const someChar = (s, f) => {
  for (const ch of s) if (f(ch.codePointAt(0) ?? 0)) return true;
  return false;
};
/** A paragraph (line) whose first letter is right-to-left. @param {string} s */
const rtlStart = (s) =>
  s.split('\n').some((line) => {
    for (const ch of line) {
      const cp = ch.codePointAt(0) ?? 0;
      if (inRanges(cp, RTL_RANGES)) return true;
      if (/\p{L}/u.test(ch)) return false;
    }
    return false;
  });

/** A UAX 14 HY, BA or SY character with a non-space after it (inside a word). */
const BREAK_AFTER = /[-/\u00ad\u2010\u2012\u2013|][^\s]/;

/** @param {any} v */
const values = (v) => (Array.isArray(v) ? v : v !== null && typeof v === 'object' ? Object.values(v) : []);

const TEXT_MEASURE = /\bt[hw]\(\s*(\d+)\s*\)/g;

/**
 * DR-ENG-05: the template's geometry measures a text (`th(i)` / `tw(i)` in its data) that is empty,
 * which C++ measures as nothing and TS as one empty line, so the parts placed from it (a UML
 * compartment line, a fieldset's top edge, a package's tab) are where the line height puts them.
 * @param {any} o
 * @param {any} t
 */
function measuresEmptyText(o, t) {
  const data = Array.isArray(t.data) ? t.data : [];
  const texts = Array.isArray(t.texts) ? t.texts : null;
  if (texts === null) return false;
  const own = Array.isArray(o.texts) ? o.texts : null;
  for (const d of data) {
    if (typeof d !== 'string') continue;
    for (const m of d.matchAll(TEXT_MEASURE)) {
      const i = Number(m[1]);
      const x = own?.[i] ?? texts[i];
      if (x !== null && typeof x === 'object' && (x.text ?? '') === '') return true;
    }
  }
  return false;
}

/**
 * @param {any} o
 * @param {Set<string>} f
 */
function collect(o, f) {
  if (o === null || typeof o !== 'object') return;
  const type = String(o.type ?? '');
  if (type !== 'templated' && !type.startsWith('avabodh.basic.')) f.add('legacy-type');
  if (type === 'avabodh.basic.unrecognized') f.add('ink');
  if (type === 'avabodh.basic.group') f.add('group');
  if (type === 'avabodh.basic.connection') f.add(`connector:${Number(o.ctype ?? 0)}`);
  const a = Number(o.params?.angle ?? 0);
  if (Number.isFinite(a) && Math.abs(a) > 1e-6) f.add('rotated');
  /** @param {any} s */
  const text = (s) => {
    if (typeof s !== 'string' || s === '') return;
    if (s.includes('\n')) f.add('multiline-text');
    else f.add('single-line-text');
    if (someChar(s, (cp) => inRanges(cp, CJK_RANGES))) f.add('cjk-text');
    if (rtlStart(s)) f.add('text-direction');
  };
  /** @param {any} st */
  const style = (st) => {
    if (st === null || typeof st !== 'object') return;
    for (const p of [st.fillpaint, st.strokepaint])
      if (p !== null && typeof p === 'object' && (p.type === 3 || p.type === 4)) f.add('gradient-fill');
    if (st.dasharray !== undefined && !(Array.isArray(st.dasharray) && st.dasharray.length === 0)) f.add('dash');
    if (typeof st.fontfamily === 'string' && st.fontfamily !== '') f.add('font-family');
    if (st.fontweight !== undefined || st.fontstyle !== undefined) f.add('font-modifier');
  };
  style(o.style);
  text(o.text);
  if (typeof o.texts === 'string') text(o.texts);
  for (const x of values(o.texts)) {
    text(x?.text);
    style(x?.style);
  }
  const t = o.template;
  if (t !== null && typeof t === 'object') {
    style(t.style);
    for (const x of values(t.texts)) {
      text(x?.text);
      style(x?.style);
    }
    if (values(t.images).length > 0) f.add('image');
    if (measuresEmptyText(o, t)) f.add('empty-text-measure');
    const g = t.generator;
    if (g !== null && typeof g === 'object') {
      text(g.text);
      if (g.type === 'native') f.add('native-generator');
      else if (typeof g.script === 'string' || typeof g.scriptfile === 'string') {
        f.add('lua-generator');
        if (String(t.id ?? '').includes('wireframe')) f.add('wireframe-generator');
      }
    }
  }
  for (const c of values(o.objects)) collect(c, f);
}

/**
 * @param {any} doc  the parsed board
 * @returns {Map<string, string[]>}
 */
export function flagsByObject(doc) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const p of values(doc?.pages)) {
    const objs = p?.objects;
    if (objs === null || typeof objs !== 'object' || Array.isArray(objs)) continue;
    for (const [id, o] of Object.entries(objs)) {
      /** @type {Set<string>} */
      const f = new Set();
      collect(o, f);
      if (coreEmbed(o, doc)) f.add('core-embed');
      if (routeTie(o, objs)) f.add('route-tie');
      if (rotatedEllipseEnd(o, objs)) f.add('rotated-ellipse-end');
      out.set(id, [...f]);
    }
  }
  return out;
}

/**
 * DR-ENG-28: a connector with an end on a rotated ellipse (a template drawing an `E` path, a
 * non-zero angle). C++ Ellipse::getIntersection rotates the line about the centre with
 * LineEquation::rotate, whose "pivot on the line" test (|A·x + B·y + C| < 0.1, unnormalised, in
 * float32) fails at board coordinates of a few hundred and up: the degenerate equation it builds
 * puts the end beside the outline or nowhere (no connector drawn).
 * @param {any} o
 * @param {Record<string, any>} objs  the page's objects
 */
function rotatedEllipseEnd(o, objs) {
  if (o?.type !== 'avabodh.basic.connection') return false;
  return [o.source, o.target].some((id) => {
    const e = objs[String(id)];
    const a = Number(e?.params?.angle ?? 0);
    if (!Number.isFinite(a) || a === 0) return false;
    const draw = Array.isArray(e?.template?.draw) ? e.template.draw : [];
    return draw.some((/** @type {any} */ d) => /(^|\s)E\s/.test(String(typeof d === 'string' ? d : (d?.path ?? ''))));
  });
}

/** @type {Map<string, { width: number, height: number }> | null} */
let coreDefaults = null;
/** The default sizes of the bundled core stencils' templates (lekhjs/stencils/core), by id. */
function coreTemplates() {
  if (coreDefaults !== null) return coreDefaults;
  coreDefaults = new Map();
  const dir = path.resolve(import.meta.dirname, '..', '..', 'stencils', 'core');
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    for (const t of Array.isArray(j?.templates) ? j.templates : [])
      if (typeof t?.id === 'string')
        coreDefaults.set(t.id, { width: Number(t.default?.width), height: Number(t.default?.height) });
  }
  return coreDefaults;
}

/** The parameters of a BPMN native generator that pick a symbol (task type, markers, event type). */
const SYMBOL_PARAMS = ['tasktype', 'marker1', 'marker2', 'type'];

/**
 * DR-GEN-15: a BPMN native-generator shape that draws a symbol of the core stencils, where the board
 * stores no copy of that symbol or a copy of another size. TS resolves the symbol from its bundled
 * core stencils; the C++ web build has no core stencils, so it drew the board's copy (another
 * size: another aspect) or nothing.
 * @param {any} o
 * @param {any} doc
 */
function coreEmbed(o, doc) {
  const t = o?.template;
  const g = t?.generator;
  if (g?.type !== 'native' || !String(g.shape ?? '').startsWith('bpmn.')) return false;
  const params = t.params ?? {};
  if (!SYMBOL_PARAMS.some((k) => typeof params[k]?.value === 'string' && params[k].value !== 'None')) return false;
  const core = coreTemplates();
  const stored = new Map();
  for (const x of values(doc?.templates)) if (typeof x?.id === 'string') stored.set(x.id, x.default ?? {});
  return (Array.isArray(g.embedrefs) ? g.embedrefs : []).some((/** @type {any} */ id) => {
    const c = core.get(String(id));
    if (c === undefined) return false;
    const s = stored.get(String(id));
    return s === undefined || Number(s.width) !== c.width || Number(s.height) !== c.height;
  });
}

/**
 * DR-ENG-26, route ties: a stored orthogonal route (ctype 2, no auto type) whose first and last legs
 * leave in the same direction (C++ LineGenerator's parallel case) between two unrotated shapes
 * whose sides facing that way are level. The case picks which end's step to use by comparing the
 * two ends' positions along that direction (`isAhead`): level sides make it a tie that C++'s
 * float32 coordinates and TS's doubles break differently, so the route takes the other step.
 * @param {any} o
 * @param {Record<string, any>} objs  the page's objects
 */
function routeTie(o, objs) {
  if (o?.type !== 'avabodh.basic.connection' || Number(o.ctype) !== 2) return false;
  const ps = Array.isArray(o.params) ? o.params : [];
  if (ps.length < 2 || Number(ps[0]?.autotype ?? 0) !== 0) return false;
  const d1 = { x: Math.trunc(Number(ps[0]?.dx ?? 0)), y: Math.trunc(Number(ps[0]?.dy ?? 0)) };
  const last = ps[ps.length - 1];
  const d2 = { x: -Math.trunc(Number(last?.dx ?? 0)), y: -Math.trunc(Number(last?.dy ?? 0)) };
  if ((d1.x === 0 && d1.y === 0) || d1.x !== d2.x || d1.y !== d2.y) return false;
  const edge = (/** @type {any} */ e) => {
    const q = e?.params;
    if (q === null || typeof q !== 'object' || Array.isArray(q) || Math.abs(Number(q.angle ?? 0)) > 1e-9) return null;
    const [c, half] = d1.x !== 0 ? [Number(q.cx), Number(q.width) / 2] : [Number(q.cy), Number(q.height) / 2];
    const v = c + (d1.x + d1.y) * half;
    return Number.isFinite(v) ? v : null;
  };
  const a = edge(objs[String(o.source)]);
  const b = edge(objs[String(o.target)]);
  return a !== null && b !== null && Math.abs(a - b) < 1e-3;
}

/**
 * Words that may be wider than their object (the over-long-word wrap of DR-TXT-03: TS breaks such a
 * word at a grapheme boundary, C++ lets it overflow): per top-level object id, its words with the
 * font size and family and the object's width. The TS page measures them (`overlongWords`).
 * @param {any} doc
 * A table-v1 cell's text is measured against its column's width (`width` of the item).
 * @returns {{ id: string, width: number, items: { words: string[], paras: string[], px: number, family: string, width?: number }[] }[]}
 */
export function wrapCandidates(doc) {
  const out = [];
  for (const p of values(doc?.pages)) {
    const objs = p?.objects;
    if (objs === null || typeof objs !== 'object' || Array.isArray(objs)) continue;
    for (const [id, o] of Object.entries(objs)) {
      /** @type {{ words: string[], paras: string[], px: number, family: string, width?: number }[]} */
      const items = [];
      /** @param {any} o */
      const visit = (o) => {
        if (o === null || typeof o !== 'object') return;
        // A table-v1 cell text names its column (`col`); the column's width is the generator
        // parameter `col<c>`, a share of the table's width (the columns sum to it).
        const gp = o.template?.generator?.shape === 'table-v1' ? o.template?.params : null;
        /** @type {number[]} */
        const cols = [];
        if (gp !== null && typeof gp === 'object')
          for (let c = 0; Number.isFinite(Number(gp[`col${c}`]?.value)); c++) cols.push(Number(gp[`col${c}`].value));
        const colSum = cols.reduce((a, b) => a + b, 0);
        const ownWidth = Number(o.params?.width);
        /** @param {any} x */
        const cellWidth = (x) => {
          const c = Number(x?.col);
          if (!Number.isInteger(c) || c < 0 || c >= cols.length || !(colSum > 0) || !(ownWidth > 0)) return undefined;
          return ((cols[c] ?? 0) / colSum) * ownWidth;
        };
        /** @param {any} s @param {any} st @param {number} [width] */
        const add = (s, st, width) => {
          if (typeof s !== 'string' || s.trim() === '') return;
          const px = Number(
            st?.fontsize ?? o.style?.fontsize ?? o.template?.style?.fontsize ?? doc?.style?.fontsize ?? 15,
          );
          const family = String(
            st?.fontfamily ??
              o.style?.fontfamily ??
              o.template?.style?.fontfamily ??
              doc?.style?.fontfamily ??
              'sans-serif',
          );
          // Any word of two graphemes or more can be broken (a short word in a narrow box too).
          const words = s.split(/\s+/).filter((w) => [...w].length >= 2);
          // DR-TXT-03 rule 1: TS also breaks after a hyphen, slash or other UAX 14 HY/BA/SY
          // character followed by a non-space; C++ only at white space. A paragraph holding such a
          // word wraps differently once it is wider than its box.
          const paras = s.split('\n').filter((l) => BREAK_AFTER.test(l));
          if (words.length > 0 || paras.length > 0)
            items.push(width === undefined ? { words, paras, px, family } : { words, paras, px, family, width });
        };
        for (const x of values(o.texts)) add(x?.text, x?.style, cellWidth(x));
        if (o.template !== null && typeof o.template === 'object')
          for (const x of values(o.template.texts)) add(x?.text, x?.style, cellWidth(x));
        for (const c of values(o.objects)) visit(c);
      };
      // Members are compared with the top-level object's width (conservative: a member is narrower).
      visit(o);
      const width = Number(o?.params?.width);
      if (items.length > 0 && width > 0) out.push({ id, width, items });
    }
  }
  return out;
}

/**
 * In the page: the ids of `cands` with a word wider than 0.75 × the object's width (a table cell's: its column's) at its font (the
 * text area is the box less the template's text insets, so a word somewhat narrower than the box
 * already wraps), or with a hyphen/slash paragraph wider than that (it wraps, and TS may break it
 * after the hyphen or slash). Passed to `page.evaluate`, so it uses nothing from this module.
 * @param {ReturnType<typeof wrapCandidates>} cands
 * @returns {string[]}
 */
export function overlongWordsInPage(cands) {
  const ctx = /** @type {any} */ (globalThis).document.createElement('canvas').getContext('2d');
  if (ctx === null) return [];
  const ids = [];
  for (const c of cands) {
    let hit = false;
    for (const it of c.items) {
      ctx.font = `${it.px}px "${it.family.replace(/"/g, '')}", sans-serif`;
      const limit = 0.75 * (it.width ?? c.width);
      if (
        it.words.some((w) => ctx.measureText(w).width > limit) ||
        (it.paras ?? []).some((l) => ctx.measureText(l).width > limit)
      ) {
        hit = true;
        break;
      }
    }
    if (hit) ids.push(c.id);
  }
  return ids;
}

/** @param {number} v */
const onCentreLine = (v) => Math.abs(v - Math.floor(v) - 0.5) < 1e-3;

/**
 * DR-ENG-26's image rule: `blob` is one pixel thick and lies on the row or column of an edge of an
 * unrotated object flagged `flag` (in `under`) that falls on a pixel's centre line (k + 0.5 in
 * page pixels), within that edge's span. Such an edge is a tie: C++ computes it in float32, TS in
 * doubles, and the row or column is drawn by one build and not the other.
 * @param {{ x: number, y: number, w: number, h: number }} blob  page pixels
 * @param {{ flags: string[], px: { x: number, y: number, w: number, h: number } }[]} under
 * @param {string} flag
 */
export function halfPixelEdgeBlob(blob, under, flag) {
  if (blob.w !== 1 && blob.h !== 1) return false;
  for (const o of under) {
    if (!o.flags.includes(flag) || o.flags.includes('rotated')) continue;
    const { x, y, w, h } = o.px;
    if (blob.h === 1)
      for (const e of [y, y + h])
        if (
          onCentreLine(e) &&
          blob.y === Math.floor(e) &&
          blob.x >= Math.floor(x) &&
          blob.x + blob.w <= Math.ceil(x + w)
        )
          return true;
    if (blob.w === 1)
      for (const e of [x, x + w])
        if (
          onCentreLine(e) &&
          blob.x === Math.floor(e) &&
          blob.y >= Math.floor(y) &&
          blob.y + blob.h <= Math.ceil(y + h)
        )
          return true;
  }
  return false;
}

/**
 * DR-ENG-26's text rule: the object's text drawn one row apart. A text line's glyphs are placed on
 * whole pixel rows, so a line whose baseline lies on a row's centre line (a float32 / double tie
 * like an image edge's) is drawn one row lower by one build. True when, inside the object's
 * rectangle `r` (page pixels, grown by 2), the two images differ but the TS image moved by one row
 * up or down matches the C++ image exactly.
 * @param {import('./diff.mjs').Rgba} a  C++ page
 * @param {import('./diff.mjs').Rgba} b  TS page
 * @param {{ x: number, y: number, w: number, h: number }} r
 * @param {(x: import('./diff.mjs').Rgba, y: import('./diff.mjs').Rgba) => number} differing
 */
export function textRowShift(a, b, r, differing) {
  const R = {
    x: Math.max(0, Math.floor(r.x - 2)),
    y: Math.max(1, Math.floor(r.y - 2)),
    w: 0,
    h: 0,
  };
  R.w = Math.min(a.width, Math.ceil(r.x + r.w + 2)) - R.x;
  R.h = Math.min(a.height - 1, Math.ceil(r.y + r.h + 2)) - R.y;
  if (R.w <= 0 || R.h <= 0) return false;
  const ca = crop(a, R);
  if (differing(ca, crop(b, R)) === 0) return false;
  return [-1, 1].some((dy) => differing(ca, crop(b, { ...R, y: R.y + dy })) === 0);
}
