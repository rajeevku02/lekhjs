// A wireframe module's structured output as the template-data JSON C++ parsed from a script's
// string (`LuaShapeGenerator.cpp:660-670`), and the placeholder drawing (spec 04 §7.4).
//
// Applying the JSON is io/'s `parseTemplateData` (spec 01 C5: the serializer depends on the model,
// never the reverse), injected into every generator `generators/` builds.
import type { JsonObject, JsonValue, ShapeTemplate, WireframeOutput } from '../template';

/** C++ `clearTemplateData()` + `JsonObjectSerializer::parseTemplateData(json, t)`. */
export type TemplateDataApplier = (t: ShapeTemplate, data: JsonObject) => void;

type Mutable = Record<string, JsonValue>;

function entry(src: object): JsonObject {
  const out: Mutable = {};
  for (const [k, v] of Object.entries(src)) if (v !== undefined) out[k] = v as JsonValue;
  return out;
}

/** The members `parseTemplateData` reads, from a module's output (`minW`/`minH`/`disabled` are not data). */
export function outputToTemplateJson(out: WireframeOutput): JsonObject {
  return {
    data: out.data.slice(),
    draw: out.draw.map(entry),
    texts: out.texts.map(entry),
    images: out.images.map(entry),
    embeds: out.embeds.map(entry),
    containers: out.containers.slice(),
  };
}

/** The theme's muted grey (opaque, ARGB as a signed int). */
const MUTED = -6381922;

/**
 * The placeholder drawing (spec 04 §7.4): a 1-px dashed outline in the muted colour, a small
 * warning triangle at the top left, and "Unsupported shape" centred in the box.
 */
export function placeholderOutput(): WireframeOutput {
  const muted = { color: MUTED, type: 2 };
  return {
    data: [
      '-w/2',
      '-h/2',
      'w/2',
      'h/2',
      // the warning triangle: apex, bottom right, bottom left
      '-w/2+9',
      '-h/2+4',
      '-w/2+14',
      '-h/2+13',
      '-w/2+4',
      '-h/2+13',
      // the label box
      '0',
      '0',
      'max(w-8, 0)',
      'max(h-8, 0)',
      '0',
    ],
    draw: [
      {
        path: 'M 0 1 L 2 1 L 2 3 L 0 3 Z',
        style: { strokepaint: muted, strokewidth: 1, fillpaint: { type: 1 }, dasharray: [4, 3] },
      },
      { path: 'M 4 5 L 6 7 L 8 9 Z', style: { strokepaint: muted, strokewidth: 1, fillpaint: muted } },
    ],
    texts: [{ text: 'Unsupported shape', location: '10 11 12 13 14', style: { textfill: muted, fontsize: 10 } }],
    images: [],
    embeds: [],
    containers: [],
    minW: 0,
    minH: 0,
  };
}
