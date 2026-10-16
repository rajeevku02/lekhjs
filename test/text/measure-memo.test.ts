// AC-ENG-11: changing each of the 11 key fields of spec 03 §8.2 forces re-measurement (field 11,
// the line pitch, through the test-only pitch override), while colour, alignment and the box
// (zoom is a canvas transform, never an input) do not. AC-ENG-10's text half: with the key
// unchanged a layout makes no `measureLine` call. Spec 06 §5.2: stretch is part of `fontKey`.
import { describe, expect, it } from 'vitest';
import { Rect } from '../../src/geometry';
import { Color, FontStyle, FontWeight, Paint, Style, TextAlignHorizontal } from '../../src/style';
import { RecordedWidthMeasurer, createTestTextStack, type TestConfigOverrides } from '../../src/testing';
import { TextMeasureMemo, textStyleSnapshot, type TextLayoutInput, type WrapMode } from '../../src/text';

function setup(testing: TestConfigOverrides = {}) {
  const measurer = new RecordedWidthMeasurer(new Map(), 7);
  const stack = createTestTextStack({ measurer, testing });
  const style = new Style();
  style.setFontSize(15);
  style.setFontFamily('Noto Sans');
  const memo = new TextMeasureMemo();
  let text = 'Process step one';
  let wrapWidth = 80;
  let mode: WrapMode = 'wrap';
  let box = new Rect(0, 0, 100, 60);
  const input = (): TextLayoutInput => ({
    text,
    style: textStyleSnapshot(style, stack.resolver),
    box,
    wrapWidth,
    angle: 0,
    wrapMode: mode,
  });
  const run = () => {
    const before = measurer.calls;
    stack.layout.layout(input(), memo);
    return measurer.calls - before;
  };
  return {
    stack,
    style,
    run,
    setText: (t: string) => (text = t),
    setWrap: (w: number) => (wrapWidth = w),
    setMode: (m: WrapMode) => (mode = m),
    setBox: (b: Rect) => (box = b),
  };
}

describe('the 11-field memo key (AC-ENG-11)', () => {
  it('an unchanged key measures nothing (AC-ENG-10, text half)', () => {
    const s = setup();
    expect(s.run()).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) {
      s.setBox(new Rect(i, i * 2, 100, 60)); // a drag moves the box, not the key
      s.stack.cache.clear(); // so a zero proves the memo, not the shared LRU, served it
      expect(s.run()).toBe(0);
    }
  });

  const fields: [string, (s: ReturnType<typeof setup>) => void][] = [
    ['1 fontEpoch', (s) => s.stack.registry.bumpEpoch()],
    ['2 text', (s) => s.setText('Process step two')],
    [
      '3 resolved family',
      (s) => {
        s.style.setFontFamily('Noto Serif');
      },
    ],
    [
      '4 font size',
      (s) => {
        s.style.setFontSize(16);
      },
    ],
    [
      '5 font multiplier',
      (s) => {
        s.style.setFontMultiplier(1.5);
      },
    ],
    [
      '6 font weight',
      (s) => {
        s.style.setFontWeight(FontWeight.Bold);
      },
    ],
    [
      '7 font style',
      (s) => {
        s.style.setFontStyle(FontStyle.Italic);
      },
    ],
    [
      '8 font modifier',
      (s) => {
        s.style.setFontModifier('Condensed');
      },
    ],
    ['9 wrap mode', (s) => s.setMode('float')],
    ['10 wrap width', (s) => s.setWrap(81)],
  ];
  for (const [name, change] of fields) {
    it(`changing field ${name} re-measures`, () => {
      const s = setup();
      s.run();
      expect(s.run()).toBe(0);
      change(s);
      s.stack.cache.clear(); // the memo must miss; the shared LRU must not hide it
      expect(s.run()).toBeGreaterThan(0);
    });
  }

  it('changing field 11 (line pitch) through the test-only pitch override re-measures', () => {
    const a = setup();
    const b = setup({ linePitch: 1.3 });
    const input = (st: ReturnType<typeof setup>) => ({
      text: 'x',
      style: textStyleSnapshot(st.style, st.stack.resolver),
      box: new Rect(0, 0, 10, 10),
      wrapWidth: 10,
      angle: 0,
    });
    const ka = a.stack.layout.measureKey('x', input(a).style, 10);
    const kb = b.stack.layout.measureKey('x', input(b).style, 10);
    expect(ka).not.toBe(kb);
    expect(ka.split('\u0000')).toHaveLength(11);
    expect(ka.split('\u0000')[0]).toBe('0');
    const memo = new TextMeasureMemo();
    a.stack.layout.layout(input(a), memo);
    const m = b.stack.measurer as RecordedWidthMeasurer;
    const before = m.calls;
    b.stack.layout.layout(input(b), memo); // the memo of a's layout does not serve b's pitch
    expect(m.calls).toBeGreaterThan(before);
    expect(b.stack.layout.lineHeight({ fontSize: 10, fontMultiplier: 1 })).toBeCloseTo(13, 12);
  });

  it('colour, alignment and the box do not re-measure', () => {
    const s = setup();
    s.run();
    s.stack.cache.clear();
    s.style.setTextFill(Paint.solid(new Color(255, 0, 0)));
    expect(s.run()).toBe(0);
    s.style.setStrokeColor(new Color(0, 0, 255));
    expect(s.run()).toBe(0);
    s.style.setTextAlignHorizontal(TextAlignHorizontal.Left);
    expect(s.run()).toBe(0);
    s.setBox(new Rect(5, 5, 300, 300));
    expect(s.run()).toBe(0);
  });

  it('the fast path skips the key while text, style revision, wrap width and epoch hold', () => {
    const s = setup();
    const memo = new TextMeasureMemo();
    const snap = textStyleSnapshot(s.style, s.stack.resolver);
    const inp = {
      text: 't',
      style: snap,
      box: new Rect(0, 0, 10, 10),
      wrapWidth: 50,
      angle: 0,
      styleRevision: s.style.revisionSum(),
    };
    s.stack.layout.layout(inp, memo);
    expect(memo.fastHit('t', s.style.revisionSum(), 50, 0)).toBe(true);
    s.style.setFontSize(30);
    expect(memo.fastHit('t', s.style.revisionSum(), 50, 0)).toBe(false);
  });

  it('a condensed and a normal face never share a cache entry (stretch in fontKey)', () => {
    const s = setup();
    const normal = textStyleSnapshot(s.style, s.stack.resolver);
    s.style.setFontModifier('Condensed');
    const condensed = textStyleSnapshot(s.style, s.stack.resolver);
    const box = new Rect(0, 0, 10, 10);
    const a = s.stack.layout.layout({ text: 'x', style: normal, box, wrapWidth: 0, angle: 0 });
    const b = s.stack.layout.layout({ text: 'x', style: condensed, box, wrapWidth: 0, angle: 0 });
    expect(a.font).toBe(b.font);
    expect(a.fontKey).not.toBe(b.fontKey);
    expect(b.fontKey.endsWith('|condensed')).toBe(true);
    const keys = s.stack.cache.entries().map(([k]) => k.split('\u0000')[0]);
    expect(new Set(keys)).toEqual(new Set([a.fontKey, b.fontKey]));
  });
});
