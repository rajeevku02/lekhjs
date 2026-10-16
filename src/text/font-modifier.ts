// `fontmodifier` (a face suffix such as `DemiBold` or `CondensedBold`) → CSS weight, style and
// stretch (spec 06 §8.3). Honoured on every platform (DR-TXT-04); today only iOS reads it.

export interface ModifierCss {
  /** CSS weight, or 0 when the modifier names none. */
  readonly weight: number;
  /** `italic`/`oblique` when the modifier names one, else ''. */
  readonly style: '' | 'italic' | 'oblique';
  /** CSS `font-stretch` keyword, or '' when the modifier names none. */
  readonly stretch: '' | 'condensed' | 'expanded';
}

/** Tokens in longest-first order, so `ExtraBold` wins over `Bold` and `SemiBold` over… nothing shorter. */
const TOKENS: readonly (readonly [string, Partial<ModifierCss>])[] = Object.freeze([
  ['ultralight', { weight: 200 }],
  ['extralight', { weight: 200 }],
  ['extrabold', { weight: 800 }],
  ['condensed', { stretch: 'condensed' }],
  ['compressed', { stretch: 'condensed' }],
  ['semibold', { weight: 600 }],
  ['demibold', { weight: 600 }],
  ['expanded', { stretch: 'expanded' }],
  ['regular', { weight: 400 }],
  ['oblique', { style: 'oblique' }],
  ['italic', { style: 'italic' }],
  ['medium', { weight: 500 }],
  ['light', { weight: 300 }],
  ['heavy', { weight: 800 }],
  ['black', { weight: 900 }],
  ['roman', { weight: 400 }],
  ['thin', { weight: 100 }],
  ['bold', { weight: 700 }],
  ['book', { weight: 400 }],
  ['wide', { stretch: 'expanded' }],
] as const);

const NONE: ModifierCss = Object.freeze({ weight: 0, style: '', stretch: '' });

/**
 * Splits `modifier` into known tokens (case-insensitive; `-`, `_` and spaces ignored). A
 * modifier with any unknown part is ignored entirely (regular face), as on web and Android
 * today.
 */
export function modifierToCss(modifier: string): ModifierCss {
  let rest = modifier.toLowerCase().replace(/[\s_-]/g, '');
  if (rest === '') return NONE;
  let weight = 0;
  let style: ModifierCss['style'] = '';
  let stretch: ModifierCss['stretch'] = '';
  while (rest.length > 0) {
    const hit = TOKENS.find(([t]) => rest.startsWith(t));
    if (hit === undefined) return NONE;
    const [tok, css] = hit;
    if (css.weight !== undefined) weight = Math.max(weight, css.weight);
    if (css.style !== undefined) style = css.style;
    if (css.stretch !== undefined) stretch = css.stretch;
    rest = rest.slice(tok.length);
  }
  return { weight, style, stretch };
}
