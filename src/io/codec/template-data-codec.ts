// Template JSON ⇄ live `ShapeTemplate` (port of C++ `JsonObjectSerializer::parseShapeTemplate`,
// `parseTemplateData`, `parseTemplateParams`, `parseCondition`, `serializeShapeTemplate`,
// `serializeTemplateParams` and `serializeCondition`, `L/document/Serializer.cpp:2387-3042,
// 3274-3301`; spec 02 `TemplateDataCodec`).
//
// Every body goes through the generator resolve hook first (spec 04 §7.1), so a Lua generator is
// converted on every path that parses a template. Ported as is, including:
//   - a body that is only `{ "id": … }` is a reference to the catalog (C++ `TemplateStore`);
//   - an entry whose `condition` is malformed is skipped; conditions are never evaluated;
//   - only the first text entry with a valid `external` side is the title;
//   - parameters are sorted by `order` only when every object-form parameter has one (stable
//     here; C++ `std::sort` left equal orders in any order);
//   - `name`, `help`, `aliases` and `libraryview` are read but never written; an embed's
//     `inheritstyle` is never written (OQ-13).
import { Style } from '../../style';
import {
  BezierCurveTemplate,
  Condition,
  EmbedInfo,
  ImageInfo,
  ParamEditorType,
  PathInfo,
  PathTemplate,
  PolygonTemplate,
  ShapeTemplate,
  TemplateParam,
  TextInfo,
  TextSide,
  TextTemplate,
  classifyGenerator,
  compiledDataOf,
  isJsonObject,
  templateClassOf,
  textSideFromName,
  textSideName,
  type JsonObject,
  type JsonValue,
  type TemplateDef,
  type TemplateEnv,
} from '../../template';
import {
  boolField,
  hasMember,
  intField,
  listOf,
  member,
  membersInByteOrder,
  numField,
  objField,
  strField,
  stringVal,
} from '../json/json-fields';
import { buildGenerator, isJsForm, resolveHook, type GeneratorHooks } from './generator-hooks';
import { parseStyle, parseStyleOrDrawingProfile, serializeStyleIfNeeded } from './style-codec';

type Out = Record<string, JsonValue>;

/** What a parse did, accumulated across calls (content-free). */
export interface TemplateParseStats {
  /** Bodies whose Lua generator the resolve hook converted to JS. */
  converted: number;
}

export interface TemplateWriteOptions {
  /**
   * The base64 data of a referenced image (`src`) to inline when the slot has none (C++
   * `serializeImageFromSrc` with a loaded image); `undefined` keeps the slot as a reference.
   */
  readonly inlineImage?: (src: string, format: string) => string | undefined;
  /** Called for every template written whose generator is JS-form (the cloud stamp rule). */
  readonly onJsGenerator?: () => void;
}

/** C++ `parseCondition`: absent is the default; a malformed one is `null` (the entry is skipped). */
function parseCondition(parent: JsonValue | undefined): Condition | null {
  const c = new Condition();
  const node = member(parent, 'condition');
  if (node === undefined) return c;
  const variable = strField(node, 'variable');
  if (variable === undefined || variable === '') return null;
  const op = strField(node, 'op');
  if (op === undefined || op === '') return null;
  const value = member(node, 'value');
  if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') return null;
  c.variable = variable;
  c.op = op;
  c.value = value;
  return c;
}

function serializeCondition(parent: Out, cond: Condition): void {
  const v = cond.value;
  if (cond.variable === '' || cond.op === '') return;
  if (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string') return;
  parent['condition'] = { variable: cond.variable, op: cond.op, value: v };
}

/** A style member parsed into a fresh style (C++ `new Style()` then `parseStyle` if present). */
function entryStyle(jn: JsonValue | undefined): Style {
  const style = new Style();
  const node = member(jn, 'style');
  if (node !== undefined) parseStyle(style, isJsonObject(node) ? node : {});
  return style;
}

/** C++ `parseTemplateParams`. */
export function parseTemplateParams(tparams: JsonValue | undefined): TemplateParam[] {
  const params: TemplateParam[] = [];
  let hasOrder = true;
  if (!isJsonObject(tparams)) return params;
  for (const [name, v] of membersInByteOrder(tparams)) {
    const tp = new TemplateParam();
    tp.name = name;
    tp.editor.type = ParamEditorType.Default;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      tp.value = v;
    } else if (isJsonObject(v)) {
      tp.value = member(v, 'value') ?? null;
      tp.order = intField(v, 'order') ?? -1;
      if (tp.order < 0) hasOrder = false;
      tp.display = strField(v, 'display') ?? '';
      const ed = objField(v, 'editor');
      if (ed !== undefined) {
        const type = intField(ed, 'type');
        if (type !== undefined) tp.editor.type = type as ParamEditorType;
        tp.editor.minVal = numField(ed, 'min') ?? tp.editor.minVal;
        tp.editor.maxVal = numField(ed, 'max') ?? tp.editor.maxVal;
        tp.editor.step = numField(ed, 'step') ?? tp.editor.step;
        tp.editor.optional = strField(ed, 'optional') ?? tp.editor.optional;
        tp.editor.maxPointer = strField(ed, 'maxpointer') ?? tp.editor.maxPointer;
        tp.editor.minPointer = strField(ed, 'minpointer') ?? tp.editor.minPointer;
        tp.editor.depends = strField(ed, 'depends') ?? tp.editor.depends;
        for (const item of listOf(ed, 'options')) if (typeof item === 'string') tp.editor.enumItems.push(item);
      }
    }
    params.push(tp);
  }
  if (hasOrder) params.sort((a, b) => a.order - b.order);
  return params;
}

