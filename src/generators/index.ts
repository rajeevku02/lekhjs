// lekhjs module `generators` (spec 01 §2.1, rank 6). The only import target from outside the module.
// The registry (`template.id` → wireframe module, native `shape` → generator, module key → canonical
// JS text), the Lua → JS converter io/ runs on every template it parses, the wireframe adapter, the
// placeholders and the host functions (spec 04 §5-§7). The contract lives in `template/`.
import type { LibraryFileJson } from '../template';
import { TemplateCatalog } from '../template';
import { GeneratorRegistry } from './generator-registry';
import { LuaToJsConverter } from './lua-to-js-converter';

export {
  GeneratorRegistry,
  GeneratorScriptTable,
  type GeneratorRegistryOptions,
  type NativeGeneratorFactory,
} from './generator-registry';
export { LuaToJsConverter, type GeneratorBuildContext } from './lua-to-js-converter';
export {
  WireframeGenerator,
  embedRefsOf,
  generatorFieldsOf,
  paramValuesOf,
  type GeneratorFields,
} from './wireframe-generator';
export { StoredNativeGenerator, UnknownGeneratorPlaceholder } from './placeholder-generators';
export {
  BpmnChoreographyGenerator,
  BpmnConversationGenerator,
  BpmnDataObjectGenerator,
  BpmnEventGenerator,
  BpmnGatewayGenerator,
  BpmnTaskGenerator,
  NATIVE_GENERATORS,
  TableGenerator,
} from './native';
export { outputToTemplateJson, placeholderOutput, type TemplateDataApplier } from './wireframe-output';
export { TemplateGeneratorHost } from './template-generator-host';
export { atoi, parseSizeSpec, split, splitByChar, splitLines, trimC, type SplitMeasure } from './wireframe-text';
export { isLeapYear, monthInfo, weekdayOf } from './month-info';
export { luaNumberString, luaToNumber, parseWireframeDate, type LuaNumber, type WireframeDate } from './wireframe-date';
export { indexList, num, str, truthy, type ParamValue } from './wireframe-lua';
export { NATIVE_SHAPES, UNUSED_SCRIPTFILE, WIREFRAME_TEMPLATES, type WireframeTemplateRow } from './wireframe-ids';
export { WIREFRAME_MODULES } from './wireframe';

/**
 * The immutable base catalog from stencil files, with every Lua generator converted to JS (spec 04
 * §3, §7.1: a catalog definition is already converted).
 */
export function buildCatalog(
  files: readonly LibraryFileJson[],
  registry: GeneratorRegistry = GeneratorRegistry.builtin(),
): TemplateCatalog {
  return TemplateCatalog.build(files, new LuaToJsConverter(registry).resolve);
}
