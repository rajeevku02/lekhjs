// Byte helpers for export, without `TextEncoder`, `btoa` or `Buffer` (no ambient globals): UTF-8
// and base64 encoding, and a growable byte buffer the encoders write into and the job drains.

/** UTF-8 bytes of `s` (lone surrogates become U+FFFD, as `TextEncoder` does). */
export function utf8Bytes(s: string): Uint8Array {
  const out = new ByteBuffer(s.length + 16);
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.byte(c);
    else if (c < 0x800) {
      out.byte(0xc0 | (c >> 6));
      out.byte(0x80 | (c & 63));
    } else if (c < 0x10000) {
      out.byte(0xe0 | (c >> 12));
      out.byte(0x80 | ((c >> 6) & 63));
      out.byte(0x80 | (c & 63));
    } else {
      out.byte(0xf0 | (c >> 18));
      out.byte(0x80 | ((c >> 12) & 63));
      out.byte(0x80 | ((c >> 6) & 63));
      out.byte(0x80 | (c & 63));
    }
  }
  return out.take();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding. */
export function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let line = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    line += B64.charAt(v >> 18) + B64.charAt((v >> 12) & 63) + B64.charAt((v >> 6) & 63) + B64.charAt(v & 63);
    if (line.length >= 8192) {
      parts.push(line);
      line = '';
    }
  }
  if (i < n) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < n ? (bytes[i + 1] ?? 0) : 0;
    const v = (a << 16) | (b << 8);
    line += B64.charAt(v >> 18) + B64.charAt((v >> 12) & 63);
    line += i + 1 < n ? B64.charAt((v >> 6) & 63) + '=' : '==';
  }
  parts.push(line);
  return parts.join('');
}

/** A growable byte buffer: encoders append, the caller `take()`s what is there and it empties. */
export class ByteBuffer {
  private buf_: Uint8Array;
  private len_ = 0;

  constructor(capacity = 4096) {
    this.buf_ = new Uint8Array(Math.max(16, capacity));
  }

  get length(): number {
    return this.len_;
  }

  private grow(extra: number): void {
    const need = this.len_ + extra;
    if (need <= this.buf_.length) return;
    let cap = this.buf_.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf_.subarray(0, this.len_));
    this.buf_ = next;
  }

  byte(v: number): void {
    if (this.len_ === this.buf_.length) this.grow(1);
    this.buf_[this.len_++] = v & 0xff;
  }

  word(v: number): void {
    this.byte(v >> 8);
    this.byte(v);
  }

  u32(v: number): void {
    this.byte(v >>> 24);
    this.byte(v >>> 16);
    this.byte(v >>> 8);
    this.byte(v);
  }

  bytes(b: Uint8Array): void {
    this.grow(b.length);
    this.buf_.set(b, this.len_);
    this.len_ += b.length;
  }

  /** The bytes written since the last `take`, as a copy; the buffer is emptied. */
  take(): Uint8Array {
    const out = this.buf_.slice(0, this.len_);
    this.len_ = 0;
    return out;
  }
}
