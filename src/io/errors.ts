// Load failures (spec 03 §14, spec 04 §9.1). The reader throws a `LoadError` with a stable code;
// the session turns it into `LoadResult { ok: false, code, message }`. Messages carry no board
// content.
import { LekhError } from '../base';

export type LoadErrorCode =
  'json_parse' | 'json_unescaped_key' | 'object_parse' | 'format_too_new' | 'format_invalid' | 'xml_parse';

/** Today's text for every failure but the version ones (the C++ typo "malfromed" is kept). */
export const LOAD_FAILED_MESSAGE =
  'Unable to load. The file is either malfromed or not compatible. Please upgrade Lekh Diagram to latest version.';

/** Spec 04 §9.1. */
export const FORMAT_TOO_NEW_MESSAGE =
  'This board was made with a newer version of Lekh. Please update the app to open it.';
export const FORMAT_INVALID_MESSAGE = 'Unable to open this board. The file is damaged or not a Lekh file.';

function messageFor(code: LoadErrorCode): string {
  if (code === 'format_too_new') return FORMAT_TOO_NEW_MESSAGE;
  if (code === 'format_invalid') return FORMAT_INVALID_MESSAGE;
  return LOAD_FAILED_MESSAGE;
}

export class LoadError extends LekhError {
  declare readonly code: LoadErrorCode;

  constructor(code: LoadErrorCode, details?: Record<string, string | number | boolean>) {
    super(code, messageFor(code), details);
    this.name = 'LoadError';
  }
}
