// The streaming PNG encoder of banded raster export (spec 08 §3 `BandEncoder`, §5.2): 8-bit RGBA
// (colour type 6), no interlace, every row with filter 0, compressed through `pako`'s streaming
// `Deflate`. Rows arrive band by band; each `take()` returns the bytes produced so far (IDAT
// chunks), so a file is never held whole. State: the deflate window plus its output buffer.
import { Deflate } from 'pako';
import { ByteBuffer } from '../bytes';

const SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

export class PngStreamEncoder {
  readonly width: number;
  readonly height: number;
  private readonly out_ = new ByteBuffer(1 << 16);
  private readonly crc_ = crcTable();
  private readonly deflate_: Deflate;
  private rows_ = 0;
  private finished_ = false;
  private row_: Uint8Array;

  constructor(width: number, height: number, opts: { level?: number } = {}) {
    if (!(width >= 1 && height >= 1)) throw new RangeError('png: empty image');
    this.width = width;
    this.height = height;
    this.row_ = new Uint8Array(1 + width * 4);
    this.deflate_ = new Deflate({ level: opts.level ?? 6, chunkSize: 1 << 16 });
    this.deflate_.onData = (chunk: Uint8Array) => {
      this.chunk('IDAT', chunk);
    };
    for (const b of SIGNATURE) this.out_.byte(b);
    const ihdr = new ByteBuffer(13);
    ihdr.u32(width);
    ihdr.u32(height);
    ihdr.byte(8); // bit depth
    ihdr.byte(6); // RGBA
    ihdr.byte(0);
    ihdr.byte(0);
    ihdr.byte(0);
    this.chunk('IHDR', ihdr.take());
  }

  /** Rows written so far. */
  get rows(): number {
    return this.rows_;
  }

  /** Appends `rows` rows of un-premultiplied RGBA (`width × 4` bytes each). */
  pushRows(rgba: Uint8Array | Uint8ClampedArray, rows: number): void {
    if (this.finished_) throw new Error('png: finished');
    if (this.rows_ + rows > this.height) throw new RangeError('png: too many rows');
    const stride = this.width * 4;
    const row = this.row_;
    for (let y = 0; y < rows; y++) {
      row[0] = 0; // filter: none
      row.set(rgba.subarray(y * stride, (y + 1) * stride), 1);
      this.deflate_.push(row, false);
    }
    this.rows_ += rows;
  }

  /** Ends the stream (missing rows are an error) and writes IEND. */
  finish(): void {
    if (this.finished_) return;
    if (this.rows_ !== this.height) throw new Error('png: missing rows');
    this.deflate_.push(new Uint8Array(0), true);
    if (this.deflate_.err !== 0) throw new Error('png: deflate failed');
    this.chunk('IEND', new Uint8Array(0));
    this.finished_ = true;
  }

  /** The bytes produced since the last `take`. */
  take(): Uint8Array {
    return this.out_.take();
  }

  private chunk(type: string, data: Uint8Array): void {
    const out = this.out_;
    out.u32(data.length);
    let crc = 0xffffffff;
    const t = this.crc_;
    for (let i = 0; i < 4; i++) {
      const b = type.charCodeAt(i);
      out.byte(b);
      crc = (t[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    out.bytes(data);
    for (const b of data) crc = (t[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
    out.u32((crc ^ 0xffffffff) >>> 0);
  }
}
