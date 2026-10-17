// The worker's scene: the long-lived, read-only half (catalog, generator registry, engine config,
// the text service that never measures) and, per job, the throw-away `ObjectStore` built from the
// job's `SceneSnapshot` (spec 07 §6.7). It uses the same io reader, model, template and generator
// code as the main thread, so answers are the same code, not an approximation.
//
// Deliberately not `session/`: a `BoardSession` pulls in `sync/` (and its types `semantic/`),
// which the worker chunk must not contain (AC-ARC-11). The environment below is the part of the
// `BoardSession` constructor the reader needs.
//
// Text: the worker never measures text (AC-REC-25). Its `TextMeasurer` throws
// `TextMeasureInWorkerError`, and `WorkerTextService` does not call it for layout: a laid-out text
// keeps its source string as one line of width 0, which is all the worker's queries see of text —
// a capture paint marks a labelled shape complex exactly as C++ does (non-empty text), and titles
// come from the snapshot's precomputed `titleRect`. `measure()` (auto-sized text boxes, `textwidth`
// data expressions, generator `textSize`) is answered from the snapshot's `textSizes`, which the
// main thread recorded by reading the same objects back; anything else reaches the throwing
// measurer.
import { EngineConfig, type Clock, type Config, type IdSource } from '../../base';
import { Rect, Size } from '../../geometry';
import { GeneratorRegistry, LuaToJsConverter, TemplateGeneratorHost } from '../../generators';
import { DocumentCodec, converterHooks, type IoEnv } from '../../io';
import { ObjectStore, type LekhObject, type ObjectEnv } from '../../model';
import type { Style } from '../../style';
import {
  CatalogOverlay,
  CatalogTemplateResolver,
  type JsonValue,
  type TemplateCatalog,
  type TemplateEnv,
  type TemplateText,
} from '../../template';
import type { LaidOutText, TextMeasurer } from '../../text';
import { ObjectSceneStore, pointOfPt, rectOfSnap, type TitleBox } from '../delegate/ObjectSceneStore';
import type { SceneArrowObject, SceneConnection } from '../delegate/SceneStore';
import type { SceneSnapshot } from './protocol';
import { measureKey } from './textSizes';

/** Thrown by anything that would measure text in the worker (a bug, AC-REC-25). */
export class TextMeasureInWorkerError extends Error {
  constructor() {
    super('text measured in the recognition worker');
    this.name = 'TextMeasureInWorkerError';
  }
}

/** The worker's `TextMeasurer`: it throws. */
export const THROWING_MEASURER: TextMeasurer = Object.freeze({
  measureLine(): never {
    throw new TextMeasureInWorkerError();
  },
});

/**
 * `TemplateText` without measuring: layouts keep the text, at width 0, so code that only asks
 * whether there is text sees the same answer; `measure` goes to the throwing measurer.
 */
export class WorkerTextService implements TemplateText {
  private readonly measurer_: TextMeasurer;
  private readonly sizes_: Readonly<Record<string, readonly [number, number]>>;

  /** `sizes`: the snapshot's `textSizes`; a measurement it lacks goes to `measurer` (which throws). */
  constructor(
    measurer: TextMeasurer = THROWING_MEASURER,
    sizes: Readonly<Record<string, readonly [number, number]>> = {},
  ) {
    this.measurer_ = measurer;
    this.sizes_ = sizes;
  }

  measure(text: string, style: Style, constraint: Size): Size {
    const s = this.sizes_[measureKey(text, style, constraint)];
    if (s !== undefined) return new Size(s[0], s[1]);
    this.measurer_.measureLine(text, '');
    return new Size(0, 0);
  }

  layout(text: string, _style: Style, box: Rect, _wrapWidth: number, angle: number): LaidOutText {
    const c = box.center();
    return {
      lines:
        text === ''
          ? []
          : [{ text, width: 0, x: c.x, baselineY: c.y, top: c.y, dir: 'ltr', start: 0, end: text.length }],
      width: 0,
      height: 0,
      lineHeight: 0,
      fontKey: '',
      font: '',
      stretch: 'normal',
      px: 0,
      ascent: 0,
      descent: 0,
      baseline: 'alphabetic',
      align: 'center',
      underline: false,
      strikeThrough: false,
      box: new Rect(c.x, c.y, 0, 0),
      angle,
    };
  }
}

