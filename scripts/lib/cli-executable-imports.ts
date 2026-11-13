// @effect-diagnostics nodeBuiltinImport:off
import * as NodeModule from "node:module";
import ts from "typescript-legacy";

export function requireExternalCjsImports(source: string, packages: ReadonlySet<string>): string {
  const module = ts.createSourceFile(
    "bundle.mjs",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const imports = module.statements.filter(
    (node): node is ts.ImportDeclaration =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      packages.has(node.moduleSpecifier.text),
  );
  if (imports.length === 0) return source;
  let prefix = "__t3SeaExternal";
  while (source.includes(prefix)) prefix += "_";
  const edits = imports.map((node, index) => {
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const name = `${prefix}${index}`;
    const clause = node.importClause;
    const statements = [`const ${name} = ${prefix}Require(${JSON.stringify(specifier)});`];
    if (clause?.name) statements.push(`const ${clause.name.text} = ${name};`);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      statements.push(`const ${bindings.name.text} = { ...${name}, default: ${name} };`);
    else if (bindings)
      for (const element of bindings.elements)
        statements.push(
          `const ${element.name.text} = ${name}[${JSON.stringify((element.propertyName ?? element.name).text)}];`,
        );
    return { start: node.getStart(module), end: node.end, text: statements.join("\n") };
  });
  let result = source;
  for (const edit of edits.toReversed())
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  const header = `import { createRequire as ${prefix}CreateRequire } from "node:module";\nconst ${prefix}Require = ${prefix}CreateRequire(import.meta.url);\n`;
  const start = result.startsWith("#!") ? result.indexOf("\n") + 1 : 0;
  return result.slice(0, start) + header + result.slice(start);
}

/** Node single-executable imports resolve only builtins; use createRequire for file-backed external packages. */
export function findEsmImportsOfExternalPackages(source: string): ReadonlyArray<string> {
  const specifiers = new Set<string>();
  const module = ts.createSourceFile(
    "bundle.mjs",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const visit = (node: ts.Node): void => {
    const dynamic =
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const specifierNode =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : dynamic
          ? node.arguments[0]
          : undefined;
    if (specifierNode && ts.isStringLiteralLike(specifierNode)) {
      const specifier = specifierNode.text;
      // Optional Bun imports are runtime builtins; static Bun imports still fail under Node.
      const runtimeBuiltin =
        NodeModule.isBuiltin(specifier) || (dynamic && specifier.startsWith("bun:"));
      if (!runtimeBuiltin && !specifier.startsWith("./") && !specifier.startsWith("../")) {
        specifiers.add(specifier);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(module);
  return [...specifiers].sort();
}
