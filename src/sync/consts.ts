// The realtime wire vocabulary: a literal port of `L/update/Consts.h` (spec 03 §11.1; spec 02
// `UpdateVocabulary`). Change a string here and you change the protocol: there is no schema file,
// and the doc server's field names must match. The member names are the C++ ones.

/** C++ `namespace consts`: the JSON field names. */
export const consts = Object.freeze({
  version: 'version',
  docid: 'docid',
  updates: 'updates',
  changes: 'changes',
  conditions: 'conditions',
  objects: 'objects',
  firstobject: 'firstobject',
  pages: 'pages',
  doc: 'doc',
  next: 'next',
  type: 'type',
  params: 'params',
  stemplate: 'template',
  angle: 'angle',
  width: 'width',
  height: 'height',
  cx: 'cx',
  cy: 'cy',
  x: 'x',
  y: 'y',
  arrows: 'arrows',
  start: 'start',
  end: 'end',
  attributes: 'attributes',
  grid: 'grid',
  scaling: 'scaling',
  scale: 'scale',
  unit: 'unit',
  present: 'present',
  ctype: 'ctype',
  texts: 'texts',
  background: 'background',
  color: 'color',
  style: 'style',
  tracker: 'tracker',
  pointer: 'pointer',
  laser: 'laser',
  user: 'user',
  name: 'name',
  id: 'id',
  templates: 'templates',
  help: 'help',
  order: 'order',
  size: 'size',
  canvasname: 'canvasname',
  canvassizetype: 'canvassizetype',
  margin: 'margin',
} as const);

/** C++ `namespace updatetypes`: the change kinds (`updates.type`). */
export const updatetypes = Object.freeze({
  addPages: 'addpages',
  delPages: 'delpages',
  changePageAttr: 'changepageattr',
  addObjects: 'addobjects',
  delObjects: 'delobjects',
  delAllObjects: 'delallobjects',
  load: 'load',
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
  trackPointer: 'trackpointer',
} as const);
export type UpdateType = (typeof updatetypes)[keyof typeof updatetypes];

/** C++ `namespace msgtypes`: the frame types. */
export const msgtypes = Object.freeze({
  request: 'request',
  update: 'update',
  broadcast: 'broadcast',
} as const);

/** The server's `message` frame type (`/backend/api/websocket-protocol.md` §6.2; not in `Consts.h`). */
export const MESSAGE_FRAME_TYPE = 'message';

/** The format stamp key a frame's `changes` may carry (spec 04 §9.3-§9.4). */
export const FORMAT_STAMP_KEY = 'doc.info.version';

/** The client compat level TS clients send on connect (spec 04 §10.1). */
export const CLIENT_COMPAT = 5;
