import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { structuralConfig } from '../../eslint.config.js';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXTURES = path.join(PKG_ROOT, 'test/lint/fixtures');

/** An ESLint instance running only the structural rules of eslint.config.js, rooted at `root`. */
export function structuralEslint(root: string = PKG_ROOT): ESLint {
  return new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: structuralConfig(root),
    ignore: false,
  });
}

/** Lint a fixture's text as if it were the file `virtualPath` (package-relative). */
export async function lintAs(fixture: string, virtualPath: string): Promise<Linter.LintMessage[]> {
  const code = readFileSync(path.join(FIXTURES, fixture), 'utf8');
  const [result] = await structuralEslint().lintText(code, { filePath: path.join(PKG_ROOT, virtualPath) });
  if (!result) throw new Error('no lint result');
  return result.messages;
}

export function ruleIds(messages: readonly Linter.LintMessage[]): (string | null)[] {
  return messages.map((m) => m.ruleId);
}
