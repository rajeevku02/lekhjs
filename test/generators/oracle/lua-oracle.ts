// The Lua generator oracle (spec 04 §13, tier T4): runs an original wireframe script in `fengari`,
// a JS Lua 5.3 VM (a devDependency only, never bundled: AC-GEN-10), the way C++
// `LuaShapeGenerator::generate` ran it (`L/shapegen/LuaShapeGenerator.cpp:568-671`):
//   - a fresh state with only `base` and `string` opened;
//   - the chunk is loaded and run, then the 8 host globals are registered;
//   - `generate(params, text)` is called; it returns `{template = <JSON string>, minw, minh,
//     disabled?}`; a missing `template`, `minw` or `minh` is no output.
// The host globals call the TS `GeneratorContext` under test, so the Lua script and its TS port
// see the same text sizes, `split`, `parseSizeSpec` and month arithmetic.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lauxlib, lua, lualib, to_luastring, type LuaState } from 'fengari';
import type { GeneratorContext, JsonObject, SplitOptions } from '../../../src/template';
import { PKG_ROOT } from '../../lint/eslint-helpers';

const FIXTURE_SETS = JSON.parse(readFileSync(path.join(PKG_ROOT, 'parity', 'fixture-sets.json'), 'utf8')) as {
  lua: string;
  stencilsV4: string;
};
/** The Lua sources (the packed minified scripts every board embeds) and the `v4` stencils. */
export const LUA_DIR = path.resolve(PKG_ROOT, FIXTURE_SETS.lua);
export const STENCILS_V4 = path.resolve(PKG_ROOT, FIXTURE_SETS.stencilsV4);

/** `wireframe/<name>_min.lua` → source, from the pack (`pack/lua_script.json`). */
export function luaPack(): Readonly<Record<string, string>> {
  return JSON.parse(readFileSync(path.join(LUA_DIR, 'pack', 'lua_script.json'), 'utf8')) as Record<string, string>;
}

/** What one Lua run produced. */
export type LuaResult =
  | {
      readonly ok: true;
      readonly template: JsonObject;
      readonly minW: number;
      readonly minH: number;
      readonly disabled?: boolean;
    }
  | { readonly ok: false; readonly error: string };

const S = to_luastring;

function pushTable(L: LuaState, fields: Readonly<Record<string, string | number | boolean | undefined>>): void {
  lua.lua_newtable(L);
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (typeof v === 'string') lua.lua_pushstring(L, S(v));
    else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
    else lua.lua_pushnumber(L, v);
    lua.lua_setfield(L, -2, S(k));
  }
}

function strArg(L: LuaState, idx: number): string | null {
  return lua.lua_isstring(L, idx) ? lua.lua_tojsstring(L, idx) : null;
}

function field(L: LuaState, tableIdx: number, k: string): string | number | boolean | undefined {
  const t = lua.lua_getfield(L, tableIdx, S(k));
  let v: string | number | boolean | undefined;
  if (t === lua.LUA_TSTRING) v = lua.lua_tojsstring(L, -1);
  else if (t === lua.LUA_TNUMBER) v = lua.lua_tonumber(L, -1);
  else if (t === lua.LUA_TBOOLEAN) v = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return v;
}

/**
 * C++ `getLuaTableFloatField`: `lua_isnumber` (a number, or a string that converts to one) and
 * `lua_tonumber`; anything else is no value.
 */
function numberField(L: LuaState, tableIdx: number, k: string): number | undefined {
  lua.lua_getfield(L, tableIdx, S(k));
  const v = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return v;
}

/**
 * The template JSON as C++ `JsonParser` read it: standard JSON, plus a trailing comma before `}`
 * or `]` (`parseObject` / `parseList` accept one; `menu_bar.lua` writes `{"disabled": true,}`).
 */
export function parseCppTemplateJson(text: string): JsonObject {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text.charAt(i + 1);
        i++;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && ' \t\r\n'.includes(text.charAt(j))) j++;
      const next = text.charAt(j);
      if (next === '}' || next === ']') continue;
    }
    out += c;
  }
  return JSON.parse(out) as JsonObject;
}

