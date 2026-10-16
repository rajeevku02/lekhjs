// AC-TXT-16: modifier mapping (spec 06 §8.3): DemiBold → 600, Light → 300, Condensed →
// condensed, BoldItalic → 700 italic, the whole table, and unknown → regular.
import { describe, expect, it } from 'vitest';
import { modifierToCss } from '../../src/text';

describe('modifierToCss (AC-TXT-16)', () => {
  it('the four named cases', () => {
    expect(modifierToCss('DemiBold')).toEqual({ weight: 600, style: '', stretch: '' });
    expect(modifierToCss('Light')).toEqual({ weight: 300, style: '', stretch: '' });
    expect(modifierToCss('Condensed')).toEqual({ weight: 0, style: '', stretch: 'condensed' });
    expect(modifierToCss('BoldItalic')).toEqual({ weight: 700, style: 'italic', stretch: '' });
  });

  it('the whole weight table', () => {
    const table: [string, number][] = [
      ['Thin', 100],
      ['UltraLight', 200],
      ['ExtraLight', 200],
      ['Light', 300],
      ['Regular', 400],
      ['Roman', 400],
      ['Book', 400],
      ['Medium', 500],
      ['DemiBold', 600],
      ['SemiBold', 600],
      ['Bold', 700],
      ['Heavy', 800],
      ['ExtraBold', 800],
      ['Black', 900],
    ];
    for (const [m, w] of table) expect(modifierToCss(m).weight, m).toBe(w);
  });

  it('style and stretch tokens, combined and case-insensitive', () => {
    expect(modifierToCss('Oblique').style).toBe('oblique');
    expect(modifierToCss('Compressed').stretch).toBe('condensed');
    expect(modifierToCss('Wide').stretch).toBe('expanded');
    expect(modifierToCss('Expanded').stretch).toBe('expanded');
    expect(modifierToCss('CondensedBold')).toEqual({ weight: 700, style: '', stretch: 'condensed' });
    expect(modifierToCss('condensed-black italic')).toEqual({ weight: 900, style: 'italic', stretch: 'condensed' });
  });

  it('an unknown or partly unknown modifier is ignored (regular face)', () => {
    expect(modifierToCss('')).toEqual({ weight: 0, style: '', stretch: '' });
    expect(modifierToCss('Fancy')).toEqual({ weight: 0, style: '', stretch: '' });
    expect(modifierToCss('BoldFancy')).toEqual({ weight: 0, style: '', stretch: '' });
  });
});
