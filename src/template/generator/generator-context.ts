// The host functions a generator may call (spec 04 §5.1; canonical name `GeneratorContext`, spec 02
// §1.2; spec 04 calls it `GeneratorHost`). They are the eight Lua host functions of
// `LuaShapeGenerator.cpp` as TS, minus `escapeJson` and `debugPrint`: generator output is
// structured, and logging goes through the session logger. `generators/TemplateGeneratorHost`
// implements it, bound to one template's style and the session's text measurer.

/** The options of the wireframe markup parser (C++ `lua_split`'s table argument). */
export interface SplitOptions {
  /** The separator; only its first character is used. Empty: no items. */
  readonly by: string;
  readonly checkDisabled?: boolean;
  readonly checkSelection?: boolean;
  readonly checkStartIcon?: boolean;
  readonly checkEndIcon?: boolean;
  readonly checkEndText?: boolean;
  readonly checkEscapeNewLine?: boolean;
  readonly checkIndent?: boolean;
  readonly checkWidth?: boolean;
  readonly checkHeight?: boolean;
  readonly widthPad?: number;
  readonly heightPad?: number;
}

/** One item of `split` (the Lua table fields). */
export interface SplitItem {
  readonly word: string;
  readonly startIcon?: string;
  readonly endIcon?: string;
  readonly endText?: string;
  readonly width: number;
  readonly height: number;
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly indent: number;
  readonly disabled: boolean;
  readonly selected: boolean;
}

/** One column of a size spec: `10c` → `{ size: 10, align: 'center' }`. */
export interface SizeSpecItem {
  readonly size: number;
  readonly align: 'left' | 'center' | 'right';
}

/** `parseSizeSpec("{10c, 20r, 30}")`; `parsed` is false for anything else. */
export interface SizeSpec {
  readonly parsed: boolean;
  readonly specs: readonly SizeSpecItem[];
}

export interface GeneratorContext {
  /** `getTextSize`: `text` in the template's style, unconstrained. */
  textSize(text: string): { readonly w: number; readonly h: number };
  /** `getStrokeWidth`: the template style's effective stroke width. */
  strokeWidth(): number;
  /** `splitLines`: split on `\n`, the first `\r` of each line removed. */
  splitLines(text: string): string[];
  /** `split`: the wireframe markup parser. */
  split(text: string, opts: SplitOptions): SplitItem[];
  parseSizeSpec(spec: string): SizeSpec;
  /** `getMonthInfo`, as pure calendar arithmetic (UTC, DR-GEN-06): weekday 1..7 of the 1st, days in month. */
  monthInfo(month: number, year: number): { readonly weekdayOfFirst: number; readonly daysInMonth: number };
}
