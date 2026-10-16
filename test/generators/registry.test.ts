// `GeneratorRegistry` and the canonical texts (spec 04 §5.2-§5.3, §7.2): the 34 ids and 33 module
// keys re-derived from `v4/wireframe.json` (AC-GEN-05), the 7 native names (AC-CLS-10),
// `scripts.generated.json` rebuilt byte for byte (AC-GEN-08), and fengari as a devDependency only
// (AC-GEN-10, with the bundle audit in tools/bundle-audit.mjs).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GeneratorRegistry,
  NATIVE_SHAPES,
  UNUSED_SCRIPTFILE,
  WIREFRAME_MODULES,
  WIREFRAME_TEMPLATES,
} from '../../src/generators';
import type { JsonObject } from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { wireframeTemplates } from './oracle/cases';
import { luaPack } from './oracle/lua-oracle';

const registry = GeneratorRegistry.builtin();

describe('the id table (AC-GEN-05)', () => {
  it('34 generator template ids, 33 module keys; slider and iosslider share one', () => {
    expect(WIREFRAME_TEMPLATES.length).toBe(34);
    expect(new Set(WIREFRAME_TEMPLATES.map((r) => r.id)).size).toBe(34);
    expect(new Set(WIREFRAME_TEMPLATES.map((r) => r.key)).size).toBe(33);
    expect(registry.keyById.get('avabodh.wireframe.slider')).toBe('wireframe/slider');
    expect(registry.keyById.get('avabodh.wireframe.iosslider')).toBe('wireframe/slider');
  });

  it('matches v4/wireframe.json: every generator template, with its scriptfile', () => {
    const bodies = wireframeTemplates();
    const fromStencil = [...bodies].map(([id, b]) => [id, (b['generator'] as JsonObject)['scriptfile']]).sort();
    expect(WIREFRAME_TEMPLATES.map((r) => [r.id, r.scriptfile]).sort()).toEqual(fromStencil);
  });

  it('every scriptfile is in the Lua pack; the pack has only the unused dev stub besides', () => {
    const pack = Object.keys(luaPack()).sort();
    const named = [...new Set(WIREFRAME_TEMPLATES.map((r) => r.scriptfile))];
    expect([...named, UNUSED_SCRIPTFILE].sort()).toEqual(pack);
    expect(registry.scriptfileKey(UNUSED_SCRIPTFILE)).toBeNull();
    expect(registry.scriptfileKey('wireframe/slider_min.lua')).toBe('wireframe/slider');
  });

  it('every ported module serves exactly the ids of its key', () => {
    for (const m of WIREFRAME_MODULES) {
      const ids = WIREFRAME_TEMPLATES.filter((r) => r.key === m.key).map((r) => r.id);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(registry.wireframe(id)).toBe(m);
    }
    expect(registry.wireframeById.size).toBe(
      WIREFRAME_TEMPLATES.filter((r) => WIREFRAME_MODULES.some((m) => m.key === r.key)).length,
    );
  });

  // AC-GEN-05: all 33 are ported (G1-G4); this was an expected-to-fail ratchet until G4.
  it('the registry serves all 34 ids with 33 modules', () => {
    expect(new Set(WIREFRAME_MODULES.map((m) => m.key)).size).toBe(33);
    expect(registry.wireframeById.size).toBe(34);
  });

  it('module files are named after their Lua script', () => {
    const dir = path.join(PKG_ROOT, 'src', 'generators', 'wireframe');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
    expect(files.map((f) => `wireframe/${f.slice(0, -3).replace(/-/g, '_')}`).sort()).toEqual(
      WIREFRAME_MODULES.map((m) => m.key).sort(),
    );
  });

  it('the 7 native generator names are known (AC-CLS-10)', () => {
    expect(NATIVE_SHAPES.length).toBe(7);
    for (const s of NATIVE_SHAPES) expect(registry.isNativeShape(s)).toBe(true);
    expect(registry.isNativeShape('bpmn.nope')).toBe(false);
  });

  it('is frozen, and two registries share nothing mutable', () => {
    expect(Object.isFrozen(registry)).toBe(true);
    const other = GeneratorRegistry.builtin();
    expect(other).not.toBe(registry);
    expect(other.scriptText('wireframe/button')).toBe(registry.scriptText('wireframe/button'));
  });
});

describe('scripts.generated.json (AC-GEN-08, AC-GEN-23)', () => {
  it('build-generator-scripts.mjs --check passes: the committed file is what the build makes', () => {
    expect(() =>
      execFileSync('node', ['tools/build-generator-scripts.mjs', '--check'], { cwd: PKG_ROOT, stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('holds one text per ported module, each with its marker', () => {
    const json = JSON.parse(
      readFileSync(path.join(PKG_ROOT, 'src', 'generators', 'scripts.generated.json'), 'utf8'),
    ) as Record<string, string>;
    expect(Object.keys(json).sort()).toEqual(WIREFRAME_MODULES.map((m) => m.key).sort());
    for (const [k, v] of Object.entries(json))
      expect(v.startsWith(`/*lekh-js:1:${k}*/function generate(p,t,h){`)).toBe(true);
  });
});

describe('fengari is test-only (AC-GEN-10)', () => {
  it('is a pinned devDependency, never a dependency, and src/ never imports it', () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies?.['fengari']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies?.['fengari']).toBeUndefined();
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/fengari|wasmoon/.test(readFileSync(p, 'utf8'))) hits.push(p);
      }
    };
    walk(path.join(PKG_ROOT, 'src'));
    expect(hits).toEqual([]);
  });

  it('the bundle audit forbids it', () => {
    expect(readFileSync(path.join(PKG_ROOT, 'tools', 'bundle-audit.mjs'), 'utf8')).toMatch(
      /FORBIDDEN_LIBS = Object\.freeze\(\[[^\]]*'fengari'/,
    );
  });
});
