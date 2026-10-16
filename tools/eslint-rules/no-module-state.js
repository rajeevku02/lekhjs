// lekhjs/no-module-state: no module-level mutable state (spec 01 §3.2 rule 3).
//
// Rejected at the top level of a module (including `export` forms):
//   - `let` and `var` declarations;
//   - a `const` bound to a mutable value: an object or array literal, `new X(…)` (a class
//     instance, Map, Set, …), or a `class` expression's instance — unless the value is
//     frozen (`Object.freeze(…)`) or an `as const` literal;
//   - `export default` of such a value;
//   - a `static` class field holding such a value (shared across every session).
// Constants (primitives, `as const` tables, frozen objects) and functions are allowed.
//
// Option `allow`: a list of `{ file, name }` (file = path suffix, name = binding) exempted
// by design — reserved for the frozen object-kind registry in src/model/index.ts.

/** @param {any} node */
function unwrap(node) {
  let n = node;
  while (
    n &&
    (n.type === 'TSSatisfiesExpression' ||
      n.type === 'TSNonNullExpression' ||
      n.type === 'ParenthesizedExpression' ||
      (n.type === 'TSAsExpression' && !isAsConst(n)))
  ) {
    n = n.expression;
  }
  return n;
}

/** @param {any} n */
function isAsConst(n) {
  return (
    n.type === 'TSAsExpression' &&
    n.typeAnnotation?.type === 'TSTypeReference' &&
    n.typeAnnotation.typeName?.type === 'Identifier' &&
    n.typeAnnotation.typeName.name === 'const'
  );
}

/** @param {any} n */
function isFreezeCall(n) {
  return (
    n.type === 'CallExpression' &&
    n.callee.type === 'MemberExpression' &&
    !n.callee.computed &&
    n.callee.object.type === 'Identifier' &&
    n.callee.object.name === 'Object' &&
    n.callee.property.type === 'Identifier' &&
    n.callee.property.name === 'freeze'
  );
}

/**
 * Why `init` is a mutable value, or null when it is not.
 * @param {any} init
 * @returns {string | null}
 */
function mutableKind(init) {
  if (!init) return null;
  if (isAsConst(init)) return null;
  const n = unwrap(init);
  if (!n) return null;
  if (isAsConst(n) || isFreezeCall(n)) return null;
  switch (n.type) {
    case 'ObjectExpression':
      return 'a mutable object literal';
    case 'ArrayExpression':
      return 'a mutable array literal';
    case 'NewExpression':
      return n.callee.type === 'Identifier' ? `a '${n.callee.name}' instance` : 'a class instance';
    default:
      return null;
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow module-level mutable state in lekhjs (spec 01 §3.2 rule 3).' },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: {
              type: 'object',
              properties: { file: { type: 'string' }, name: { type: 'string' } },
              required: ['file', 'name'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      topLevelLet:
        "Top-level '{{kind}}' is module state shared by every session; move it onto BoardSession or the Runtime, or make it a const (spec 01 §3.2 rule 3).",
      mutableValue:
        "Top-level '{{name}}' holds {{what}}, which is module state shared by every session; freeze it (Object.freeze / as const) or move it onto BoardSession or the Runtime (spec 01 §3.2 rule 3).",
      staticField:
        "Static field '{{name}}' holds {{what}}, which is module state shared by every session (spec 01 §3.2 rule 3).",
    },
  },
  create(context) {
    const filename = context.filename.replace(/\\/g, '/');
    /** @type {{ file: string; name: string }[]} */
    const allow = context.options[0]?.allow ?? [];
    /** @param {string} name */
    const allowed = (name) => allow.some((a) => a.name === name && filename.endsWith(a.file));

    /** @param {any} decl */
    function checkDeclaration(decl) {
      if (decl.type !== 'VariableDeclaration') return;
      if (decl.declare) return;
      if (decl.kind === 'let' || decl.kind === 'var') {
        context.report({ node: decl, messageId: 'topLevelLet', data: { kind: decl.kind } });
        return;
      }
      for (const d of decl.declarations) {
        const what = mutableKind(d.init);
        if (!what) continue;
        const name = d.id.type === 'Identifier' ? d.id.name : '(destructured)';
        if (allowed(name)) continue;
        context.report({ node: d, messageId: 'mutableValue', data: { name, what } });
      }
    }

    return {
      Program(program) {
        for (const stmt of program.body) {
          if (stmt.type === 'VariableDeclaration') checkDeclaration(stmt);
          else if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) checkDeclaration(stmt.declaration);
          else if (stmt.type === 'ExportDefaultDeclaration') {
            const what = mutableKind(stmt.declaration);
            if (what && !allowed('default'))
              context.report({ node: stmt, messageId: 'mutableValue', data: { name: 'default', what } });
          }
        }
      },
      PropertyDefinition(node) {
        if (!node.static) return;
        const what = mutableKind(node.value);
        if (!what) return;
        const name = node.key.type === 'Identifier' ? node.key.name : '(computed)';
        context.report({ node, messageId: 'staticField', data: { name, what } });
      },
    };
  },
};

export default rule;
