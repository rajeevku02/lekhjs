// The seven native generators (spec 04 §6), by the `shape` of a `type: "native"` generator block:
// the registry's default `natives` (C++ `CppShapeGenerator::getGenerator`).
import type { JsonObject, ShapeGenerator } from '../../template';
import {
  BpmnChoreographyGenerator,
  BpmnConversationGenerator,
  BpmnDataObjectGenerator,
  BpmnEventGenerator,
  BpmnGatewayGenerator,
  BpmnTaskGenerator,
} from './bpmn';
import { TableGenerator } from './table';

export {
  BpmnChoreographyGenerator,
  BpmnConversationGenerator,
  BpmnDataObjectGenerator,
  BpmnEventGenerator,
  BpmnGatewayGenerator,
  BpmnTaskGenerator,
  EVENT_EMBEDS,
  EVENT_SOLID_EMBEDS,
  GATEWAY_EMBEDS,
  TASK_MARKER_EMBEDS,
  TASK_TYPE_EMBEDS,
} from './bpmn';
export { TableGenerator } from './table';

/** `shape` → the generator built from its stored block. */
export const NATIVE_GENERATORS: Readonly<Record<string, (generator: JsonObject) => ShapeGenerator>> = Object.freeze({
  'bpmn.activity': (g) => BpmnTaskGenerator.fromJson(g),
  'bpmn.event': (g) => BpmnEventGenerator.fromJson(g),
  'bpmn.gateway': (g) => BpmnGatewayGenerator.fromJson(g),
  'bpmn.conversation': (g) => BpmnConversationGenerator.fromJson(g),
  'bpmn.dataobject': (g) => BpmnDataObjectGenerator.fromJson(g),
  'bpmn.choreography': (g) => BpmnChoreographyGenerator.fromJson(g),
  'table-v1': (g) => TableGenerator.fromJson(g),
});
