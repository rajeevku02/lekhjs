// The DataExpression tree (port of C++ `Expression` and its four node classes,
// `L/DataExpression.{h,cpp}`). Nodes are immutable and frozen, so one compiled tree is shared by
// every live template of a catalog definition (spec 04 §2: "compiled expressions are cached on
// the TemplateDef").
//
// Evaluation reads a `DataStore` (the instance's box and data) and an `ExpressionScope` (the
// template's parameters, text slots and path styles); the C++ passed the `ShapeTemplate` itself.
import { toInt } from '../../base';
import { Size } from '../../geometry';
import type { DataStore } from './data-store';

/** What an expression may ask of the template it is evaluated for. */
export interface ExpressionScope {
  /** The numeric value of the parameter `name`, or `undefined` when there is none. */
  paramValue(name: string): number | undefined;
  /**
   * The measured size of text slot `index` under `constraint` (-1 = unconstrained), or `null`
   * when there is no such slot (C++ `tw`/`th` then return 0).
   */
  textSize(index: number, constraint: Size): Size | null;
  /** C++ `sw(i)`: the effective stroke width of path `i`, else of the template's own style. */
  strokeWidth(index: number): number;
}

/** C++ `BinaryExpression::Operator`. */
export const BinaryOperator = Object.freeze({ Add: 0, Subtract: 1, Multiply: 2, Divide: 3 } as const);
export type BinaryOperator = (typeof BinaryOperator)[keyof typeof BinaryOperator];

export abstract class Expression {
  abstract value(ds: DataStore, scope: ExpressionScope): number;
}

export class PrimitiveExpression extends Expression {
  readonly constant: number;

  constructor(val: number) {
    super();
    this.constant = val;
    Object.freeze(this);
  }

  value(): number {
    return this.constant;
  }
}

export class BinaryExpression extends Expression {
  readonly left: Expression;
  readonly right: Expression;
  readonly op: BinaryOperator;

  constructor(left: Expression, right: Expression, op: BinaryOperator) {
    super();
    this.left = left;
    this.right = right;
    this.op = op;
    Object.freeze(this);
  }

  value(ds: DataStore, scope: ExpressionScope): number {
    const v1 = this.left.value(ds, scope);
    const v2 = this.right.value(ds, scope);
    switch (this.op) {
      case BinaryOperator.Add:
        return v1 + v2;
      case BinaryOperator.Subtract:
        return v1 - v2;
      case BinaryOperator.Multiply:
        return v1 * v2;
      case BinaryOperator.Divide:
        return v1 / v2;
    }
  }
}

/** `w h x y a` (the box), else a parameter, else 0. The box names hide parameters of that name. */
export class VariableAccessExpression extends Expression {
  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
    Object.freeze(this);
  }

  value(ds: DataStore, scope: ExpressionScope): number {
    switch (this.name) {
      case 'w':
        return ds.width();
      case 'h':
        return ds.height();
      case 'x':
        return ds.cx();
      case 'y':
        return ds.cy();
      case 'a':
        return ds.angle();
    }
    return scope.paramValue(this.name) ?? 0;
  }
}

/** C `fmin`/`fmax`: a NaN argument yields the other one. */
function fmin(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a < b ? a : b;
}
function fmax(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a > b ? a : b;
}

/** C++ `(int)val` used as an index; NaN and infinities read as an out-of-range index. */
function index(val: number): number {
  return Number.isFinite(val) ? toInt(val) : -1;
}

/**
 * `d sin cos tan min max tw th sw`; any other name evaluates to 0. Extra arguments are ignored.
 * Doubles throughout (spec 04 §2, decided): C++ called the float `sinf`/`fminf`.
 */
export class FunctionCallExpression extends Expression {
  readonly name: string;
  readonly params: readonly Expression[];

  constructor(name: string, params: readonly Expression[]) {
    super();
    this.name = name;
    this.params = Object.freeze(params.slice());
    Object.freeze(this);
  }

  value(ds: DataStore, scope: ExpressionScope): number {
    const first = this.params[0];
    if (first === undefined) return 0;
    const val = first.value(ds, scope);
    const second = this.params[1];
    switch (this.name) {
      case 'd':
        // Not bounds-checked in C++ (undefined memory); 0 here (spec 04 §2).
        return ds.value(index(val));
      case 'sin':
        return Math.sin(val);
      case 'cos':
        return Math.cos(val);
      case 'tan':
        return Math.tan(val);
      case 'min':
        if (this.params.length !== 2 || second === undefined) return 0;
        return fmin(val, second.value(ds, scope));
      case 'max':
        if (this.params.length !== 2 || second === undefined) return 0;
        return fmax(val, second.value(ds, scope));
      case 'tw': {
        const constrH = second !== undefined ? second.value(ds, scope) : -1;
        return scope.textSize(index(val), new Size(-1, constrH))?.width ?? 0;
      }
      case 'th': {
        const constrW = second !== undefined ? second.value(ds, scope) : -1;
        return scope.textSize(index(val), new Size(constrW, -1))?.height ?? 0;
      }
      case 'sw':
        return scope.strokeWidth(index(val));
    }
    return 0;
  }
}
