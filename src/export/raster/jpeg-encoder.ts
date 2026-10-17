// The streaming baseline JPEG encoder of banded raster export (spec 08 §3 `BandEncoder`, §5.2):
// quality 100 (OQ-56), YCbCr 4:4:4 (one 8×8 block per component per MCU), the standard Huffman
// tables, JFIF. Rows arrive band by band, a multiple of 8 rows at a time except the last push;
// partial blocks at the right and bottom edges repeat the last column and row. Each `take()`
// returns the entropy-coded bytes so far, so the file is never held whole; the state is one strip
// of blocks and the bit writer.
//
// The arithmetic (colour conversion table, AAN float DCT, rounding) follows the Adobe AS3 encoder
// that `jpeg-js` ports, so for the same pixels the output is byte-identical to
// `jpeg-js.encode(image, quality)`, the test oracle. `jpeg-js` itself cannot be used for export: its
// `encode()` takes the whole RGBA buffer.
import { ByteBuffer } from '../bytes';

const ZIGZAG = Object.freeze([
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57,
  58, 62, 63,
]);

const YQT = Object.freeze([
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
  87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
]);

const UVQT = Object.freeze([
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99,
]);

const AASF = Object.freeze([1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379]);

const DC_LUM_NR = Object.freeze([0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
const DC_LUM_VAL = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const AC_LUM_NR = Object.freeze([0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]);
const AC_LUM_VAL = Object.freeze([
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14,
  0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09,
  0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a,
  0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65,
  0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88,
  0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9,
  0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
  0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
  0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
]);
const DC_CHR_NR = Object.freeze([0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
const DC_CHR_VAL = DC_LUM_VAL;
const AC_CHR_NR = Object.freeze([0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]);
const AC_CHR_VAL = Object.freeze([
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32,
  0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16,
  0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64,
  0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86,
  0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8,
  0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
  0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
]);

/** A Huffman table: code and length per symbol. */
interface Huffman {
  readonly code: Int32Array;
  readonly len: Int32Array;
}

function huffman(nr: readonly number[], values: readonly number[]): Huffman {
  const code = new Int32Array(256);
  const len = new Int32Array(256);
  let cv = 0;
  let pos = 0;
  for (let k = 1; k <= 16; k++) {
    for (let j = 1; j <= (nr[k] ?? 0); j++) {
      const sym = values[pos] ?? 0;
      code[sym] = cv;
      len[sym] = k;
      pos++;
      cv++;
    }
    cv *= 2;
  }
  return { code, len };
}

/** The AS3 encoder's scale factor for a quality (1-100). */
function scaleFactor(quality: number): number {
  const q = quality <= 0 ? 1 : quality > 100 ? 100 : quality;
  return q < 50 ? Math.floor(5000 / q) : Math.floor(200 - q * 2);
}

export class JpegStreamEncoder {
  readonly width: number;
  readonly height: number;
  private readonly out_ = new ByteBuffer(1 << 16);
  private readonly yTable_ = new Int32Array(64);
  private readonly uvTable_ = new Int32Array(64);
  private readonly fdY_ = new Float64Array(64);
  private readonly fdUV_ = new Float64Array(64);
  private readonly yDC_ = huffman(DC_LUM_NR, DC_LUM_VAL);
  private readonly uvDC_ = huffman(DC_CHR_NR, DC_CHR_VAL);
  private readonly yAC_ = huffman(AC_LUM_NR, AC_LUM_VAL);
  private readonly uvAC_ = huffman(AC_CHR_NR, AC_CHR_VAL);
  private readonly rgbYuv_ = new Int32Array(2048);
  private readonly ydu_ = new Float64Array(64);
  private readonly udu_ = new Float64Array(64);
  private readonly vdu_ = new Float64Array(64);
  private readonly du_ = new Int32Array(64);
  private readonly quant_ = new Int32Array(64);
  private dcY_ = 0;
  private dcU_ = 0;
  private dcV_ = 0;
  private bytenew_ = 0;
  private bytepos_ = 7;
  private rows_ = 0;
  /** Rows held back until a full 8-row strip (or the end) is there. */
  private pending_: Uint8Array;
  private pendingRows_ = 0;
  private finished_ = false;

  constructor(width: number, height: number, quality = 100) {
    if (!(width >= 1 && height >= 1 && width < 65536 && height < 65536)) throw new RangeError('jpeg: bad size');
    this.width = width;
    this.height = height;
    this.pending_ = new Uint8Array(width * 4 * 8);
    this.initQuant(scaleFactor(quality));
    for (let i = 0; i < 256; i++) {
      const t = this.rgbYuv_;
      t[i] = 19595 * i;
      t[i + 256] = 38470 * i;
      t[i + 512] = 7471 * i + 0x8000;
      t[i + 768] = -11059 * i;
      t[i + 1024] = -21709 * i;
      t[i + 1280] = 32768 * i + 0x807fff;
      t[i + 1536] = -27439 * i;
      t[i + 1792] = -5329 * i;
    }
    this.writeHeaders();
  }

  get rows(): number {
    return this.rows_;
  }

  /**
   * Appends `rows` rows of RGBA (alpha ignored: export fills JPEG bands white first). Any count is
   * accepted; full 8-row strips are coded at once and the rest waits for the next push.
   */
  pushRows(rgba: Uint8Array | Uint8ClampedArray, rows: number): void {
    if (this.finished_) throw new Error('jpeg: finished');
    if (this.rows_ + this.pendingRows_ + rows > this.height) throw new RangeError('jpeg: too many rows');
    const stride = this.width * 4;
    let y = 0;
    if (this.pendingRows_ > 0) {
      const take = Math.min(8 - this.pendingRows_, rows);
      this.pending_.set(rgba.subarray(0, take * stride), this.pendingRows_ * stride);
      this.pendingRows_ += take;
      y = take;
      if (this.pendingRows_ === 8) {
        this.strip(this.pending_, 0, 8);
        this.pendingRows_ = 0;
      }
    }
    while (rows - y >= 8) {
      this.strip(rgba, y * stride, 8);
      y += 8;
    }
    if (y < rows) {
      this.pending_.set(rgba.subarray(y * stride, rows * stride), 0);
      this.pendingRows_ = rows - y;
    }
  }

  /** Codes the last partial strip, pads the bit stream and writes EOI. */
  finish(): void {
    if (this.finished_) return;
    if (this.pendingRows_ > 0) {
      this.strip(this.pending_, 0, this.pendingRows_);
      this.pendingRows_ = 0;
    }
    if (this.rows_ !== this.height) throw new Error('jpeg: missing rows');
    if (this.bytepos_ >= 0) this.writeBits((1 << (this.bytepos_ + 1)) - 1, this.bytepos_ + 1);
    this.out_.word(0xffd9);
    this.finished_ = true;
  }

  /** The bytes produced since the last `take`. */
  take(): Uint8Array {
    return this.out_.take();
  }

  // ---- setup ----

  private initQuant(sf: number): void {
    for (let i = 0; i < 64; i++) {
      let t = Math.floor(((YQT[i] ?? 0) * sf + 50) / 100);
      t = t < 1 ? 1 : t > 255 ? 255 : t;
      this.yTable_[ZIGZAG[i] ?? 0] = t;
      let u = Math.floor(((UVQT[i] ?? 0) * sf + 50) / 100);
      u = u < 1 ? 1 : u > 255 ? 255 : u;
      this.uvTable_[ZIGZAG[i] ?? 0] = u;
    }
    let k = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const a = (AASF[row] ?? 1) * (AASF[col] ?? 1) * 8.0;
        this.fdY_[k] = 1.0 / ((this.yTable_[ZIGZAG[k] ?? 0] ?? 1) * a);
        this.fdUV_[k] = 1.0 / ((this.uvTable_[ZIGZAG[k] ?? 0] ?? 1) * a);
        k++;
      }
    }
  }

  private writeHeaders(): void {
    const o = this.out_;
    o.word(0xffd8); // SOI
    // APP0 JFIF 1.1, no units, 1:1
    o.word(0xffe0);
    o.word(16);
    for (const b of [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]) o.byte(b);
    o.word(1);
    o.word(1);
    o.byte(0);
    o.byte(0);
    // DQT
    o.word(0xffdb);
    o.word(132);
    o.byte(0);
    for (let i = 0; i < 64; i++) o.byte(this.yTable_[i] ?? 1);
    o.byte(1);
    for (let i = 0; i < 64; i++) o.byte(this.uvTable_[i] ?? 1);
    // SOF0
    o.word(0xffc0);
    o.word(17);
    o.byte(8);
    o.word(this.height);
    o.word(this.width);
    o.byte(3);
    for (const b of [1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]) o.byte(b);
    // DHT
    o.word(0xffc4);
    o.word(0x01a2);
    const table = (cls: number, nr: readonly number[], vals: readonly number[], count: number): void => {
      o.byte(cls);
      for (let i = 0; i < 16; i++) o.byte(nr[i + 1] ?? 0);
      for (let i = 0; i < count; i++) o.byte(vals[i] ?? 0);
    };
    table(0, DC_LUM_NR, DC_LUM_VAL, 12);
    table(0x10, AC_LUM_NR, AC_LUM_VAL, 162);
    table(1, DC_CHR_NR, DC_CHR_VAL, 12);
    table(0x11, AC_CHR_NR, AC_CHR_VAL, 162);
    // SOS
    o.word(0xffda);
    o.word(12);
    for (const b of [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]) o.byte(b);
  }

  // ---- coding ----

  /** Codes one strip of up to 8 rows starting at `off` in `rgba` (bottom rows repeat the last). */
  private strip(rgba: Uint8Array | Uint8ClampedArray, off: number, rows: number): void {
    const w = this.width;
    const stride = w * 4;
    const t = this.rgbYuv_;
    const ydu = this.ydu_;
    const udu = this.udu_;
    const vdu = this.vdu_;
    for (let x = 0; x < w; x += 8) {
      for (let pos = 0; pos < 64; pos++) {
        const row = Math.min(pos >> 3, rows - 1);
        const col = Math.min(x + (pos & 7), w - 1);
        const p = off + row * stride + col * 4;
        const r = rgba[p] ?? 0;
        const g = rgba[p + 1] ?? 0;
        const b = rgba[p + 2] ?? 0;
        ydu[pos] = (((t[r] ?? 0) + (t[g + 256] ?? 0) + (t[b + 512] ?? 0)) >> 16) - 128;
        udu[pos] = (((t[r + 768] ?? 0) + (t[g + 1024] ?? 0) + (t[b + 1280] ?? 0)) >> 16) - 128;
        vdu[pos] = (((t[r + 1280] ?? 0) + (t[g + 1536] ?? 0) + (t[b + 1792] ?? 0)) >> 16) - 128;
      }
      this.dcY_ = this.processDU(ydu, this.fdY_, this.dcY_, this.yDC_, this.yAC_);
      this.dcU_ = this.processDU(udu, this.fdUV_, this.dcU_, this.uvDC_, this.uvAC_);
      this.dcV_ = this.processDU(vdu, this.fdUV_, this.dcV_, this.uvDC_, this.uvAC_);
    }
    this.rows_ += rows;
  }

  private writeBits(value: number, length: number): void {
    let posval = length - 1;
    while (posval >= 0) {
      if (value & (1 << posval)) this.bytenew_ |= 1 << this.bytepos_;
      posval--;
      this.bytepos_--;
      if (this.bytepos_ < 0) {
        if (this.bytenew_ === 0xff) {
          this.out_.byte(0xff);
          this.out_.byte(0);
        } else this.out_.byte(this.bytenew_);
        this.bytepos_ = 7;
        this.bytenew_ = 0;
      }
    }
  }

  /** `category` and `bitcode` of the AS3 encoder, computed. */
  private writeValue(v: number): void {
    const a = v < 0 ? -v : v;
    let cat = 0;
    while (a >> cat !== 0) cat++;
    const bits = v < 0 ? v + (1 << cat) - 1 : v;
    this.writeBits(bits, cat);
  }

  private static category(v: number): number {
    const a = v < 0 ? -v : v;
    let cat = 0;
    while (a >> cat !== 0) cat++;
    return cat;
  }

  private processDU(cdu: Float64Array, fdtbl: Float64Array, dcIn: number, htdc: Huffman, htac: Huffman): number {
    const q = this.fdct(cdu, fdtbl);
    const du = this.du_;
    for (let j = 0; j < 64; j++) du[ZIGZAG[j] ?? 0] = q[j] ?? 0;
    const d0 = du[0] ?? 0;
    const diff = d0 - dcIn;
    if (diff === 0) this.writeBits(htdc.code[0] ?? 0, htdc.len[0] ?? 0);
    else {
      const cat = JpegStreamEncoder.category(diff);
      this.writeBits(htdc.code[cat] ?? 0, htdc.len[cat] ?? 0);
      this.writeValue(diff);
    }
    let end0 = 63;
    while (end0 > 0 && du[end0] === 0) end0--;
    if (end0 === 0) {
      this.writeBits(htac.code[0] ?? 0, htac.len[0] ?? 0);
      return d0;
    }
    let i = 1;
    while (i <= end0) {
      const start = i;
      while (du[i] === 0 && i <= end0) i++;
      let zeros = i - start;
      if (zeros >= 16) {
        const n = zeros >> 4;
        for (let m = 1; m <= n; m++) this.writeBits(htac.code[0xf0] ?? 0, htac.len[0xf0] ?? 0);
        zeros &= 0xf;
      }
      const v = du[i] ?? 0;
      const sym = (zeros << 4) + JpegStreamEncoder.category(v);
      this.writeBits(htac.code[sym] ?? 0, htac.len[sym] ?? 0);
      this.writeValue(v);
      i++;
    }
    if (end0 !== 63) this.writeBits(htac.code[0] ?? 0, htac.len[0] ?? 0);
    return d0;
  }

  /** AAN forward DCT and quantization (the AS3 encoder's `fDCTQuant`), in place on `data`. */
  private fdct(data: Float64Array, fdtbl: Float64Array): Int32Array {
    let off = 0;
    for (let i = 0; i < 8; i++) {
      const d0 = data[off] ?? 0;
      const d1 = data[off + 1] ?? 0;
      const d2 = data[off + 2] ?? 0;
      const d3 = data[off + 3] ?? 0;
      const d4 = data[off + 4] ?? 0;
      const d5 = data[off + 5] ?? 0;
      const d6 = data[off + 6] ?? 0;
      const d7 = data[off + 7] ?? 0;
      const tmp0 = d0 + d7;
      const tmp7 = d0 - d7;
      const tmp1 = d1 + d6;
      const tmp6 = d1 - d6;
      const tmp2 = d2 + d5;
      const tmp5 = d2 - d5;
      const tmp3 = d3 + d4;
      const tmp4 = d3 - d4;
      let tmp10 = tmp0 + tmp3;
      const tmp13 = tmp0 - tmp3;
      let tmp11 = tmp1 + tmp2;
      let tmp12 = tmp1 - tmp2;
      data[off] = tmp10 + tmp11;
      data[off + 4] = tmp10 - tmp11;
      const z1 = (tmp12 + tmp13) * 0.707106781;
      data[off + 2] = tmp13 + z1;
      data[off + 6] = tmp13 - z1;
      tmp10 = tmp4 + tmp5;
      tmp11 = tmp5 + tmp6;
      tmp12 = tmp6 + tmp7;
      const z5 = (tmp10 - tmp12) * 0.382683433;
      const z2 = 0.5411961 * tmp10 + z5;
      const z4 = 1.306562965 * tmp12 + z5;
      const z3 = tmp11 * 0.707106781;
      const z11 = tmp7 + z3;
      const z13 = tmp7 - z3;
      data[off + 5] = z13 + z2;
      data[off + 3] = z13 - z2;
      data[off + 1] = z11 + z4;
      data[off + 7] = z11 - z4;
      off += 8;
    }
    off = 0;
    for (let i = 0; i < 8; i++) {
      const d0 = data[off] ?? 0;
      const d1 = data[off + 8] ?? 0;
      const d2 = data[off + 16] ?? 0;
      const d3 = data[off + 24] ?? 0;
      const d4 = data[off + 32] ?? 0;
      const d5 = data[off + 40] ?? 0;
      const d6 = data[off + 48] ?? 0;
      const d7 = data[off + 56] ?? 0;
      const tmp0 = d0 + d7;
      const tmp7 = d0 - d7;
      const tmp1 = d1 + d6;
      const tmp6 = d1 - d6;
      const tmp2 = d2 + d5;
      const tmp5 = d2 - d5;
      const tmp3 = d3 + d4;
      const tmp4 = d3 - d4;
      let tmp10 = tmp0 + tmp3;
      const tmp13 = tmp0 - tmp3;
      let tmp11 = tmp1 + tmp2;
      let tmp12 = tmp1 - tmp2;
      data[off] = tmp10 + tmp11;
      data[off + 32] = tmp10 - tmp11;
      const z1 = (tmp12 + tmp13) * 0.707106781;
      data[off + 16] = tmp13 + z1;
      data[off + 48] = tmp13 - z1;
      tmp10 = tmp4 + tmp5;
      tmp11 = tmp5 + tmp6;
      tmp12 = tmp6 + tmp7;
      const z5 = (tmp10 - tmp12) * 0.382683433;
      const z2 = 0.5411961 * tmp10 + z5;
      const z4 = 1.306562965 * tmp12 + z5;
      const z3 = tmp11 * 0.707106781;
      const z11 = tmp7 + z3;
      const z13 = tmp7 - z3;
      data[off + 40] = z13 + z2;
      data[off + 24] = z13 - z2;
      data[off + 8] = z11 + z4;
      data[off + 56] = z11 - z4;
      off++;
    }
    const out = this.quant_;
    for (let i = 0; i < 64; i++) {
      const v = (data[i] ?? 0) * (fdtbl[i] ?? 0);
      out[i] = v > 0.0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
    }
    return out;
  }
}
