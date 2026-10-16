// style/ (port of C++ `Style`, `GroupStyle`, `color_t`, `Measure`): inheritance and root
// defaults, non-overridables, the kept C++ quirks, GroupStyle's group and master modes, `equals`,
// `copyFrom`, the revision counter, colours and units.
import { describe, expect, it } from 'vitest';
import {
  CapStyle,
  Color,
  DEFAULT_PAINT,
  FontSpec,
  FontStyle,
  FontWeight,
  GroupStyle,
  GroupStyleMode,
  JoinStyle,
  Length,
  LineBreakMode,
  NO_SHADOW,
  POINTS_PER_INCH,
  Paint,
  PaintType,
  Scaling,
  Shadow,
  Style,
  TextAlignHorizontal,
  TextAlignVertical,
  TextDecoration,
  Unit,
} from '../../src/style';

describe('Style inheritance and root defaults', () => {
  it('a fresh root style has the C++ defaults', () => {
    const s = new Style();
    expect(s.effectiveStrokeWidth()).toBe(2);
    expect(s.effectiveCapStyle()).toBe(CapStyle.Round);
    expect(s.effectiveJoinStyle()).toBe(JoinStyle.Round);
    expect(s.effectiveStrokePaint().type).toBe(PaintType.Solid);
    expect(s.effectiveStrokePaint().solidColor.toInt()).toBe(-16777216);
    expect(s.effectiveFillPaint().type).toBe(PaintType.NoPaint);
    expect(s.effectiveTextFill().solidColor.equals(new Color(0, 0, 0))).toBe(true);
    expect(s.effectiveTextStroke().type).toBe(PaintType.NoPaint);
    expect(s.effectiveFontSize()).toBe(15);
    expect(s.effectiveFontMultiplier()).toBe(1);
    expect(s.effectiveFontFamily()).toBe('');
    expect(s.effectiveFontWeight()).toBe(FontWeight.Normal);
    expect(s.effectiveFontStyle()).toBe(FontStyle.Normal);
    expect(s.effectiveTextAlignHorizontal()).toBe(TextAlignHorizontal.Center);
    expect(s.effectiveTextAlignVertical()).toBe(TextAlignVertical.Center);
    expect(s.effectiveTextDecoration()).toBe(TextDecoration.Normal);
    expect(s.effectiveTextPadding()).toBe(-1);
    expect(s.effectiveDisabled()).toBe(false);
    expect(s.effectiveDashPatternPhase()).toBe(0);
    expect(s.effectiveShadow().equals(NO_SHADOW)).toBe(true);
    expect(s.fill()).toBe(false);
  });

  it('undefined attributes inherit through the parent chain', () => {
    const root = new Style();
    root.setFontSize(20);
    root.setFontFamily('Noto Serif');
    root.setStrokeWidth(3);
    const mid = new Style();
    mid.setParent(root);
    mid.setFontWeight(FontWeight.Bold);
    const leaf = new Style();
    leaf.setParent(mid);
    expect(leaf.effectiveFontSize()).toBe(20);
    expect(leaf.effectiveFontFamily()).toBe('Noto Serif');
    expect(leaf.effectiveFontWeight()).toBe(FontWeight.Bold);
    expect(leaf.effectiveStrokeWidth()).toBe(3);
    leaf.setFontSize(9);
    expect(leaf.effectiveFontSize()).toBe(9);
    leaf.removeFontSize();
    expect(leaf.effectiveFontSize()).toBe(20);
  });

  it('a negative inherited stroke width or phase reads as 0 (C++)', () => {
    const root = new Style();
    const leaf = new Style();
    leaf.setParent(root);
    root.setStrokeWidth(-5);
    expect(root.effectiveStrokeWidth()).toBe(2);
    expect(leaf.effectiveStrokeWidth()).toBe(2);
  });

  it('a dash array of only zeros clears the dash; the own empty dash inherits', () => {
    const root = new Style();
    root.setDashArray([4, 2]);
    const s = new Style();
    s.setParent(root);
    expect(s.effectiveDashArray()).toEqual([4, 2]);
    s.setDashArray([0, 0]);
    expect(s.isDashArrayDefined()).toBe(false);
    expect(s.dashPatternCount()).toBe(2);
  });
});

