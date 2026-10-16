// The whitelist for an expression an agent writes into a semantic path's draw (port of C++
// `validateSemanticExpression`, `L/DataExpression.cpp`; KB write-path §3): numbers, `+ - * /`,
// the names `w` and `h`, `min`/`max` of two arguments and `sin`/`cos`/`tan` of one. Anything
// else would evaluate silently (an unknown name is 0), so it is refused here instead.
import { DataExpressionParser, isCAlpha, isCDigit, isCSpace } from './data-expression-parser';
import {
  BinaryExpression,
  FunctionCallExpression,
  PrimitiveExpression,
  VariableAccessExpression,
  type Expression,
} from './expression';

export type SemanticExpressionCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The name at fault; empty when there is none. */ readonly offending: string;
      readonly reason: string;
    };

const OK: SemanticExpressionCheck = Object.freeze({ ok: true });

function refuse(offending: string, reason: string): SemanticExpressionCheck {
  return { ok: false, offending, reason };
}

/** The arity of a whitelisted function, or -1 for any other name. */
function semanticArity(name: string): number {
  if (name === 'min' || name === 'max') return 2;
  if (name === 'sin' || name === 'cos' || name === 'tan') return 1;
  return -1;
}

function arityMessage(name: string, arity: number, got: number): string {
  return `${name} takes ${String(arity)} ${arity === 1 ? 'argument' : 'arguments'}, got ${String(got)}`;
}

function walk(exp: Expression): SemanticExpressionCheck {
  if (exp instanceof PrimitiveExpression) return OK;
  if (exp instanceof BinaryExpression) {
    const l = walk(exp.left);
    return l.ok ? walk(exp.right) : l;
  }
  if (exp instanceof VariableAccessExpression) {
    if (exp.name === 'w' || exp.name === 'h') return OK;
    return refuse(exp.name, `unknown name "${exp.name}"`);
  }
  if (exp instanceof FunctionCallExpression) {
    const arity = semanticArity(exp.name);
    if (arity < 0) return refuse(exp.name, `unknown function "${exp.name}"`);
    if (exp.params.length !== arity) return refuse(exp.name, arityMessage(exp.name, arity, exp.params.length));
    for (const p of exp.params) {
      const r = walk(p);
      if (!r.ok) return r;
    }
    return OK;
  }
  return refuse('', 'not a valid expression');
}

/** B.15: an operator followed, after optional spaces, by `-`. */
function negativeAfterOperator(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '+' && c !== '-' && c !== '*' && c !== '/') continue;
    let j = i + 1;
    while (j < text.length && isCSpace(text[j])) j++;
    if (j < text.length && text[j] === '-') return true;
  }
  return false;
}

/** The parser cannot read an empty argument list; name the function when that is what failed. */
function emptyCall(text: string): SemanticExpressionCheck | null {
  let i = 0;
  while (i < text.length) {
    if (!isCAlpha(text[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < text.length && (isCAlpha(text[i]) || isCDigit(text[i]))) i++;
    const name = text.slice(start, i);
    let j = i;
    while (j < text.length && isCSpace(text[j])) j++;
    if (j >= text.length || text[j] !== '(') continue;
    j++;
    while (j < text.length && isCSpace(text[j])) j++;
    if (j < text.length && text[j] === ')') {
      const arity = semanticArity(name);
      return arity < 0 ? refuse(name, `unknown function "${name}"`) : refuse(name, arityMessage(name, arity, 0));
    }
  }
  return null;
}

export function validateSemanticExpression(text: string): SemanticExpressionCheck {
  let blank = true;
  for (const c of text) {
    if (!isCSpace(c)) {
      blank = false;
      break;
    }
  }
  if (blank) return refuse('', 'empty expression');
  const exp = new DataExpressionParser().compileAll(text);
  if (exp === null) {
    const call = emptyCall(text);
    if (call !== null) return call;
    if (negativeAfterOperator(text)) {
      return refuse('', 'a negative operand after an operator needs parentheses: write w*(-0.5), not w*-0.5');
    }
    return refuse('', 'not a valid expression');
  }
  return walk(exp);
}
