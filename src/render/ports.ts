// The image port `render/` owns (spec 02 §6 `ImageCodec`, spec 01 §4.2 `DecodedImage`).
// `session/ports.ts` re-exports these, so hosts import every port from one place.
//
// Browser: `ImageBitmap` (createImageBitmap / OffscreenCanvas.convertToBlob). Node (kashi):
// `@napi-rs/canvas` `Image` / `Canvas.encode`. The engine never calls a codec from paint: decoding
// happens in the host or the session, and the decoded image arrives as an `imageLoaded` event that
// lands in the `ImageCache` (spec 03 §7).
import type { Size } from '../geometry';

/** A decoded image, ready for `Canvas2DLike.drawImage(image.source, …)`. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** What the host's `drawImage` accepts: an `ImageBitmap`, a napi `Image`, a canvas. */
  readonly source: unknown;
  /** Releases the backing store (`ImageBitmap.close`). Called on eviction and on dispose. */
  close?(): void;
}

/** The encodings the engine asks for (C++ `cloneImageData` / `getBase64FromImage` formats). */
export type ImageFormat = 'png' | 'jpeg';

/**
 * Decode, encode and resize images: the image half of the C++ `Platform` (`getImageDataFromBase64String`,
 * `cloneImageData`, `getBase64FromImage`, `getImageSize`, `resizeImage`, `freePlatformImageObject`).
 * The size is `DecodedImage.width/height`; freeing is `DecodedImage.close`.
 */
export interface ImageCodec {
  /** Decodes encoded bytes (PNG, JPEG, …). Rejects with a decode error. */
  decode(bytes: Uint8Array): Promise<DecodedImage>;
  /** Decodes a `data:` URL (base64 images of offline boards, OQ-66: browser only). */
  decodeDataUrl(dataUrl: string): Promise<DecodedImage>;
  /** Encodes an image; `quality` (0-1) applies to JPEG only. */
  encode(image: DecodedImage, format: ImageFormat, quality?: number): Promise<Uint8Array>;
  /** A resized copy; the original is untouched. */
  resize(image: DecodedImage, size: Size): Promise<DecodedImage>;
}
