// AC-UI-41 (lekhjs half; spec 05 §4.4, §7.4): the three C++ icons the overlay draws on the canvas
// are exactly the glyphs of `glyphs.ts`, exempt from the board's react-icons `iconMap`, and their
// path data is the C++ templates' (`lekhcore/res/icons/svg_icons.json`, `icons.json`), copied once.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANVAS_GLYPHS } from '../../src/interaction/glyphs';

const ICONS = path.resolve(__dirname, '../../../lekhcore/res/icons');

interface Template {
  id: string;
  data: string[];
  draw: { path: string }[];
}

function template(id: string): Template {
  for (const file of ['svg_icons.json', 'icons.json']) {
    const json = JSON.parse(readFileSync(path.join(ICONS, file), 'utf8')) as { templates: Template[] };
    const t = json.templates.find((x) => x.id === id);
    if (t) return t;
  }
  throw new Error(`no C++ template ${id}`);
}

/** A template's expressions (`0.5*w`, `-h/2`, `1.2e-05*h`) at w = h = 1. */
function factor(e: string): number {
  const half = /^(-?)[wh]\/2$/.exec(e);
  if (half) return half[1] ? -0.5 : 0.5;
  const scaled = /^(-?[0-9.]+(?:e[-+]?[0-9]+)?)\*[wh]$/.exec(e);
  if (scaled) return Number(scaled[1]);
  throw new Error(`unexpected template expression ${e}`);
}

describe('canvas glyphs (AC-UI-41)', () => {
  it('are exactly sel_rect_rotate, erase_dragger and zoom_info', () => {
    expect(Object.keys(CANVAS_GLYPHS).sort()).toEqual([
      'lekhapp.ui.erase_dragger',
      'lekhapp.ui.sel_rect_rotate',
      'lekhapp.ui.zoom_info',
    ]);
  });

  it.each(Object.keys(CANVAS_GLYPHS))('%s has the C++ template path data', (id) => {
    const t = template(id);
    const glyph = CANVAS_GLYPHS[id as keyof typeof CANVAS_GLYPHS];
    expect(glyph.paths).toHaveLength(t.draw.length);
    glyph.paths.forEach((p, i) => {
      const tok = t.draw[i].path.trim().split(/\s+/);
      const expected: (string | number)[] = [];
      for (let k = 0; k < tok.length;) {
        const op = tok[k++];
        const n = op === 'C' ? 3 : 1;
        expected.push(op);
        for (let j = 0; j < n; j++, k += 2)
          expected.push(factor(t.data[Number(tok[k])]), factor(t.data[Number(tok[k + 1])]));
      }
      const actual = p.d.flat();
      expect(actual).toHaveLength(expected.length);
      actual.forEach((v, j) => {
        if (typeof v === 'string') expect(v).toBe(expected[j]);
        else expect(v).toBeCloseTo(expected[j] as number, 4);
      });
    });
  });
});
