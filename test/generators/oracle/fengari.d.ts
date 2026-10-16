// The part of `fengari` (a Lua 5.3 VM in JS, devDependency only: AC-GEN-10) the Lua oracle uses.
declare module 'fengari' {
  export type LuaState = { readonly __lua: unique symbol };
  export type LuaString = Uint8Array;
  export type CFunction = (L: LuaState) => number;
  export const lua: {
    LUA_OK: number;
    LUA_TNIL: number;
    LUA_TBOOLEAN: number;
    LUA_TNUMBER: number;
    LUA_TSTRING: number;
    LUA_TTABLE: number;
    lua_pop(L: LuaState, n: number): void;
    lua_pcall(L: LuaState, nargs: number, nresults: number, msgh: number): number;
    lua_pushcfunction(L: LuaState, f: CFunction): void;
    lua_setglobal(L: LuaState, name: LuaString): void;
    lua_getglobal(L: LuaState, name: LuaString): number;
    lua_newtable(L: LuaState): void;
    lua_pushstring(L: LuaState, s: LuaString): void;
    lua_pushnumber(L: LuaState, n: number): void;
    lua_pushinteger(L: LuaState, n: number): void;
    lua_pushboolean(L: LuaState, b: boolean): void;
    lua_pushnil(L: LuaState): void;
    lua_setfield(L: LuaState, idx: number, k: LuaString): void;
    lua_getfield(L: LuaState, idx: number, k: LuaString): number;
    lua_settable(L: LuaState, idx: number): void;
    lua_rawseti(L: LuaState, idx: number, n: number): void;
    lua_isstring(L: LuaState, idx: number): boolean;
    lua_isnumber(L: LuaState, idx: number): boolean;
    lua_istable(L: LuaState, idx: number): boolean;
    lua_type(L: LuaState, idx: number): number;
    lua_tojsstring(L: LuaState, idx: number): string;
    lua_tonumber(L: LuaState, idx: number): number;
    lua_toboolean(L: LuaState, idx: number): boolean;
    lua_gettop(L: LuaState): number;
    lua_settop(L: LuaState, idx: number): void;
  };
  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_requiref(L: LuaState, name: LuaString, f: CFunction, glb: number): void;
    luaL_loadbuffer(L: LuaState, s: LuaString, sz: number | null, name: LuaString | null): number;
  };
  export const lualib: { luaopen_base: CFunction; luaopen_string: CFunction };
  export function to_luastring(s: string): LuaString;
}