export interface WorkerSceneOptions {
  readonly catalog: TemplateCatalog;
  readonly generators?: GeneratorRegistry;
  readonly config?: Config;
  readonly clock?: Clock;
  /** The measurer behind each job's `WorkerTextService` (default: the throwing one; tests count). */
  readonly measurer?: TextMeasurer;
}

/** A job's scene: the store and what loading it cost. */
export interface LoadedScene {
  readonly scene: ObjectSceneStore;
  /** Objects the reader could not parse (the job fails with `rec_snapshot` when any). */
  readonly failed: number;
}

/** Ids only ever minted for objects the worker reads with their own ids: a counter is enough. */
function counterIds(): IdSource {
  let n = 0;
  return {
    next(): string {
      n++;
      return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    },
  };
}

const ZERO_CLOCK: Clock = Object.freeze({ now: () => 0 });

export class WorkerScene {
  readonly catalog: TemplateCatalog;
  readonly config: Config;
  private readonly converter_: LuaToJsConverter;
  private readonly measurer_: TextMeasurer;
  private readonly clock_: Clock;

  constructor(opts: WorkerSceneOptions) {
    this.catalog = opts.catalog;
    this.config = opts.config ?? new EngineConfig();
    this.converter_ = new LuaToJsConverter(opts.generators ?? GeneratorRegistry.builtin());
    this.measurer_ = opts.measurer ?? THROWING_MEASURER;
    this.clock_ = opts.clock ?? ZERO_CLOCK;
  }

  /** The io environment of one job, over a fresh overlay holding the snapshot's templates. */
  private env(snap: SceneSnapshot): DocumentCodec {
    const config = this.config;
    const text: TemplateText = new WorkerTextService(this.measurer_, snap.textSizes);
    const holder: { codec: DocumentCodec | null } = { codec: null };
    const codec = (): DocumentCodec => {
      if (holder.codec === null) throw new Error('worker codec not ready');
      return holder.codec;
    };
    const overlay = new CatalogOverlay(this.catalog, {
      resolve: this.converter_.resolve,
      instantiate: (def) => codec().templates.instantiate(def),
    });
    for (const json of Object.values(snap.docTemplates)) overlay.addTemplate(json as JsonValue);
    const resolver = new CatalogTemplateResolver(overlay, (def) => codec().embedFactory()(def));
    const templates: TemplateEnv = {
      config,
      text,
      resolver,
      image: () => undefined,
      generatorContext: (t) => new TemplateGeneratorHost(t, text),
      warn: () => undefined,
    };
    const ids = counterIds();
    const objects: ObjectEnv = {
      config,
      text,
      arrowhead: (id) => {
        const def = overlay.arrowhead(id);
        return def === undefined ? null : codec().templates.instantiate(def);
      },
      newId: () => ids.next(),
    };
    const env: IoEnv = {
      objects,
      templates,
      document: { config, clock: this.clock_, ids },
      generators: converterHooks(this.converter_),
    };
    holder.codec = new DocumentCodec(env);
    return holder.codec;
  }

  /** Reads `snap`'s objects into a fresh store, laid out and indexed. */
  load(snap: SceneSnapshot, zoom: number): LoadedScene {
    const codec = this.env(snap);
    const objs: LekhObject[] = [];
    let failed = 0;
    for (const so of snap.objects) {
      if (so.isConnector) continue;
      try {
        objs.push(codec.readObject(so.json as JsonValue, so.id).object);
      } catch (err) {
        if (err instanceof TextMeasureInWorkerError) throw err;
        failed++;
      }
    }
    const store = new ObjectStore({ config: this.config, clock: this.clock_ });
    store.load(objs);
    store.flushLayout();
    const titles = new Map<string, TitleBox>();
    for (const so of snap.objects) {
      if (so.titleRect !== undefined) titles.set(so.id, { rect: rectOfSnap(so.titleRect), angle: so.titleAngle ?? 0 });
    }
    const arrows: SceneArrowObject[] = snap.arrowEnds.map((a) => ({
      id: a.id,
      strokeWidth: a.strokeWidth,
      isSingleCurve: a.isSingleCurve,
      ends: a.ends.map((e) => ({ p1: pointOfPt(e.p1), p2: pointOfPt(e.p2), hasArrow: e.hasArrow })),
    }));
    const connections: SceneConnection[] = snap.connections.map((c) => ({
      firstId: c.firstId,
      secondId: c.secondId,
      type: c.type,
      autoType: c.autoType,
    }));
    return {
      scene: new ObjectSceneStore({ store, config: this.config, titles, arrows, connections, zoom }),
      failed,
    };
  }
}
