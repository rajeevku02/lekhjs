// The legacy XML document form (port of C++ `XmlSerializer::deserialize` and its `parse*`
// functions, `L/document/XmlSerializer.cpp:87-1139`; spec 02 `XmlDocumentReader`, spec 03 §10.5).
// Only the reader is ported: there is no XML writer (owner, OQ-11). An XML board loads and is
// saved as JSON, as today.
//
// Every XML object but a plain connector is a legacy type and is converted on load
// (`LegacyConverter`). Ported as is, including:
//   - a connector keeps its three segment texts as legacy labels (trailing empty ones dropped) and
//     takes its type only from `setOldLineParams`, i.e. only when `ConnectDistance` is present;
//   - a dash pattern keeps its first two entries; the colour channels are read Red, Blue, Green,
//     Alpha; a black background colour reads as none;
//   - the root `DrawingProfile` is the current drawing style (returned as `currentStyle`).
// One deliberate difference: C++ `fixConnections` stopped at the first connector whose end was
// missing and left it, and every later one, in the store with no ends (nothing drew them); here
// every connector with a missing end is dropped, as the JSON reader does.
import { BezierCurve, Point } from '../../geometry';
import { ArrowHeads, ConnectionObject, ConnectionType, LekhDocument, type LekhObject } from '../../model';
import { Color, Style, type CapStyle, type JoinStyle } from '../../style';
import { LoadError } from '../errors';
import type { ReadResult } from '../json/document-reader';
import { convertLegacy, type LegacyBase, type LegacyObject } from '../legacy/legacy-converter';
import { LoadContext, type IoEnv } from '../load-context';
import { XmlTokenType, XmlTokenizer } from './xml-tokenizer';

const Open = XmlTokenType.Open;
const Close = XmlTokenType.Close;

/** A parsed XML object: a legacy record or a connector, with its integer id. */
interface XmlEntry {
  readonly id: number;
  readonly legacy: LegacyObject | null;
  readonly connector: ConnectionObject | null;
  readonly srcId: number;
  readonly targetId: number;
}

class Fail extends Error {}

export class XmlDocumentReader {
  private readonly env: IoEnv;

  constructor(env: IoEnv) {
    this.env = env;
  }

  /** C++ `isXML`: a `<` within the first 12 characters. */
  static isXml(text: string): boolean {
    return text.slice(0, 12).includes('<');
  }

  read(text: string): ReadResult {
    try {
      return this.readOrFail(text);
    } catch (e) {
      if (e instanceof Fail) throw new LoadError('xml_parse');
      throw e;
    }
  }

  private readOrFail(text: string): ReadResult {
    const t = new XmlTokenizer(text);
    if (text === '') throw new Fail();
    t.skipWhitespace();
    if (t.atEnd()) throw new Fail();
    const doc = new LekhDocument(this.env.document);
    const ctx = new LoadContext(this.env, doc);
    const req = <T>(v: T | null): T => {
      if (v === null) throw new Fail();
      return v;
    };
    const tag = (name: string, type: typeof Open | typeof Close) => {
      if (!t.match(name, type)) throw new Fail();
    };

    tag('LekhDiagram', Open);
    this.parseMetaInfo(t, doc, req, tag);
    this.parseBackground(t, doc, req, tag);
    const currentStyle = new Style();
    this.parseDrawingProfile(t, currentStyle, req, tag);

    const entries = this.parseObjects(t, req, tag);
    const byId = new Map<number, LekhObject>();
    const connectors: { con: ConnectionObject; src: number; target: number }[] = [];
    const page = doc.activePage();
    for (const e of entries) {
      let obj: LekhObject;
      if (e.legacy !== null) {
        obj = convertLegacy(e.legacy, this.env.objects.newId(), ctx);
        if (obj instanceof ConnectionObject) connectors.push({ con: obj, src: e.srcId, target: e.targetId });
      } else if (e.connector !== null) {
        obj = e.connector;
        connectors.push({ con: obj as ConnectionObject, src: e.srcId, target: e.targetId });
      } else {
        continue;
      }
      byId.set(e.id, obj);
      page.objectStore.add(obj);
    }
    for (const { con, src, target } of connectors) {
      const first = src > 0 ? byId.get(src) : undefined;
      const second = target > 0 ? byId.get(target) : undefined;
      if (first === undefined || second === undefined) {
        ctx.note('connector_end_missing');
        page.objectStore.remove(con);
        continue;
      }
      con.setConnectedObjects(first, second);
    }
    t.match('LekhDiagram', Close);

    return {
      doc,
      format: 'xml',
      version: doc.info.version,
      convertedLua: false,
      currentStyle,
      help: new Map(),
      recoveredPages: [],
      source: null,
      warnings: ctx.warnings(),
    };
  }

