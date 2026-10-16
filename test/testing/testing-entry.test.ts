// The `lekhjs/testing` entry (spec 01 §4.1): createTestRuntime, the fakes, setTestConfig with
// linePitch, and the fixture loader.
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Size } from '../../src/geometry';
import type { ImagePort } from '../../src/session';
import { Style } from '../../src/style';
import { TemplateTextService } from '../../src/template';
import { LINE_PITCH } from '../../src/text';
import {
  FakeImagePort,
  FakeScheduler,
  FakeTransport,
  createFixtureLoader,
  createTestRuntime,
  fakeImage,
  setTestConfig,
} from '../../src/testing';
import { CORE_FIXTURES } from '../io/helpers';

describe('lekhjs/testing', () => {
  it('createTestRuntime applies setTestConfig, including the linePitch override', () => {
    const measureTwoLines = (pitch?: number) => {
      const rt = createTestRuntime(pitch === undefined ? {} : { testing: { linePitch: pitch } });
      const text = new TemplateTextService(rt.textLayout, rt.fontResolver);
      return text.measure('a\nb', new Style(), new Size(-1, -1)).height;
    };
    const base = measureTwoLines();
    const wide = measureTwoLines(LINE_PITCH * 2);
    expect(wide).toBeGreaterThan(base);
    expect(createTestRuntime({ testing: { linePitch: 2 } }).testing.linePitch).toBe(2);
    expect(() => setTestConfig({ linePitch: 0 })).toThrow(RangeError);
    expect(() => setTestConfig({ nope: true } as never)).toThrow(TypeError);
  });

  it('createTestRuntime measures with a canvas factory when given one', () => {
    const rt = createTestRuntime({ canvas: { createCanvas: (w, h) => createCanvas(w, h) } });
    expect(rt.measurer.measureLine('hello', '16px sans-serif').width).toBeGreaterThan(0);
    expect(rt.ids.next()).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('FakeScheduler runs timers in time order and frames on frame()', () => {
    const s = new FakeScheduler(0);
    const log: string[] = [];
    s.setTimeout(() => log.push('b'), 20);
    s.setTimeout(() => log.push('a'), 10);
    const h = s.setTimeout(() => log.push('x'), 15);
    s.clearTimeout(h);
    s.requestFrame((t) => log.push(`frame@${String(t)}`));
    s.advance(25);
    expect(log).toEqual(['a', 'b']);
    expect(s.now()).toBe(25);
    expect(s.frame()).toBe(1);
    expect(log.at(-1)).toBe('frame@25');
    expect([s.pendingTimers, s.pendingFrames]).toEqual([0, 0]);
  });

  it('FakeTransport and FakeImagePort record and answer', async () => {
    const t = new FakeTransport('closed');
    expect(t.send('x')).toBe(false);
    const states: string[] = [];
    const off = t.onState((st) => states.push(st.state));
    t.setState('open');
    expect(t.send('y')).toBe(true);
    off();
    t.close();
    expect([states, t.sent]).toEqual([['open'], ['y']]);

    const img = fakeImage(3, 4);
    const fake = new FakeImagePort(new Map([['a', img]]), { inline: false });
    const port: ImagePort = fake;
    port.request(['a', 'b']);
    expect(fake.requested).toEqual(['a', 'b']);
    expect(await port.ensure(['a', 'b'], { timeoutMs: 10 })).toEqual({ loaded: ['a'], missing: ['b'] });
    const unpin = port.pin(['a']);
    expect(fake.pins.get('a')).toBe(1);
    unpin();
    unpin();
    expect(fake.pins.get('a')).toBe(0);
    await expect(port.decodeInline('data:x')).rejects.toThrow();
  });

  it('the fixture loader reads through the reader it is given', () => {
    const fx = createFixtureLoader((p) => readFileSync(p, 'utf8'), CORE_FIXTURES);
    expect(fx.text('format/01-empty.lekh')).toContain('"info"');
    expect(fx.json('format/01-empty.lekh')).toHaveProperty('info');
    expect(fx.boards(['format/01-empty.lekh', 'format/02-one-shape.lekh'])).toHaveLength(2);
  });
});
