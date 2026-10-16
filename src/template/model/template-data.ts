// A template's declarative members as loaded (port of C++ `BaseTemplateData` and `TemplateData`,
// merged as spec 02 §7.1 decides; `L/BaseTemplateData.{h,cpp}`, `L/ShapeTemplate.cpp:29-197`).
//
// The members are public fields: `io/TemplateDataCodec` reads and writes them (the C++ friend
// `JsonObjectSerializer`), and generators rewrite them (the C++ friends `LuaShapeGenerator` and
// `CppShapeGenerator`). Styles are never null: the C++ codec always made one.
import { Style } from '../../style';
import type { JsonValue } from '../json';
import type { TemplateParam } from '../expr/template-param';
import type { ShapeGenerator } from '../generator/shape-generator';
import { TextSide } from './shape-element';

/** C++ `BaseTemplateData::Condition`: parsed and written back, never evaluated (spec 04 §2). */
export class Condition {
  variable = '';
  op = '';
  value: JsonValue = null;

  clone(): Condition {
    const c = new Condition();
    c.variable = this.variable;
    c.op = this.op;
    c.value = this.value;
    return c;
  }

  /** C++ `Condition::equals` returns true unconditionally. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the C++ signature
  equals(_other: Condition): boolean {
    return true;
  }
}

/** C++ `TextInfo::DefaultRowColVal`. */
export const DEFAULT_ROW_COL = -999999;

export class TextInfo {
  location = '';
  text = '';
  type = '';
  name = '';
  /** Table cells (the `table-v1` generator). */
  row = DEFAULT_ROW_COL;
  col = DEFAULT_ROW_COL;
  style: Style = new Style();
  condition = new Condition();
  /** Not `None` only for the template's title, drawn outside the shape on that side. */
  external: TextSide = TextSide.None;

  /** A copy with its own style and condition (C++ `copyFrom` clones the style). */
  clone(): TextInfo {
    const t = new TextInfo();
    t.location = this.location;
    t.text = this.text;
    t.type = this.type;
    t.name = this.name;
    t.row = this.row;
    t.col = this.col;
    t.style = this.style.clone();
    t.condition = this.condition.clone();
    t.external = this.external;
    return t;
  }

  /** C++ `TextInfo::equals`: location, text, row, col, side, style and condition. */
  equals(other: TextInfo): boolean {
    return (
      other.location === this.location &&
      other.text === this.text &&
      other.row === this.row &&
      other.col === this.col &&
      other.external === this.external &&
      other.style.equals(this.style) &&
      other.condition.equals(this.condition)
    );
  }
}

export class ImageInfo {
  location = '';
  base64 = '';
  format = '';
  src = '';
  style: Style = new Style();
  condition = new Condition();

  clone(): ImageInfo {
    const i = new ImageInfo();
    i.location = this.location;
    i.base64 = this.base64;
    i.format = this.format;
    i.src = this.src;
    i.style = this.style.clone();
    i.condition = this.condition.clone();
    return i;
  }
}

export class PathInfo {
  drawCmds = '';
  style: Style = new Style();
  condition = new Condition();

  constructor(drawCmds = '', style: Style = new Style()) {
    this.drawCmds = drawCmds;
    this.style = style;
  }

  clone(): PathInfo {
    const p = new PathInfo(this.drawCmds, this.style.clone());
    p.condition = this.condition.clone();
    return p;
  }
}

export class EmbedInfo {
  name: string;
  /** Take the embedded template's id from this parameter's value. */
  param: string;
  location: string;
  mode: string;
  inheritStyle: boolean;
  style: Style | null;
  condition: Condition;

  constructor(
    name: string,
    param: string,
    location: string,
    mode: string,
    inheritStyle: boolean,
    style: Style | null,
    condition: Condition = new Condition(),
  ) {
    this.name = name;
    this.param = param;
    this.location = location;
    this.mode = mode;
    this.inheritStyle = inheritStyle;
    this.style = style;
    this.condition = condition;
  }

