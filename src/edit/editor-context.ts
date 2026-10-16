// What the commands, editors, clipboard and selection catalog of one board share: the edit
// environment, the current document, the undo stack and the transaction helper. One per board
// session (no singletons: C++ `UndoManager::instance`, `Clipboard::instance`, `LekhGlobal`).
import type { Config } from '../base';
import type { DocumentCodec } from '../io';
import type { LekhDocument } from '../model';
import { EditTransaction } from './edit-transaction';
import { UndoManager, type UndoManagerOptions } from './undo-manager';
import type { UpdateSink } from './update';
import type { EditEnv } from './user-action';

export interface EditorContextOptions {
  readonly codec: DocumentCodec;
  readonly sink: UpdateSink;
  /** The session's current document (a reload replaces it). */
  readonly document: () => LekhDocument;
  readonly undo?: UndoManagerOptions;
}

export class EditorContext {
  readonly env: EditEnv;
  readonly undo: UndoManager;
  readonly tx: EditTransaction;
  private readonly document_: () => LekhDocument;

  constructor(opts: EditorContextOptions) {
    this.env = { codec: opts.codec, sink: opts.sink };
    this.undo = new UndoManager(opts.undo);
    this.tx = new EditTransaction(this.env, this.undo);
    this.document_ = opts.document;
  }

  get doc(): LekhDocument {
    return this.document_();
  }

  get config(): Config {
    return this.env.codec.env.objects.config;
  }

  /** A template's help text (C++ `TemplateStore::getHelp`). */
  help(templateId: string): string {
    return this.env.codec.env.help?.(templateId) ?? '';
  }
}
