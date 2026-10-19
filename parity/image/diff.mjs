// The image bar of verification 02 §B.3, shared by the image comparison (B) and the library-shape
// test (C): `pixelmatch` (threshold 0.1, anti-aliasing excluded) → differing pixels < 0.1 % of the
// page, and 8-connected blobs of the diff mask → none larger than 16 px² at scale 1 (16·s² at
// scale s). Self-diff is exact: two renders of one input by one build must be byte-identical.
//
// Images are `{ width, height, data }` with RGBA bytes, as `pngjs` decodes them.
import pixelmatch from 'pixelmatch';
import { createRequire } from 'node:module';

// pngjs ships no types; required untyped.
/** @type {any} */
const { PNG } = createRequire(import.meta.url)('pngjs');

export const THRESHOLD = 0.1;
export const MAX_FRACTION = 0.001;
export const MAX_BLOB_AT_SCALE_1 = 16;

/** @typedef {{ width: number, height: number, data: Uint8Array }} Rgba */
/** @typedef {{ x: number, y: number, w: number, h: number, pixels: number }} Blob */

/** @param {Buffer | Uint8Array} buf @returns {Rgba} */
export function decodePng(buf) {
  const png = PNG.sync.read(Buffer.from(buf));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}

/** @param {Rgba} img @returns {Buffer} */
export function encodePng(img) {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length).copy(png.data);
  return PNG.sync.write(png);
}

/** @param {string} dataUrl @returns {Rgba | null} null for the empty export (`data:,`) */
export function decodeDataUrl(dataUrl) {
  const m = /^data:image\/png;base64,(.*)$/.exec(dataUrl);
  if (m === null) return null;
  return decodePng(Buffer.from(m[1] ?? '', 'base64'));
}

/** The blob limit at `scale` (16·s² px). @param {number} [scale] */
export const maxBlob = (scale = 1) => MAX_BLOB_AT_SCALE_1 * scale * scale;

/** Exact equality of two renders (the self-diff of §B.3 rule 3). @param {Rgba} a @param {Rgba} b */
export function identical(a, b) {
  return a.width === b.width && a.height === b.height && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;
}

/**
 * Places two images on a common canvas by their board origins (§B.2 item 4): `origin` is the
 * board point at pixel (0, 0). Uncovered pixels are transparent.
 * @param {Rgba} a
 * @param {{ x: number, y: number }} oa
 * @param {Rgba} b
 * @param {{ x: number, y: number }} ob
 * @param {number} scale
 */
export function align(a, oa, b, ob, scale) {
  const ax = Math.round(oa.x * scale);
  const ay = Math.round(oa.y * scale);
  const bx = Math.round(ob.x * scale);
  const by = Math.round(ob.y * scale);
  const minx = Math.min(ax, bx);
  const miny = Math.min(ay, by);
  const width = Math.max(ax + a.width, bx + b.width) - minx;
  const height = Math.max(ay + a.height, by + b.height) - miny;
  const place = (/** @type {Rgba} */ img, /** @type {number} */ dx, /** @type {number} */ dy) => {
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < img.height; y++) {
      const src = y * img.width * 4;
      out.set(img.data.subarray(src, src + img.width * 4), ((y + dy) * width + dx) * 4);
    }
    return { width, height, data: out };
  };
  return {
    a: place(a, ax - minx, ay - miny),
    b: place(b, bx - minx, by - miny),
    origin: { x: minx / scale, y: miny / scale },
  };
}

/**
 * Differing pixels and the diff mask (1 = differs, anti-aliasing excluded unless `includeAA`).
 * `ignore`, when given, is a mask of pixels excluded from the count (§B.5 item 2).
 * @param {Rgba} a
 * @param {Rgba} b
 * @param {{ threshold?: number, includeAA?: boolean, ignore?: Uint8Array | null }} [opts]
 */
export function diffImages(a, b, opts = {}) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('diffImages: sizes differ; align first');
  const { width, height } = a;
  const out = new Uint8Array(width * height * 4);
  pixelmatch(a.data, b.data, out, width, height, {
    threshold: opts.threshold ?? THRESHOLD,
    includeAA: opts.includeAA ?? false,
    diffMask: true,
  });
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if ((out[i * 4 + 3] ?? 0) > 0 && !(opts.ignore && opts.ignore[i])) {
      mask[i] = 1;
      count++;
    }
  }
  return { width, height, mask, count, total: width * height, fraction: count / (width * height) };
}

/** A visual diff (C++ greyed, differences red, AA yellow) for local review. @param {Rgba} a @param {Rgba} b @returns {Rgba} */
export function diffPicture(a, b) {
  const out = new Uint8Array(a.width * a.height * 4);
  pixelmatch(a.data, b.data, out, a.width, a.height, { threshold: THRESHOLD, includeAA: false });
  return { width: a.width, height: a.height, data: out };
}

/**
 * 8-connected components of a mask.
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @returns {Blob[]}
 */
export function blobs(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  /** @type {Blob[]} */
  const out = [];
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let minx = width;
    let miny = height;
    let maxx = -1;
    let maxy = -1;
    let pixels = 0;
    while (sp > 0) {
      const i = /** @type {number} */ (stack[--sp]);
      const x = i % width;
      const y = (i - x) / width;
      pixels++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack[sp++] = j;
          }
        }
      }
    }
    out.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, pixels });
  }
  return out;
}

