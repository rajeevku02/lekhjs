// Fixture loaders (spec 01 §4.1). lekhjs/src has no file system (no Node types), so the test hands
// in its reader (`readFileSync` in the vitest suites, `fetch` in a browser test) and the root of a
// fixture set (`test/fixtures`, or a sibling C++ set from `parity/fixture-sets.json`).
export interface FixtureLoader {
  /** A fixture's text (a `.lekh` / `.xml` board, a stencil file). */
  text(rel: string): string;
  /** A fixture's JSON. */
  json(rel: string): unknown;
  /** Several boards' texts, in the order given. */
  boards(rels: readonly string[]): string[];
}

export function createFixtureLoader(readText: (path: string) => string, root: string): FixtureLoader {
  const join = (rel: string) => (root.endsWith('/') ? `${root}${rel}` : `${root}/${rel}`);
  return {
    text: (rel) => readText(join(rel)),
    json: (rel) => JSON.parse(readText(join(rel))) as unknown,
    boards: (rels) => rels.map((r) => readText(join(r))),
  };
}
