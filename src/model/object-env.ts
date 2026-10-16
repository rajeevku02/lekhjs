// What an object kind needs from its session (replaces the C++ globals `Config::instance()`,
// `Platform::currentPlatform` for text, and `TemplateStore::instance().getArrow`). A session
// builds one and hands it to every object it creates or loads; objects never reach a global.
import type { Config } from '../base';
import type { ShapeTemplate, TemplateText } from '../template';

export interface ObjectEnv {
  readonly config: Config;
  /** Text measuring and layout (connector labels; C++ `Platform::getTextSize`, `LekhUtil::drawText`). */
  readonly text: TemplateText;
  /**
   * The catalog's connector arrowhead `id` (C++ `TemplateStore::getArrow`), not yet cloned, or
   * null. The object clones and loads its own copy.
   */
  arrowhead(id: string): ShapeTemplate | null;
  /** A new object id (C++ `Platform::newId`: `shortIdFromUuid(uuid)` from the session's `IdSource`). */
  newId(): string;
}

/** C++ arrowhead ids of `IArrowObject::setArrow(loc, {has, solid})`. */
export const SOLID_ARROW_ID = 'avabodh.arrow.str';
export const OPEN_ARROW_ID = 'avabodh.arrow.ar';
