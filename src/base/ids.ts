// Short ids (port of C++ `BaseUtil::shortIdFromUuid`). The canonical statement of the format is
// the knowledge base: the document-model page, "Page and object identity".

/** The flickrBase58 alphabet: digit value = index. It has no `.`, `$` or NUL. */
export const FLICKR_BASE58 = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

/** Length of a short id: 128 bits in base 58, left-padded with `1` (digit zero). */
export const SHORT_ID_LENGTH = 22;

function hexValue(c: number): number {
  if (c >= 48 && c <= 57) return c - 48; // 0-9
  if (c >= 97 && c <= 102) return c - 87; // a-f
  if (c >= 65 && c <= 70) return c - 55; // A-F
  return -1;
}

/**
 * The short id of a UUID: its 128 bits written in flickrBase58, most significant digit first,
 * left-padded with `1` to exactly 22 characters.
 *
 * Hex is read case-insensitively and every `-` is ignored. Input that is not exactly 32 hex
 * digits once `-` is removed is returned unchanged. Ids are case-sensitive: never case-fold one.
 */
export function shortIdFromUuid(uuid: string): string {
  const bytes = new Uint8Array(16);
  let nibbles = 0;
  for (let i = 0; i < uuid.length; i++) {
    const c = uuid.charCodeAt(i);
    if (c === 45) continue; // '-'
    const v = hexValue(c);
    if (v < 0 || nibbles >= 32) return uuid;
    bytes[nibbles >> 1] = (bytes[nibbles >> 1] ?? 0) | (nibbles % 2 === 0 ? v << 4 : v);
    nibbles++;
  }
  if (nibbles !== 32) return uuid;

  // Repeated long division of the 128-bit value by 58; the remainders are the digits,
  // least significant first.
  const out: string[] = [];
  for (;;) {
    let zero = true;
    for (const b of bytes) {
      if (b !== 0) {
        zero = false;
        break;
      }
    }
    if (zero) break;
    let rem = 0;
    for (let i = 0; i < 16; i++) {
      const cur = (rem << 8) | (bytes[i] ?? 0);
      bytes[i] = Math.floor(cur / 58);
      rem = cur % 58;
    }
    out.push(FLICKR_BASE58.charAt(rem));
  }
  while (out.length < SHORT_ID_LENGTH) out.push(FLICKR_BASE58.charAt(0));
  return out.reverse().join('');
}
