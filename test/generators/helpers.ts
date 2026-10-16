// Shared helpers for the generator suites: wireframe template bodies in their stored forms (the
// Lua a board embeds, the `scriptfile` a stencil names, the JS a TS client writes), boards and
// objects around them, and the canonical texts.
import { GeneratorRegistry } from '../../src/generators';
import type { JsonObject, JsonValue } from '../../src/template';
import { luaPack } from './oracle/lua-oracle';

export const BUTTON = 'avabodh.wireframe.button';
export const PAGE = 'page-1';

const PACK = luaPack();

/** The packed Lua source of a wireframe script (what every saved board embeds). */
export function luaSource(file: string): string {
  const s = PACK[file];
  if (s === undefined) throw new Error(`no Lua ${file}`);
  return s;
}

/** The canonical JS text of a module key (from the shipped table). */
export function jsText(key: string): string {
  const t = GeneratorRegistry.builtin().scriptText(key);
  if (t === undefined) throw new Error(`no canonical text for ${key}`);
  return t;
}

const BUTTON_PARAMS: JsonObject = {
  state: { value: 'normal', editor: { type: 4, options: ['normal', 'disabled', 'selected', 'in focus'] } },
  icon: { value: null, editor: { type: 255, optional: 'no icon' } },
  'icon size': {
    value: 'propotional to font',
    editor: { type: 255, depends: 'icon', options: ['propotional to shape', 'propotional to font'] },
  },
  menu: false,
};

/** A button body as a board stores it, with `generator` given. */
export function buttonBody(generator: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    id: BUTTON,
    data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
    default: { width: 80, height: 28 },
    style: { strokewidth: 1.5 },
    params: BUTTON_PARAMS,
    generator,
    ...extra,
  };
}

/** The stored-board Lua form. */
export function luaButton(text = 'OK', extra: JsonObject = {}): JsonObject {
  return buttonBody({ script: luaSource('wireframe/button_min.lua'), text, interprettext: true }, extra);
}

/** A templated object around `template`. */
export function objectOf(template: JsonObject, cx = 100, cy = 100, order = 1): JsonObject {
  return {
    type: 'templated',
    order,
    params: { cx, cy, width: 80, height: 28, angle: 0 },
    template,
  };
}

/** A 4.2 board with one page `PAGE` holding `objects` (and `templates`, `extraPages` when given). */
export function boardWith(
  objects: Readonly<Record<string, JsonObject>>,
  opts: { version?: string; templates?: JsonObject; extraPages?: JsonObject } = {},
): JsonObject {
  const pages: Record<string, JsonValue> = {
    [PAGE]: { name: 'Page 1', order: 0, canvassizetype: 'infinite', objects: { ...objects } },
    ...(opts.extraPages ?? {}),
  };
  return {
    info: { version: opts.version ?? '4.2', title: '', author: '', description: '', platform: '1' },
    pages,
    ...(opts.templates !== undefined ? { templates: opts.templates } : {}),
  };
}
