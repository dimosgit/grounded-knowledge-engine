#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadLayerManifest(repoRoot = defaultRepoRoot) {
  const manifestPath = path.join(repoRoot, "gke.layers.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read ${manifestPath}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export function validateLayerManifest(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const checkExists = options.checkExists !== false;
  assertObjectKeys(manifest, ["schemaVersion", "protectedRoots", "layers"], "manifest");
  if (manifest.schemaVersion !== 1) {
    throw new Error(`unsupported schemaVersion '${manifest.schemaVersion}'`);
  }
  assertStringArray(manifest?.protectedRoots, "protectedRoots");
  if (!manifest.layers || typeof manifest.layers !== "object" || Array.isArray(manifest.layers)) {
    throw new Error("layers must be an object");
  }

  const layerEntries = Object.entries(manifest.layers);
  if (layerEntries.length === 0) throw new Error("layers must not be empty");
  if (manifest.layers.all) throw new Error("'all' is reserved for the virtual composite scope");

  const protectedRoots = manifest.protectedRoots.map((value, index) =>
    normalizeSafePath(value, `protectedRoots[${index}]`),
  );
  const ownedRoots = [];

  for (const [name, layer] of layerEntries) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid layer name '${name}'`);
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw new Error(`layer '${name}' must be an object`);
    }
    assertObjectKeys(
      layer,
      ["description", "roots", "excludes", "reconcile", "dependsOn", "verify"],
      `layer '${name}'`,
    );
    if (typeof layer.description !== "string" || !layer.description.trim()) {
      throw new Error(`layer '${name}' must have a description`);
    }
    assertStringArray(layer.roots, `layer '${name}' roots`, { nonEmpty: true });
    assertStringArray(layer.excludes, `layer '${name}' excludes`);
    assertStringArray(layer.reconcile, `layer '${name}' reconcile`);
    assertStringArray(layer.dependsOn, `layer '${name}' dependsOn`);
    assertStringArray(layer.verify, `layer '${name}' verify`, { nonEmpty: true });

    const roots = layer.roots.map((value, index) =>
      normalizeSafePath(value, `layer '${name}' roots[${index}]`),
    );
    const excludes = layer.excludes.map((value, index) =>
      normalizeSafePath(value, `layer '${name}' excludes[${index}]`),
    );
    const reconcile = layer.reconcile.map((value, index) =>
      normalizeSafePath(value, `layer '${name}' reconcile[${index}]`),
    );

    for (const root of roots) {
      const protectedRoot = protectedRoots.find((candidate) => pathsOverlap(root, candidate));
      if (protectedRoot) {
        throw new Error(
          `layer '${name}' root '${root}' overlaps protected root '${protectedRoot}'`,
        );
      }
      const owner = ownedRoots.find((entry) => pathsOverlap(root, entry.root));
      if (owner) {
        throw new Error(
          `layer '${name}' root '${root}' overlaps root '${owner.root}' owned by '${owner.name}'`,
        );
      }
      if (checkExists) assertConfinedExistingPath(repoRoot, root, `layer '${name}' root`);
      ownedRoots.push({ name, root });
    }

    for (const excludedPath of excludes) {
      if (!roots.some((root) => isSameOrNested(excludedPath, root))) {
        throw new Error(`layer '${name}' exclude '${excludedPath}' is outside its owned roots`);
      }
    }
    for (const integrationPath of reconcile) {
      const protectedRoot = protectedRoots.find((candidate) =>
        pathsOverlap(integrationPath, candidate),
      );
      if (protectedRoot) {
        throw new Error(
          `layer '${name}' reconcile path '${integrationPath}' overlaps protected root '${protectedRoot}'`,
        );
      }
      if (checkExists) {
        assertConfinedExistingPath(repoRoot, integrationPath, `layer '${name}' reconcile path`);
      }
    }
  }

  for (const [name] of layerEntries) resolveLayerNames(manifest, name);

  return {
    schemaVersion: manifest.schemaVersion,
    layerCount: layerEntries.length,
    ownedRootCount: ownedRoots.length,
  };
}

export function resolveLayerScope(manifest, scope) {
  validateLayerManifest(manifest, { checkExists: false });
  const layerNames = Object.keys(manifest.layers);
  const layers =
    scope === "all"
      ? [...new Set(layerNames.flatMap((name) => resolveLayerNames(manifest, name)))]
      : resolveLayerNames(manifest, scope);
  return {
    scope,
    schemaVersion: manifest.schemaVersion,
    layers,
    roots: [...new Set(layers.flatMap((name) => manifest.layers[name].roots))],
    excludes: [...new Set(layers.flatMap((name) => manifest.layers[name].excludes))],
    reconcile: [...new Set(layers.flatMap((name) => manifest.layers[name].reconcile))],
    verify: [...new Set(layers.flatMap((name) => manifest.layers[name].verify))],
  };
}

function resolveLayerNames(manifest, name, visiting = new Set(), resolved = []) {
  const layer = manifest.layers?.[name];
  if (!layer) {
    throw new Error(
      `unknown layer '${name || ""}'; expected one of: ${Object.keys(manifest.layers || {}).join(", ")}, all`,
    );
  }
  if (visiting.has(name)) throw new Error(`dependency cycle includes '${name}'`);
  if (resolved.includes(name)) return resolved;
  visiting.add(name);
  for (const dependency of layer.dependsOn) {
    resolveLayerNames(manifest, dependency, visiting, resolved);
  }
  visiting.delete(name);
  resolved.push(name);
  return resolved;
}

function assertStringArray(value, label, options = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  if (options.nonEmpty && value.length === 0) throw new Error(`${label} must not be empty`);
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
}

function assertObjectKeys(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function normalizeSafePath(value, label) {
  const normalizedSeparators = value.replace(/\\/g, "/");
  const normalized = path.posix.normalize(normalizedSeparators);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedSeparators) ||
    normalized !== normalizedSeparators.replace(/\/$/, "")
  ) {
    throw new Error(`${label} has unsafe or non-canonical path '${value}'`);
  }
  return normalized;
}

function pathsOverlap(left, right) {
  return isSameOrNested(left, right) || isSameOrNested(right, left);
}

function isSameOrNested(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function assertConfinedExistingPath(repoRoot, relativePath, label) {
  const target = path.join(repoRoot, relativePath);
  if (!fs.existsSync(target)) throw new Error(`${label} is missing: ${relativePath}`);
  const repoReal = fs.realpathSync(repoRoot);
  const targetReal = fs.realpathSync(target);
  if (targetReal !== repoReal && !targetReal.startsWith(`${repoReal}${path.sep}`)) {
    throw new Error(`${label} resolves outside the repository: ${relativePath}`);
  }
}

function printList(manifest) {
  for (const [name, layer] of Object.entries(manifest.layers)) {
    console.log(`${name}\t${layer.description}`);
  }
  console.log("all\tComposite of every distributable layer.");
}

export function runLayerCli(argv = process.argv.slice(2), options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const manifest = options.manifest || loadLayerManifest(repoRoot);
  const [command = "list", scope, ...extra] = argv;
  if (extra.length) throw new Error(`unexpected arguments: ${extra.join(" ")}`);
  const summary = validateLayerManifest(manifest, { repoRoot });

  if (command === "list") {
    if (scope) throw new Error("list does not accept a layer name");
    printList(manifest);
  } else if (command === "show" || command === "plan") {
    if (!scope) throw new Error(`${command} requires a layer name`);
    console.log(JSON.stringify(resolveLayerScope(manifest, scope), null, 2));
  } else if (command === "verify") {
    if (scope) throw new Error("verify does not accept a layer name");
    console.log(
      `GKE layer manifest v${summary.schemaVersion} passed: ${summary.layerCount} layers, ${summary.ownedRootCount} owned roots.`,
    );
  } else {
    throw new Error("expected one of: list, show <layer>, plan <layer>, verify");
  }
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  try {
    runLayerCli();
  } catch (error) {
    console.error(`gke-layers: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
