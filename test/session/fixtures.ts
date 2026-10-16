// Session-suite fixtures: a box whose layout throws on demand (E-50), and a test-only custom
// command that mutates and then throws (AC-ENG-33, E-36, E-52).
import { Rect } from '../../src/geometry';
import { TranslateObjectAction } from '../../src/edit';
import type { LayoutGeometry } from '../../src/model';
import type { BoardSession } from '../../src/session';
import { BoxShape } from '../model/helpers';

export class ThrowingBox extends BoxShape {
  throws = 1;
  constructor(id: string) {
    super(id, new Rect(500, 500, 40, 40));
  }
  protected override computeLayout(): LayoutGeometry {
    if (this.throws > 0) {
      this.throws--;
      throw new Error('layout failed');
    }
    return super.computeLayout();
  }
}

/** `mutate-then-throw`: moves its objects by 5 (one undo step, one frame), then throws. */
export function registerThrowing(session: BoardSession): void {
  session.registerCommand('mutate-then-throw', (ctx) => {
    ctx.editor.tx.run(new TranslateObjectAction(ctx.editor.env, ctx.doc, [...ctx.objects], 5, 0));
    throw new Error('handler bug');
  });
}
