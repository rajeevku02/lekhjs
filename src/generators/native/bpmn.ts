// The six BPMN native generators (spec 04 §6; hand port of `L/shapegen/CppShapeGenerator.cpp`
// :386-776 and :1352-1640): `bpmn.activity`, `bpmn.event`, `bpmn.gateway`, `bpmn.conversation`,
// `bpmn.dataobject` and `bpmn.choreography`.
//
// Each is `onParamChange`: its output is serialized and it runs only from `ShapeTemplate.load()`.
// It rewrites the template's `data`, `draw` and `embeds` (and, for the choreography, the
// participant texts) directly, with no JSON round trip. `embedReferences()` is the whole
// parameter-independent symbol set of the generator, whatever the stored `embedrefs` said (C++
// `updateEmbedRefs`), so a written board carries every symbol definition in `doc.templates`.
import type {
  DataStore,
  GeneratorBehavior,
  GeneratorContext,
  JsonObject,
  ShapeTemplate,
  EmbedInfo,
} from '../../template';
import { PathInfo, ShapeGenerator, TextInfo } from '../../template';
import { Color, Style } from '../../style';
import {
  CORNER_RADIUS,
  aspectEmbed,
  boolVal,
  intVal,
  loc5,
  makeRect,
  nativeFieldsOf,
  nativeJson,
  paramMap,
  refSet,
  sf,
  si,
  sv,
  stringVal,
  type NativeFields,
} from './native-common';

const SYM = 'avabodh.bpmn.syms.';

/** C++ `taskTypeEmbedMap`. */
export const TASK_TYPE_EMBEDS: Readonly<Record<string, string>> = Object.freeze({
  Send: `${SYM}messageFilled`,
  Receive: `${SYM}message`,
  'Receive Instantiating': `${SYM}messageCircle`,
  User: `${SYM}user`,
  Manual: `${SYM}manual`,
  'Business Rule': `${SYM}businessRule`,
  Service: `${SYM}service`,
  Script: `${SYM}script`,
});

/** C++ `taskMarkerEmbedMap`. */
export const TASK_MARKER_EMBEDS: Readonly<Record<string, string>> = Object.freeze({
  'Sub-Process': `${SYM}subprocess`,
  Loop: `${SYM}loop`,
  Parallel: `${SYM}parallelMarker`,
  Sequential: `${SYM}sequentialMarker`,
  'Ad Hoc': `${SYM}adhoc`,
  Compensation: `${SYM}compensation`,
});

/** C++ `eventEmbedMap` (catching events). */
export const EVENT_EMBEDS: Readonly<Record<string, string>> = Object.freeze({
  Message: `${SYM}message`,
  Timer: `${SYM}timer`,
  Escalation: `${SYM}escalation`,
  Conditional: `${SYM}conditional`,
  Link: `${SYM}link`,
  Error: `${SYM}error`,
  Cancel: `${SYM}cancel`,
  Compensation: `${SYM}compensation`,
  Signal: `${SYM}signal`,
  Multiple: `${SYM}multiple`,
  'Parallel Multiple': `${SYM}parallelMultiple`,
  Terminate: `${SYM}terminate`,
});

/** C++ `eventEmbedMap2` (end and throwing intermediate events: solid icons). */
export const EVENT_SOLID_EMBEDS: Readonly<Record<string, string>> = Object.freeze({
  Message: `${SYM}messageFilled`,
  Timer: `${SYM}timer`,
  Escalation: `${SYM}escalationFilled`,
  Conditional: `${SYM}conditional`,
  Link: `${SYM}linkFilled`,
  Error: `${SYM}errorFilled`,
  Cancel: `${SYM}cancelFilled`,
  Compensation: `${SYM}compensationFilled`,
  Signal: `${SYM}signalFilled`,
  Multiple: `${SYM}multipleFilled`,
  'Parallel Multiple': `${SYM}parallelMultipleFilled`,
  Terminate: `${SYM}terminate`,
});

