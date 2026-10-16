// C++ `NoOpPlatform` (`L/Platform.h:518-550`): a `DrawingPlatform` that draws nothing. A test
// helper only: settling layout is `layout()` / `ensureLayout()`, not a draw to nowhere (spec 03 §5.1).
import type { DrawingPlatform } from './drawing-platform';

export class NoOpPlatform implements DrawingPlatform {
  startDrawing(): void {
    /* nothing */
  }
  endDrawing(): void {
    /* nothing */
  }
  closePath(): void {
    /* nothing */
  }
  addLineTo(): void {
    /* nothing */
  }
  moveTo(): void {
    /* nothing */
  }
  addCircle(): void {
    /* nothing */
  }
  addArc(): void {
    /* nothing */
  }
  addEllipse(): void {
    /* nothing */
  }
  addCurve(): void {
    /* nothing */
  }
  addRoundedRect(): void {
    /* nothing */
  }
  drawText(): void {
    /* nothing */
  }
  drawImage(): void {
    /* nothing */
  }
  saveContext(): void {
    /* nothing */
  }
  restoreContext(): void {
    /* nothing */
  }
  translate(): void {
    /* nothing */
  }
  clip(): void {
    /* nothing */
  }
}
