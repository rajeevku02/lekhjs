// The outgoing realtime update a command produces (C++ `Update`, raised through
// `LekhGlobal::updateManager().raise`). `edit/` and `sync/` share a rank and may not import each
// other (spec 01 §3.2 rule 1), so the strings a command writes are repeated here; a test pins them
// to `sync/consts.ts` (AC-ENG-17). The session's sink hands the update to `SyncSession` (cloud
// boards) through the event's outbox, or drops it (offline boards, as C++ dropped it with no
// docid).
import type { JsonValue } from '../template';

/** The `updates.type` values commands write (C++ `updatetypes`). */
export const EditUpdateType = Object.freeze({
  addPages: 'addpages',
  delPages: 'delpages',
  changePageAttr: 'changepageattr',
  addObjects: 'addobjects',
  delObjects: 'delobjects',
  delAllObjects: 'delallobjects',
  changeAttr: 'changeattr',
  changeArrow: 'changearrow',
  changeTemplateParams: 'changetemplateparams',
  changeGrid: 'changegrid',
  changeScaling: 'changescaling',
  changeConnectionParams: 'changeconnectionparams',
  changeConnectionTexts: 'changeconnectiontexts',
  changeBackground: 'changebackground',
  changeStyle: 'changestyle',
  convertObjects: 'convertobjects',
} as const);
export type EditUpdateType = (typeof EditUpdateType)[keyof typeof EditUpdateType];

/** The path members commands write (C++ `consts`). */
export const EditKeys = Object.freeze({
  doc: 'doc',
  pages: 'pages',
  objects: 'objects',
  params: 'params',
  stemplate: 'template',
  cx: 'cx',
  cy: 'cy',
  width: 'width',
  height: 'height',
  angle: 'angle',
  arrows: 'arrows',
  start: 'start',
  end: 'end',
  texts: 'texts',
  ctype: 'ctype',
  style: 'style',
  background: 'background',
  attributes: 'attributes',
  grid: 'grid',
  present: 'present',
  scaling: 'scaling',
  unit: 'unit',
  scale: 'scale',
  order: 'order',
  templates: 'templates',
  help: 'help',
} as const);

/** C++ `Update`: one change set, `null` values being deletes. */
export class OutgoingUpdate {
  readonly type: EditUpdateType;
  readonly changes: Record<string, JsonValue> = {};
  readonly conditions: Record<string, JsonValue> = {};

  constructor(type: EditUpdateType) {
    this.type = type;
  }

  set(path: string, value: JsonValue): void {
    this.changes[path] = value;
  }

  get size(): number {
    return Object.keys(this.changes).length;
  }
}

/** Where commands raise their updates (the session's outbox). */
export interface UpdateSink {
  raise(update: OutgoingUpdate): void;
}

/** A sink that drops everything (offline boards, headless edits). */
export const NO_UPDATES: UpdateSink = Object.freeze({
  raise(): void {
    /* offline: nothing is sent */
  },
});

/** A sink that keeps what it was given (tests, a session's per-event outbox). */
export class CollectingSink implements UpdateSink {
  readonly updates: OutgoingUpdate[] = [];

  raise(update: OutgoingUpdate): void {
    this.updates.push(update);
  }

  clear(): void {
    this.updates.length = 0;
  }
}
