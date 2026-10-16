// The stencil sets bundled with lekhjs (spec 04 §4): stencils/core/ holds the eight core
// stencil files, stencils/builtin/ the compiled-in sets, icons and libnames.json.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const STENCILS = path.join(PKG_ROOT, 'stencils');
const CORE = ['archimate', 'bpmn', 'callout', 'dfd', 'flowchart', 'misc', 'table', 'uml'];
const BUILTIN = ['arrow', 'basic', 'connection_arrows', 'container', 'libnames', 'templates'];

type Json = Record<string, unknown>;
const read = (rel: string) => JSON.parse(readFileSync(path.join(STENCILS, rel), 'utf8')) as Json;
const names = (dir: string) =>
  readdirSync(path.join(STENCILS, dir), { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();

describe('stencils/core', () => {
  it('holds exactly the eight core stencil files', () => {
    expect(names('core')).toEqual(CORE.map((n) => `${n}.json`));
  });

  it.each(CORE)('%s.json is a library file with categories', (n) => {
    const doc = read(`core/${n}.json`);
    expect(Array.isArray(doc['library'])).toBe(true);
    expect((doc['library'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('carries no Lua generator script', () => {
    for (const n of CORE) expect(readFileSync(path.join(STENCILS, 'core', `${n}.json`), 'utf8')).not.toMatch(/scriptfile|\blua\b/i);
  });
});

describe('stencils/builtin', () => {
  it('holds the compiled-in sets, libnames.json and the icons', () => {
    expect(names('builtin')).toEqual(BUILTIN.map((n) => `${n}.json`));
    expect(names('builtin/icons')).toEqual(['icons.json', 'svg_icons.json']);
  });

  it('has the 26 connection arrowheads', () => {
    expect(read('builtin/connection_arrows.json')['arrows']).toHaveLength(26);
  });

  it('libnames.json maps library ids to comma-separated shape names', () => {
    const libnames = read('builtin/libnames.json');
    expect(Object.keys(libnames).length).toBeGreaterThan(100);
    expect(Object.values(libnames).every((v) => typeof v === 'string')).toBe(true);
  });

  it.each(['templates', 'basic', 'container', 'arrow'])('%s.json parses with a templates or library list', (n) => {
    const doc = read(`builtin/${n}.json`);
    expect(Array.isArray(doc['templates']) || Array.isArray(doc['library'])).toBe(true);
  });

  it.each(['icons.json', 'svg_icons.json'])('icons/%s holds a templates list', (n) => {
    expect(Array.isArray(read(`builtin/icons/${n}`)['templates'])).toBe(true);
  });
});
