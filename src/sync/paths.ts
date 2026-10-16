// Small helpers over the dotted `changes` keys and frame text (ports of `UpdateHandler::split`).

/**
 * C++ `UpdateHandler::split(str, ".")`: the non-empty tokens between dots (so `a..b` is `[a, b]`
 * and a leading or trailing dot adds nothing).
 */
export function splitKey(key: string): string[] {
  return key.split('.').filter((t) => t !== '');
}

/** The UTF-8 byte length of `s` (the frame-size cap of spec 04 §9.4 counts bytes). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else {
      n += 3;
    }
  }
  return n;
}
