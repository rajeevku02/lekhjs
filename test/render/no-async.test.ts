// AC-ENG-25 (render/ part): no source file contains `async` or `await`, and `Promise` appears
// only in the port declarations (ImageCodec, render/ports.ts). Also: NoOpPlatform and
// PathCaptureDrawingPlatform implement every DrawingPlatform method Canvas2DDrawingPlatform has.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Canvas2DDrawingPlatform, NoOpPlatform, PathCaptureDrawingPlatform } from '../../src/render';
import { PKG_ROOT } from '../lint/eslint-helpers';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const methods = (proto: object) =>
  Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && typeof Reflect.get(proto, n) === 'function');

describe('render/ is synchronous (AC-ENG-25)', () => {
  it('no async/await, and Promise only in ports.ts', () => {
    const dir = path.join(PKG_ROOT, 'src', 'render');
    const files = readdirSync(dir).filter((x) => x.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const code = strip(readFileSync(path.join(dir, f), 'utf8'));
      expect(/\basync\b|\bawait\b/.test(code), f).toBe(false);
      if (f !== 'ports.ts') expect(/\bPromise\b/.test(code), f).toBe(false);
    }
  });
});

describe('DrawingPlatform implementations', () => {
  const drawing = [
    'startDrawing',
    'endDrawing',
    'closePath',
    'addLineTo',
    'moveTo',
    'addCircle',
    'addArc',
    'addEllipse',
    'addCurve',
    'addRoundedRect',
    'drawText',
    'drawImage',
    'saveContext',
    'restoreContext',
    'translate',
    'clip',
  ];
  it.each([
    ['Canvas2DDrawingPlatform', Canvas2DDrawingPlatform.prototype],
    ['NoOpPlatform', NoOpPlatform.prototype],
    ['PathCaptureDrawingPlatform', PathCaptureDrawingPlatform.prototype],
  ])('%s has every drawing method', (_name, proto) => {
    const have = methods(proto);
    for (const m of drawing) expect(have, m).toContain(m);
  });

  it('NoOpPlatform draws nothing and returns undefined everywhere', () => {
    const p = new NoOpPlatform();
    for (const m of methods(NoOpPlatform.prototype)) {
      expect((Reflect.get(p, m) as () => unknown).call(p)).toBeUndefined();
    }
  });
});
