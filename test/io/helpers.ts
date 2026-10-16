// Shared helpers for the io suites: an `IoEnv` over the bundled catalog (lekhjs/stencils/builtin and
// core, built once per test file), the template test environment (text 10 per character, 12 high),
// a fixed clock and sequential ids; plus walkers that list every live object of a document.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { EngineConfig, shortIdFromUuid, type Config, type Logger } from '../../src/base';
import { DocumentCodec, type GeneratorHooks, type IoEnv } from '../../src/io';
import {
  ConnectionObject,
  GroupObject,
  MultiObjects,
  type LekhDocument,
  type LekhObject,
  type ObjectEnv,
} from '../../src/model';
import {
  CatalogOverlay,
  CatalogTemplateResolver,
  TemplateCatalog,
  type JsonValue,
  type LibraryFileJson,
  type TemplateEnv,
} from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { fixedClock, seqIds } from '../model/helpers';
import { testEnv } from '../template/helpers';

export const STENCILS = path.join(PKG_ROOT, 'stencils');
/**
 * The sibling worktrees' C++-written fixtures, read in place and never copied. Their locations are
 * in parity/fixture-sets.json: test/ names no C++ or backend repository path (AC-ARC-12).
 */
const FIXTURE_SETS = JSON.parse(readFileSync(path.join(PKG_ROOT, 'parity', 'fixture-sets.json'), 'utf8')) as {
  core: string;
  backend: string;
};
export const CORE_FIXTURES = path.resolve(PKG_ROOT, FIXTURE_SETS.core);
export const BACKEND_FIXTURES = path.resolve(PKG_ROOT, FIXTURE_SETS.backend);
export const IO_FIXTURES = path.join(PKG_ROOT, 'test', 'fixtures', 'io');

function readDir(dir: string): LibraryFileJson[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'libnames.json')
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as LibraryFileJson);
}

let catalog_: TemplateCatalog | null = null;

/** The bundled catalog: builtin sets, then the eight core stencil files. */
export function bundledCatalog(): TemplateCatalog {
  catalog_ ??= TemplateCatalog.build([
    ...readDir(path.join(STENCILS, 'builtin')),
    ...readDir(path.join(STENCILS, 'core')),
  ]);
  return catalog_;
}

export interface TestIo {
  readonly env: IoEnv;
  readonly codec: DocumentCodec;
  readonly overlay: CatalogOverlay;
  readonly logs: { level: string; m: string; f?: object }[];
}

export interface TestIoOptions {
  readonly config?: Config;
  readonly generators?: GeneratorHooks;
  readonly catalog?: TemplateCatalog;
}

/** A fresh session-like io environment (its own overlay, ids and log). */
export function testIo(opts: TestIoOptions = {}): TestIo {
  const config = opts.config ?? new EngineConfig({ debug: { verifyIndex: true } });
  const base = testEnv();
  const logs: TestIo['logs'] = [];
  const logger: Logger = {
    debug: (m, f) => logs.push({ level: 'debug', m, ...(f !== undefined ? { f } : {}) }),
    info: (m, f) => logs.push({ level: 'info', m, ...(f !== undefined ? { f } : {}) }),
    warn: (m, f) => logs.push({ level: 'warn', m, ...(f !== undefined ? { f } : {}) }),
    error: (m, f) => logs.push({ level: 'error', m, ...(f !== undefined ? { f } : {}) }),
  };
  const holder: { codec: DocumentCodec | null } = { codec: null };
  const codec = () => {
    if (holder.codec === null) throw new Error('codec not ready');
    return holder.codec;
  };
  const overlay = new CatalogOverlay(opts.catalog ?? bundledCatalog(), {
    instantiate: (def) => codec().templates.instantiate(def),
  });
  const resolver = new CatalogTemplateResolver(overlay, (def) => codec().embedFactory()(def));
  const templates: TemplateEnv = { ...base, config, resolver };
  const ids = seqIds();
  const objects: ObjectEnv = {
    config,
    text: base.text,
    arrowhead: (id) => {
      const def = overlay.arrowhead(id);
      return def === undefined ? null : codec().templates.instantiate(def);
    },
    newId: () => shortIdFromUuid(ids.next()),
  };
  const docHelp = new Map<string, string>();
  const env: IoEnv = {
    objects,
    templates,
    document: { config, clock: fixedClock(), ids },
    help: (id) => overlay.help(id) ?? docHelp.get(id),
    onHelp: (id, text) => {
      if (overlay.help(id) === undefined && !docHelp.has(id)) docHelp.set(id, text);
    },
    logger,
    ...(opts.generators !== undefined ? { generators: opts.generators } : {}),
  };
  holder.codec = new DocumentCodec(env);
  return { env, codec: holder.codec, overlay, logs };
}

/** Every object of `doc`, depth first (group members and multi children included). */
export function allObjects(doc: LekhDocument): LekhObject[] {
  const out: LekhObject[] = [];
  const visit = (o: LekhObject) => {
    out.push(o);
    if (o instanceof GroupObject) for (const m of o.objects()) visit(m.object);
    if (o instanceof MultiObjects) for (const m of o.objects()) visit(m.object);
  };
  for (const p of doc.pages) for (const o of p.objectStore.objects) visit(o);
  return out;
}

/** The live object classes (C++ `getName`) a document may hold; no legacy type is among them. */
export const LIVE_NAMES = Object.freeze(['Templated', 'Group', 'Unrecognized', 'Connection', 'MultiObjects']);

/** Every `type` member anywhere in `json`. */
export function typesIn(json: JsonValue): string[] {
  const out: string[] = [];
  const visit = (v: JsonValue | undefined) => {
    if (Array.isArray(v)) for (const x of v as readonly JsonValue[]) visit(x);
    else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, JsonValue>;
      if (typeof o['type'] === 'string') out.push(o['type']);
      for (const k of Object.keys(o)) visit(o[k]);
    }
  };
  visit(json);
  return out;
}

export function connectors(doc: LekhDocument): ConnectionObject[] {
  return allObjects(doc).filter((o): o is ConnectionObject => o instanceof ConnectionObject);
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

/** `.lekh` files under `dir`, recursively, as paths relative to it (sorted). */
export function lekhFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith('.lekh')) out.push(r);
    }
  };
  walk('');
  return out.sort();
}
