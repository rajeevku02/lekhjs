// Legacy Apple PostScript names stored in `fontfamily` by old iOS/Mac builds (spec 06 §8.2 rule 4).
//
// The real table is generated once on device by the WKWebView font spike (H-TXT-1,
// `apple-postscript-names.json`, spec 06 §12). Until that run exists this is a provisional seed
// of well-known iOS/macOS faces; `FontNameResolver` accepts the generated table as an option and
// it replaces this seed.

/** What a PostScript name stands for. */
export interface PostScriptFace {
  readonly family: string;
  readonly weight: number;
  readonly italic: boolean;
  readonly stretch: string;
}

type Row = readonly [string, string, number, boolean?, string?];

const SEED: readonly Row[] = Object.freeze([
  ['AmericanTypewriter', 'American Typewriter', 400],
  ['AmericanTypewriter-Bold', 'American Typewriter', 700],
  ['ArialMT', 'Arial', 400],
  ['Arial-BoldMT', 'Arial', 700],
  ['Arial-ItalicMT', 'Arial', 400, true],
  ['AvenirNext-Regular', 'Avenir Next', 400],
  ['AvenirNext-Medium', 'Avenir Next', 500],
  ['AvenirNext-DemiBold', 'Avenir Next', 600],
  ['AvenirNext-Bold', 'Avenir Next', 700],
  ['AvenirNext-Italic', 'Avenir Next', 400, true],
  ['AvenirNextCondensed-Regular', 'Avenir Next Condensed', 400, false, 'condensed'],
  ['AvenirNextCondensed-Bold', 'Avenir Next Condensed', 700, false, 'condensed'],
  ['ChalkboardSE-Regular', 'Chalkboard SE', 400],
  ['ChalkboardSE-Bold', 'Chalkboard SE', 700],
  ['Chalkduster', 'Chalkduster', 400],
  ['Copperplate', 'Copperplate', 400],
  ['Copperplate-Bold', 'Copperplate', 700],
  ['Courier', 'Courier', 400],
  ['Courier-Bold', 'Courier', 700],
  ['CourierNewPSMT', 'Courier New', 400],
  ['CourierNewPS-BoldMT', 'Courier New', 700],
  ['Didot', 'Didot', 400],
  ['Didot-Bold', 'Didot', 700],
  ['Futura-Medium', 'Futura', 500],
  ['Futura-Bold', 'Futura', 700],
  ['Georgia', 'Georgia', 400],
  ['Georgia-Bold', 'Georgia', 700],
  ['Georgia-Italic', 'Georgia', 400, true],
  ['GillSans', 'Gill Sans', 400],
  ['GillSans-Bold', 'Gill Sans', 700],
  ['Helvetica', 'Helvetica', 400],
  ['Helvetica-Bold', 'Helvetica', 700],
  ['Helvetica-Oblique', 'Helvetica', 400, true],
  ['HelveticaNeue', 'Helvetica Neue', 400],
  ['HelveticaNeue-Light', 'Helvetica Neue', 300],
  ['HelveticaNeue-Medium', 'Helvetica Neue', 500],
  ['HelveticaNeue-Bold', 'Helvetica Neue', 700],
  ['HelveticaNeue-Italic', 'Helvetica Neue', 400, true],
  ['MarkerFelt-Thin', 'Marker Felt', 300],
  ['MarkerFelt-Wide', 'Marker Felt', 700],
  ['Menlo-Regular', 'Menlo', 400],
  ['Menlo-Bold', 'Menlo', 700],
  ['Noteworthy-Light', 'Noteworthy', 300],
  ['Noteworthy-Bold', 'Noteworthy', 700],
  ['Optima-Regular', 'Optima', 400],
  ['Optima-Bold', 'Optima', 700],
  ['Palatino-Roman', 'Palatino', 400],
  ['Palatino-Bold', 'Palatino', 700],
  ['Papyrus', 'Papyrus', 400],
  ['TimesNewRomanPSMT', 'Times New Roman', 400],
  ['TimesNewRomanPS-BoldMT', 'Times New Roman', 700],
  ['Verdana', 'Verdana', 400],
  ['Verdana-Bold', 'Verdana', 700],
] as const);

/** The provisional seed as a lookup table. */
export function seedPostScriptNames(): ReadonlyMap<string, PostScriptFace> {
  return new Map(
    SEED.map(([ps, family, weight, italic, stretch]) => [
      ps,
      { family, weight, italic: italic ?? false, stretch: stretch ?? 'normal' },
    ]),
  );
}
