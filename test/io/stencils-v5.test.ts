// `lekhboard/stencils/v5`, the folder the TS apps read (spec 04 §4, §8; verification 02 §C.5):
// it is v4 with every Lua generator replaced by the canonical JS text of its module, built by
// `lekhboard/tools/build-v5.js`. This suite holds the v5 rows of AC-GEN from the lekhjs side:
// v5 builds with no issue and no Lua (AC-GEN-02), every non-wireframe file and both index files
// are v4's byte for byte (AC-GEN-13), and the lekhboard tool's conversion is exactly the one this
// engine performs on a v4 template (spec 04 §7.2), so a v5 shape and a converted v4 shape are the
// same template.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GeneratorRegistry, LuaToJsConverter, WireframeGenerator } from '../../src/generators';
import { StencilSetLoader } from '../../src/io';
import {
  CatalogOverlay,
  JS_GENERATOR_MARKER,
  TemplateCatalog,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  type LibraryFileJson,
} from '../../src/template';
import { testEnv } from '../template/helpers';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { bundledCatalog, testIo } from './helpers';

const STENCILS = path.join(PKG_ROOT, '..', 'lekhboard', 'stencils');
const V4 = path.join(STENCILS, 'v4');
const V5 = path.join(STENCILS, 'v5');
const conv = new LuaToJsConverter(GeneratorRegistry.builtin());

function readJson(file: string): LibraryFileJson {
  return JSON.parse(readFileSync(file, 'utf8')) as LibraryFileJson;
}

function readValue(file: string): JsonValue {
  return JSON.parse(readFileSync(file, 'utf8')) as JsonValue;
}

function stencilFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort();
}

/** Every template body with a `generator` object, anywhere in a file. */
function generatorBodies(v: JsonValue, out: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(v)) for (const x of v as readonly JsonValue[]) generatorBodies(x, out);
  else if (isJsonObject(v)) {
    if (isJsonObject(v['generator'])) out.push(v);
    for (const x of Object.values(v)) generatorBodies(x, out);
  }
  return out;
}

describe.skipIf(!existsSync(V5))('lekhboard/stencils/v5', () => {
  it('holds exactly v4’s files; all but wireframe.json byte for byte, the index files included (AC-GEN-13)', () => {
    expect(readdirSync(V5).sort()).toEqual(readdirSync(V4).sort());
    const differing = readdirSync(V4).filter(
      (f) => !readFileSync(path.join(V4, f)).equals(readFileSync(path.join(V5, f))),
    );
    expect(differing).toEqual(['wireframe.json']);
  });

  it('carries no Lua: no scriptfile, and every script-form generator is JS under a served id', () => {
    const bodies = stencilFiles(V5).flatMap((f) => generatorBodies(readValue(path.join(V5, f))));
    const scriptForm = bodies.filter((b) => (b['generator'] as JsonObject)['type'] !== 'native');
    expect(scriptForm).toHaveLength(34);
    for (const b of scriptForm) {
      const g = b['generator'] as JsonObject;
      expect(g['scriptfile']).toBeUndefined();
      expect(g['type']).toBeUndefined();
      expect(typeof g['script'] === 'string' && JS_GENERATOR_MARKER.test(g['script'])).toBe(true);
      expect(conv.classify(g, b['id'] as string).kind).toBe('js');
    }
  });

  it('each v5 wireframe template is the engine’s own conversion of its v4 template (spec 04 §7.2)', () => {
    const v4 = generatorBodies(readValue(path.join(V4, 'wireframe.json')));
    const v5 = new Map(generatorBodies(readValue(path.join(V5, 'wireframe.json'))).map((b) => [b['id'], b]));
    expect(v4).toHaveLength(34);
    for (const body of v4) {
      const r = conv.resolve(body);
      expect(r.converted).toBe(true);
      const shipped = v5.get(body['id']);
      expect(shipped).toEqual(r.json);
      // Same member order too: the generator's is the serializer's (script, text, interprettext, embedrefs).
      expect(JSON.stringify(shipped)).toBe(JSON.stringify(r.json));
    }
  });

  it('every v5 template builds into a catalog with no issue, the 34 generators as JS (AC-GEN-02)', () => {
    const c = TemplateCatalog.build(
      stencilFiles(V5).map((f) => readJson(path.join(V5, f))),
      conv.resolve,
    );
    expect(c.issues()).toEqual([]);
    const ids = c.templateIds();
    expect(ids.length).toBeGreaterThan(300);
    const kinds = ids.filter((id) => id.startsWith('avabodh.wireframe.')).map((id) => c.template(id)?.generator?.kind);
    expect(kinds.filter((k) => k === 'js')).toHaveLength(34);
    expect(kinds.filter((k) => k === 'lua' || k === 'unknown')).toHaveLength(0);
    expect(ids.some((id) => c.template(id)?.converted === true)).toBe(false);
  }, 60_000);

  it('every v5 wireframe generator generates without a warning (no placeholder, no failure)', () => {
    const io = testIo();
    const overlay = new CatalogOverlay(bundledCatalog(), { resolve: conv.resolve });
    StencilSetLoader.load(readFileSync(path.join(V5, 'wireframe.json'), 'utf8'), overlay);
    expect(overlay.issues()).toEqual([]);
    const env = testEnv();
    const codec = io.codec.templates.withEnv(env);
    const bodies = generatorBodies(readValue(path.join(V5, 'wireframe.json')));
    for (const body of bodies) {
      const t = codec.parse(body);
      expect(t?.generator).toBeInstanceOf(WireframeGenerator);
      t?.load();
    }
    expect(env.warnings).toEqual([]);
  });
});
