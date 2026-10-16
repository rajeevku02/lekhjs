// Regenerates test/fixtures/golden/io/<name>.json, the C++ oracle side of AC-ENG-22: each legacy
// XML fixture in test/fixtures/io/ loaded and serialized by the C++ core (the vendored backend wasm
// of lbs/kashi, the Node oracle of verification 01). The TS suite compares its own load of the
// same XML against these, object by object.
//
// The fixtures are synthetic (hand-written in the C++ XML writer's grammar); no board content.
// The backend core's catalogue has no `avabodh.basic.text` / `.image` body, so the builtin bodies
// the apps compile in (lekhjs/stencils/builtin, copied from lekhcore's ResourcesGen) are seeded
// into its template store first, as the apps have them.
//
//   node parity/tools/io-golden/regen.mjs [--kashi <lbs/kashi>]
// Hold the heavy-job lock when running it.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const args = process.argv.slice(2);
const kIdx = args.indexOf('--kashi');
const KASHI = path.resolve(kIdx >= 0 ? (args[kIdx + 1] ?? '') : path.join(PKG, '..', 'lbs', 'kashi'));
const IN = path.join(PKG, 'test', 'fixtures', 'io');
const OUT = path.join(PKG, 'test', 'fixtures', 'golden', 'io');
const SEEDED = ['avabodh.basic.text', 'avabodh.basic.image', 'avabodh.basic.ellipse'];

const require = createRequire(path.join(KASHI, 'package.json'));
// kashi's config module exits without these; the core tier's jest shim sets placeholders.
require(path.join(KASHI, 'test', 'setup', 'env.js'));
const host = require(path.join(KASHI, 'service', 'mcp', 'core', 'host'));
const ops = require(path.join(KASHI, 'service', 'mcp', 'core', 'ops'));
const stencils = require(path.join(KASHI, 'service', 'mcp', 'stencils'));

/** The builtin bodies of the three templates the XML converter takes from the store. */
function seedBodies() {
  const dir = path.join(PKG, 'stencils', 'builtin');
  const bodies = [];
  for (const f of ['templates.json', 'basic.json']) {
    const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    for (const t of j.templates ?? []) if (SEEDED.includes(t.id)) bodies.push(t);
    for (const c of j.library ?? []) {
      for (const o of c.objects ?? [])
        if (o && typeof o === 'object' && SEEDED.includes(o.template?.id)) bodies.push(o.template);
    }
  }
  return bodies;
}

/**
 * One oracle operation: seed the store, load `text`, serialize.
 * @param {string} text
 * @returns {(h: { Module: unknown, doc: { load(t: string): boolean, serialize(): string } }) => Promise<string | null>}
 */
const loadAndSerialize =
  (text) =>
  async ({ Module, doc }) => {
    ops.seed(Module, ['avabodh.basic.ellipse']);
    stencils.seedTemplateStore(Module, { bodies: seedBodies() });
    return doc.load(text) ? doc.serialize() : null;
  };

stencils.init({ dir: path.join(KASHI, 'vendor', 'stencils') });
await host.init();
mkdirSync(OUT, { recursive: true });
// `ts-only-*` fixtures exercise what the C++ core cannot load (a curve connector: `ObjectConverter::convert`
// returns a pointer its own `Ptr` has already freed), so they have no golden.
const files = readdirSync(IN)
  .filter((f) => f.endsWith('.xml') && !f.startsWith('ts-only-'))
  .sort();
for (const f of files) {
  const text = readFileSync(path.join(IN, f), 'utf8');
  const out = await host.enter(loadAndSerialize(text));
  if (out === null) throw new Error(`${f}: the C++ core did not load it`);
  const target = path.join(OUT, f.replace(/\.xml$/, '.json'));
  writeFileSync(target, `${JSON.stringify(JSON.parse(out), null, 2)}\n`);
  console.log(`wrote ${path.relative(PKG, target)}`);
}
process.exit(0);
