// The version a whole-document write stamps (spec 04 §9.2, spec 03 §10.6; replaces C++
// `serializeInfo` with the process-wide `FormatStampMode`).
//
// The policy is an argument of each write, never process state, so two sessions writing at once
// with different policies cannot affect each other (AC-ENG-20):
//   - `offline` (offline save, `.lekh` export, share-as-file, download a copy): always 5.0;
//   - `cloud` (an upload of a local file, MCP `board_create_content`): by content only — 5.0 when
//     a JS-form generator is written, else 4.3 when a title is, else 4.2. Neither the stored cloud
//     version nor the file's own `info.version` is read: kashi keeps a stored board's version from
//     going down (stored = max(stored, written), spec 04 §9.2).
import { GroupObject, TemplatedObject, type LekhDocument, type LekhObject } from '../../model';
import { FormatVersion } from './format-version';

export type StampPolicy = 'offline' | 'cloud';

/** What the cloud rule looks at. */
export interface StampContent {
  /** A template with a JS-form generator is written (placeholders do not count). */
  readonly hasJsGenerators: boolean;
  /** A templated object has a title, at any group depth. */
  readonly usesTitle: boolean;
}

function objectsUseTitle(objs: readonly LekhObject[]): boolean {
  for (const obj of objs) {
    if (obj instanceof GroupObject) {
      if (objectsUseTitle(obj.members())) return true;
      continue;
    }
    if (obj instanceof TemplatedObject) {
      const t = obj.shapeTemplate();
      if (t !== null && t.titleIndex() >= 0) return true;
    }
  }
  return false;
}

/** C++ `documentUsesTitle`: any templated object on any page, at any group depth, has a title. */
export function documentUsesTitle(doc: LekhDocument): boolean {
  return doc.pages.some((p) => objectsUseTitle(p.objectStore.objects));
}

export const FormatStamp = Object.freeze({
  /** The `info.version` to write under `policy` for `content`. */
  versionFor(policy: StampPolicy, content: StampContent): string {
    if (policy === 'offline') return FormatVersion.LATEST;
    if (content.hasJsGenerators) return FormatVersion.LATEST;
    return content.usesTitle ? FormatVersion.TITLES : FormatVersion.BASE;
  },
});
