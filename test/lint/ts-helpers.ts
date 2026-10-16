import path from 'node:path';
import ts from 'typescript';
import { PKG_ROOT } from './eslint-helpers';

export function parsedBuildConfig(): ts.ParsedCommandLine {
  const file = path.join(PKG_ROOT, 'tsconfig.build.json');
  const read = ts.readConfigFile(file, (p) => ts.sys.readFile(p));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, PKG_ROOT);
}

/** Diagnostic codes from compiling `files` with the build options (no emit). */
export function diagnosticCodes(files: string[]): number[] {
  const program = ts.createProgram(files, {
    ...parsedBuildConfig().options,
    noEmit: true,
    declaration: false,
    emitDeclarationOnly: false,
    rootDir: PKG_ROOT,
  });
  return ts.getPreEmitDiagnostics(program).map((d) => d.code);
}
