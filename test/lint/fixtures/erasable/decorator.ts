// AC-ARC-18: decorators are rejected by lint (tsc's erasableSyntaxOnly does not cover them).
function sealed(target: unknown, _ctx: ClassDecoratorContext): void {
  void target;
}

@sealed
export class D {}
