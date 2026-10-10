#!/usr/bin/env node
/**
 * Local mirror of .github/workflows/ci.yml, so failures surface before push.
 *
 * Selects CI gates by the paths that differ from the upstream branch
 * (committed, staged, unstaged, and untracked) and always runs the full
 * sanitization gate, including the machine-local overlay that CI cannot see.
 *
 *   npm run verify            # gates for changed paths
 *   npm run verify -- --all   # every CI gate
 *   npm run verify -- --list  # print the plan without running it
 *
 * CI also runs `npm run setup:mcp -- --skip-smoke`; it is skipped here because
 * it rewrites the local client settings.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cockpit = path.join(repoRoot, "apps/cockpit");
const args = new Set(process.argv.slice(2));
const runAll = args.has("--all");
const listOnly = args.has("--list");

function git(...gitArgs) {
  try {
    return execFileSync("git", gitArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") || "origin/main";
const base = git("merge-base", "HEAD", upstream);
const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
const changed = new Set(
  [base ? git("diff", "--name-only", `${base}...HEAD`) : "", git("diff", "--name-only", "HEAD")]
    .join("\n")
    .split("\n")
    .concat(untracked)
    .filter(Boolean),
);

const touches = (...prefixes) =>
  runAll || [...changed].some((file) => prefixes.some((p) => file === p || file.startsWith(p)));
const rootFile = (pattern) =>
  runAll || [...changed].some((file) => !file.includes("/") && pattern.test(file));

const pilot = touches("scripts/workflow-pilot/");
const contracts = touches("packages/contracts/");
const engine =
  contracts ||
  touches(
    "tools/",
    "scripts/",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "eslint.config.js",
    "gke.layers.json",
    "copy-manifest.json",
  ) ||
  rootFile(/\.ts$/);
// Prettier also gates root-level *.md and *.json, so docs-only changes still need it.
const format = engine || touches(".prettierrc.json", ".prettierignore") || rootFile(/\.(json|md)$/);
const ui = contracts || touches("apps/cockpit/", "demo-kb/");

/** @type {Array<[label: string, cwd: string, cmd: string, args: string[]]>} */
const steps = [];
if (engine) {
  steps.push(
    ["Engine typecheck", repoRoot, "npm", ["run", "typecheck"]],
    ["Engine lint", repoRoot, "npm", ["run", "lint"]],
  );
}
if (format) steps.push(["Engine format check", repoRoot, "npm", ["run", "format:check"]]);
if (engine) {
  steps.push(
    ["Engine build", repoRoot, "npm", ["run", "build"]],
    ["Complete engine verification", repoRoot, "npm", ["run", "test:gke"]],
  );
}
if (pilot) {
  steps.push(
    ["Workflow pilot verification", repoRoot, "npm", ["run", "test:workflow-pilot"]],
    ["Workflow pilot lint", repoRoot, "npx", ["eslint", "scripts/workflow-pilot/**/*.mjs"]],
  );
}
if (ui) {
  steps.push(
    ["Cockpit core compatibility", cockpit, "npm", ["run", "check:core"]],
    ["Cockpit typecheck", cockpit, "npm", ["run", "typecheck"]],
    ["Cockpit lint", cockpit, "npm", ["run", "lint"]],
    ["Cockpit format check", cockpit, "npm", ["run", "format:check"]],
    // Test and build both sync Markdown into apps/cockpit/content, so they run in sequence.
    ["Cockpit test", cockpit, "npm", ["run", "test"]],
    ["Cockpit build", cockpit, "npm", ["run", "build"]],
    ["Production bundle boundary", cockpit, "npm", ["run", "test:production-boundary"]],
    ["Initial bundle budget", cockpit, "npm", ["run", "test:bundle-budget"]],
  );
}
steps.push(["Sanitization gate (full, with local overlay)", repoRoot, "npm", ["run", "scrub"]]);

console.log(
  `verify-local: ${changed.size} changed path(s) vs ${upstream}; ${runAll ? "all gates" : `engine=${engine} format=${format} pilot=${pilot} ui=${ui}`}`,
);
for (const [label] of steps) console.log(`  - ${label}`);
if (untracked.length) {
  console.log(
    `  ! ${untracked.length} untracked file(s) are not scrubbed until staged: ${untracked.slice(0, 5).join(", ")}${untracked.length > 5 ? ", …" : ""}`,
  );
}
if (listOnly) process.exit(0);

// CI installs with `npm ci`, so direct dependencies must match the lockfile or
// tools such as prettier report different results locally.
const trees = [[repoRoot, "npm ci"]];
if (ui) trees.push([cockpit, "npm --prefix apps/cockpit ci"]);
for (const [tree, hint] of trees) {
  const modules = path.join(tree, "node_modules");
  if (!existsSync(modules)) {
    console.error(
      `verify-local: missing ${path.relative(repoRoot, modules)}; run \`${hint}\` first.`,
    );
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(path.join(tree, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(tree, "package-lock.json"), "utf8"));
  const drift = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
    (name) => {
      const locked = lock.packages?.[`node_modules/${name}`]?.version;
      const installedPath = path.join(modules, name, "package.json");
      const installed = existsSync(installedPath)
        ? JSON.parse(readFileSync(installedPath, "utf8")).version
        : undefined;
      return locked && installed !== locked;
    },
  );
  if (drift.length) {
    console.error(
      `verify-local: ${path.relative(repoRoot, modules) || "node_modules"} differs from the lockfile (${drift.join(", ")}); run \`${hint}\` first.`,
    );
    process.exit(1);
  }
}

const started = Date.now();
for (const [label, cwd, cmd, cmdArgs] of steps) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✖ verify-local failed at: ${label}`);
    process.exit(result.status ?? 1);
  }
}
console.log(
  `\n✔ verify-local passed (${steps.length} gates, ${Math.round((Date.now() - started) / 1000)}s)`,
);
