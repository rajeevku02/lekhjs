// Realtime frames: the parsed form and the codec (port of C++ `UpdateMsg::parse` / `serialize` and
// `Update`, `L/update/UpdateManager.cpp:27-145`; spec 02 `UpdateFrame`, spec 03 §11.1-§11.2).
//
// Decoding: `JSON.parse`, then the lenient reader on a `SyntaxError` (a C++ peer writes `nan` /
// `inf`: read as 0, counted); still malformed → `frame_parse`. Then the C++ shape checks: `docid`
// and `type` are required; an `update` frame needs `updates` (an object) with a string `type` and a
// `changes` member. `changes` and `conditions` are kept in UTF-8 key order, the order C++'s
// `std::map` visited them. A missing or non-integer `version` reads as 0 (C++ ignored it).
//
// Encoding: `{ version, docid, type, updates: { changes, conditions, pointer?, type } }` with the
// keys sorted and escaped (io's `writeJsonText`), so non-finite numbers go out as 0.
import { Point } from '../geometry';
import { byteOrderKeys, parseJsonText, writeJsonText } from '../io';
import { isJsonObject, type JsonObject, type JsonValue } from '../template';
import { consts, msgtypes } from './consts';

/** C++ `UpdateMsg::User`. */
export interface RemoteUser {
  readonly id: string;
  readonly name: string;
}

/** C++ `Update`: one change set of one `updates.type`. */
export interface FrameUpdate {
  readonly type: string;
  /** `[key, value]` in UTF-8 key order; a `null` value is a delete (`JsonNode::NONE`). */
  readonly changes: readonly (readonly [string, JsonValue])[];
  readonly conditions: readonly (readonly [string, JsonValue])[];
  /** `trackpointer` presence points. */
  readonly pointers: readonly Point[];
}

/** C++ `UpdateMsg`. */
export interface UpdateFrame {
  readonly version: number;
  readonly docid: string;
  /** `update`, `message`, `request`, `broadcast`, … */
  readonly type: string;
  readonly user: RemoteUser;
  /** Present for `update` frames. */
  readonly update: FrameUpdate | null;
  /** The whole parsed frame (the `message` envelope is read from it). */
  readonly raw: JsonObject;
  /** Non-finite literals the lenient fallback read as 0. */
  readonly nonFinite: number;
}

export type DecodeResult =
  | { readonly ok: true; readonly frame: UpdateFrame }
  | { readonly ok: false; readonly code: 'frame_parse'; readonly reason: string };

/** An outgoing change set (`edit/` commands produce this shape). */
export interface OutgoingChanges {
  readonly type: string;
  readonly changes: Readonly<Record<string, JsonValue>>;
  readonly conditions?: Readonly<Record<string, JsonValue>>;
  readonly pointers?: readonly { readonly x: number; readonly y: number }[];
}

function entries(o: JsonValue | undefined): [string, JsonValue][] {
  if (!isJsonObject(o)) return [];
  return byteOrderKeys(o).map((k) => [k, o[k] as JsonValue]);
}

function fail(reason: string): DecodeResult {
  return { ok: false, code: 'frame_parse', reason };
}

export const FrameCodec = Object.freeze({
  /** Text → frame, or `frame_parse`. */
  decode(text: string): DecodeResult {
    let parsed: { value: JsonValue; nonFinite: number };
    try {
      parsed = parseJsonText(text);
    } catch {
      return fail('json');
    }
    const { value, nonFinite } = parsed;
    if (!isJsonObject(value)) return fail('not_an_object');
    const v = value[consts.version];
    const version = typeof v === 'number' && Number.isInteger(v) ? v : 0;
    const docid = value[consts.docid];
    if (typeof docid !== 'string') return fail('no_docid');
    const type = value[consts.type];
    if (typeof type !== 'string') return fail('no_type');
    const u = value[consts.user];
    let user: RemoteUser = { id: '', name: '' };
    if (isJsonObject(u)) {
      const id = u[consts.id];
      const name = u[consts.name];
      user = { id: typeof id === 'string' ? id : '', name: typeof name === 'string' ? name : '' };
    }
    let update: FrameUpdate | null = null;
    if (type === msgtypes.update) {
      const un = value[consts.updates];
      if (un === undefined) return fail('no_updates');
      if (!isJsonObject(un)) return fail('updates_not_an_object');
      const utype = un[consts.type];
      if (typeof utype !== 'string') return fail('no_update_type');
      if (!(consts.changes in un)) return fail('no_changes');
      const pointers: Point[] = [];
      const pn = un[consts.pointer];
      if (Array.isArray(pn)) {
        for (const item of pn as readonly JsonValue[]) {
          if (!isJsonObject(item)) continue;
          const x = item[consts.x];
          const y = item[consts.y];
          if (typeof x === 'number' && typeof y === 'number') pointers.push(new Point(x, y));
        }
      }
      update = {
        type: utype,
        changes: entries(un[consts.changes]),
        conditions: entries(un[consts.conditions]),
        pointers,
      };
    }
    return { ok: true, frame: { version, docid, type, user, update, raw: value, nonFinite } };
  },

  /** C++ `UpdateMsg::serialize` of an `update` frame. */
  encode(version: number, docid: string, u: OutgoingChanges): string {
    const updates: Record<string, JsonValue> = {
      [consts.changes]: { ...u.changes },
      [consts.conditions]: { ...(u.conditions ?? {}) },
      [consts.type]: u.type,
    };
    if (u.pointers !== undefined && u.pointers.length > 0) {
      updates[consts.pointer] = u.pointers.map((p) => ({ [consts.x]: p.x, [consts.y]: p.y }));
    }
    const frame: JsonObject = {
      [consts.version]: Math.trunc(version),
      [consts.docid]: docid,
      [consts.type]: msgtypes.update,
      [consts.updates]: updates,
    };
    return writeJsonText(frame);
  },
});