  /** C++ `parseMetaInfo`: version 1.0, or a compatibility list naming 1.0. */
  private parseMetaInfo(t: XmlTokenizer, doc: LekhDocument, req: Req, tag: Tag): void {
    tag('MetaInfo', Open);
    const version = req(t.string('Version'));
    const compat = req(t.string('Compatibility'));
    if (version !== '1.0' && !compat.split(',').includes('1.0')) throw new Fail();
    const info = doc.info;
    info.version = version;
    info.compatibilityList = compat;
    info.createdOnPlatform = req(t.string('CreatedOnPlatform'));
    info.author = req(t.string('Author'));
    info.title = req(t.string('Title'));
    info.description = req(t.string('Description'));
    tag('MetaInfo', Close);
  }

  /** C++ `parseBackground`. */
  private parseBackground(t: XmlTokenizer, doc: LekhDocument, req: Req, tag: Tag): void {
    tag('Background', Open);
    const isSet = req(t.bool('IsSet'));
    const color = this.parseColor(t, 'Color', req, tag);
    const base64 = req(t.string('Image'));
    tag('Background', Close);
    if (!isSet) return;
    const bg = doc.activePage().background;
    if (!(color.red === 0 && color.green === 0 && color.blue === 0)) bg.setColor(color);
    if (base64 !== '') bg.setImageData(base64);
  }

  /** C++ `parseColor`: Red, Blue, Green, Alpha. */
  private parseColor(t: XmlTokenizer, name: string, req: Req, tag: Tag): Color {
    tag(name, Open);
    const r = req(t.int('Red'));
    const b = req(t.int('Blue'));
    const g = req(t.int('Green'));
    const a = req(t.int('Alpha'));
    tag(name, Close);
    return new Color(r, g, b, a);
  }

  /** C++ `parseDrawingProfile` (with `parseFontProfile` and `parseDashPattern`). */
  private parseDrawingProfile(t: XmlTokenizer, dp: Style, req: Req, tag: Tag): void {
    tag('DrawingProfile', Open);
    dp.setJoinStyle(req(t.int('JoinStyle')) as JoinStyle);
    dp.setCapStyle(req(t.int('CapStyle')) as CapStyle);
    dp.setStrokeWidth(req(t.double('Width')));
    dp.setStrokeColor(this.parseColor(t, 'Color', req, tag));
    const fill = req(t.bool('Fill'));
    if (!fill) dp.setNoFill();
    const fillColor = this.parseColor(t, 'FillColor', req, tag);
    if (fill) dp.setFillColor(fillColor);

    tag('FontProfile', Open);
    dp.setFontSize(req(t.double('Size')));
    dp.setFontFamily(req(t.string('Family')));
    dp.setFontModifier(req(t.string('Modifiers')));
    dp.setFontColor(this.parseColor(t, 'Color', req, tag));
    tag('FontProfile', Close);

    tag('DashPattern', Open);
    req(t.int('Count'));
    dp.setDashPatternPhase(req(t.int('Phase')));
    const d0 = req(t.double('D'));
    const d1 = req(t.double('D'));
    req(t.double('D'));
    req(t.double('D'));
    dp.setDashArray([d0, d1]);
    tag('DashPattern', Close);
    tag('DrawingProfile', Close);
  }

