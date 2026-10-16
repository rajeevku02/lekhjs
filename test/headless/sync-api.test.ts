// AC-ARC-08: no function exported from `lekhjs/headless` and no `BoardSession` method is `async`
// or returns a thenable, over the fixture set. (`project`, `compile`, `generate`, `lint` and
// `paintPage` join the exports, and this walk, with task B1.)
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Canvas2DLike } from '../../src/base';
import * as headless from '../../src/headless';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler, fakeImage } from '../../src/testing';
import { CORE_FIXTURES, lekhFiles } from '../io/helpers';
import { testRuntime } from '../session/helpers';

type Fn = (...args: unknown[]) => unknown;

function isAsync(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as Fn).constructor.name === 'AsyncFunction';
}

function isThenable(v: unknown): boolean {
  return (
    v !== null &&
    (typeof v === 'object' || typeof v === 'function') &&
    typeof (v as { then?: unknown }).then === 'function'
  );
}

/** Every method a class (and its bases) declares, statics included. */
function methodsOf(cls: Fn): { name: string; fn: unknown }[] {
  const out: { name: string; fn: unknown }[] = [];
  for (let proto: object | null = cls.prototype as object; proto !== null && proto !== Object.prototype;) {
    for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (name === 'constructor') continue;
      for (const f of [Reflect.get(d, 'value'), Reflect.get(d, 'get'), Reflect.get(d, 'set')] as unknown[])
        if (typeof f === 'function') out.push({ name, fn: f });
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(cls)))
    if (typeof d.value === 'function') out.push({ name: `static ${name}`, fn: d.value });
  return out;
}

describe('AC-ARC-08: the headless API is synchronous', () => {
  it('no export of lekhjs/headless and no BoardSession method is an async function', () => {
    const offenders: string[] = [];
    for (const [name, v] of Object.entries(headless)) {
      if (isAsync(v)) offenders.push(name);
      if (typeof v === 'function')
        for (const m of methodsOf(v as Fn)) if (isAsync(m.fn)) offenders.push(`${name}.${m.name}`);
    }
    expect(methodsOf(BoardSession as unknown as Fn).length).toBeGreaterThan(15);
    expect(offenders).toEqual([]);
  });

  it('no call returns a thenable, over the fixture set', () => {
    const runtime = testRuntime();
    const files = lekhFiles(CORE_FIXTURES);
    expect(files.length).toBeGreaterThan(10);
    const results: unknown[] = [];
    const rec = (v: unknown) => {
      results.push(v);
      return v;
    };
    /** Calls `o[name](...args)` and records the result (void results included). */
    const call = (o: object, name: string, ...args: unknown[]): unknown =>
      rec(Reflect.apply(Reflect.get(o, name) as Fn, o, args));
    for (const f of files) {
      const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
      rec(s.load(readFileSync(path.join(CORE_FIXTURES, f), 'utf8'), { kind: 'offline' }));
      call(s, 'layoutAll');
      for (const p of s.document.pages) for (const o of p.objectStore.objects) rec(s.visualBounds(p.id, o.id));
      rec(s.serialize({ stamp: 'offline' }));
      rec(s.serialize({ stamp: 'cloud' }));
      call(s, 'addTemplates', []);
      rec(s.missingResources());
      rec(s.view);
      call(s, 'dispatch', { type: 'imageLoaded', url: 'u', image: fakeImage() });
      call(s, 'dispatch', { type: 'command', origin: 'ui', command: { kind: 'view', canvasW: 64, canvasH: 64 } });
      const ctx = createCanvas(64, 64).getContext('2d') as unknown as Canvas2DLike;
      for (const layer of ['grid', 'drawing', 'middle'] as const) call(s, 'paint', layer, ctx);
      call(s, 'on', 'documentChanged', () => undefined);
      call(s, 'requestPaint', 'drawing');
      call(s, 'setTimer', 't', 1, () => undefined);
      call(s, 'clearTimer', 't');
      call(s, 'dispose');
    }
    rec(BoardSession.empty(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() }));
    rec(headless.createRuntime({ measurer: runtime.measurer, fonts: runtime.fontLoader, catalog: runtime.catalog }));
    expect(results.filter(isThenable)).toEqual([]);
    expect(results.filter((r) => typeof r === 'object' && r !== null && 'ok' in r && r.ok === false)).toEqual([]);
  });
});