describe('Style setters', () => {
  it('a non-overridable attribute ignores set and remove', () => {
    const s = new Style();
    s.setFontSize(12);
    s.addNonOverridables('fontSize');
    s.setFontSize(30);
    s.removeFontSize();
    expect(s.effectiveFontSize()).toBe(12);
    expect(s.isFontSizeOverridable()).toBe(false);
  });

  it('removeShadow and removeLineBreakMode ignore the non-overridables (C++)', () => {
    const s = new Style();
    s.setShadow(new Shadow(1, 1, 3, new Color(1, 2, 3)));
    s.addNonOverridables('shadow');
    s.addNonOverridables('lineBreakMode');
    s.removeShadow();
    s.removeLineBreakMode();
    expect(s.isShadowDefined()).toBe(false);
    expect(s.isLineBreakModeDefined()).toBe(false);
  });

  it('lineBreakMode starts defined as word wrap (C++ reset)', () => {
    expect(new Style().isLineBreakModeDefined()).toBe(true);
    expect(new Style().effectiveLineBreakMode()).toBe(LineBreakMode.WordWrapping);
  });

  it('textPadding, dash phase and disabled are integers (C++ int fields)', () => {
    const s = new Style();
    s.setTextPadding(4.7);
    s.setDashPatternPhase(2.9);
    s.setDisabled(1.5);
    expect([s.effectiveTextPadding(), s.effectiveDashPatternPhase(), s.effectiveDisabled()]).toEqual([4, 2, true]);
  });

  it('colour shortcuts keep the rest of the current paint', () => {
    const s = new Style();
    s.setFillColor(new Color(10, 20, 30));
    expect(s.effectiveFillPaint().type).toBe(PaintType.Solid);
    s.setNoFill();
    expect(s.effectiveFillPaint().type).toBe(PaintType.NoPaint);
    expect(s.effectiveFillPaint().solidColor.equals(new Color(10, 20, 30))).toBe(true);
    s.setFontColor(new Color(255, 0, 0));
    expect(s.effectiveTextFill().solidColor.toCss()).toBe('rgba(255, 0, 0, 1)');
  });

  it('every mutation bumps the revision; revisionSum includes ancestors and the parent link', () => {
    const root = new Style();
    const s = new Style();
    s.setParent(root);
    const r0 = s.revisionSum();
    root.setFontSize(18);
    expect(s.revisionSum()).toBeGreaterThan(r0);
    const r1 = s.revisionSum();
    s.setParent(new Style());
    expect(s.revisionSum()).not.toBe(r1);
    const own = s.revision;
    s.setTextFill(Paint.solid(new Color(1, 1, 1)));
    expect(s.revision).toBe(own + 1);
  });
});

describe('equals, clone, copyFrom', () => {
  it('equals compares what C++ compares and ignores the rest', () => {
    const a = new Style();
    const b = new Style();
    b.setFontModifier('Bold');
    b.setFontMultiplier(2);
    b.setTextPadding(5);
    expect(a.equals(b)).toBe(true);
    b.setFontFamily('Caveat');
    expect(a.equals(b)).toBe(false);
    const c = new Style();
    c.setDashArray([1, 2]);
    const d = new Style();
    d.setDashArray([1, 3]);
    expect(c.equals(d)).toBe(false);
  });

  it('copyFrom copies own values and non-overridables but keeps the parent', () => {
    const p1 = new Style();
    const p2 = new Style();
    const src = new Style();
    src.setParent(p1);
    src.setFontSize(33);
    src.addNonOverridables('fontSize');
    const dst = new Style();
    dst.setParent(p2);
    dst.copyFrom(src);
    expect(dst.parent()).toBe(p2);
    expect(dst.effectiveFontSize()).toBe(33);
    expect(dst.isFontSizeOverridable()).toBe(false);
    const cl = src.clone();
    expect(cl.parent()).toBeNull();
    expect(cl.effectiveFontSize()).toBe(33);
  });

  it('Paint.equals: same type; solid compares colour; gradients equal on type (C++ TODO)', () => {
    expect(Paint.solid(new Color(1, 2, 3)).equals(Paint.solid(new Color(1, 2, 3)))).toBe(true);
    expect(Paint.solid(new Color(1, 2, 3)).equals(Paint.solid(new Color(1, 2, 4)))).toBe(false);
    expect(new Paint({ type: PaintType.LinearGradient }).equals(new Paint({ type: PaintType.LinearGradient }))).toBe(
      true,
    );
    expect(DEFAULT_PAINT.equals(new Paint({ type: PaintType.Default }))).toBe(true);
    expect(new Shadow(1, 2, -1).equals(new Shadow(5, 5, -3))).toBe(true);
  });
});