/** C++ `serializeTemplateParams`. */
export function serializeTemplateParams(params: readonly TemplateParam[]): JsonObject {
  const out: Out = {};
  for (const p of params) {
    if (Object.prototype.hasOwnProperty.call(out, p.name)) continue; // C++ `insert`: the first wins
    const et = p.editor.type;
    if (et !== ParamEditorType.Default || p.display !== '' || p.order >= 0) {
      const ed: Out = { type: et };
      if (et === ParamEditorType.IntMinMax || et === ParamEditorType.FloatMinMax) {
        ed['min'] = p.editor.minVal;
        ed['max'] = p.editor.maxVal;
      } else if (et === ParamEditorType.FloatMinMaxStep) {
        ed['min'] = p.editor.minVal;
        ed['max'] = p.editor.maxVal;
        ed['step'] = p.editor.step;
      } else if (et === ParamEditorType.EnumString) {
        ed['options'] = p.editor.enumItems.slice();
      }
      if (p.editor.depends !== '') ed['depends'] = p.editor.depends;
      if (p.editor.maxPointer !== '') ed['maxpointer'] = p.editor.maxPointer;
      if (p.editor.minPointer !== '') ed['minpointer'] = p.editor.minPointer;
      if (p.editor.optional !== '') ed['optional'] = p.editor.optional;
      out[p.name] = { value: p.value, display: p.display, order: p.order, editor: ed };
    } else {
      out[p.name] = p.value;
    }
  }
  return out;
}

export class TemplateDataCodec {
  readonly env: TemplateEnv;
  readonly hooks: GeneratorHooks | undefined;

  constructor(env: TemplateEnv, hooks?: GeneratorHooks) {
    this.env = env;
    this.hooks = hooks;
  }

  /** A codec like this one whose templates use `env` (a load's environment). */
  withEnv(env: TemplateEnv): TemplateDataCodec {
    return new TemplateDataCodec(env, this.hooks);
  }

  /**
   * C++ `parseShapeTemplate`: a new, **not loaded** template from `json`, or `null` when it is
   * not a template body (no string `id`) or names a template the catalog does not have.
   * A reference body `{id}` returns the catalog's loaded copy.
   */
  parse(json: JsonValue | undefined, stats?: TemplateParseStats): ShapeTemplate | null {
    if (!isJsonObject(json)) return null;
    const tid = strField(json, 'id');
    if (tid === undefined) return null;
    if (Object.keys(json).length === 1) return this.env.resolver.getTemplate(tid);

    const res = resolveHook(this.hooks)(json);
    if (res.converted && stats !== undefined) stats.converted++;
    const node = res.json;
    const klass = templateClassOf(node);
    const isPoly = klass === 'polygon';
    let stl: ShapeTemplate;
    if (klass === 'polygon') stl = new PolygonTemplate(this.env);
    else if (klass === 'curve') stl = new BezierCurveTemplate(this.env);
    else if (klass === 'text') stl = new TextTemplate(this.env);
    else if (klass === 'path') stl = new PathTemplate(this.env);
    else stl = new ShapeTemplate(this.env);

    stl.templateId = tid;
    stl.boundPathStr = strField(node, 'bound') ?? stl.boundPathStr;
    this.parseTemplateData(node, stl);
    stl.editableVerticesStr = strField(node, 'editable_vertices') ?? stl.editableVerticesStr;
    stl.noFillPathStr = strField(node, 'no_fill') ?? stl.noFillPathStr;

    const flags = intField(node, 'flags');
    if (flags !== undefined) {
      stl.setFlags(flags);
    } else {
      stl.usePrimitiveForDistance = boolField(node, 'primitive_for_distance') ?? stl.usePrimitiveForDistance;
      stl.usePrimitiveForIntersection =
        boolField(node, 'primitive_for_intersection') ?? stl.usePrimitiveForIntersection;
      stl.usePrimitiveForInsideCheck = boolField(node, 'primitive_for_inside') ?? stl.usePrimitiveForInsideCheck;
      if (isPoly) {
        stl.textInCentroid = boolField(node, 'text_at_centroid') ?? stl.textInCentroid;
        stl.closed = boolField(node, 'closed') ?? stl.closed;
        stl.rounded = boolField(node, 'rounded') ?? stl.rounded;
      }
    }

    const lib = objField(node, 'libraryview');
    if (lib !== undefined) {
      const a = stl.libraryViewAttr;
      a.width = numField(lib, 'width') ?? a.width;
      a.height = numField(lib, 'height') ?? a.height;
      a.text = strField(lib, 'text') ?? a.text;
      a.scale = boolField(lib, 'scale') ?? a.scale;
      a.priority = intField(lib, 'priority') ?? 0;
    }
    const def = objField(node, 'default');
    if (def !== undefined) {
      const a = stl.defaultAttr;
      a.width = numField(def, 'width') ?? a.width;
      a.height = numField(def, 'height') ?? a.height;
      a.angle = numField(def, 'angle') ?? a.angle;
    }
    stl.templateName = strField(node, 'name') ?? stl.templateName;

    const gen = objField(node, 'generator');
    if (gen !== undefined) {
      const ref = res.generator ?? classifyGenerator(gen);
      const g = buildGenerator(this.hooks, gen, ref, tid);
      if (g !== null) stl.generator = g;
    }
    return stl;
  }

