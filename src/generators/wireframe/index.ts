// The hand-ported wireframe modules (spec 04 §5.3). One file per Lua script, named after it in
// kebab case (`android_actionbar.lua` → `android-actionbar.ts`, key `wireframe/android_actionbar`), whose
// default export is the module; `tools/build-generator-scripts.mjs` bundles each file into its
// canonical JS text. The rest of the 33 are ported by tasks G2-G4: until a script's module is
// listed here, a template that uses it loads as a placeholder (`lua_unknown_id`).
import type { WireframeModule } from '../../template';
import button from './button';

export const WIREFRAME_MODULES: readonly WireframeModule[] = Object.freeze([button]);
