// The generators that stand in for code lekhjs does not run (spec 04 §6, §7.4).
//
// `UnknownGeneratorPlaceholder` (spec 04 calls it `PlaceholderGenerator`): Lua or JS under an
// unknown template id, an unknown `type`, an unknown native `shape`. It draws the placeholder at the
// object's box and keeps the template body exactly as read: the serializer writes that body back
// (`preserved()`), so moves rewrite only the object's params and nothing is lost (DR-GEN-12; C++
// built no generator and dropped the block on write). It never counts as JS-form, so it never
// converts or stamps a board.
//
// `StoredNativeGenerator`: a known native generator (`bpmn.*`, `table-v1`) that a registry built
// without that factory (`GeneratorRegistryOptions.natives`) cannot run; the shipped registry has all
// seven (`native/`). Native output is serialized, so it draws the stored members as read and writes
// its block back unchanged, as an `onParamChange` generator.
import type {
  DataStore,
  GeneratorBehavior,
  GeneratorContext,
  JsonObject,
  PreservedTemplate,
  ShapeTemplate,
  UnknownGeneratorReason,
} from '../template';
import { ShapeGenerator, cloneJson, deepFreeze } from '../template';
import { embedRefsOf } from './wireframe-generator';
import { outputToTemplateJson, placeholderOutput, type TemplateDataApplier } from './wireframe-output';

export class UnknownGeneratorPlaceholder extends ShapeGenerator {
  readonly behavior: GeneratorBehavior = 'generateAlways';
  readonly reason: UnknownGeneratorReason;
  private readonly generator_: JsonObject;
  private readonly preserved_: PreservedTemplate;
  private readonly apply_: TemplateDataApplier;

  /** `generator` is the stored block, `template` the whole body it was read from. */
  constructor(generator: JsonObject, template: JsonObject, reason: UnknownGeneratorReason, apply: TemplateDataApplier) {
    super();
    this.reason = reason;
    this.generator_ = deepFreeze(cloneJson(generator));
    this.preserved_ = Object.freeze({ reason, template: deepFreeze(cloneJson(template)) });
    this.apply_ = apply;
  }

  /** Text editing is off for a placeholder. */
  interpretText(): boolean {
    return false;
  }

  interpretedText(): string {
    const t = this.generator_['text'];
    return typeof t === 'string' ? t : '';
  }

  /** The stored `embedrefs`, so copying the object keeps the definitions it named. */
  embedReferences(): readonly string[] {
    return embedRefsOf(this.generator_);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    this.apply_(t, outputToTemplateJson(placeholderOutput()));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  setDimension(_ds: DataStore): void {
    /* no minimum size */
  }

  clone(): UnknownGeneratorPlaceholder {
    return new UnknownGeneratorPlaceholder(this.generator_, this.preserved_.template, this.reason, this.apply_);
  }

  toJSON(): JsonObject {
    return this.generator_;
  }

  override preserved(): PreservedTemplate {
    return this.preserved_;
  }
}

export class StoredNativeGenerator extends ShapeGenerator {
  readonly behavior: GeneratorBehavior = 'onParamChange';
  private json_: JsonObject;

  constructor(json: JsonObject) {
    super();
    this.json_ = deepFreeze(cloneJson(json));
  }

  interpretText(): boolean {
    return this.json_['interprettext'] === true;
  }

  interpretedText(): string {
    const t = this.json_['text'];
    return typeof t === 'string' ? t : '';
  }

  override setInterpretedText(text: string): void {
    this.json_ = deepFreeze({ ...cloneJson(this.json_), text });
  }

  embedReferences(): readonly string[] {
    return embedRefsOf(this.json_);
  }

  generate(): void {
    /* the stored members are drawn as read */
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  setDimension(_ds: DataStore): void {
    /* no minimum size */
  }

  clone(): StoredNativeGenerator {
    return new StoredNativeGenerator(this.json_);
  }

  toJSON(): JsonObject {
    return this.json_;
  }
}
