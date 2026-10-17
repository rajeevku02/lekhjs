// AC-TXT-17 (spec 06 §9, DR-TXT-06): every creation point stores `fontfamily: "Noto Sans"` on the
// new object's own style; loaded, pasted and duplicated objects keep their stored value; the
// document root style is unchanged. The semantic layer (MCP `board_create_content` /
// `board_edit`, AC-TXT-18's engine half) does the same unless `font_family` is given.
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { GroupObject, stampNewContentFont, type LekhObject } from '../../src/model';
import { compile } from '../../src/semantic';
import { DEFAULT_FONT_FAMILY } from '../../src/text';
import type { JsonObject } from '../../src/template';
import { A, B, viewHarness, type ViewHarness } from '../interaction/helpers';
import { applierRig, rectDTO } from '../recognizer/client/applierRig';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ownFamily = (o: LekhObject): string | null => {
  const dp = o.getDrawingProfile();
  return dp.isFontFamilyDefined() ? dp.effectiveFontFamily() : null;
};

/** Runs `fn` and returns the objects it added to the active page. */
function added(h: ViewHarness, fn: () => void): LekhObject[] {
  const store = () => h.session.editor.doc.activePage().objectStore;
  const before = new Set(store().objects.map((o) => o.id));
  fn();
  return store().objects.filter((o) => !before.has(o.id));
}

function rootFamily(h: ViewHarness): string {
  return h.session.editor.doc.style.effectiveFontFamily();
}

describe('new content gets Noto Sans (AC-TXT-17)', () => {
  const creations: [string, (h: ViewHarness) => void][] = [
    ['the text tool', (h) => h.bv.canvas.editTextAt(new Point(700, 500), false)],
    [
      'context menu Add Note',
      (h) => {
        h.bv.commands.runContextAction('add_note');
      },
    ],
    [
      'context menu Add Text',
      (h) => {
        h.bv.commands.runContextAction('add_text');
      },
    ],
    [
      'context menu Add Rectangle',
      (h) => {
        h.bv.commands.runContextAction('add_rect');
      },
    ],
    [
      'context menu Add Circle',
      (h) => {
        h.bv.commands.runContextAction('add_circle');
      },
    ],
    ['a library insert', (h) => h.bv.library.addShape('avabodh.basic.rectangle', new Point(600, 400))],
    [
      'an inserted image',
      (h) =>
        h.bv.insertImage({ kind: 'data', base64: PNG_1PX, format: 'PNG', width: 40, height: 20 }, new Point(90, 90)),
    ],
    [
      'plain ink',
      (h) => {
        h.bv.recognition.addInk([new Point(10, 10), new Point(40, 12), new Point(80, 30)]);
      },
    ],
  ];

  for (const [name, create] of creations) {
    it(`${name}: the new object's own style is "Noto Sans"; the root style is unchanged`, () => {
      const h = viewHarness();
      const root = rootFamily(h);
      const objs = added(h, () => {
        create(h);
      });
      expect(objs.length).toBeGreaterThan(0);
      for (const o of objs) expect(ownFamily(o)).toBe(DEFAULT_FONT_FAMILY);
      expect(rootFamily(h)).toBe(root);
    });
  }

  it('recognition output (MutationApplier add) carries "Noto Sans"', () => {
    const r = applierRig();
    r.run((ctx) => r.applier.apply(ctx, [{ op: 'add', shapes: [rectDTO(0, 0, 50, 50)] }], r.job()));
    const page = r.h.session.editor.doc.activePage();
    expect(page.objectStore.objects).toHaveLength(1);
    for (const o of page.objectStore.objects) expect(ownFamily(o)).toBe(DEFAULT_FONT_FAMILY);
  });

  it('a family the canvas style sets is kept (the user chose it)', () => {
    const h = viewHarness();
    h.session.currentStyle.setFontFamily('Caveat');
    const objs = added(h, () => {
      h.bv.canvas.editTextAt(new Point(700, 500), false);
    });
    expect(objs.map(ownFamily)).toEqual(['Caveat']);
  });

  it('a template whose style sets its own family keeps it; a group is never stamped', () => {
    const h = viewHarness();
    const a = h.obj(A);
    a.getDrawingProfile().setFontFamily('Noto Serif');
    expect(stampNewContentFont(a)).toBe(0);
    expect(ownFamily(a)).toBe('Noto Serif');
    const g = new GroupObject(h.session.codec.env.objects, [h.tobj(B)]);
    expect(stampNewContentFont(g)).toBe(0);
    expect(ownFamily(h.obj(B))).toBeNull();
  });
});

describe('objects not created keep their stored family (AC-TXT-17)', () => {
  it('loaded objects keep "" (no family on their own style)', () => {
    const h = viewHarness();
    expect(ownFamily(h.obj(A))).toBeNull();
    expect(ownFamily(h.obj(B))).toBeNull();
  });

  it('duplicate and copy/paste keep the source value, "" included', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const dup = added(h, () => {
      h.bv.commands.run('duplicate');
    });
    expect(dup.length).toBeGreaterThan(0);
    for (const o of dup) expect(ownFamily(o)).toBeNull();

    h.bv.overlay.select(h.obj(B));
    h.bv.commands.run('copy');
    const pasted = added(h, () => {
      h.bv.commands.run('paste');
    });
    expect(pasted.length).toBeGreaterThan(0);
    for (const o of pasted) expect(ownFamily(o)).toBeNull();
  });
});

describe('the semantic layer (MCP add_node / add_edge)', () => {
  const objectsOf = (answer: JsonObject): JsonObject[] => {
    const out: JsonObject[] = [];
    for (const f of (answer['frames'] ?? []) as { changes?: Record<string, unknown> }[]) {
      for (const [k, v] of Object.entries(f.changes ?? {})) {
        if (/\.objects\.[^.]+$/.test(k) && v !== null && typeof v === 'object') out.push(v as JsonObject);
      }
    }
    return out;
  };

  it('a new node and a new edge store "Noto Sans" unless font_family is given', () => {
    const h = viewHarness();
    const page = h.session.editor.doc.activePage().id;
    const answer = compile(h.session, {
      version: 4,
      page,
      ops: [
        { op: 'add_node', ref: 'n1', shape: 'avabodh.basic.rectangle', text: 'one', cx: 900, cy: 900 },
        {
          op: 'add_node',
          ref: 'n2',
          shape: 'avabodh.basic.rectangle',
          text: 'two',
          cx: 1100,
          cy: 900,
          style: { font_family: 'Caveat' },
        },
        { op: 'add_edge', from: 'n1', to: 'n2', texts: [{ text: 'go', position: 0.5 }] },
      ],
    }) as JsonObject;
    expect(answer['ok'], JSON.stringify(answer).slice(0, 300)).not.toBe(false);
    const objs = objectsOf(answer);
    expect(objs).toHaveLength(3);
    const text = objs.map((o) => JSON.stringify(o));
    expect(text.filter((t) => t.includes('"fontfamily":"Noto Sans"'))).toHaveLength(2);
    expect(text.filter((t) => t.includes('"fontfamily":"Caveat"'))).toHaveLength(1);
  });
});