describe('GroupStyle', () => {
  function group(mode: GroupStyleMode) {
    const a = new Style();
    a.setFontSize(11);
    a.setStrokeWidth(4);
    const b = new Style();
    b.setFontSize(22);
    const g = new GroupStyle(mode);
    g.setProfiles([a, b]);
    return { g, a, b };
  }

  it('group mode copies member 0 and applies every set to each member', () => {
    const { g, a, b } = group(GroupStyleMode.Group);
    expect(g.effectiveFontSize()).toBe(11);
    expect(g.effectiveStrokeWidth()).toBe(4);
    g.setFontSize(30);
    expect([a.effectiveFontSize(), b.effectiveFontSize()]).toEqual([30, 30]);
    g.setFillColor(new Color(9, 9, 9));
    expect(b.effectiveFillPaint().solidColor.equals(new Color(9, 9, 9))).toBe(true);
  });

  it('master mode clears the attribute on each member so they inherit', () => {
    const { g, a, b } = group(GroupStyleMode.Master);
    g.setFontSize(30);
    expect([a.isFontSizeDefined(), b.isFontSizeDefined()]).toEqual([false, false]);
    expect(g.effectiveFontSize()).toBe(30);
  });

  it('a set equal to the current effective value does nothing; the dash phase goes to every member', () => {
    const { g, b } = group(GroupStyleMode.Master);
    g.setFontSize(15); // the group's own effective size is the root default 15
    expect(b.effectiveFontSize()).toBe(22);
    g.setDashPatternPhase(3);
    expect(b.effectiveDashPatternPhase()).toBe(3);
  });

  it('non-overridables are not kept on a group; selection state propagates', () => {
    const { g, a } = group(GroupStyleMode.Group);
    g.addNonOverridables('fontSize');
    expect(g.isFontSizeOverridable()).toBe(true);
    g.setIsSelected(true);
    expect(a.isSelected()).toBe(true);
  });

  it('deepClone copies the members; clone shares them', () => {
    const { g, a } = group(GroupStyleMode.Group);
    const deep = g.deepClone();
    const shallow = g.clone();
    expect(deep.getProfiles()[0]).not.toBe(a);
    expect(shallow.getProfiles()[0]).toBe(a);
    deep.setFontSize(50);
    expect(a.effectiveFontSize()).toBe(11);
  });
});

describe('Color', () => {
  it('reads and writes the signed 32-bit ARGB form', () => {
    const c = Color.fromInt(-16777216);
    expect([c.red, c.green, c.blue, c.alpha]).toEqual([0, 0, 0, 255]);
    expect(Color.fromInt(0xff102030).toInt()).toBe(0xff102030 | 0);
    expect(new Color(1, 2, 3, 4).toUint()).toBe(0x04010203);
  });

  it('two transparent colours are equal; disabled and inverted as C++', () => {
    expect(new Color(1, 2, 3, 0).equals(new Color(9, 9, 9, 0))).toBe(true);
    expect(new Color(100, 0, 255).disabled()).toEqual(new Color(193, 153, 255));
    expect(new Color(5, 10, 250).disabled()).toEqual(new Color(155, 157, 253));
    expect(new Color(10, 20, 30).inverted()).toEqual(new Color(245, 235, 225));
  });

  it('HSV round trip', () => {
    for (const c of [new Color(255, 0, 0), new Color(0, 128, 255), new Color(200, 200, 200), new Color(12, 200, 99)]) {
      const back = Color.fromHsv(c.toHsv());
      expect(Math.abs(back.red - c.red)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.green - c.green)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.blue - c.blue)).toBeLessThanOrEqual(1);
    }
  });
});

describe('units', () => {
  it('POINTS_PER_INCH is 144; a pixel is a point', () => {
    expect(POINTS_PER_INCH).toBe(144);
    expect(new Length(2, Unit.Inch).points()).toBe(288);
    expect(new Length(7, Unit.Pixel).points()).toBe(7);
    expect(new Length(2.54, Unit.Centimeter).points()).toBeCloseTo(144, 12);
  });

  it('toUnit converts inch and cm directly', () => {
    expect(new Length(1, Unit.Inch).toUnit(Unit.Centimeter)).toBe(2.54);
    expect(new Length(2.54, Unit.Centimeter).toUnit(Unit.Inch)).toBe(1);
    expect(new Length(144, Unit.Point).toUnit(Unit.Inch)).toBe(1);
    expect(new Length(10.6, Unit.Point).points(true)).toBe(11);
  });

  it('unit names round-trip; unknown is point', () => {
    for (const u of [Unit.Point, Unit.Pixel, Unit.Inch, Unit.Centimeter])
      expect(Length.unitFromStr(Length.unitStr(u))).toBe(u);
    expect(Length.unitFromStr('furlong')).toBe(Unit.Point);
  });

  it('Scaling rounds to two decimals (half away from zero) and guards a non-positive scale', () => {
    const s = new Scaling(Unit.Inch, 2);
    expect(s.pointToUnit(144)).toBe(2);
    expect(s.pointToUnit(-1.08)).toBe(-0.02);
    expect(s.unitToPoint(2)).toBe(144);
    expect(new Scaling(Unit.Inch, 0).unitToPoint(5)).toBe(5);
    expect(Scaling.default().isDefault()).toBe(true);
    expect(Scaling.inchDefault().isDefault()).toBe(false);
  });
});

describe('FontSpec', () => {
  it('collects the effective font and px = size × multiplier', () => {
    const root = new Style();
    root.setFontSize(20);
    const s = new Style();
    s.setParent(root);
    s.setFontMultiplier(1.5);
    s.setFontStyle(FontStyle.Oblique);
    s.setFontModifier('DemiBold');
    const f = FontSpec.of(s);
    expect([f.size, f.multiplier, f.px, f.italic, f.bold, f.modifier, f.family]).toEqual([
      20,
      1.5,
      30,
      true,
      false,
      'DemiBold',
      '',
    ]);
  });
});
