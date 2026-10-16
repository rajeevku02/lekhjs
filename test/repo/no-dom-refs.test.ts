// AC-CLS-15: no file under src/ references `window`, `document`, `HTMLElement` or `Worker`, as an
// identifier in a value or a type position (the TypeScript scanner skips comments and strings; a
// property name such as `x.document` is a member access, not the global, and is allowed).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const BANNED = new Set(['window', 'document', 'HTMLElement', 'Worker']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** The banned global names `text` uses, with their line numbers. */
export function domRefs(text: string, name = 'x.ts'): string[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true);
  const hits: string[] = [];
  // A name the file binds itself (a local, a parameter) is not the global.
  const bound = new Set<string>();
  const bind = (n: ts.Node): void => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name)) bound.add(n.name.text);
    ts.forEachChild(n, bind);
  };
  bind(sf);
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && BANNED.has(n.text) && !bound.has(n.text)) {
      const p = n.parent;
      const member =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isQualifiedName(p) && p.right === n) ||
        ((ts.isPropertySignature(p) ||
          ts.isPropertyDeclaration(p) ||
          ts.isPropertyAssignment(p) ||
          ts.isMethodDeclaration(p) ||
          ts.isMethodSignature(p) ||
          ts.isGetAccessorDeclaration(p) ||
          ts.isSetAccessorDeclaration(p)) &&
          p.name === n);
      if (!member) hits.push(`${n.text}@${String(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('no DOM references in src/ (AC-CLS-15)', () => {
  it('finds none', () => {
    const hits = files(path.join(PKG_ROOT, 'src')).flatMap((f) =>
      domRefs(readFileSync(f, 'utf8'), f).map((h) => `${path.relative(PKG_ROOT, f)}: ${h}`),
    );
    expect(hits).toEqual([]);
  });

  it('catches a value use and a type use, not a comment, a string or a member name', () => {
    expect(domRefs('const a = window.innerWidth; let w: Worker | null = null;')).toEqual(['window@1', 'Worker@1']);
    expect(domRefs('// document\nconst s = "HTMLElement"; const o = { document: 1 }; o.document;')).toEqual([]);
    expect(domRefs('function f(document: number) { return document; }')).toEqual([]);
  });
});
