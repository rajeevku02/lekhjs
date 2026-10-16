// The draw-string parser (port of C++ `SVGPathParser`, `L/PathParser.{h,cpp}`). An SVG-like
// command string whose arguments are **data indices**, not coordinates: `M 0 1 L 2 3 Z`.
// Commands: M L H V C Q A Z (lowercase = relative), plus E (ellipse) and R (rounded rect).
// Numbers are unsigned integers; one comma may follow a number. An unknown letter is skipped.
// As in C++, a parse error keeps the commands read so far (`ok` is false).
import { isCAlpha, isCDigit, isCSpace } from '../expr/data-expression-parser';
import {
  ArcShape,
  BezierCurveShape,
  CloseCommand,
  EllipseShape,
  HorizontalLineShape,
  LineShape,
  MoveToCommand,
  QuadBezierCurveShape,
  RoundedRectShape,
  VerticalLineShape,
  type PrimitiveShape,
} from './primitive-shape';

export interface ParsedPath {
  readonly shapes: PrimitiveShape[];
  readonly ok: boolean;
}

const ARITY: Readonly<Record<string, number>> = Object.freeze({
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  q: 4,
  a: 6,
  e: 5,
  r: 7,
  z: 0,
});

export class SvgPathParser {
  private str_ = '';
  private i_ = 0;

  parse(dataStr: string): ParsedPath {
    this.str_ = dataStr;
    this.i_ = 0;
    const shapes: PrimitiveShape[] = [];
    let tok = this.next();
    while (tok.kind === 'char') {
      const ch = tok.ch;
      const lower = ch.toLowerCase();
      const arity = ARITY[lower];
      if (arity !== undefined) {
        const args: number[] = [];
        for (let k = 0; k < arity; k++) {
          const t = this.next();
          if (t.kind !== 'number') return { shapes, ok: false };
          args.push(t.n);
        }
        const rel = ch === lower;
        const prev = shapes.at(-1) ?? null;
        const a = (k: number) => args[k] ?? 0;
        switch (lower) {
          case 'm':
            shapes.push(new MoveToCommand(a(0), a(1), rel, prev));
            break;
          case 'z':
            // C++ passes `true` as `relative` for every close.
            shapes.push(new CloseCommand(prev, true));
            break;
          case 'l':
            shapes.push(new LineShape(a(0), a(1), rel, prev));
            break;
          case 'h':
            shapes.push(new HorizontalLineShape(a(0), rel, prev));
            break;
          case 'v':
            shapes.push(new VerticalLineShape(a(0), rel, prev));
            break;
          case 'c':
            shapes.push(new BezierCurveShape(a(0), a(1), a(2), a(3), a(4), a(5), rel, prev));
            break;
          case 'q':
            shapes.push(new QuadBezierCurveShape(a(0), a(1), a(2), a(3), rel, prev));
            break;
          case 'a':
            shapes.push(new ArcShape(a(0), a(1), a(2), a(3), a(4), a(5), rel, prev));
            break;
          case 'e':
            shapes.push(new EllipseShape(a(0), a(1), a(2), a(3), a(4)));
            break;
          case 'r':
            shapes.push(new RoundedRectShape(a(0), a(1), a(2), a(3), a(4), a(5), a(6)));
            break;
        }
      }
      tok = this.next();
    }
    return { shapes, ok: tok.kind === 'end' };
  }

  private next(): { kind: 'char'; ch: string } | { kind: 'number'; n: number } | { kind: 'error' } | { kind: 'end' } {
    const s = this.str_;
    while (this.i_ < s.length && isCSpace(s[this.i_])) this.i_++;
    if (this.i_ >= s.length) return { kind: 'end' };
    const c = s[this.i_] ?? '';
    if (isCAlpha(c)) {
      this.i_++;
      return { kind: 'char', ch: c };
    }
    if (isCDigit(c)) {
      const start = this.i_;
      while (this.i_ < s.length && isCDigit(s[this.i_])) this.i_++;
      const n = Number.parseInt(s.slice(start, this.i_), 10);
      while (this.i_ < s.length && isCSpace(s[this.i_])) this.i_++;
      if (this.i_ < s.length && s[this.i_] === ',') this.i_++;
      return { kind: 'number', n };
    }
    return { kind: 'error' };
  }
}
