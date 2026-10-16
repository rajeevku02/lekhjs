// lekhjs module `sync` (spec 01 §2.1, rank 9). The only import target from outside the module.
// Realtime: the wire vocabulary, the frame codec, transactional apply, the session (docid,
// version), the format stamp, the transport port, the reconnect decision and remote presence
// (spec 03 §11, spec 04 §9.3-§9.4, spec 09 §7).
export {
  CLIENT_COMPAT,
  FORMAT_STAMP_KEY,
  MESSAGE_FRAME_TYPE,
  consts,
  msgtypes,
  updatetypes,
  type UpdateType,
} from './consts';
export type { Transport, TransportState, TransportStateName } from './transport';
export {
  FrameCodec,
  type DecodeResult,
  type FrameUpdate,
  type OutgoingChanges,
  type RemoteUser,
  type UpdateFrame,
} from './frame';
export { splitKey, utf8Length } from './paths';
export {
  AddDelObjectsUpdateAction,
  ApplyRecord,
  ArrowUpdateAction,
  AttrChangeUpdateAction,
  BackgroundChangeUpdateAction,
  ConnectionChangeUpdateAction,
  ConnectionTextsUpdateAction,
  DocReloadUpdateAction,
  GridChangeUpdateAction,
  PageAddDeleteAction,
  PageAttrChangeAction,
  RejectedUpdateAction,
  ScalingChangeUpdateAction,
  StyleChangeUpdateAction,
  TemplateParamUpdateAction,
  UpdateAction,
  type ApplyEnv,
  type ApplyResult,
  type AttrUpdate,
  type ObjStyle,
} from './update-actions';
export { UpdateDecoder } from './update-decoder';
export {
  CONVERSION_MAX_BYTES,
  CONVERSION_MAX_TEMPLATES,
  FrameStamper,
  docTemplateKey,
  objectTemplateKey,
  type ConversionEntry,
  type JsFormTest,
  type StampObservation,
} from './frame-stamper';
export {
  CLEAR_POINTS_MS,
  LAST_POINTER_MS,
  PRESENCE_COLORS,
  PresenceTracker,
  colorIndexOf,
  trailRadius,
  type PointerLoc,
  type PresenceTrackerOptions,
} from './presence-tracker';
export { ReconnectPolicy, type ReconnectDecision, type ReconnectPolicyOptions } from './reconnect-policy';
export {
  SyncSession,
  type ReceiveOutcome,
  type ServerMessage,
  type SyncEvents,
  type SyncHost,
  type SyncSessionOptions,
} from './sync-session';
