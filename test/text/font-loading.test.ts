// AC-TXT-07 (spec 06 §5.3): with a loader that asks for it (the browser's `DomFontLoader`), no
// layout or measurement runs before `ensureLoaded` resolves for the document's fonts; a font
// arriving later bumps `fontEpoch`, marks every text object layout-dirty and repaints. A loader
// that does not ask (backend, test fakes) never makes layout wait.
import { describe, expect, it } from 'vitest';
import { BoardSession, createRuntime } from '../../src/session';
import { documentFontRequests } from '../../src/session/font-requests';
import { FakeImagePort, FakeScheduler, RecordedWidthMeasurer } from '../../src/testing';
import type { FontFaceRequest, FontLoader, LineMetrics, TextMeasurer } from '../../src/text';
import { bundledCatalog } from '../io/helpers';
import { fixtureJson } from '../sync/helpers';

class SpyMeasurer implements TextMeasurer {
  calls = 0;
  private readonly inner = new RecordedWidthMeasurer(new Map(), 8);
  measureLine(text: string, fontKey: string): LineMetrics {
    this.calls++;
    return this.inner.measureLine(text, fontKey);
  }
}

/** A loader whose `ensureLoaded` the test resolves, and whose `fontsChanged` it fires. */
class DeferredLoader implements FontLoader {
  readonly waitBeforeLayout = true;
  epoch = 0;
  readonly calls: { fonts: readonly FontFaceRequest[]; sample: string }[] = [];
  private resolve_: (() => void) | null = null;
  private readonly cbs_ = new Set<() => void>();

  ensureLoaded(fonts: readonly FontFaceRequest[], sample: string): Promise<void> {
    this.calls.push({ fonts, sample });
    return new Promise((res) => {
      this.resolve_ = res;
    });
  }
  resolve(): void {
    this.resolve_?.();
  }
  onFontsChanged(cb: () => void): () => void {
    this.cbs_.add(cb);
    return () => this.cbs_.delete(cb);
  }
  bump(): void {
    this.epoch++;
    for (const cb of [...this.cbs_]) cb();
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function rig(loader: FontLoader) {
  const measurer = new SpyMeasurer();
  const runtime = createRuntime({ measurer, fonts: loader, catalog: bundledCatalog(), host: 'web' });
  const scheduler = new FakeScheduler();
  const session = new BoardSession(runtime, { images: new FakeImagePort(), scheduler });
  const seen: string[] = [];
  session.on('paintRequested', (e) => seen.push(e.layer));
  /** The layers repainted at the next frame. */
  const painted = (): string[] => {
    scheduler.frame();
    const out = seen.slice();
    seen.length = 0;
    return out;
  };
  return { measurer, runtime, session, painted };
}

/** A 2-D context that records `fillText` calls and ignores the rest. */
function recordingContext(): { ctx: never; fills: string[] } {
  const fills: string[] = [];
  const target: Record<string, unknown> = {
    fillText: (t: string) => fills.push(t),
    measureText: () => ({ width: 1 }),
  };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  return { ctx: ctx as never, fills };
}

describe('fonts before the first layout (AC-TXT-07)', () => {
  it('no measurement before ensureLoaded resolves; then the document is laid out and repainted', async () => {
    const loader = new DeferredLoader();
    const r = rig(loader);
    r.session.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
    expect(r.session.waitingForFonts).toBe(true);
    expect(loader.calls).toHaveLength(1);
    expect(r.measurer.calls).toBe(0);
    const { ctx, fills } = recordingContext();
    r.session.paint('drawing', ctx);
    expect(fills).toHaveLength(0);
    expect(r.measurer.calls).toBe(0);

    // The request names the bundled default and carries the document's characters.
    const req = loader.calls[0];
    expect(req?.fonts.some((f) => f.family === 'Noto Sans' && f.weight === 400 && f.style === 'normal')).toBe(true);
    for (const ch of 'StartEndnext') expect(req?.sample).toContain(ch);

    loader.resolve();
    await tick();
    expect(r.session.waitingForFonts).toBe(false);
    expect(r.measurer.calls).toBeGreaterThan(0);
    expect(r.painted()).toContain('drawing');
    r.session.dispose();
  });

  it('a font arriving later bumps fontEpoch and re-lays out every text object', async () => {
    const loader = new DeferredLoader();
    const r = rig(loader);
    r.session.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
    loader.resolve();
    await tick();
    const epoch = r.runtime.fonts.fontEpoch;
    const calls = r.measurer.calls;
    r.painted();
    loader.bump();
    expect(r.runtime.fonts.fontEpoch).toBe(epoch + 1);
    expect(r.measurer.calls).toBeGreaterThan(calls);
    expect(r.painted()).toContain('drawing');
    r.session.dispose();
  });

  it('a rejected load still ends the wait (fallback fonts)', async () => {
    const loader = new DeferredLoader();
    loader.ensureLoaded = () => Promise.reject(new Error('404'));
    const r = rig(loader);
    r.session.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
    await tick();
    expect(r.session.waitingForFonts).toBe(false);
    expect(r.measurer.calls).toBeGreaterThan(0);
    r.session.dispose();
  });

  it('a reopen supersedes the previous wait; dispose drops it', async () => {
    const loader = new DeferredLoader();
    const r = rig(loader);
    r.session.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
    r.session.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
    expect(loader.calls).toHaveLength(2);
    r.session.dispose();
    loader.resolve();
    await tick();
    expect(r.measurer.calls).toBe(0);
  });

  it('a loader that does not ask (backend, fakes) never makes layout wait', () => {
    const loader = new DeferredLoader();
    Object.defineProperty(loader, 'waitBeforeLayout', { value: false });
    const r = rig(loader);
    r.session.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
    expect(r.session.waitingForFonts).toBe(false);
    expect(loader.calls).toHaveLength(0);
    expect(r.measurer.calls).toBeGreaterThan(0);
    r.session.dispose();
  });

  it('documentFontRequests lists each resolved face once and leaves generic-only fonts out', () => {
    const loader = new DeferredLoader();
    const r = rig(loader);
    r.session.dispatch({ type: 'open', raw: fixtureJson('format/03-connector.lekh'), meta: { kind: 'offline' } });
    const { requests } = documentFontRequests(r.session.document, r.runtime.fontResolver);
    const keys = requests.map((q) => q.fontKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(requests.every((q) => q.family !== '')).toBe(true);
    r.session.dispose();
  });
});