/** C++ `gatewayEmbedMap` (`Inclusive` has no icon: it draws a circle). */
export const GATEWAY_EMBEDS: Readonly<Record<string, string>> = Object.freeze({
  Exclusive: `${SYM}cancelFilled`,
  'Event Based': `${SYM}multiple`,
  Parallel: `${SYM}parallelMultipleFilled`,
  Inclusive: '',
  'Exclusive Event Based': `${SYM}multiple`,
  Complex: `${SYM}complexFilled`,
  'Parallel Event Based': `${SYM}parallelMultiple`,
});

/** `map.find(key) != map.end()` on a frozen record (own keys only). */
function lookup(map: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** A path with a fresh style (C++ `paths.push_back(PathInfo()); pi.style = new Style()`). */
function newPath(paths: PathInfo[], drawCmds = ''): PathInfo {
  const p = new PathInfo(drawCmds, new Style());
  paths.push(p);
  return p;
}

/** C++ `setDataExprs` + `setPathInfo` + `setEmbedInfo`. */
function apply(t: ShapeTemplate, data: string[], paths: PathInfo[], embeds: EmbedInfo[]): void {
  t.dataExpStrs = data;
  t.pathData = paths;
  t.embedData = embeds;
}

/** The `CppShapeGenerator` members every BPMN generator keeps; its symbol set is fixed. */
abstract class BpmnGenerator extends ShapeGenerator {
  readonly behavior: GeneratorBehavior = 'onParamChange';
  protected readonly fields_: NativeFields;

  constructor(fields: NativeFields) {
    super();
    this.fields_ = { ...fields, embedRefs: this.symbols() };
  }

  /** C++ `updateEmbedRefs`. */
  protected abstract symbols(): readonly string[];

  interpretText(): boolean {
    return this.fields_.interpretText;
  }

  interpretedText(): string {
    return this.fields_.text;
  }

  override setInterpretedText(text: string): void {
    this.fields_.text = text;
  }

  embedReferences(): readonly string[] {
    return this.fields_.embedRefs;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- C++ `savedw_`/`savedh_` are never set by a native generator
  setDimension(_ds: DataStore): void {
    /* no minimum size */
  }

  toJSON(): JsonObject {
    return nativeJson(this.fields_);
  }
}

/** Two task markers side by side at `y` (C++ `BpmnTaskGenerator` and `genTask`). */
function pushMarkers(data: string[], embeds: EmbedInfo[], marker1: string, marker2: string, count: number, y: string) {
  if (count === 0) return;
  const isz = 14;
  const gap2 = 1;
  const x = count > 1 ? isz + gap2 / 2 : 0;
  if (marker1 !== '') {
    const len = data.length;
    data.push(sf(-x), y, sf(isz), sf(isz), '0');
    embeds.push(aspectEmbed(marker1, loc5(len)));
  }
  if (marker2 !== '') {
    const len = data.length;
    data.push(sf(x), y, sf(isz), sf(isz), '0');
    embeds.push(aspectEmbed(marker2, loc5(len)));
  }
}

/** `bpmn.activity` (C++ `BpmnTaskGenerator`, `CppShapeGenerator.cpp:386`). */
export class BpmnTaskGenerator extends BpmnGenerator {
  static readonly SYMBOLS: readonly string[] = refSet(
    Object.values(TASK_TYPE_EMBEDS),
    Object.values(TASK_MARKER_EMBEDS),
  );

  static fromJson(gen: JsonObject): BpmnTaskGenerator {
    return new BpmnTaskGenerator(nativeFieldsOf('bpmn.activity', gen));
  }

  protected symbols(): readonly string[] {
    return BpmnTaskGenerator.SYMBOLS;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    const pmap = paramMap(t);
    const act = pmap.get('activity');
    if (act === undefined) return;
    const activity = stringVal(act);

    const data: string[] = [];
    const paths: PathInfo[] = [];
    const pi = newPath(paths);
    if (activity === 'Event Sub-Process') pi.style.setDashArray([4, 4]);
    if (activity === 'Call Activity') pi.style.setStrokeWidth(t.getStyle().effectiveStrokeWidth() + 2);
    pi.drawCmds = makeRect(data, 0);

    // "Transcation" is the stencil's spelling.
    if (activity === 'Transcation') {
      const inner = newPath(paths);
      inner.style.setNoFill();
      inner.style.addNonOverridables('fillPaint');
      inner.drawCmds = makeRect(data, 4);
    }

    const embeds: EmbedInfo[] = [];
    const tt = pmap.get('tasktype');
    if (tt !== undefined) {
      const icon = lookup(TASK_TYPE_EMBEDS, stringVal(tt));
      if (icon !== undefined) {
        const gap = 10;
        const isz = 20;
        const len = data.length;
        data.push(`-w/2 +${sf(gap + isz / 2)}`, `-h/2 +${sf(gap + isz / 2)}`, sf(isz), sf(isz), '0');
        embeds.push(aspectEmbed(icon, loc5(len)));
      }
    }

    let marker1 = '';
    let marker2 = '';
    let count = 0;
    const m1 = pmap.get('marker1');
    if (m1 !== undefined) {
      const m = lookup(TASK_MARKER_EMBEDS, stringVal(m1));
      if (m !== undefined) {
        marker1 = m;
        count++;
      }
    }
    const m2 = pmap.get('marker2');
    if (m2 !== undefined) {
      const m = lookup(TASK_MARKER_EMBEDS, stringVal(m2));
      if (m !== undefined) {
        marker2 = m;
        count++;
      }
    }
    pushMarkers(data, embeds, marker1, marker2, count, `h/2 - ${sf(8 + 14 / 2)}`);
    apply(t, data, paths, embeds);
  }

  clone(): BpmnTaskGenerator {
    return new BpmnTaskGenerator(this.fields_);
  }
}

/** `bpmn.event` (C++ `BpmnEventGenerator`, `CppShapeGenerator.cpp:505`). */
export class BpmnEventGenerator extends BpmnGenerator {
  static readonly SYMBOLS: readonly string[] = refSet(Object.values(EVENT_EMBEDS), Object.values(EVENT_SOLID_EMBEDS));

  static fromJson(gen: JsonObject): BpmnEventGenerator {
    return new BpmnEventGenerator(nativeFieldsOf('bpmn.event', gen));
  }

  protected symbols(): readonly string[] {
    return BpmnEventGenerator.SYMBOLS;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    const pmap = paramMap(t);
    const g = pmap.get('group');
    if (g === undefined) return;
    const group = stringVal(g);
    const nonInterrupting = boolVal(pmap.get('noninterrupting'));
    const throwing = boolVal(pmap.get('throwing'));
    const solid = group === 'End' || (group === 'Intermediate' && throwing);
    let icon = '';
    const tp = pmap.get('type');
    if (tp !== undefined) icon = lookup(solid ? EVENT_SOLID_EMBEDS : EVENT_EMBEDS, stringVal(tp)) ?? '';

    const data: string[] = ['0', '0', 'w', 'h', '0'];
    const paths: PathInfo[] = [];
    const embeds: EmbedInfo[] = [];
    const pi = newPath(paths, 'E 0 1 2 3 4');

    if (group === 'Intermediate') {
      if (nonInterrupting) pi.style.setDashArray([4, 4]);
      data.push('0', '0', 'w-9', 'h-9', '0');
      const pi2 = newPath(paths, 'E 5 6 7 8 9');
      if (nonInterrupting) pi2.style.setDashArray([4, 4]);
    } else if (group === 'End') {
      pi.style.setStrokeWidth(t.getStyle().effectiveStrokeWidth() + 2);
    } else if (nonInterrupting) {
      pi.style.setDashArray([4, 4]);
    }

    if (icon !== '') {
      const len = data.length;
      data.push('0', '0', 'w*0.5', 'h*0.5', '0');
      embeds.push(aspectEmbed(icon, loc5(len)));
    }
    apply(t, data, paths, embeds);
  }

  clone(): BpmnEventGenerator {
    return new BpmnEventGenerator(this.fields_);
  }
}

/** `bpmn.gateway` (C++ `BpmnGatewayGenerator`, `CppShapeGenerator.cpp:590`). */
export class BpmnGatewayGenerator extends BpmnGenerator {
  static readonly SYMBOLS: readonly string[] = refSet(Object.values(GATEWAY_EMBEDS));

  static fromJson(gen: JsonObject): BpmnGatewayGenerator {
    return new BpmnGatewayGenerator(nativeFieldsOf('bpmn.gateway', gen));
  }

  protected symbols(): readonly string[] {
    return BpmnGatewayGenerator.SYMBOLS;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    let type = '';
    for (const p of t.params) if (p.name === 'type') type = p.stringValue();

    const data: string[] = ['0', '-h/2', 'w/2', '0', '0', 'h/2', '-w/2', '0'];
    const paths: PathInfo[] = [];
    const embeds: EmbedInfo[] = [];
    newPath(paths, 'M 0 1 L 2 3 L 4 5 L 6 7 Z');

    const icon = lookup(GATEWAY_EMBEDS, type) ?? '';
    const circle = (r: string) => {
      const len = data.length;
      data.push('0', '0', `w*${r}`, `h*${r}`, '0');
      newPath(paths, `E ${sv([len, len + 1, len + 2, len + 3, len + 4])}`).style.setStrokeWidth(2);
    };

    let embedFactor = 0.5;
    if (type === 'Event Based' || type === 'Exclusive Event Based' || type === 'Parallel Event Based') {
      embedFactor = 0.3;
      circle('0.55');
      if (type === 'Event Based') circle('0.42');
    }
    if (type === 'Exclusive') embedFactor = 0.4;
    if (type === 'Complex') embedFactor = 0.7;

    if (icon !== '') {
      const len = data.length;
      data.push('0', '0', `w*${sf(embedFactor)}`, `h*${sf(embedFactor)}`, '0');
      embeds.push(aspectEmbed(icon, loc5(len)));
    }
    if (icon === '' && type === 'Inclusive') circle('0.5');
    apply(t, data, paths, embeds);
  }

  clone(): BpmnGatewayGenerator {
    return new BpmnGatewayGenerator(this.fields_);
  }
}

/** `bpmn.conversation` (C++ `BpmnConversationGenerator`, `CppShapeGenerator.cpp:675`). */
export class BpmnConversationGenerator extends BpmnGenerator {
  static readonly SYMBOLS: readonly string[] = refSet([`${SYM}subprocess`]);

  static fromJson(gen: JsonObject): BpmnConversationGenerator {
    return new BpmnConversationGenerator(nativeFieldsOf('bpmn.conversation', gen));
  }

  protected symbols(): readonly string[] {
    return BpmnConversationGenerator.SYMBOLS;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    const pmap = paramMap(t);
    const data: string[] = ['-w/2', '0', '-w/4', '-h/2', 'w/4', '-h/2', 'w/2', '0', 'w/4', 'h/2', '-w/4', 'h/2'];
    const paths: PathInfo[] = [];
    const embeds: EmbedInfo[] = [];
    const pi = newPath(paths, 'M 0 1 L 2 3 L 4 5 L 6 7 L 8 9 L 10 11 Z ');
    if (pmap.has('call') && boolVal(pmap.get('call'))) {
      pi.style.setStrokeWidth(t.getStyle().effectiveStrokeWidth() + 2);
    }
    if (pmap.has('subconversation') && boolVal(pmap.get('subconversation'))) {
      const len = data.length;
      const isz = 16;
      const gap = 6;
      data.push('0', `h/2 - ${sf(gap + isz / 2)}`, sf(isz), sf(isz), '0');
      embeds.push(aspectEmbed(`${SYM}subprocess`, loc5(len)));
    }
    apply(t, data, paths, embeds);
  }

  clone(): BpmnConversationGenerator {
    return new BpmnConversationGenerator(this.fields_);
  }
}

/** `bpmn.dataobject` (C++ `BpmnDataObjectGenerator`, `CppShapeGenerator.cpp:724`). */
export class BpmnDataObjectGenerator extends BpmnGenerator {
  static readonly SYMBOLS: readonly string[] = refSet([`${SYM}parallelMarker`, `${SYM}link`, `${SYM}linkFilled`]);

  static fromJson(gen: JsonObject): BpmnDataObjectGenerator {
    return new BpmnDataObjectGenerator(nativeFieldsOf('bpmn.dataobject', gen));
  }

  protected symbols(): readonly string[] {
    return BpmnDataObjectGenerator.SYMBOLS;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    const pmap = paramMap(t);
    const data: string[] = ['-w/2', '-h/2', 'w*0.2', '-h/2', 'w/2', '-h*0.25', 'w/2', 'h/2', '-w/2', 'h/2'];
    const paths: PathInfo[] = [];
    const embeds: EmbedInfo[] = [];
    newPath(paths, 'M 0 1 L 2 3 L 4 5 L 6 7 L 8 9 Z ').style.setStrokeWidth(2);
    data.push('w*0.2', '-h*0.25');
    newPath(paths, 'M 2 3 L 10 11 L 4 5 ').style.setStrokeWidth(2);

    const tp = pmap.get('type');
    if (tp !== undefined) {
      const type = stringVal(tp);
      if (type === 'Collection') {
        const len = data.length;
        const isz = 16;
        const gap = 6;
        data.push('0', `h/2 - ${sf(gap + isz / 2)}`, sf(isz), sf(isz), '0');
        embeds.push(aspectEmbed(`${SYM}parallelMarker`, loc5(len)));
      }
      const isInput = type === 'Input';
      const isOutput = type === 'Output';
      if (isInput || isOutput) {
        const icon = isOutput ? `${SYM}linkFilled` : `${SYM}link`;
        const len = data.length;
        data.push('min(w*0.4, 16)', 'min(h*0.2, 16)', `-w/2+d(${si(len)})`, `-h/2+d(${si(len + 1)})`, '16', '16', '0');
        embeds.push(aspectEmbed(icon, loc5(len + 2)));
      }
    }
    apply(t, data, paths, embeds);
  }

  clone(): BpmnDataObjectGenerator {
    return new BpmnDataObjectGenerator(this.fields_);
  }
}

/** `bpmn.choreography` (C++ `BpmnChoreographyGenerator`, `CppShapeGenerator.cpp:1352`). */
export class BpmnChoreographyGenerator extends BpmnGenerator {
  static readonly SYMBOLS: readonly string[] = refSet([
    `${SYM}subprocess`,
    `${SYM}message`,
    `${SYM}message2`,
    `${SYM}loop`,
    `${SYM}parallelMarker`,
    `${SYM}sequentialMarker`,
  ]);

  private topy_ = 0;
  private boty_ = 0;
  private data_: string[] = [];
  private paths_: PathInfo[] = [];
  private embeds_: EmbedInfo[] = [];

  static fromJson(gen: JsonObject): BpmnChoreographyGenerator {
    return new BpmnChoreographyGenerator(nativeFieldsOf('bpmn.choreography', gen));
  }

  protected symbols(): readonly string[] {
    return BpmnChoreographyGenerator.SYMBOLS;
  }

  override doesPartialTextManipulation(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    const pmap = paramMap(t);
    this.topy_ = 0;
    this.boty_ = 0;
    this.data_ = [];
    this.paths_ = [];
    this.embeds_ = [];

    let participants = pmap.has('participants') ? intVal(pmap.get('participants')) : 0;
    if (participants <= 2) participants = 2;
    const input = boolVal(pmap.get('input'));
    const response = boolVal(pmap.get('response'));
    const activeOnTop = pmap.has('activetop') ? boolVal(pmap.get('activetop')) : true;
    const marker = stringVal(pmap.get('marker'));
    const choreography = stringVal(pmap.get('choreography'));
    const isCall = choreography === 'Call';

    // One text per participant plus the task's, defaults for new ones; extra ones go.
    const texts = t.textData;
    while (texts.length < participants + 1) {
      const ti = new TextInfo();
      ti.text = texts.length === 0 ? 'Participant A' : texts.length === 1 ? 'Task' : 'Participant';
      texts.push(ti);
    }
    if (texts.length > participants + 1) texts.length = participants + 1;

    const pi = newPath(this.paths_);
    if (isCall) pi.style.setStrokeWidth(t.getStyle().effectiveStrokeWidth() + 2);
    pi.drawCmds = makeRect(this.data_, 0);

    if (activeOnTop) this.participantsActiveTop(texts);
    else this.participantsActiveBottom(texts);
    this.task(marker, choreography);

    const gap = 50;
    const isz = 40;
    // A message icon above (`top`) or below the shape, joined to it by a dotted line.
    const message = (icon: string, top: boolean) => {
      const data = this.data_;
      const edge = top ? '-h/2-' : 'h/2+';
      const len = data.length;
      data.push('0', `${edge}${sf(gap)}`, sf(isz), sf(isz), '0');
      this.embeds_.push(aspectEmbed(icon, loc5(len)));
      data.push('0', `${edge}sw(-1)`, '0', `${edge}${sf(gap - isz / 2)}`);
      const path = newPath(this.paths_, `M ${sv([len + 5, len + 6])} L ${sv([len + 7, len + 8])}`);
      path.style.setDashArray([2, 3]);
      path.style.setStrokeWidth(2);
      path.style.addNonOverridables('dashArray');
      path.style.addNonOverridables('strokeWidth');
    };
    if ((input && activeOnTop) || (response && !activeOnTop)) {
      message(activeOnTop ? `${SYM}message` : `${SYM}message2`, true);
    }
    if ((response && activeOnTop) || (input && !activeOnTop)) {
      message(activeOnTop ? `${SYM}message2` : `${SYM}message`, false);
    }
    apply(t, this.data_, this.paths_, this.embeds_);
  }

  /** C++ `genParticipantsActiveTop`. */
  private participantsActiveTop(texts: TextInfo[]): void {
    const data = this.data_;
    let len = data.length;
    data.push('th(0) + sw(-1) + 8', '-w/2', `-h/2+d(${si(len)})`, 'w/2', `d(${si(len + 2)})`);
    newPath(this.paths_, `M ${sv([len + 1, len + 2])} L ${sv([len + 3, len + 4])}`);
    data.push('0', `-h/2+d(${si(len)})/2`, 'w', `d(${si(len)})`, '0');
    setLocation(texts, 0, loc5(len + 5));
    this.topy_ = len + 2;

    data.push('h/2');
    let prevIdx = data.length - 1;
    for (let i = texts.length - 1; i > 1; i--) {
      const l = data.length;
      data.push(`th(${si(i)}) + sw(-1) + 8`, '0', `d(${si(prevIdx)})-d(${si(l)})/2`, 'w', `d(${si(l)})`, '0');
      setLocation(texts, i, loc5(l + 1));
      data.push('-w/2', `d(${si(prevIdx)})-d(${si(l)})`, 'w/2', `d(${si(l + 7)})`);
      newPath(this.paths_, `M ${sv([l + 6, l + 7])} L ${sv([l + 8, l + 9])}`);
      prevIdx = l + 7;
    }

    len = data.length;
    data.push(
      `d(${si(prevIdx)})-d(${si(this.topy_)})`,
      '0',
      `d(${si(this.topy_)})+d(${si(len)})/2`,
      'w',
      `d(${si(len)})`,
      '0',
    );
    setLocation(texts, 1, loc5(len + 1));

    this.boty_ = prevIdx;
    this.activeBand(prevIdx, 'h/2', '-');
  }

  /** C++ `genParticipantsActiveBottom`. */
  private participantsActiveBottom(texts: TextInfo[]): void {
    const data = this.data_;
    let len = data.length;
    data.push('th(0) + sw(-1) + 8', '-w/2', `h/2-d(${si(len)})`, 'w/2', `d(${si(len + 2)})`);
    newPath(this.paths_, `M ${sv([len + 1, len + 2])} L ${sv([len + 3, len + 4])}`);
    data.push('0', `h/2-d(${si(len)})/2`, 'w', `d(${si(len)})`, '0');
    setLocation(texts, 0, loc5(len + 5));
    this.boty_ = len + 2;

    data.push('-h/2');
    let prevIdx = data.length - 1;
    for (let i = 2; i < texts.length; i++) {
      const l = data.length;
      data.push(`th(${si(i)}) + sw(-1) + 8`, '0', `d(${si(prevIdx)})+d(${si(l)})/2`, 'w', `d(${si(l)})`, '0');
      setLocation(texts, i, loc5(l + 1));
      data.push('-w/2', `d(${si(prevIdx)})+d(${si(l)})`, 'w/2', `d(${si(l + 7)})`);
      newPath(this.paths_, `M ${sv([l + 6, l + 7])} L ${sv([l + 8, l + 9])}`);
      prevIdx = l + 7;
    }

    this.topy_ = prevIdx;

    len = data.length;
    data.push(
      `d(${si(this.boty_)})-d(${si(prevIdx)})`,
      '0',
      `d(${si(this.topy_)})+d(${si(len)})/2`,
      'w',
      `d(${si(len)})`,
      '0',
    );
    setLocation(texts, 1, loc5(len + 1));

    this.activeBand(this.topy_, '-h/2', '+');
  }

  /**
   * The grey band of the initiating participant: from `d(from)` to the rounded edge `edge`
   * (`h/2` at the bottom, `-h/2` at the top), inserted as the second path.
   */
  private activeBand(from: number, edge: 'h/2' | '-h/2', toward: '-' | '+'): void {
    const data = this.data_;
    const rad = si(CORNER_RADIUS);
    const len = data.length;
    data.push(
      '-w/2',
      `d(${si(from)})`,
      '-w/2',
      `${edge}${toward}${rad}`,
      '-w/2',
      `${edge}${toward}0.3*${rad}`,
      `-w/2+0.3*${rad}`,
      edge,
      `-w/2+${rad}`,
      edge,
      `w/2-${rad}`,
      edge,
      `w/2-0.3*${rad}`,
      edge,
      'w/2',
      `${edge}${toward}0.3*${rad}`,
      'w/2',
      `${edge}${toward}${rad}`,
      'w/2',
      `d(${si(len + 1)})`,
    );
    const style = new Style();
    style.setFillColor(new Color(191, 191, 191));
    style.addNonOverridables('fillPaint');
    const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => len + a + i);
    const cmds =
      `M ${sv([len, len + 1])} L ${sv([len + 2, len + 3])} C${sv(r(4, 9))} L ${sv([len + 10, len + 11])}` +
      ` C${sv(r(12, 17))} L ${sv([len + 18, len + 19])} Z`;
    this.paths_.splice(1, 0, new PathInfo(cmds, style));
  }

  /** C++ `genTask`: the loop/parallel/sequential marker and the sub-choreography marker. */
  private task(marker: string, type: string): void {
    let marker1 = '';
    let marker2 = '';
    let count = 0;
    if (marker === 'Loop') {
      marker1 = `${SYM}loop`;
      count++;
    } else if (marker === 'Parallel') {
      marker1 = `${SYM}parallelMarker`;
      count++;
    } else if (marker === 'Sequential') {
      marker1 = `${SYM}sequentialMarker`;
      count++;
    }
    if (type === 'Sub-Choreography') {
      marker2 = `${SYM}subprocess`;
      count++;
    }
    pushMarkers(this.data_, this.embeds_, marker1, marker2, count, `d(${si(this.boty_)}) - ${sf(8 + 14 / 2)}`);
  }

  clone(): BpmnChoreographyGenerator {
    return new BpmnChoreographyGenerator(this.fields_);
  }
}

function setLocation(texts: TextInfo[], i: number, location: string): void {
  const ti = texts[i];
  if (ti !== undefined) ti.location = location;
}
