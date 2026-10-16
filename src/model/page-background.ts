// A page background (port of C++ `LekhBackground`, `Platform.{h,cpp}`): the default (white), a
// colour, or a base64 image; plus the grid flag the document copies onto the active page.
//
// Two base64 images were once used to draw the grid as a tiled background; loading either turns
// the grid on and the background back to the default (C++ `checkOldBackgroundImage`), as does an
// empty image.
import { Color } from '../style';

/** C++ `oldGridBackground` (`Platform.cpp:6`). */
export const OLD_GRID_BACKGROUND =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAaklEQVQ4Ee1UQQoAIQhst/z/Yz10EGmFIfaQguC1DhUzoxMqPWut5i0RMZiIPLIxs+GvyyXBG5ws1JaVCjbQz53rPyMcClW1S805miE4RGzvvepcevYNRn/S+8CfcOoxQ+jnyc45DSxV+wN9NxrCHaetGwAAAABJRU5ErkJggg==';

/** C++ `oldGridBackground2` (`Platform.cpp:8`). */
export const OLD_GRID_BACKGROUND_2 =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAHGlET1QAAAACAAAAAAAAAAoAAAAoAAAACgAAAAoAAABmcm4+HgAAADJJREFUOBFi+I8D/AIDHJL/P4EBAy7pUc3oITPgAQaJEkzyKxhgikNE3oMBAy5pYjQDAAAA//+1+k5GAAAAL0lEQVRj+I8D/AIDHJL/P4EBAy7pUc3oITPgAQZxACb5HgwwxSEiL8GAAZc0MZoBEb6bDalRrEUAAAAASUVORK5CYII=';

/** C++ `LekhBackground::Type`. */
export const BackgroundType = Object.freeze({ Default: 0, Image: 1, Color: 2 } as const);
export type BackgroundType = (typeof BackgroundType)[keyof typeof BackgroundType];

const WHITE: Color = Object.freeze(new Color(255, 255, 255, 255));

export class PageBackground {
  private type_: BackgroundType = BackgroundType.Default;
  private color_: Color = WHITE;
  private base64_ = '';
  private grid_ = false;

  get type(): BackgroundType {
    return this.type_;
  }

  get color(): Color {
    return this.color_;
  }

  /** The base64 image data ('' unless the type is `Image`, or after a colour was set). */
  get imageData(): string {
    return this.base64_;
  }

  get hasGrid(): boolean {
    return this.grid_;
  }

  /** C++ `setDefault`: the type and colour; the image data is kept, as in C++. */
  setDefault(): void {
    this.type_ = BackgroundType.Default;
    this.color_ = WHITE;
  }

  setColor(c: Color): void {
    this.color_ = c;
    this.base64_ = '';
    this.type_ = BackgroundType.Color;
  }

  setImageData(base64: string): void {
    this.base64_ = base64;
    this.type_ = BackgroundType.Image;
    this.checkOldBackgroundImage();
  }

  setGrid(on: boolean): void {
    this.checkOldBackgroundImage();
    this.grid_ = on;
  }

  equals(other: PageBackground): boolean {
    if (other.type_ !== this.type_) return false;
    switch (this.type_) {
      case BackgroundType.Image:
        return other.base64_ === this.base64_;
      case BackgroundType.Color:
        return other.color_.equals(this.color_);
      default:
        return true;
    }
  }

  clone(): PageBackground {
    const b = new PageBackground();
    b.type_ = this.type_;
    b.color_ = this.color_;
    b.base64_ = this.base64_;
    b.grid_ = this.grid_;
    return b;
  }

  private checkOldBackgroundImage(): void {
    if (this.type_ !== BackgroundType.Image) return;
    if (this.base64_ === OLD_GRID_BACKGROUND || this.base64_ === OLD_GRID_BACKGROUND_2) {
      this.grid_ = true;
      this.setDefault();
    }
    if (this.base64_ === '') this.setDefault();
  }
}
