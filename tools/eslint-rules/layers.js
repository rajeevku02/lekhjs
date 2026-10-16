// lekhjs/layers: import-x `no-restricted-paths` over the rank zones (tools/layers.mjs),
// except that a type-only import or re-export (`import type …`, `export type … from`) is
// allowed, because the compiler erases it (spec 01 §3.2 rules 1-2, verbatimModuleSyntax).
//
// An inline `import { type X }` is NOT exempt: under verbatimModuleSyntax it leaves a
// runtime `import {} from '…'` behind, which is a real upward edge.
import importX from 'eslint-plugin-import-x';

/** @type {any} */
const base = importX.rules['no-restricted-paths'];

/** @param {any} node the reported import source literal */
function isTypeOnly(node) {
  const p = node?.parent;
  if (!p) return false;
  if (p.type === 'ImportDeclaration') return p.importKind === 'type';
  if (p.type === 'ExportNamedDeclaration' || p.type === 'ExportAllDeclaration') return p.exportKind === 'type';
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    ...base.meta,
    docs: {
      description: 'Enforce the lekhjs module ranks: downward value imports only, upward references type-only.',
    },
  },
  create(context) {
    const filtering = Object.create(context, {
      report: {
        value(/** @type {any} */ descriptor) {
          if (isTypeOnly(descriptor.node)) return;
          context.report(descriptor);
        },
      },
    });
    return /** @type {import('eslint').Rule.RuleListener} */ (/** @type {any} */ (base.create)(filtering));
  },
};

export default rule;
