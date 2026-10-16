// Paragraph base direction (spec 06 §3.5, DR-TXT-09): the first strong character of the
// paragraph decides (UAX #9 rules P2-P3): L → ltr; R or AL → rtl; none → ltr. iOS (TextKit
// natural direction) and Android (FIRSTSTRONG_LTR) already do this; the web and backend drew
// every paragraph ltr.
import { bidiStrongType } from './unicode';

export type TextDirection = 'ltr' | 'rtl';

export function paragraphDirection(paragraph: string): TextDirection {
  for (let i = 0; i < paragraph.length;) {
    const cp = paragraph.codePointAt(i) ?? 0;
    const t = bidiStrongType(cp);
    if (t === 1) return 'ltr';
    if (t === 2) return 'rtl';
    i += cp > 0xffff ? 2 : 1;
  }
  return 'ltr';
}
