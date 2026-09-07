import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { builtinModules } from "node:module";

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function layer(file) {
  if (file.startsWith("packages/contracts/src/")) return "contracts";
  if (file.startsWith("apps/cockpit/src/")) return "browser";
  if (file.startsWith("tools/")) return "core";
  return "adapter";
}

export function sourceImports(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : node;
        const bindings = clause?.namedBindings || node.exportClause;
        const typeOnly =
          Boolean(clause?.isTypeOnly) ||
          Boolean(
            !clause?.name &&
            bindings?.elements?.length &&
            bindings.elements.every((item) => item.isTypeOnly),
          );
        imports.push({ specifier: node.moduleSpecifier.text, typeOnly });
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      imports.push({ specifier: node.moduleReference.expression.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      imports.push({ specifier: node.argument.literal.text, typeOnly: true });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) {
        throw new Error(
          `${file}: dynamic imports must have a literal target for boundary verification`,
        );
      }
      imports.push({ specifier: argument.text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return imports;
}

function targetPath(file, specifier) {
  if (specifier.startsWith("@gke/contracts/")) {
    return `packages/contracts/src/${specifier.slice("@gke/contracts/".length)}`;
  }
  if (specifier.startsWith("@/")) return `apps/cockpit/src/${specifier.slice(2)}`;
  if (specifier.startsWith("."))
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return null;
}

/** Check every supplied source, including new files, type imports and re-exports. */
export function validateImportBoundaries(sources) {
  const graph = new Map();
  for (const [file, source] of sources) {
    const owner = layer(file);
    const edges = [];
    for (const { specifier, typeOnly } of sourceImports(file, source)) {
      const target = targetPath(file, specifier);
      if (target) {
        const targetOwner = layer(target);
        const allowed =
          owner === "contracts"
            ? targetOwner === "contracts"
            : owner === "browser"
              ? ["browser", "contracts"].includes(targetOwner)
              : owner === "core"
                ? ["core", "contracts"].includes(targetOwner)
                : true;
        if (!allowed)
          throw new Error(`${file}: forbidden ${owner} -> ${targetOwner} import '${specifier}'`);
        const stem = target.replace(/\.js$/, "");
        const resolved = [target, `${stem}.ts`, `${stem}.tsx`, `${target}/index.ts`].find(
          (candidate) => sources.has(candidate),
        );
        if (resolved && !typeOnly) edges.push(resolved);
      } else if (
        owner === "contracts" ||
        (owner === "browser" && (specifier.startsWith("node:") || builtins.has(specifier))) ||
        (owner === "core" && /^(react|react-dom)(?:\/|$)/.test(specifier))
      ) {
        throw new Error(`${file}: forbidden platform/package import '${specifier}' in ${owner}`);
      }
    }
    graph.set(file, edges);
  }
  const visited = new Set();
  const active = [];
  function visit(file) {
    if (active.includes(file))
      throw new Error(
        `Runtime import cycle: ${[...active.slice(active.indexOf(file)), file].join(" -> ")}`,
      );
    if (visited.has(file)) return;
    active.push(file);
    for (const next of graph.get(file) || []) visit(next);
    active.pop();
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  return { files: sources.size };
}

export function readProductionSources(repoRoot) {
  const sources = new Map();
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
      if (["__tests__", "node_modules", "fixtures", "eval"].includes(entry.name)) continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file) && !/(?:-test|\.test)\.tsx?$/.test(file))
        sources.set(file, fs.readFileSync(path.join(repoRoot, file), "utf8"));
    }
  }
  for (const root of ["packages/contracts/src", "tools", "apps/cockpit/src"]) walk(root);
  return sources;
}
