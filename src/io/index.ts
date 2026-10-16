// lekhjs module `io` (spec 01 §2.1, rank 8). The only import target from outside the module.
// Document IO (spec 03 §10, spec 04 §9, §11): the JSON reader with the lenient fallback, the
// writer with a stamp policy, legacy conversion on every load path, the XML reader (no writer),
// the format version and stamp, and the stencil and user-library readers.
export { DocumentCodec, type ReadObject } from './document-codec';
export {
  FORMAT_INVALID_MESSAGE,
  FORMAT_TOO_NEW_MESSAGE,
  LOAD_FAILED_MESSAGE,
  LoadError,
  type LoadErrorCode,
} from './errors';
export { LoadContext, withResolver, type IoEnv, type LoadWarning } from './load-context';
export { FormatVersion } from './format/format-version';
export { FormatStamp, documentUsesTitle, type StampContent, type StampPolicy } from './format/format-stamp';
export { parseJsonText, parseLenientJson, type LenientParse } from './json/lenient-json';
export { writeJsonText, type JsonTextStats } from './json/json-writer';
export { byteOrderKeys, compareUtf8 } from './json/json-fields';
export { JsonDocumentReader, parseBackground, type PageRead, type ReadResult } from './json/document-reader';
export { JsonDocumentWriter, type WriteOptions, type WriteResult } from './json/document-writer';
export { ObjectReader, parseConnectionParams, parsePoint, parsePoints } from './json/object-reader';
export {
  TemplateDataCodec,
  parseTemplateParams,
  serializeTemplateParams,
  type TemplateParseStats,
  type TemplateWriteOptions,
} from './codec/template-data-codec';
export {
  parseDrawingProfile,
  parsePaint,
  parseStyle,
  parseStyleOrDrawingProfile,
  serializePaint,
  serializeStyle,
} from './codec/style-codec';
export {
  completeHooks,
  converterHooks,
  type CompleteGeneratorHooks,
  type GeneratorHooks,
} from './codec/generator-hooks';
export {
  LEGACY_TYPES,
  LEGACY_TYPE_NAMES,
  convertLegacy,
  type LegacyKind,
  type LegacyObject,
} from './legacy/legacy-converter';
export { XmlDocumentReader } from './xml/xml-document-reader';
export { XmlTokenizer, XmlTokenType, unescapeXml, type XmlToken } from './xml/xml-tokenizer';
export { STENCIL_LIB_VERSION, StencilSource } from './library/stencil-source';
export { StencilSetLoader, type StencilCategoryRef, type StencilFetchPlan } from './library/stencil-set-loader';
export { LibraryItemCodec } from './library/library-item-codec';
