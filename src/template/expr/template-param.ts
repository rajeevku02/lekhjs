// A template parameter and its editor descriptor (port of C++ `TemplateParam` and
// `TemplateParamEditor`, `L/DataExpression.h`). The editor descriptor drives the React property
// panel; the value is the stored JSON value.
import type { JsonValue } from '../json';

/** C++ `TemplateParamEditor::ParamEditorType` (the stored numbers). */
export const ParamEditorType = Object.freeze({
  Default: 0,
  IntMinMax: 1,
  FloatMinMax: 2,
  FloatMinMaxStep: 3,
  EnumString: 4,
  EnumIcon: 5,
  Icon: 6,
  Hidden: 255,
} as const);
export type ParamEditorType = (typeof ParamEditorType)[keyof typeof ParamEditorType];

export class TemplateParamEditor {
  type: ParamEditorType = ParamEditorType.Default;
  minVal = 0;
  maxVal = 0;
  step = 0;
  enumItems: string[] = [];
  minPointer = '';
  maxPointer = '';
  optional = '';
  depends = '';

  clone(): TemplateParamEditor {
    const e = new TemplateParamEditor();
    e.type = this.type;
    e.minVal = this.minVal;
    e.maxVal = this.maxVal;
    e.step = this.step;
    e.enumItems = this.enumItems.slice();
    e.minPointer = this.minPointer;
    e.maxPointer = this.maxPointer;
    e.optional = this.optional;
    e.depends = this.depends;
    return e;
  }
}

export class TemplateParam {
  value: JsonValue = null;
  name = '';
  display = '';
  order = -1;
  editor = new TemplateParamEditor();

  /**
   * The value as a number (C++ `JsonNode::floatOrIntVal`). C++ left the out-value unset for any
   * other type and read garbage; a non-number reads 0 here.
   */
  numberValue(): number {
    return typeof this.value === 'number' ? this.value : 0;
  }

  /** The value as a string (C++ `stringVal`: empty for a non-string). */
  stringValue(): string {
    return typeof this.value === 'string' ? this.value : '';
  }

  /** C++ `equals`: same name and an equal value. */
  equals(other: TemplateParam): boolean {
    return this.name === other.name && jsonEquals(this.value, other.value);
  }

  clone(): TemplateParam {
    const p = new TemplateParam();
    p.value = this.value;
    p.name = this.name;
    p.display = this.display;
    p.order = this.order;
    p.editor = this.editor.clone();
    return p;
  }
}

/** Structural equality of two JSON values (C++ `JsonNode::equals`). */
export function jsonEquals(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const aa = a as readonly JsonValue[];
    const ba = b as readonly JsonValue[];
    if (aa.length !== ba.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (!jsonEquals(aa[i] ?? null, ba[i] ?? null)) return false;
    }
    return true;
  }
  const ao = a as Readonly<Record<string, JsonValue>>;
  const bo = b as Readonly<Record<string, JsonValue>>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  for (const k of ak) {
    if (!(k in bo) || !jsonEquals(ao[k] ?? null, bo[k] ?? null)) return false;
  }
  return true;
}
