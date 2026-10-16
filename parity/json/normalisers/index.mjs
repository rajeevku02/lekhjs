// The named normalisers register rules may cite (`rule.json[].normaliser`, verification 01 §9.2).
// The four canonicalisation steps (`generator-script`, `info-version`, `root-style`,
// `lua-data-number`) always run; a rule naming one of them is a no-op that register:check accepts.
// A normaliser a rule applies with `op: normalise` exports `equal(cpp, ts) → boolean | null` over
// the two subtrees at the matched path, with the input board's subtree there as a third argument
// (null: not applicable; the next rule is tried).
import * as generatorScript from './generator-script.mjs';
import * as infoVersion from './info-version.mjs';
import * as fontModifierSize from './font-modifier-size.mjs';
import * as legacyConvert from './legacy-convert.mjs';
import * as luaDataNumber from './lua-data-number.mjs';
import * as placeholderVerbatim from './placeholder-verbatim.mjs';
import * as rootStyle from './root-style.mjs';

/** @type {Readonly<Record<string, { name: string, equal?: (a: any, b: any, input?: any) => boolean | null }>>} */
export const NORMALISERS = Object.freeze({
  [generatorScript.name]: generatorScript,
  [infoVersion.name]: infoVersion,
  [rootStyle.name]: rootStyle,
  [luaDataNumber.name]: luaDataNumber,
  [legacyConvert.name]: legacyConvert,
  [placeholderVerbatim.name]: placeholderVerbatim,
  [fontModifierSize.name]: fontModifierSize,
});

/** The canonicalisation steps every comparison applies (no rule needed). */
export const ALWAYS = Object.freeze([generatorScript.name, infoVersion.name, rootStyle.name, luaDataNumber.name]);