/**
 * 8-connected components of a mask fed one row at a time (top to bottom), for pages compared in
 * tiles (run.mjs): only the previous row's labels are kept, so a page of any height costs one row
 * of labels plus the components' statistics. `result()` gives the same blobs as `blobs()` over the
 * whole mask (in a different order).
 */
export class BlobStream {
  /** @param {number} width */
  constructor(width) {
    this.width = width;
    this.prev = new Int32Array(width).fill(-1);
    this.cur = new Int32Array(width).fill(-1);
    this.y = 0;
    /** @type {number[]} */
    this.parent = [];
    /** @type {number[][]} minx, miny, maxx, maxy, pixels */
    this.stats = [];
  }

  /** @param {number} a */
  find(a) {
    const p = this.parent;
    while (p[a] !== a) {
      const g = /** @type {number} */ (p[/** @type {number} */ (p[a])]);
      p[a] = g;
      a = g;
    }
    return a;
  }

  /** @param {number} a @param {number} b */
  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return a;
    const sa = /** @type {number[]} */ (this.stats[a]);
    const sb = /** @type {number[]} */ (this.stats[b]);
    sa[0] = Math.min(/** @type {number} */ (sa[0]), /** @type {number} */ (sb[0]));
    sa[1] = Math.min(/** @type {number} */ (sa[1]), /** @type {number} */ (sb[1]));
    sa[2] = Math.max(/** @type {number} */ (sa[2]), /** @type {number} */ (sb[2]));
    sa[3] = Math.max(/** @type {number} */ (sa[3]), /** @type {number} */ (sb[3]));
    sa[4] = /** @type {number} */ (sa[4]) + /** @type {number} */ (sb[4]);
    this.parent[b] = a;
    return a;
  }

  /** One mask row (`width` entries, non-zero = differs). @param {Uint8Array} row */
  row(row) {
    const { width, prev, cur } = this;
    const y = this.y;
    for (let x = 0; x < width; x++) {
      if (!row[x]) {
        cur[x] = -1;
        continue;
      }
      let label = -1;
      const n = [x > 0 ? cur[x - 1] : -1, x > 0 ? prev[x - 1] : -1, prev[x], x + 1 < width ? prev[x + 1] : -1];
      for (const m of n) {
        if (m === undefined || m < 0) continue;
        label = label < 0 ? this.find(m) : this.union(label, m);
      }
      if (label < 0) {
        label = this.parent.length;
        this.parent.push(label);
        this.stats.push([x, y, x, y, 0]);
      }
      cur[x] = label;
      const st = /** @type {number[]} */ (this.stats[this.find(label)]);
      if (x < /** @type {number} */ (st[0])) st[0] = x;
      if (x > /** @type {number} */ (st[2])) st[2] = x;
      if (y > /** @type {number} */ (st[3])) st[3] = y;
      st[4] = /** @type {number} */ (st[4]) + 1;
    }
    this.prev = cur;
    this.cur = prev;
    this.y++;
  }

  /** @returns {Blob[]} */
  result() {
    /** @type {Blob[]} */
    const out = [];
    for (let i = 0; i < this.parent.length; i++) {
      if (this.parent[i] !== i) continue;
      const [minx = 0, miny = 0, maxx = 0, maxy = 0, pixels = 0] = /** @type {number[]} */ (this.stats[i]);
      out.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, pixels });
    }
    return out;
  }
}

/**
 * The §B.3 bar over a diff: `{ pass, fraction, largestBlob, oversized }`.
 * @param {{ count: number, total: number }} d
 * @param {Blob[]} bl
 * @param {number} [scale]
 */
export function bar(d, bl, scale = 1) {
  const limit = maxBlob(scale);
  const oversized = bl.filter((b) => b.pixels > limit);
  const fraction = d.total === 0 ? 0 : d.count / d.total;
  const largestBlob = bl.reduce((m, b) => Math.max(m, b.pixels), 0);
  return {
    pass: fraction < MAX_FRACTION && oversized.length === 0,
    fraction,
    largestBlob,
    oversized: oversized.length,
  };
}

/**
 * Pixels in `rect` (pixel coordinates, clipped) that are not the background (opaque white).
 * @param {Rgba} img
 * @param {{ x: number, y: number, w: number, h: number }} rect
 */
export function inkPixels(img, rect) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * img.width + x) * 4;
      if (img.data[p] !== 255 || img.data[p + 1] !== 255 || img.data[p + 2] !== 255 || img.data[p + 3] !== 255) n++;
    }
  }
  return n;
}

/**
 * A sub-image (clipped), for crops of failing cells.
 * @param {Rgba} img
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @returns {Rgba}
 */
export function crop(img, rect) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < y1 - y0; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    out.set(img.data.subarray(src, src + (x1 - x0) * 4), y * width * 4);
  }
  return { width, height, data: out };
}

/**
 * Images side by side with a 4 px grey separator (C++ | TS | diff).
 * @param {Rgba[]} imgs
 * @returns {Rgba}
 */
export function sideBySide(imgs) {
  const gap = 4;
  const width = imgs.reduce((n, i) => n + i.width, 0) + gap * (imgs.length - 1);
  const height = imgs.reduce((n, i) => Math.max(n, i.height), 0);
  const out = new Uint8Array(width * height * 4).fill(160);
  let x = 0;
  for (const img of imgs) {
    for (let y = 0; y < img.height; y++) {
      out.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), (y * width + x) * 4);
    }
    x += img.width + gap;
  }
  return { width, height, data: out };
}
