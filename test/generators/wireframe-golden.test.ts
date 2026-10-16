// Golden outputs of the wireframe modules (spec 04 §13): every ported module, for each of its
// template ids, run with the stub host on its default parameters with the default text, the empty
// text and the selection markup text. The files under `golden/wireframe/` are the reviewed output;
// a port change that alters any of them shows as a diff. They are written with
// `vitest run -u test/generators/wireframe-golden.test.ts` (new files are written on a first run
// outside CI).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIREFRAME_MODULES, WIREFRAME_TEMPLATES, outputToTemplateJson } from '../../src/generators';
import { casesFor, TEXTS, wireframeTemplates } from './oracle/cases';
import { STUB_HOST } from './oracle/stub-host';

const bodies = wireframeTemplates();
const GOLDEN = path.join(import.meta.dirname, 'golden');

describe('wireframe golden outputs', () => {
  for (const m of WIREFRAME_MODULES) {
    it(`${m.key} matches golden/${m.key}.json`, async () => {
      const out: Record<string, unknown> = {};
      for (const row of WIREFRAME_TEMPLATES.filter((r) => r.key === m.key)) {
        const body = bodies.get(row.id);
        if (body === undefined) throw new Error(`no template ${row.id}`);
        const defaults = casesFor(row.id, body)[0];
        if (defaults === undefined) throw new Error(`no cases for ${row.id}`);
        const texts = [defaults.text, '', TEXTS[4] ?? ''];
        out[row.id] = texts.map((text) => {
          const r = m.generate({ params: defaults.params, text }, STUB_HOST);
          return {
            params: defaults.params,
            text,
            output: {
              ...outputToTemplateJson(r),
              minW: r.minW,
              minH: r.minH,
              ...(r.disabled !== undefined ? { disabled: r.disabled } : {}),
            },
          };
        });
      }
      await expect(`${JSON.stringify(out, null, 1)}\n`).toMatchFileSnapshot(path.join(GOLDEN, `${m.key}.json`));
    });
  }
});
