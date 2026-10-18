// Object flags for the attribution of image differences (verification 02 §B.6 item 1), read from
// the board JSON both builds loaded: per top-level object id of a map-form page (the ids the TS
// build reports through `__lekhTest.objects`), the union of the object's and its members' flags.
// A register entry's `rule.image.attribute.object_flag` claims the diff blobs over objects with
// that flag. Array-form (offline) pages mint new ids on load and get no flags.
//
// Flags: multiline-text, cjk-text (CJK or another script that wraps between graphemes: Thai, Lao,
// Khmer, Myanmar), text-direction (a paragraph starting right-to-left),
// legacy-type, lua-generator, wireframe-generator, native-generator, connector:<ctype>, image,
// ink, group, gradient-fill, dash, rotated, font-family, font-modifier.

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
      out.set(id, [...f]);
    }
  }
  return out;
}

/**
 * Words that may be wider than their object (the over-long-word wrap of DR-TXT-03: TS breaks such a
 * word at a grapheme boundary, C++ lets it overflow): per top-level object id, its words with the
 * font size and family and the object's width. The TS page measures them (`overlongWords`).
 * @param {any} doc
 * @returns {{ id: string, width: number, items: { words: string[], paras: string[], px: number, family: string }[] }[]}
 */
export function wrapCandidates(doc) {
  const out = [];
  for (const p of values(doc?.pages)) {
    const objs = p?.objects;
    if (objs === null || typeof objs !== 'object' || Array.isArray(objs)) continue;
    for (const [id, o] of Object.entries(objs)) {
      /** @type {{ words: string[], paras: string[], px: number, family: string }[]} */
      const items = [];
      /** @param {any} o */
      const visit = (o) => {
        if (o === null || typeof o !== 'object') return;
        /** @param {any} s @param {any} st */
        const add = (s, st) => {
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
          const words = s.split(/\s+/).filter((w) => w.length > 3);
          // DR-TXT-03 rule 1: TS also breaks after a hyphen, slash or other UAX 14 HY/BA/SY
          // character followed by a non-space; C++ only at white space. A paragraph holding such a
          // word wraps differently once it is wider than its box.
          const paras = s.split('\n').filter((l) => BREAK_AFTER.test(l));
          if (words.length > 0 || paras.length > 0) items.push({ words, paras, px, family });
        };
        for (const x of values(o.texts)) add(x?.text, x?.style);
        if (o.template !== null && typeof o.template === 'object')
          for (const x of values(o.template.texts)) add(x?.text, x?.style);
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
 * In the page: the ids of `cands` with a word wider than 0.75 × the object's width at its font (the
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
      const limit = 0.75 * c.width;
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