/** JSON string escaping for `escapeJson` (C++ `JsonParser::escapeString`). */
function escapeJson(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

function registerHost(L: LuaState, host: GeneratorContext): void {
  const def = (name: string, f: (L: LuaState) => number) => {
    lua.lua_pushcfunction(L, f);
    lua.lua_setglobal(L, S(name));
  };
  def('getTextSize', (L) => {
    const s = strArg(L, -1);
    const sz = s === null ? { w: 0, h: 0 } : host.textSize(s);
    lua.lua_pushnumber(L, sz.w);
    lua.lua_pushnumber(L, sz.h);
    return 2;
  });
  def('getStrokeWidth', (L) => {
    lua.lua_pushnumber(L, host.strokeWidth());
    return 1;
  });
  def('splitLines', (L) => {
    const s = strArg(L, -1);
    const lines = s === null ? [] : host.splitLines(s);
    lua.lua_newtable(L);
    lines.forEach((line, i) => {
      lua.lua_pushstring(L, S(line));
      lua.lua_rawseti(L, -2, i + 1);
    });
    return 1;
  });
  def('escapeJson', (L) => {
    const s = strArg(L, -1);
    lua.lua_pushstring(L, S(s === null ? '' : escapeJson(s)));
    return 1;
  });
  def('debugPrint', () => 0);
  def('split', (L) => {
    const s = strArg(L, -2);
    if (s === null || !lua.lua_istable(L, -1)) {
      lua.lua_newtable(L);
      return 1;
    }
    const by = field(L, -1, 'by');
    const bool = (k: string) => field(L, -1, k) === true;
    const numf = (k: string) => {
      const v = field(L, -1, k);
      return typeof v === 'number' ? v : 0;
    };
    const opts: SplitOptions = {
      by: typeof by === 'string' ? by : typeof by === 'number' ? String(by) : '',
      checkDisabled: bool('checkDisabled'),
      checkSelection: bool('checkSelection'),
      checkStartIcon: bool('checkStartIcon'),
      checkEndIcon: bool('checkEndIcon'),
      checkEndText: bool('checkEndText'),
      checkEscapeNewLine: bool('checkEscapeNewLine'),
      checkIndent: bool('checkIndent'),
      checkWidth: bool('checkWidth'),
      checkHeight: bool('checkHeight'),
      heightPad: numf('heightPad'),
      widthPad: numf('widthPad'),
    };
    const items = host.split(s, opts);
    lua.lua_newtable(L);
    items.forEach((it, i) => {
      pushTable(L, {
        word: it.word,
        startIcon: it.startIcon,
        endIcon: it.endIcon,
        endText: it.endText,
        width: it.width,
        height: it.height,
        widthRatio: it.widthRatio,
        heightRatio: it.heightRatio,
      });
      lua.lua_pushinteger(L, it.indent);
      lua.lua_setfield(L, -2, S('indent'));
      lua.lua_pushboolean(L, it.disabled);
      lua.lua_setfield(L, -2, S('disabled'));
      lua.lua_pushboolean(L, it.selected);
      lua.lua_setfield(L, -2, S('selected'));
      lua.lua_rawseti(L, -2, i + 1);
    });
    return 1;
  });
  def('parseSizeSpec', (L) => {
    const s = strArg(L, -1);
    lua.lua_newtable(L);
    const spec = s === null ? { parsed: false, specs: [] } : host.parseSizeSpec(s);
    spec.specs.forEach((sp, i) => {
      lua.lua_newtable(L);
      lua.lua_pushinteger(L, sp.size);
      lua.lua_setfield(L, -2, S('size'));
      lua.lua_pushstring(L, S(sp.align));
      lua.lua_setfield(L, -2, S('align'));
      lua.lua_rawseti(L, -2, i + 1);
    });
    lua.lua_pushboolean(L, spec.parsed);
    lua.lua_setfield(L, -2, S('parsed'));
    return 1;
  });
  def('getMonthInfo', (L) => {
    if (!lua.lua_isnumber(L, -1) || !lua.lua_isnumber(L, -2)) {
      lua.lua_pushinteger(L, 1);
      lua.lua_pushinteger(L, 30);
      return 2;
    }
    const info = host.monthInfo(lua.lua_tonumber(L, -2), lua.lua_tonumber(L, -1));
    lua.lua_pushinteger(L, info.weekdayOfFirst);
    lua.lua_pushinteger(L, info.daysInMonth);
    return 2;
  });
}

function pushParams(L: LuaState, params: Readonly<Record<string, number | string | boolean | null>>): void {
  lua.lua_newtable(L);
  for (const [k, v] of Object.entries(params)) {
    lua.lua_pushstring(L, S(k));
    if (typeof v === 'number') {
      if (Number.isInteger(v)) lua.lua_pushinteger(L, v);
      else lua.lua_pushnumber(L, v);
    } else if (typeof v === 'string') lua.lua_pushstring(L, S(v));
    else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
    else lua.lua_pushnil(L);
    lua.lua_settable(L, -3);
  }
}

/** One Lua state per script, kept across calls as C++ kept it (leaked globals persist). */
export class LuaGenerator {
  private readonly L: LuaState;

  constructor(script: string, host: GeneratorContext) {
    const L = lauxlib.luaL_newstate();
    lauxlib.luaL_requiref(L, S('_G'), lualib.luaopen_base, 1);
    lua.lua_pop(L, 1);
    lauxlib.luaL_requiref(L, S('string'), lualib.luaopen_string, 1);
    lua.lua_pop(L, 1);
    const src = S(script);
    if (lauxlib.luaL_loadbuffer(L, src, null, null) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
      throw new Error(`Lua chunk failed: ${lua.lua_tojsstring(L, -1)}`);
    }
    registerHost(L, host);
    lua.lua_settop(L, 0);
    this.L = L;
  }

  generate(params: Readonly<Record<string, number | string | boolean | null>>, text: string): LuaResult {
    const L = this.L;
    lua.lua_getglobal(L, S('generate'));
    pushParams(L, params);
    lua.lua_pushstring(L, S(text));
    if (lua.lua_pcall(L, 2, 1, 0) !== lua.LUA_OK) {
      const error = lua.lua_tojsstring(L, -1);
      lua.lua_settop(L, 0);
      return { ok: false, error };
    }
    const tmpl = field(L, -1, 'template');
    const minw = numberField(L, -1, 'minw');
    const minh = numberField(L, -1, 'minh');
    const disabled = field(L, -1, 'disabled');
    lua.lua_settop(L, 0);
    if (typeof tmpl !== 'string' || typeof minw !== 'number' || typeof minh !== 'number') {
      return { ok: false, error: 'no template, minw or minh' };
    }
    let template: JsonObject;
    try {
      template = parseCppTemplateJson(tmpl);
    } catch {
      // C++ had cleared the template data already: the shape is left empty.
      return { ok: false, error: 'template is not JSON' };
    }
    return {
      ok: true,
      template,
      minW: minw,
      minH: minh,
      ...(typeof disabled === 'boolean' ? { disabled } : {}),
    };
  }
}