  /** C++ `parseTemplateData`: the declarative members of `node` into `stl`. */
  private parseTemplateData(node: JsonObject, stl: ShapeTemplate): void {
    parseStyleOrDrawingProfile(node, stl.getStyle());

    const texts = member(node, 'texts');
    if (typeof texts === 'string') {
      if (texts !== '') {
        const td = new TextInfo();
        td.location = texts;
        stl.textData.push(td);
      }
    } else {
      let hasTitle = false;
      for (const jn of listOf(node, 'texts')) {
        const cond = parseCondition(jn);
        if (cond === null) continue;
        let external: TextSide = TextSide.None;
        const side = strField(jn, 'external');
        if (!hasTitle && side !== undefined) external = textSideFromName(side);
        const loc = strField(jn, 'location') ?? '';
        if (loc === '' && external === TextSide.None) continue;
        hasTitle = hasTitle || external !== TextSide.None;
        const ti = new TextInfo();
        ti.location = loc;
        ti.text = strField(jn, 'text') ?? '';
        ti.type = strField(jn, 'type') ?? '';
        ti.style = entryStyle(jn);
        ti.condition = cond;
        ti.external = external;
        const row = intField(jn, 'row');
        if (row !== undefined) ti.row = row;
        const col = intField(jn, 'col');
        if (col !== undefined) ti.col = col;
        stl.textData.push(ti);
      }
    }

    const images = member(node, 'images');
    if (typeof images === 'string') {
      if (images !== '') {
        const ii = new ImageInfo();
        ii.location = images;
        stl.imageData.push(ii);
      }
    } else {
      for (const jn of listOf(node, 'images')) {
        const cond = parseCondition(jn);
        if (cond === null) continue;
        const loc = strField(jn, 'location');
        if (loc === undefined || loc === '') continue;
        const data = strField(jn, 'data') ?? '';
        const src = strField(jn, 'src') ?? '';
        if (data === '' && src === '') continue;
        const ii = new ImageInfo();
        ii.location = loc;
        ii.base64 = data;
        ii.format = strField(jn, 'format') ?? '';
        ii.style = entryStyle(jn);
        ii.condition = cond;
        ii.src = src;
        stl.imageData.push(ii);
      }
    }

    for (const jn of listOf(node, 'draw')) {
      if (typeof jn === 'string') {
        if (jn !== '') stl.pathData.push(new PathInfo(jn, new Style()));
      } else if (isJsonObject(jn)) {
        const cond = parseCondition(jn);
        if (cond === null) continue;
        const drawStr = strField(jn, 'path');
        if (drawStr === undefined || drawStr === '') continue;
        const pi = new PathInfo(drawStr, entryStyle(jn));
        pi.condition = cond;
        stl.pathData.push(pi);
      }
    }

    for (const jn of listOf(node, 'containers')) if (typeof jn === 'string') stl.containerPaths.push(jn);

    for (const emb of listOf(node, 'embeds')) {
      const cond = parseCondition(emb);
      if (cond === null) continue;
      const name = strField(emb, 'name');
      const location = strField(emb, 'location');
      if (name === undefined || location === undefined) continue;
      const param = strField(emb, 'param') ?? '';
      const mode = strField(emb, 'mode') ?? '';
      const inherit = boolField(emb, 'inheritstyle') ?? true;
      stl.embedData.push(new EmbedInfo(name, param, location, mode, inherit, entryStyle(emb), cond));
    }

    if (hasMember(node, 'params')) stl.params = parseTemplateParams(member(node, 'params'));

    for (const s of listOf(node, 'data')) stl.dataExpStrs.push(stringVal(s));
    for (const s of listOf(node, 'pointattrs')) stl.pointAttrStrs.push(stringVal(s));

    stl.alignPointsStr = strField(node, 'alignpoints') ?? stl.alignPointsStr;
    stl.help = strField(node, 'help') ?? stl.help;
    stl.aliases = strField(node, 'aliases') ?? stl.aliases;
  }