  private parseObjects(t: XmlTokenizer, req: Req, tag: Tag): XmlEntry[] {
    tag('Objects', Open);
    const out: XmlEntry[] = [];
    for (;;) {
      const token = t.next();
      if (token.type === XmlTokenType.End) throw new Fail();
      if (token.type === XmlTokenType.Close) break;
      t.index = token.undoIndex;
      out.push(this.createObject(t, token.value, req, tag));
    }
    t.match('Objects', Close);
    return out;
  }

  /** C++ `parseObjectBegin`: the tag, then ID, Text and DrawingProfile. */
  private begin(t: XmlTokenizer, name: string, req: Req, tag: Tag): { id: number; base: LegacyBase } {
    tag(name, Open);
    const id = req(t.int('ID'));
    const text = req(t.string('Text'));
    const style = new Style();
    this.parseDrawingProfile(t, style, req, tag);
    return { id, base: { text, style } };
  }

  private point(t: XmlTokenizer, name: string, req: Req, tag: Tag): Point {
    tag(name, Open);
    const x = req(t.double('X'));
    const y = req(t.double('Y'));
    tag(name, Close);
    return new Point(x, y);
  }

  private points(t: XmlTokenizer, name: string, req: Req, tag: Tag): Point[] {
    tag(name, Open);
    const out: Point[] = [];
    for (;;) {
      const token = t.next();
      if (token.type === XmlTokenType.End) throw new Fail();
      t.index = token.undoIndex;
      if (token.type === XmlTokenType.Close) break;
      out.push(this.point(t, 'Point', req, tag));
    }
    tag(name, Close);
    return out;
  }

  private arrows(t: XmlTokenizer, req: Req, tag: Tag): ArrowHeads {
    const arr = new ArrowHeads(this.env.objects);
    tag('Arrow', Open);
    const startHas = req(t.bool('ArrowAtStart'));
    const startSolid = req(t.bool('ArrowAtStartSolid'));
    arr.setStartKind(startHas, startSolid);
    const endHas = req(t.bool('ArrowAtEnd'));
    const endSolid = req(t.bool('ArrowAtEndSolid'));
    arr.setEndKind(endHas, endSolid);
    tag('Arrow', Close);
    return arr;
  }

  private curves(t: XmlTokenizer, req: Req, tag: Tag): BezierCurve[] {
    tag('Curves', Open);
    const out: BezierCurve[] = [];
    for (;;) {
      const token = t.next();
      if (token.type === XmlTokenType.End) throw new Fail();
      t.index = token.undoIndex;
      if (token.type === XmlTokenType.Close) break;
      tag('BezierCurve', Open);
      const n = req(t.int('NumberOfPoints'));
      const p1 = this.point(t, 'Point', req, tag);
      const p2 = this.point(t, 'Point', req, tag);
      const p3 = this.point(t, 'Point', req, tag);
      const p4 = this.point(t, 'Point', req, tag);
      tag('BezierCurve', Close);
      out.push(new BezierCurve(p1, p2, p3, p4, n));
    }
    tag('Curves', Close);
    return out;
  }

  /** C++ `parseConnectionObject`, into a fresh connector with no ends. */
  private connection(
    t: XmlTokenizer,
    req: Req,
    tag: Tag,
  ): { id: number; con: ConnectionObject; src: number; target: number } {
    const { id, base } = this.begin(t, 'Connection', req, tag);
    const con = new ConnectionObject(
      this.env.objects,
      null,
      null,
      ConnectionType.GenericLine,
      this.env.objects.newId(),
    );
    con.text = base.text;
    con.drawingProfile.copyFrom(base.style);
    const texts = [req(t.string('Text')), req(t.string('Text')), req(t.string('Text'))];
    while (texts.length > 0 && texts[texts.length - 1] === '') texts.pop();
    con.legacyTexts = texts;
    const src = req(t.int('Source'));
    const target = req(t.int('Target'));
    const type = req(t.int('Type'));
    const dist = t.int('ConnectDistance');
    if (dist !== null) con.setOldLineParams(dist, type);
    con.arrows.copyFrom(this.arrows(t, req, tag));
    tag('Connection', Close);
    return { id, con, src, target };
  }

