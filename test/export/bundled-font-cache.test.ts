// The bundled TTFs offline (W10 FX-B): the web serves them no-cache and builds a new
// BundledFontSource per export, so the bytes of an online export are kept in the host's store and
// a later export whose fetch fails (offline) gets them from there. The network stays first.
import { describe, expect, it } from 'vitest';
import { BundledFontSource, type BundledFontCache } from '../../src/export/pdf';
import type { ExportSignalLike, FontRequest } from '../../src/export/types';
import { bundledRegistry } from './pdf-helpers';

const SIGNAL: ExportSignalLike = { aborted: false, addEventListener: () => undefined };
const REQ: FontRequest = { text: 'Hello', family: 'Noto Sans', bold: false, italic: false };

function memoryCache(): BundledFontCache & { store: Map<string, Uint8Array>; puts: number } {
  const store = new Map<string, Uint8Array>();
  const c = {
    store,
    puts: 0,
    match: (url: string) => Promise.resolve(store.get(url) ?? null),
    put: (url: string, b: Uint8Array) => {
      c.puts++;
      store.set(url, b);
      return Promise.resolve();
    },
  };
  return c;
}

describe('BundledFontSource with a cache', () => {
  it('an export after one online export works offline (a new source, the fetch failing)', async () => {
    const cache = memoryCache();
    const font = new Uint8Array([1, 2, 3, 4]);
    const online = new BundledFontSource({ registry: bundledRegistry(), load: () => Promise.resolve(font), cache });
    const a = await online.resolve(REQ, SIGNAL);
    expect(a?.bytes).toEqual(font);
    expect(cache.puts).toBe(1);

    const offline = new BundledFontSource({
      registry: bundledRegistry(),
      load: () => Promise.reject(new TypeError('Failed to fetch')),
      cache,
    });
    const b = await offline.resolve(REQ, SIGNAL);
    expect(b?.bytes).toEqual(font);
    expect(b?.source).toBe('bundled');
    // A load that answers null (a non-2xx) also falls back.
    const nulls = new BundledFontSource({ registry: bundledRegistry(), load: () => Promise.resolve(null), cache });
    expect((await nulls.resolve(REQ, SIGNAL))?.bytes).toEqual(font);
  });

  it('the network wins when it answers (a redeployed font at the same URL replaces the stored one)', async () => {
    const cache = memoryCache();
    const old = new Uint8Array([9]);
    const fresh = new Uint8Array([7, 7]);
    await new BundledFontSource({ registry: bundledRegistry(), load: () => Promise.resolve(old), cache }).resolve(
      REQ,
      SIGNAL,
    );
    const r = await new BundledFontSource({
      registry: bundledRegistry(),
      load: () => Promise.resolve(fresh),
      cache,
    }).resolve(REQ, SIGNAL);
    expect(r?.bytes).toEqual(fresh);
    expect([...cache.store.values()]).toEqual([fresh]);
  });

  it('offline with an empty store is null, and a failing store is ignored', async () => {
    const empty = new BundledFontSource({
      registry: bundledRegistry(),
      load: () => Promise.reject(new Error('offline')),
      cache: memoryCache(),
    });
    expect(await empty.resolve(REQ, SIGNAL)).toBeNull();
    const broken: BundledFontCache = {
      match: () => Promise.reject(new Error('quota')),
      put: () => Promise.reject(new Error('quota')),
    };
    const font = new Uint8Array([5]);
    const ok = new BundledFontSource({ registry: bundledRegistry(), load: () => Promise.resolve(font), cache: broken });
    expect((await ok.resolve(REQ, SIGNAL))?.bytes).toEqual(font);
    const off = new BundledFontSource({
      registry: bundledRegistry(),
      load: () => Promise.reject(new Error('offline')),
      cache: broken,
    });
    expect(await off.resolve(REQ, SIGNAL)).toBeNull();
  });

  it('without a cache a failed load is null (Node and native hosts, as before)', async () => {
    const s = new BundledFontSource({ registry: bundledRegistry(), load: () => Promise.reject(new Error('x')) });
    expect(await s.resolve(REQ, SIGNAL)).toBeNull();
  });
});
