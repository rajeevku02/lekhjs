// The DataExpression parser (port of C++ `DataExpressionParser`, `L/DataExpression.cpp`). A
// recursive descent over `+ - * /`, parentheses, numbers, names and calls, with the C++ quirks
// reproduced exactly (spec 04 §2, AC-GEN-01):
//   - an unknown name evaluates to 0 (`VariableAccessExpression`);
//   - `compile` ignores trailing text ("w h" is `w`);
//   - unary minus only at the start of an expression, a parenthesis or an argument (`w*-0.5`
//     does not parse);
//   - a name is a letter followed by letters and digits;
//   - `f()` does not parse; extra call arguments are kept and ignored by evaluation.
// An expression that does not parse compiles to `null`; the template evaluates it to 0 and warns
// `expression_invalid` (DR-GEN-01; C++ dereferenced the null).
import {
  BinaryExpression,
  BinaryOperator,
  FunctionCallExpression,
  PrimitiveExpression,
  VariableAccessExpression,
  type Expression,
} from './expression';

const TokenType = Object.freeze({
  Number: 0,
  Operator: 1,
  Id: 2,
  OpenBracket: 3,
  CloseBracket: 4,
  Comma: 5,
  Error: 6,
  End: 7,
} as const);
type TokenType = (typeof TokenType)[keyof typeof TokenType];

/** C `isspace` in the C locale. */
export function isCSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\v' || ch === '\f' || ch === '\r';
}
export function isCDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}
export function isCAlpha(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'));
}

/** C `atof` of a number token: the longest numeric prefix, 0 when there is none. */
function atof(s: string): number {
  const v = Number.parseFloat(s);
  return Number.isNaN(v) ? 0 : v;
}

/** A stored list value of `parseIntStrList`: an integer or a name. */
export type IntOrName = number | string;

export class DataExpressionParser {
  private curIndex_ = 0;
  private dataStr_ = '';
  private type_: TokenType = TokenType.End;
  private value_ = 0;
  private var_ = '';
  private op_: BinaryOperator = BinaryOperator.Add;

  /** The expression at the start of `str`, ignoring trailing text; `null` when none parses. */
  compile(str: string): Expression | null {
    this.curIndex_ = 0;
    this.dataStr_ = str;
    return this.parseExp(null, BinaryOperator.Add);
  }

  /** `compile`, but `null` unless the whole string was consumed. */
  compileAll(str: string): Expression | null {
    const exp = this.compile(str);
    if (exp === null) return null;
    this.nextToken();
    return this.tok() === TokenType.End ? exp : null;
  }

  /**
   * A whitespace-separated list of non-negative integers (C++ `parseList`, a `stringstream >> int`
   * loop). Reading stops at the end, at a negative number, or after a token that is not an
   * integer, which C++ stored as 0 (`"1 x"` → `[1, 0]`, `"1.5"` → `[1, 0]`).
   */
  static parseList(str: string): number[] {
    const list: number[] = [];
    let i = 0;
    for (;;) {
      while (i < str.length && isCSpace(str[i])) i++;
      if (i >= str.length) break;
      let j = i;
      if (str[j] === '+' || str[j] === '-') j++;
      const digitsStart = j;
      while (j < str.length && isCDigit(str[j])) j++;
      if (j === digitsStart) {
        // Failed extraction: C++11 writes 0 into the value, which is not negative.
        list.push(0);
        break;
      }
      // `+ 0` turns `-0` into 0: an int has no negative zero.
      const n = Number.parseInt(str.slice(i, j), 10) + 0;
      if (n < 0) break;
      list.push(n);
      i = j;
    }
    return list;
  }

  /** C++ `parseList` as a member, for call sites that hold a parser. */
  parseList(str: string): number[] {
    return DataExpressionParser.parseList(str);
  }

  /**
   * Numbers (truncated to integers) and names, separated by spaces (C++ `parseIntStrList`, the
   * point-attribute form). `null` when any other token appears.
   */
  parseIntStrList(listStr: string): IntOrName[] | null {
    this.curIndex_ = 0;
    this.dataStr_ = listStr;
    const list: IntOrName[] = [];
    this.nextToken();
    while (this.tok() !== TokenType.End) {
      if (this.tok() === TokenType.Number) list.push(Math.trunc(this.value_));
      else if (this.tok() === TokenType.Id) list.push(this.var_);
      else return null;
      this.nextToken();
    }
    return list;
  }

  /** The current token type (a call, so control-flow narrowing does not outlive `nextToken`). */
  private tok(): TokenType {
    return this.type_;
  }