  /**
   * A new, loaded template from a catalog or document definition (the `TemplateFactory` the
   * catalog overlay is given). Its compiled expressions are the definition's.
   */
  instantiate(def: TemplateDef): ShapeTemplate {
    const t = this.parse(def.json);
    if (t === null) throw new Error(`TemplateDataCodec.instantiate: ${def.id} is not a template body`);
    if (Object.keys(def.json).length > 1) t.useCompiled(compiledDataOf(def));
    t.load();
    return t;
  }

  /** C++ `serializeShapeTemplate`. */
  serialize(stl: ShapeTemplate, opts: TemplateWriteOptions = {}): JsonObject {
    const tmpl: Out = { id: stl.templateId };
    serializeStyleIfNeeded(tmpl, stl.getStyle());
    if (stl.boundPathStr !== '') tmpl['bound'] = stl.boundPathStr;
    if (stl.noFillPathStr !== '') tmpl['no_fill'] = stl.noFillPathStr;
    if (stl.editableVerticesStr !== '') tmpl['editable_vertices'] = stl.editableVerticesStr;
    if (stl.alignPointsStr !== '') tmpl['alignpoints'] = stl.alignPointsStr;
    if (stl instanceof PolygonTemplate && stl.templateId !== 'avabodh.basic.polygon') tmpl['polygon'] = true;
    const flags = stl.getFlags();
    if (flags !== 0) tmpl['flags'] = flags;
    tmpl['data'] = stl.dataExpStrs.slice();
    if (stl.pointAttrStrs.length > 0) tmpl['pointattrs'] = stl.pointAttrStrs.slice();
    if (stl.params.length > 0) tmpl['params'] = serializeTemplateParams(stl.params);

    const gen = stl.generator;
    if (gen !== null) {
      tmpl['generator'] = gen.toJSON();
      if (opts.onJsGenerator !== undefined && isJsForm(this.hooks, gen)) opts.onJsGenerator();
    }
    if (gen === null || gen.behavior === 'onParamChange') {
      if (stl.textData.length > 0) {
        const title = stl.titleIndex();
        tmpl['texts'] = stl.textData.map((t, i) => {
          const to: Out = { text: t.text };
          if (t.location !== '') to['location'] = t.location;
          if (i === title) to['external'] = textSideName(t.external);
          if (t.row !== -999999) to['row'] = t.row;
          if (t.col !== -999999) to['col'] = t.col;
          if (t.type !== '') to['type'] = t.type;
          serializeStyleIfNeeded(to, t.style);
          serializeCondition(to, t.condition);
          return to;
        });
      }
      if (stl.imageData.length > 0) {
        tmpl['images'] = stl.imageData.map((im) => {
          const io: Out = { data: im.base64, format: im.format, location: im.location };
          serializeStyleIfNeeded(io, im.style);
          serializeCondition(io, im.condition);
          if (im.src !== '') {
            io['src'] = im.src;
            if (im.base64 === '' && opts.inlineImage !== undefined) {
              const data = opts.inlineImage(im.src, im.format);
              if (data !== undefined) io['data'] = data;
            }
          }
          return io;
        });
      }
      if (stl.pathData.length > 0) {
        tmpl['draw'] = stl.pathData.map((p) => {
          const po: Out = { path: p.drawCmds };
          serializeStyleIfNeeded(po, p.style);
          serializeCondition(po, p.condition);
          return po;
        });
      }
      if (stl.containerPaths.length > 0) tmpl['containers'] = stl.containerPaths.slice();
      if (stl.embedData.length > 0) {
        tmpl['embeds'] = stl.embedData.map((e) => {
          const eo: Out = { name: e.name };
          if (e.param !== '') eo['param'] = e.param;
          eo['location'] = e.location;
          if (e.mode !== '') eo['mode'] = e.mode;
          if (e.style !== null) serializeStyleIfNeeded(eo, e.style);
          serializeCondition(eo, e.condition);
          return eo;
        });
      }
    }
    tmpl['default'] = { width: stl.defaultAttr.width, height: stl.defaultAttr.height, angle: stl.defaultAttr.angle };
    return tmpl;
  }
}
