// The wireframe module contract (spec 04 §5.1): one pure, synchronous function per Lua script,
// with no I/O, no timers and no module state. It returns structured data (not a JSON string);
// `generators/WireframeGenerator` applies it to the template. Styles are template style JSON, as a
// stencil file writes them.
import type { JsonObject } from '../json';
import type { GeneratorContext } from './generator-context';

/** A wireframe module key, e.g. `wireframe/button`. */
export type WireframeKey = `wireframe/${string}`;

export interface WireframeInput {
  /** The template's parameter values (C++ `pushParamsTable`). */
  readonly params: Readonly<Record<string, number | string | boolean | null>>;
  /** `generator.text`. */
  readonly text: string;
}

export interface DrawEntry {
  readonly path: string;
  readonly style?: JsonObject;
}

export interface TextEntry {
  readonly text: string;
  readonly location: string;
  readonly style?: JsonObject;
  readonly row?: number;
  readonly col?: number;
  readonly type?: string;
}

export interface ImageEntry {
  readonly location: string;
  readonly src?: string;
  readonly style?: JsonObject;
}

export interface EmbedEntry {
  readonly name?: string;
  readonly param?: string;
  readonly location: string;
  readonly mode?: string;
  /** Read, never written (OQ-13); default true. */
  readonly inheritstyle?: boolean;
  readonly style?: JsonObject;
}

/** What a module returns: the template members it rewrites, and its minimum size. */
export interface WireframeOutput {
  data: string[];
  draw: DrawEntry[];
  texts: TextEntry[];
  images: ImageEntry[];
  embeds: EmbedEntry[];
  containers: string[];
  /** `alignpoints`, when the script sets it (`tabs`, `vtabs`); C++ `clearTemplateData` keeps it otherwise. */
  alignPoints?: string;
  minW: number;
  minH: number;
  /** Applied with `Style.setDisabled`. */
  disabled?: boolean;
}

export interface WireframeModule {
  readonly key: WireframeKey;
  generate(input: WireframeInput, ctx: GeneratorContext): WireframeOutput;
}
