import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = fs.realpathSync(path.resolve(here, "../.."));
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const inside = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

// Resolve existing ancestors too, so symlinked parents cannot bypass the boundary.
export function canonical(target) {
  const absolute = path.resolve(target);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent = path.dirname(absolute);
  if (parent === absolute) throw new Error("Cannot resolve output directory");
  return path.join(canonical(parent), path.basename(absolute));
}

export function external(target) {
  const resolved = canonical(target);
  if (inside(repo, resolved) || inside(resolved, repo)) {
    throw new Error("Output must not overlap the repository");
  }
  return resolved;
}

export function snapshot(root) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Symlinked work root is not allowed");
  const result = {};
  function walk(directory, prefix = "") {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed in pilot artifacts");
      if (entry.isDirectory()) walk(file, name + "/");
      else if (entry.isFile()) result[name] = hash(fs.readFileSync(file));
      else throw new Error("Only regular files are allowed in pilot artifacts");
    }
  }
  walk(root);
  return result;
}

export function evaluatorHashes() {
  return Object.fromEntries(
    ["common.mjs", "prepare.mjs", "evaluate.mjs", "cases.mjs", "fixtures/catalog.mjs"].map(
      (name) => [name, hash(fs.readFileSync(path.join(here, name)))],
    ),
  );
}

export function isMain(url) {
  return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);
}

export function cli(run) {
  try {
    run();
  } catch (error) {
    // Avoid echoing data from worker files or raw session input.
    console.error(error.message);
    process.exitCode = 1;
  }
}
