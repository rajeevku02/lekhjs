// lekhjs module `edit` (spec 01 §2.1, rank 9). The only import target from outside the module.
// Commands (the `UserAction` family) with their realtime updates, the per-session undo stack, the
// transaction helper, cloning and the clipboard, the editors' engine half and the selection-menu
// catalog (spec 02 §11, spec 03 §11.3, §11.5, spec 05 §6.3, §8).
export { CollectingSink, EditKeys, EditUpdateType, NO_UPDATES, OutgoingUpdate, type UpdateSink } from './update';
export {
  ArrowEnd,
  UserAction,
  arrowPointCount,
  arrowsOf,
  connectionParamsJson,
  connectionTextsJson,
  editConfig,
  refreshArrows,
  type EditEnv,
} from './user-action';
export {
  AddObjectAction,
  ArrowAddEraseAction,
  ArrowChangeAction,
  ChangeConnectionAction,
  ConnectionVertexEditAction,
  ConvertObjectsAction,
  DeleteObjectAction,
  DrawingProfileChangeAction,
  ExpandAction,
  FlipAction,
  GroupAction,
  ObjectOrderChangeAction,
  ObjectsActionBase,
  RotateAction,
  ScaleAction,
  TemplateModificationAction,
  TemplateParamChangeAction,
  TemplatedObjectChangeAction,
  TextEditAction,
  TextMoveAction,
  TranslateObjectAction,
  VertexEditAction,
  collectEmbedTemplates,
  makeTitleSideChange,
  snapshotTemplate,
  styleDiff,
  type TemplateSnapshot,
} from './object-actions';
export {
  AddDelPageBaseAction,
  AddPageAction,
  BackgroundChangeAction,
  ChangeGridAction,
  ChangeScalingAction,
  DeletePageAction,
  PageSizeChangeAction,
  ReorderPageAction,
  SetPageMarginAction,
  SetPageNameAction,
} from './page-actions';
export { UNDO_STACK_SIZE, UndoManager, type UndoManagerOptions } from './undo-manager';
export { EditTransaction, TemplatedObjectsChangeAction } from './edit-transaction';
export {
  MultiSelection,
  isMulti,
  selectionOf,
  targetObjects,
  targetStyle,
  type EditTarget,
  type SelectionChange,
} from './edit-target';
export { EditorContext, type EditorContextOptions } from './editor-context';
export { addMultiToCanvas, cloneObjects, cloneWithConnections, performGroupClone, type CloneResult } from './clone';
export { ClipboardService, multiOf, type ClipboardPayload } from './clipboard';
export { EditCommands } from './commands';
export {
  ColorEditor,
  ColorType,
  ConnectionEditor,
  PageEditor,
  PageOrientation,
  PropertyEditor,
  StyleEditor,
  type ParamValueType,
} from './editors';
export {
  SelectionActionCatalog,
  type SelectionAction,
  type SelectionActionContext,
  type SelectionActionDef,
  type SelectionActionId,
  type SelectionActionResult,
  type SelectionPanel,
} from './selection-actions';