  /** C++ `createObject`. */
  private createObject(t: XmlTokenizer, name: string, req: Req, tag: Tag): XmlEntry {
    const legacy = (id: number, l: LegacyObject): XmlEntry => ({
      id,
      legacy: l,
      connector: null,
      srcId: 0,
      targetId: 0,
    });
    switch (name) {
      case 'Circle': {
        const { id, base } = this.begin(t, name, req, tag);
        const center = this.point(t, 'Center', req, tag);
        const radius = req(t.double('Radius'));
        tag(name, Close);
        return legacy(id, { kind: 'circle', ...base, center, radius });
      }
      case 'Ellipse': {
        const { id, base } = this.begin(t, name, req, tag);
        const center = this.point(t, 'Center', req, tag);
        const width = req(t.double('Width'));
        const height = req(t.double('Height'));
        const rotation = req(t.double('Rotation'));
        tag(name, Close);
        return legacy(id, { kind: 'ellipse', ...base, center, width, height, rotation });
      }
      case 'Line': {
        const { id, base } = this.begin(t, name, req, tag);
        const vertices = [this.point(t, 'StartPoint', req, tag), this.point(t, 'EndPoint', req, tag)];
        const arrows = this.arrows(t, req, tag);
        tag(name, Close);
        return legacy(id, { kind: 'polygon', ...base, vertices, closed: false, rounded: false, arrows });
      }
      case 'Polygon': {
        const { id, base } = this.begin(t, name, req, tag);
        const vertices = this.points(t, 'Points', req, tag);
        if (vertices.length < 2) throw new Fail();
        const closed = req(t.bool('IsClosed'));
        const rounded = req(t.bool('IsRounded'));
        const arrows = this.arrows(t, req, tag);
        tag(name, Close);
        return legacy(id, { kind: 'polygon', ...base, vertices, closed, rounded, arrows });
      }
      case 'FreeForm': {
        const { id, base } = this.begin(t, name, req, tag);
        const points = this.points(t, 'Points', req, tag);
        tag(name, Close);
        return legacy(id, { kind: 'freeform', ...base, points });
      }
      case 'Curve': {
        const { id, base } = this.begin(t, name, req, tag);
        const curves = this.curves(t, req, tag);
        const arrows = this.arrows(t, req, tag);
        tag(name, Close);
        return legacy(id, { kind: 'curve', ...base, curves, arrows });
      }
      case 'Text': {
        const { id, base } = this.begin(t, name, req, tag);
        const center = this.point(t, 'Center', req, tag);
        const rotation = req(t.double('Rotation'));
        tag(name, Close);
        return legacy(id, { kind: 'text', ...base, center, rotation });
      }
      case 'Image': {
        const { id, base } = this.begin(t, name, req, tag);
        const center = this.point(t, 'Center', req, tag);
        const width = req(t.double('Width'));
        const height = req(t.double('Height'));
        const rotation = req(t.double('Rotation'));
        const format = req(t.string('Format'));
        const data = req(t.string('Data'));
        tag(name, Close);
        return legacy(id, { kind: 'image', ...base, center, width, height, rotation, format, data });
      }
      case 'Connection': {
        const { id, con, src, target } = this.connection(t, req, tag);
        return { id, legacy: null, connector: con, srcId: src, targetId: target };
      }
      case 'CurveConnection': {
        tag(name, Open);
        const { id, con, src, target } = this.connection(t, req, tag);
        const angle1 = req(t.double('Angle'));
        const angle2 = req(t.double('Angle'));
        const distFactor1 = req(t.double('DistanceFactor'));
        const distFactor2 = req(t.double('DistanceFactor'));
        tag(name, Close);
        // As C++: the converted connector keeps the arrowheads; its style and labels are not carried.
        return {
          id,
          legacy: {
            kind: 'curveconnection',
            text: '',
            style: new Style(),
            srcId: String(src),
            targetId: String(target),
            angle1,
            angle2,
            distFactor1,
            distFactor2,
            arrows: con.arrows,
          },
          connector: null,
          srcId: src,
          targetId: target,
        };
      }
    }
    throw new Fail();
  }
}

type Req = <T>(v: T | null) => T;
type Tag = (name: string, type: typeof Open | typeof Close) => void;