  private parseExp(prevIn: Expression | null, popIn: BinaryOperator): Expression | null {
    let prev = prevIn;
    let pop = popIn;
    if (prev === null) {
      const tmp = this.curIndex_;
      this.nextToken();
      if (this.tok() === TokenType.Operator && this.op_ === BinaryOperator.Subtract) {
        prev = new PrimitiveExpression(0);
        pop = BinaryOperator.Subtract;
      } else {
        this.curIndex_ = tmp;
      }
    }

    let exp = this.parseMExp(null, BinaryOperator.Multiply);
    if (exp === null) return null;
    if (prev !== null) exp = new BinaryExpression(prev, exp, pop);

    const tmp = this.curIndex_;
    this.nextToken();
    if (this.tok() === TokenType.End) return exp;
    if (
      this.tok() !== TokenType.Operator ||
      (this.op_ !== BinaryOperator.Add && this.op_ !== BinaryOperator.Subtract)
    ) {
      this.curIndex_ = tmp;
      return exp;
    }
    return this.parseExp(exp, this.op_);
  }

  private parseMExp(prev: Expression | null, pop: BinaryOperator): Expression | null {
    let exp = this.parsePExp();
    if (exp === null) return null;
    if (prev !== null) exp = new BinaryExpression(prev, exp, pop);

    const tmpIndex = this.curIndex_;
    this.nextToken();
    if (this.tok() !== TokenType.Operator) {
      this.curIndex_ = tmpIndex;
      return exp;
    }
    const op = this.op_;
    if (op === BinaryOperator.Multiply || op === BinaryOperator.Divide) return this.parseMExp(exp, op);
    this.curIndex_ = tmpIndex;
    return exp;
  }

  private parsePExp(): Expression | null {
    this.nextToken();
    if (this.tok() === TokenType.End || this.tok() === TokenType.Error) return null;
    if (this.tok() === TokenType.Number) return new PrimitiveExpression(this.value_);
    if (this.tok() === TokenType.OpenBracket) {
      const e = this.parseExp(null, BinaryOperator.Add);
      if (e === null) return null;
      this.nextToken();
      return this.tok() === TokenType.CloseBracket ? e : null;
    }
    if (this.tok() === TokenType.Id) {
      const name = this.var_;
      const tmp = this.curIndex_;
      this.nextToken();
      if (this.tok() !== TokenType.OpenBracket) {
        this.curIndex_ = tmp;
        return new VariableAccessExpression(name);
      }
      const params: Expression[] = [];
      let e = this.parseExp(null, BinaryOperator.Add);
      if (e === null) return null;
      params.push(e);
      for (;;) {
        this.nextToken();
        if (this.tok() === TokenType.CloseBracket) return new FunctionCallExpression(name, params);
        if (this.tok() !== TokenType.Comma) return null;
        e = this.parseExp(null, BinaryOperator.Add);
        if (e === null) return null;
        params.push(e);
      }
    }
    return null;
  }

  private nextToken(): void {
    const s = this.dataStr_;
    while (this.curIndex_ < s.length && isCSpace(s[this.curIndex_])) this.curIndex_++;
    if (this.curIndex_ >= s.length) {
      this.type_ = TokenType.End;
      return;
    }
    const c = s[this.curIndex_];
    if (isCDigit(c) || c === '.') {
      let str = c ?? '';
      let dotFound = false;
      let eFound = false;
      this.curIndex_++;
      while (this.curIndex_ < s.length) {
        const ch = s[this.curIndex_];
        if (!(isCDigit(ch) || ch === '.' || ch === 'e' || ch === 'E' || ch === '+' || ch === '-')) break;
        if (ch === 'e' || ch === 'E') {
          if (eFound) break;
          eFound = true;
        }
        if (ch === '.') {
          // C++ quirk: the leading '.' does not set `dotFound`, so ".5.5" is one token, read
          // by `atof` as 0.5.
          if (dotFound || eFound) break;
          dotFound = true;
        }
        if (ch === '+' || ch === '-') {
          if ((s[this.curIndex_ - 1] ?? '').toLowerCase() !== 'e') break;
        }
        str += ch ?? '';
        this.curIndex_++;
      }
      this.value_ = atof(str);
      this.type_ = TokenType.Number;
      return;
    }
    if (isCAlpha(c)) {
      let str = '';
      while (this.curIndex_ < s.length && (isCAlpha(s[this.curIndex_]) || isCDigit(s[this.curIndex_]))) {
        str += s[this.curIndex_] ?? '';
        this.curIndex_++;
      }
      this.type_ = TokenType.Id;
      this.var_ = str;
      return;
    }
    this.curIndex_++;
    switch (c) {
      case '(':
        this.type_ = TokenType.OpenBracket;
        return;
      case ')':
        this.type_ = TokenType.CloseBracket;
        return;
      case '+':
        this.type_ = TokenType.Operator;
        this.op_ = BinaryOperator.Add;
        return;
      case '-':
        this.type_ = TokenType.Operator;
        this.op_ = BinaryOperator.Subtract;
        return;
      case '*':
        this.type_ = TokenType.Operator;
        this.op_ = BinaryOperator.Multiply;
        return;
      case '/':
        this.type_ = TokenType.Operator;
        this.op_ = BinaryOperator.Divide;
        return;
      case ',':
        this.type_ = TokenType.Comma;
        return;
    }
    // C++ did not advance on an unknown character; an Error token ends every parse, so the
    // index past it is never read.
    this.curIndex_--;
    this.type_ = TokenType.Error;
  }
}
