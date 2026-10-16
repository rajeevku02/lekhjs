// The `lekhjs` ESLint plugin: the project's own rules (spec 01 §3.3).
import layers from './layers.js';
import noModuleState from './no-module-state.js';

const plugin = Object.freeze({
  meta: { name: 'lekhjs' },
  rules: { layers, 'no-module-state': noModuleState },
});

export default plugin;
