// Short ids: the golden vectors of the KB document-model page ("Page and object identity") and the 1,000
// npm short-uuid 6.0.3 pairs the C++ ShortIdTest also checks (fixtures/short-uuid-vectors.json).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLICKR_BASE58, SHORT_ID_LENGTH, shortIdFromUuid } from '../../src/base';

const vectors = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures/short-uuid-vectors.json'), 'utf8'),
) as { uuid: string; short: string }[];

function decode58(s: string): bigint {
  let v = 0n;
  for (const c of s) v = v * 58n + BigInt(FLICKR_BASE58.indexOf(c));
  return v;
}

describe('shortIdFromUuid', () => {
  it('matches the KB golden vectors', () => {
    expect(shortIdFromUuid('3a8c685e-dc86-47a6-80ac-7e79f255b252')).toBe('8ek6xwftSipyETbq2Yvzem');
    expect(shortIdFromUuid('9B1DE562-109D-465F-A513-D2B37C8F30C4')).toBe('k9XFbQ4Hapk5PACEyW3qjy');
  });

  it('matches all 1,000 short-uuid vectors', () => {
    expect(vectors.length).toBe(1000);
    for (const v of vectors) expect(shortIdFromUuid(v.uuid)).toBe(v.short);
  });

  it('ignores case and hyphen placement', () => {
    const a = shortIdFromUuid('9b1de562109d465fa513d2b37c8f30c4');
    expect(shortIdFromUuid('9B1D-E562-109D465FA513D2B3-7C8F30C4')).toBe(a);
    expect(shortIdFromUuid('----9b1de562109d465fa513d2b37c8f30c4')).toBe(a);
  });

  it('passes through anything that is not exactly 32 hex digits', () => {
    for (const s of [
      '',
      'smoke-000000000001',
      '9b1de562109d465fa513d2b37c8f30c',
      '9b1de562109d465fa513d2b37c8f30c4a',
      'g'.repeat(32),
      '9b1de562 109d465fa513d2b37c8f30c4',
    ]) {
      expect(shortIdFromUuid(s)).toBe(s);
    }
  });

  it('is 22 alphabet characters and round-trips the 128 bits', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const h = randomBytes(16).toString('hex');
      const id = shortIdFromUuid(h);
      expect(id).toMatch(/^[1-9a-km-zA-HJ-NP-Z]{22}$/);
      expect(id.length).toBe(SHORT_ID_LENGTH);
      expect(decode58(id)).toBe(BigInt('0x' + h));
      seen.add(id);
    }
    expect(seen.size).toBe(2000);
  });
});
