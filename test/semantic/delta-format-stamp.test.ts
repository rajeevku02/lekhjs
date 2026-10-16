// The delta compiler's realtime format stamp (spec 04 §9.3, spec 10 §6, AC-BE-14): the first
// compiled frame that writes a template with a JS-form generator on a board below 5.0 carries
// `"doc.info.version": "5.0"` in the same `changes`, so kashi's format gate sees the stamp in the
// frame that introduces the JS; a frame without one, and a board already at 5.0, carry none.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import type { JsonObject, JsonValue } from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { testRuntime } from '../session/helpers';

const runtime = testRuntime();
const WIREFRAME_V4 = path.join(PKG_ROOT, '..', 'lekhboard', 'stencils', 'v4', 'wireframe.json');
const PAGE = 'c0ffffff-0000-4000-8000-000000000001';
const STAMP = 'doc.info.version';

function board(version: string): JsonObject {
  return {
    info: { author: '', description: '', platform: '1', title: 'Board', version },
    attributes: { grid: { present: true }, scaling: { scale: 1, unit: 'point' } },
    pages: {
      [PAGE]: {
        name: 'Only',
        order: 1,
        canvassizetype: 'infinite',
        canvasname: '',
        size: { width: 0, height: 0, unit: 'point' },
        background: { color: -1 },
        objects: {},
      },
    },
  };
}

/** The v4 (Lua) wireframe bodies: the session's overlay converts them to JS as it takes them. */
function wireframeBodies(): JsonObject[] {
  const file = JSON.parse(readFileSync(WIREFRAME_V4, 'utf8')) as { templates?: JsonObject[] };
  return file.templates ?? [];
}

interface Frame {
  type: string;
  changes: Record<string, JsonValue>;
}

function frames(version: string, ops: JsonValue[]): Frame[] {
  const s = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  expect(s.load(board(version)).ok).toBe(true);
  s.addTemplates(wireframeBodies());
  const answer = compile(s, { version: 4, page: PAGE, ops }) as JsonObject;
  s.dispose();
  expect(answer['ok'], JSON.stringify(answer).slice(0, 300)).toBe(true);
  return (answer['frames'] ?? []) as unknown as Frame[];
}

const calendar = { op: 'add_node', shape: 'avabodh.wireframe.calendar', cx: 100, cy: 100 };
const rectangle = { op: 'add_node', shape: 'avabodh.basic.rectangle', cx: 300, cy: 100 };

describe.runIf(existsSync(WIREFRAME_V4))('the format stamp in compiled frames (AC-BE-14)', () => {
  it('a frame adding a wireframe shape to a 4.2 board carries "doc.info.version": "5.0"', () => {
    const fs = frames('4.2', [calendar]);
    const adding = fs.find((f) => Object.keys(f.changes).some((k) => k.includes('.objects.')));
    expect(adding?.type).toBe('addobjects');
    expect(adding?.changes[STAMP]).toBe('5.0');
    // Exactly one frame carries it.
    expect(fs.filter((f) => STAMP in f.changes)).toHaveLength(1);
  });

  it('keys stay in byte order with the stamp among them', () => {
    const changes = Object.keys(frames('4.3', [calendar, rectangle])[0]?.changes ?? {});
    expect(changes).toEqual([...changes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('a frame with no JS generator carries no stamp', () => {
    for (const f of frames('4.2', [rectangle])) expect(STAMP in f.changes).toBe(false);
  });

  it('a board already at 5.0 is not stamped again', () => {
    for (const f of frames('5.0', [calendar])) expect(STAMP in f.changes).toBe(false);
  });
});
