// The streaming encoders of banded raster export (spec 08 §5.2, §12 "BandEncoder output decodes to
// the same pixels"): PNG through pako decodes to exactly the input rows whatever the band split;
// the JPEG row encoder is byte-identical to `jpeg-js.encode(image, 100)` (the oracle) for band
// splits on and off the 8-row strip boundary.
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { JpegStreamEncoder, PngStreamEncoder } from '../../src/export';
import { pixelsOf } from './helpers';

function image(w: number, h: number, seed = 1): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  let s = seed;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const i = (y * w + x) * 4;
      // A gradient with noise and a hard edge, so DC, AC and run lengths are all exercised.
      d[i] = (x * 255) / w + ((s >> 8) & 15);
      d[i + 1] = (y * 255) / h;
      d[i + 2] = x > w / 2 ? 220 : (s >> 16) & 255;
      d[i + 3] = x % 7 === 0 ? 128 : 255;
    }
  }
  return d;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function bands(
  enc: PngStreamEncoder | JpegStreamEncoder,
  rgba: Uint8Array,
  w: number,
  h: number,
  split: number[],
): Uint8Array {
  const out: Uint8Array[] = [enc.take()];
  let y = 0;
  for (let i = 0; y < h; i++) {
    const rows = Math.min(split[i % split.length] ?? h, h - y);
    enc.pushRows(rgba.subarray(y * w * 4, (y + rows) * w * 4), rows);
    y += rows;
    if (y >= h) enc.finish();
    out.push(enc.take());
  }
  return concat(out);
}

describe('PngStreamEncoder', () => {
  for (const [w, h, split] of [
    [37, 23, [23]],
    [37, 23, [5, 1, 9]],
    [300, 120, [16]],
    [1, 1, [1]],
  ] as const) {
    it(`${String(w)}×${String(h)} in bands of ${split.join('/')} decodes to the input`, async () => {
      const rgba = image(w, h);
      const png = bands(new PngStreamEncoder(w, h), rgba, w, h, [...split]);
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const px = await pixelsOf(png);
      expect([px.width, px.height]).toEqual([w, h]);
      // Decoding through a canvas premultiplies: compare opaque pixels exactly, the rest by alpha.
      for (let i = 0; i < rgba.length; i += 4) {
        expect(px.data[i + 3]).toBe(rgba[i + 3]);
        if (rgba[i + 3] === 255)
          expect([px.data[i], px.data[i + 1], px.data[i + 2]]).toEqual([rgba[i], rgba[i + 1], rgba[i + 2]]);
      }
    });
  }

  it('refuses too many rows and a finish before the last row', () => {
    const e = new PngStreamEncoder(2, 2);
    expect(() => {
      e.pushRows(new Uint8Array(24), 3);
    }).toThrow(RangeError);
    e.pushRows(new Uint8Array(8), 1);
    expect(() => {
      e.finish();
    }).toThrow();
  });
});

describe('JpegStreamEncoder (byte-identical to jpeg-js at quality 100)', () => {
  for (const [w, h, split] of [
    [64, 48, [48]],
    [61, 45, [16]],
    [61, 45, [16, 16, 13]],
    [100, 37, [3, 5, 8, 21]],
    [8, 8, [8]],
    [1, 1, [1]],
  ] as const) {
    it(`${String(w)}×${String(h)} in bands of ${split.join('/')}`, () => {
      const rgba = image(w, h, 7);
      const ours = bands(new JpegStreamEncoder(w, h, 100), rgba, w, h, [...split]);
      const oracle = jpeg.encode({ data: Buffer.from(rgba), width: w, height: h }, 100).data;
      expect(ours.length).toBe(oracle.length);
      expect(Buffer.from(ours).equals(Buffer.from(oracle))).toBe(true);
    });
  }

  it('decodes to the size it was given', () => {
    const rgba = image(33, 17);
    const ours = bands(new JpegStreamEncoder(33, 17), rgba, 33, 17, [16]);
    const d = jpeg.decode(Buffer.from(ours));
    expect([d.width, d.height]).toEqual([33, 17]);
  });
});
