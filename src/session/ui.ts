// The requests a session makes of its UI, and the value types they carry (spec 05 §6.3; spec 01
// §2.1 puts `UiRequests` in `session/`). React's `<BoardUiHost>` implements `UiRequests` and the
// session receives it as `SessionOptions.ui`; a headless session (kashi) has none, so nothing it
// does can wait on a person. Answers come back as `command` events (spec 03 §12.3).
import type { Point } from '../geometry';

/** A value, or "mixed" when the selection disagrees. */
export type OrMixed<T> = T | 'mixed';
/** A colour (CSS), or "none". */
export type OrNone<T> = T | 'none';

/** The effective style of the selection; "mixed" when the selection disagrees (spec 05 §6.3). */
export interface StyleSnapshot {
  readonly stroke: {
    readonly color: OrMixed<string>;
    readonly width: OrMixed<number>;
    readonly dash: OrMixed<'solid' | 'dash' | 'dot'>;
    /** The dash pattern (the stroke panel's Line Dash cell); empty for solid. */
    readonly dashArray?: readonly number[];
  };
  readonly fill: { readonly color: OrMixed<OrNone<string>> };
  readonly text: {
    readonly family: OrMixed<string>;
    readonly size: OrMixed<number>;
    readonly bold: OrMixed<boolean>;
    readonly italic: OrMixed<boolean>;
    readonly underline: OrMixed<boolean>;
    readonly strike: OrMixed<boolean>;
    readonly color: OrMixed<string>;
    readonly align: OrMixed<'left' | 'center' | 'right'>;
    /** The text panel's second alignment row. */
    readonly verticalAlign?: OrMixed<'top' | 'center' | 'bottom'>;
  };
  readonly connection?: {
    readonly kind: OrMixed<'line' | 'curve' | 'multi'>;
    readonly startArrow: OrMixed<string>;
    readonly endArrow: OrMixed<string>;
  };
  readonly corner?: OrMixed<'round' | 'sharp'>;
}

export type DialogRequest =
  | {
      readonly kind: 'ok_cancel';
      readonly title: string;
      readonly message: string;
      readonly ok?: string;
      readonly cancel?: string;
    }
  | {
      readonly kind: 'text_input';
      readonly title: string;
      readonly value: string;
      readonly placeholder?: string;
      /** C++ `DialogInput::message` (e.g. "Enter Page Name"). */
      readonly message?: string;
      /** C++ `allowEmpty` (default true). */
      readonly allowEmpty?: boolean;
      /** C++ `okText` / `cancelText` (default OK / Cancel). */
      readonly ok?: string;
      readonly cancel?: string;
    }
  | { readonly kind: 'info' | 'error' | 'warn'; readonly title: string; readonly message: string }
  /** "Disconnected from server" with Reload (spec 09 §7, `ReconnectPolicy`). */
  | { readonly kind: 'disconnected' }
  /** The format gate (spec 04 §10.1). */
  | {
      readonly kind: 'gate';
      readonly code: 'board_requires_newer_app';
      readonly message: string;
      readonly reload: true;
    };

export interface DialogResponse {
  readonly action: 'ok' | 'cancel' | 'reload' | 'back';
  readonly value?: string;
}

export interface ToastRequest {
  readonly message: string;
  readonly kind: 'info' | 'warn' | 'error';
  readonly durationMs?: number;
  readonly action?: { readonly label: string; readonly id: string };
  /**
   * C++ `Toast::show(at, msg)` (`Side::Relative`): the toast's top-left at this view point,
   * kept on screen. Without it the toast is centred below the top toolbar (`Side::Top`).
   */
  readonly at?: Point;
}

/** An image the user picked (`LekhPlugin.pickImage` natively, `<input type=file>` on the web). */
export interface PickedImage {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly name?: string;
}

/** One entry of the canvas context menu. */
export interface ContextAction {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
}

/** The shape picker a connect-drag dropped on empty canvas opens. */
export interface ShapePickerRequest {
  readonly at: Point;
  readonly fromObjectId: string;
  readonly fromAnchor: string;
}

export type OpenViewKind = 'share' | 'contact' | 'main_help' | 'platform_info' | `context_info${string}` | 'shape_help';

/** Implemented by `<BoardUiHost>`, injected into the session (spec 05 §6.3). */
export interface UiRequests {
  dialog(req: DialogRequest): Promise<DialogResponse>;
  openView(kind: OpenViewKind, args?: unknown): void;
  pickImage(): Promise<PickedImage | null>;
  toast(t: ToastRequest): void;
  contextMenu(at: Point, items: readonly ContextAction[]): void;
  shapePicker(req: ShapePickerRequest): void;
  navigateBack(): void;
  openUpgrade(source: string): void;
}
