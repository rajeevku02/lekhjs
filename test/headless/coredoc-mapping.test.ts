// AC-ARC-09: every row of spec 10 §3's `CoreDoc` mapping that names a lekhjs symbol resolves to an
// export of `lekhjs/headless` or to a member of an exported class. The `expectTypeOf` assertions
// are checked by `tsc -p tsconfig.test.json` (`npm run typecheck`); the `it` blocks check that the
// same names exist at run time. Rows naming Node APIs (`process.memoryUsage()`,
// `v8.getHeapStatistics()`) or saying "deleted" are excluded.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Rect } from '../../src/geometry';
import * as headless from '../../src/headless';
import {
  BoardSession,
  TemplateCatalog,
  compile,
  createNodeRuntime,
  generate,
  lint,
  paintPage,
  project,
  type Canvas2DDrawingPlatform,
  type PaintPageAnswer,
  type Runtime,
} from '../../src/headless';
import type { JsonObject } from '../../src/template';

describe('AC-ARC-09: the CoreDoc mapping resolves to lekhjs/headless', () => {
  it('names every mapped function and class', () => {
    for (const name of [
      'createNodeRuntime',
      'BoardSession',
      'TemplateCatalog',
      'project',
      'compile',
      'generate',
      'lint',
      'paintPage',
      'Canvas2DDrawingPlatform',
    ]) {
      expect(typeof Reflect.get(headless, name), name).toBe('function');
    }
    for (const m of ['load', 'serialize', 'layoutAll', 'visualBounds', 'addTemplates', 'dispose'])
      expect(typeof Reflect.get(BoardSession.prototype, m), m).toBe('function');
    for (const g of ['isLoaded', 'document'])
      expect(typeof Reflect.get(Object.getOwnPropertyDescriptor(BoardSession.prototype, g) ?? {}, 'get'), g).toBe(
        'function',
      );
    expect(typeof Reflect.get(BoardSession, 'empty')).toBe('function');
    expect(typeof Reflect.get(TemplateCatalog, 'withLibrary')).toBe('function');
  });

  it('has the member types the mapping relies on', () => {
    // `new Module.CoreDoc()` → `new BoardSession(runtime, { catalog, images, budget })`
    expectTypeOf(BoardSession).constructorParameters.toEqualTypeOf<ConstructorParameters<typeof BoardSession>>();
    expectTypeOf<ConstructorParameters<typeof BoardSession>[0]>().toEqualTypeOf<Runtime>();
    // `doc.load(raw)` + `doc.message()` → `s.load(raw): LoadResult`
    expectTypeOf<BoardSession['load']>().parameter(0).toEqualTypeOf<string | object>();
    // (`details`: the reader's content-free details, for a load failure report; round BR1.)
    expectTypeOf<ReturnType<BoardSession['load']>>().toEqualTypeOf<
      | { readonly ok: true }
      | {
          readonly ok: false;
          readonly code: string;
          readonly message: string;
          readonly details?: Readonly<Record<string, string | number | boolean>>;
        }
    >();
    // `doc.serialize()` → `s.serialize({ stamp: 'cloud' })`
    expectTypeOf<BoardSession['serialize']>().parameter(0).toEqualTypeOf<{ stamp: 'offline' | 'cloud' }>();
    expectTypeOf<ReturnType<BoardSession['serialize']>>().toEqualTypeOf<string>();
    // settle → `s.layoutAll(pageId?)`
    expectTypeOf<BoardSession['layoutAll']>().toEqualTypeOf<(pageId?: string) => void>();
    // `doc.visualBounds(pageId, nodeId)` → `s.visualBounds(pageId, nodeId): Rect | null`
    expectTypeOf<ReturnType<BoardSession['visualBounds']>>().toEqualTypeOf<Rect | null>();
    // `doc.isLoaded()` → `s.isLoaded`; `pageCount()` → `s.document.pages.length`; `name()` → `s.document.name`
    expectTypeOf<BoardSession['isLoaded']>().toEqualTypeOf<boolean>();
    expectTypeOf<BoardSession['document']['pages']['length']>().toEqualTypeOf<number>();
    expectTypeOf<BoardSession['document']['name']>().toEqualTypeOf<string>();
    // `doc.reset(); doc.delete()` → `s.dispose()`
    expectTypeOf<BoardSession['dispose']>().toEqualTypeOf<() => void>();
    // `Module.emptyDocument()` → `BoardSession.empty(runtime, opts)`
    expectTypeOf<ReturnType<typeof BoardSession.empty>>().toEqualTypeOf<BoardSession>();
    // `Module.initObjects(json)` → `TemplateCatalog.withLibrary(base, libraryJson)`
    expectTypeOf<ReturnType<typeof TemplateCatalog.withLibrary>>().toEqualTypeOf<TemplateCatalog>();
    // `doc.project/compile/lint(json)` and `doc.generate(json)`: object in, object out
    expectTypeOf(project).returns.toEqualTypeOf<JsonObject | null>();
    expectTypeOf(compile).returns.toEqualTypeOf<JsonObject | null>();
    expectTypeOf(generate).returns.toEqualTypeOf<JsonObject>();
    expectTypeOf(lint).returns.toEqualTypeOf<JsonObject>();
    // `doc.render(json, drawingPlatform)` → `paintPage(s, { page, … }, new Canvas2DDrawingPlatform(ctx))`
    expectTypeOf(paintPage).returns.toEqualTypeOf<PaintPageAnswer>();
    expectTypeOf<Canvas2DDrawingPlatform>().toExtend<NonNullable<Parameters<typeof paintPage>[2]>>();
    // `Module.setPlatform(...)` → `createNodeRuntime(...)` once per worker
    expectTypeOf(createNodeRuntime).returns.toEqualTypeOf<Runtime>();
    // A BoardSession is what every semantic function and paintPage take first.
    expectTypeOf<BoardSession>().toExtend<Parameters<typeof project>[0]>();
    expectTypeOf<BoardSession>().toExtend<Parameters<typeof compile>[0]>();
    expectTypeOf<BoardSession>().toExtend<Parameters<typeof generate>[0]>();
    expectTypeOf<BoardSession>().toExtend<Parameters<typeof lint>[0]>();
    expectTypeOf<BoardSession>().toExtend<Parameters<typeof paintPage>[0]>();
  });
});