  clone(): EmbedInfo {
    return new EmbedInfo(
      this.name,
      this.param,
      this.location,
      this.mode,
      this.inheritStyle,
      this.style?.clone() ?? null,
      this.condition.clone(),
    );
  }
}

/** The bits of the stored `flags` member (part of the document format). */
export const TemplateFlags = Object.freeze({
  PrimitiveForDist: 0x1,
  PrimitiveForIntersect: 0x2,
  PrimitiveForInside: 0x4,
  TextCentroid: 0x8,
  Closed: 0x10,
  Rounded: 0x20,
} as const);

export class TemplateData {
  templateId = '';
  templateName = '';
  aliases = '';
  help = '';

  textData: TextInfo[] = [];
  imageData: ImageInfo[] = [];
  pathData: PathInfo[] = [];
  embedData: EmbedInfo[] = [];
  /** The `data` expression strings. */
  dataExpStrs: string[] = [];
  params: TemplateParam[] = [];
  pointAttrStrs: string[] = [];
  alignPointsStr = '';
  containerPaths: string[] = [];
  boundPathStr = '';
  noFillPathStr = '';
  editableVerticesStr = '';
  generator: ShapeGenerator | null = null;

  usePrimitiveForDistance = false;
  usePrimitiveForIntersection = false;
  usePrimitiveForInsideCheck = false;
  /** Polygon templates only. */
  textInCentroid = false;
  closed = false;
  rounded = false;

  /** C++ `name()`. */
  name(): string {
    return this.templateName;
  }

  /**
   * C++ `copyFrom`: every member is copied, styles and parameters cloned, the generator cloned.
   * `help` is not copied (as C++; the catalog keeps help text separately).
   */
  copyFrom(other: TemplateData): void {
    this.clearTemplateData();
    this.templateId = other.templateId;
    this.templateName = other.templateName;
    this.aliases = other.aliases;
    this.generator = other.generator !== null ? other.generator.clone() : null;
    this.dataExpStrs = other.dataExpStrs.slice();
    this.pathData = other.pathData.map((p) => p.clone());
    this.containerPaths = other.containerPaths.slice();
    this.boundPathStr = other.boundPathStr;
    this.textData = other.textData.map((t) => t.clone());
    this.imageData = other.imageData.map((i) => i.clone());
    this.embedData = other.embedData.map((e) => e.clone());
    this.params = other.params.map((p) => p.clone());
    this.pointAttrStrs = other.pointAttrStrs.slice();
    this.noFillPathStr = other.noFillPathStr;
    this.editableVerticesStr = other.editableVerticesStr;
    this.alignPointsStr = other.alignPointsStr;
    this.usePrimitiveForDistance = other.usePrimitiveForDistance;
    this.usePrimitiveForInsideCheck = other.usePrimitiveForInsideCheck;
    this.usePrimitiveForIntersection = other.usePrimitiveForIntersection;
    this.textInCentroid = other.textInCentroid;
    this.closed = other.closed;
    this.rounded = other.rounded;
  }

  getFlags(): number {
    let flags = 0;
    if (this.usePrimitiveForDistance) flags |= TemplateFlags.PrimitiveForDist;
    if (this.usePrimitiveForIntersection) flags |= TemplateFlags.PrimitiveForIntersect;
    if (this.usePrimitiveForInsideCheck) flags |= TemplateFlags.PrimitiveForInside;
    if (this.textInCentroid) flags |= TemplateFlags.TextCentroid;
    if (this.closed) flags |= TemplateFlags.Closed;
    if (this.rounded) flags |= TemplateFlags.Rounded;
    return flags;
  }

  setFlags(flags: number): void {
    this.usePrimitiveForDistance = (flags & TemplateFlags.PrimitiveForDist) !== 0;
    this.usePrimitiveForIntersection = (flags & TemplateFlags.PrimitiveForIntersect) !== 0;
    this.usePrimitiveForInsideCheck = (flags & TemplateFlags.PrimitiveForInside) !== 0;
    this.textInCentroid = (flags & TemplateFlags.TextCentroid) !== 0;
    this.closed = (flags & TemplateFlags.Closed) !== 0;
    this.rounded = (flags & TemplateFlags.Rounded) !== 0;
  }

  /** C++ `clearTemplateData`: the generated members (and point attributes) are emptied. */
  clearTemplateData(): void {
    this.pointAttrStrs = [];
    this.pathData = [];
    this.textData = [];
    this.imageData = [];
    this.dataExpStrs = [];
    this.embedData = [];
    this.containerPaths = [];
  }

  clearTextData(): void {
    this.textData = [];
  }
}
