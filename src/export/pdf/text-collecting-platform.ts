// `TextCollectingPlatform` (spec 08 §7.2, spec 02): the PDF pre-pass. `drawForExport` runs once
// against it before the first page, so every font request, fallback image and board image the
// drawing pass needs is resolved (awaited) first; the drawing pass is then synchronous. It
// records text draws and images only; paths, state and clips are ignored.
import type { DecodedImage, DrawingPlatform } from '../../render';
import type { Style } from '../../style';
import type { LaidOutText } from '../../text';

export interface CollectedText {
  readonly text: LaidOutText;
  readonly style: Style;
}

export class TextCollectingPlatform implements DrawingPlatform {
  readonly texts: CollectedText[] = [];
  readonly images = new Set<DecodedImage>();

  startDrawing(): void {
    /* paths are not collected */
  }
  endDrawing(): void {
    /* paths are not collected */
  }
  closePath(): void {
    /* paths are not collected */
  }
  addLineTo(): void {
    /* paths are not collected */
  }
  moveTo(): void {
    /* paths are not collected */
  }
  addCircle(): void {
    /* paths are not collected */
  }
  addArc(): void {
    /* paths are not collected */
  }
  addEllipse(): void {
    /* paths are not collected */
  }
  addCurve(): void {
    /* paths are not collected */
  }
  addRoundedRect(): void {
    /* paths are not collected */
  }
  drawText(text: LaidOutText, style: Style): void {
    if (text.lines.length > 0) this.texts.push({ text, style });
  }
  drawImage(_c: unknown, _s: unknown, _r: number, image: DecodedImage | null | undefined): void {
    if (image !== null && image !== undefined) this.images.add(image);
  }
  saveContext(): void {
    /* state is not collected */
  }
  restoreContext(): void {
    /* state is not collected */
  }
  translate(): void {
    /* state is not collected */
  }
  clip(): void {
    /* clips are not collected */
  }
}
