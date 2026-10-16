// Kind tests (spec 01 C6): code tests `obj.kind` instead of `instanceof` across modules.
import type { LekhObject } from './lekh-object';
import { ObjectKind } from './lekh-object';

export function isGroup(obj: LekhObject | null | undefined): boolean {
  return obj?.kind === ObjectKind.Group;
}

export function isConnector(obj: LekhObject | null | undefined): boolean {
  return obj?.kind === ObjectKind.Connector;
}

export function isFreehand(obj: LekhObject | null | undefined): boolean {
  return obj?.kind === ObjectKind.Freehand;
}

export function isTemplated(obj: LekhObject | null | undefined): boolean {
  return obj?.kind === ObjectKind.Templated;
}
