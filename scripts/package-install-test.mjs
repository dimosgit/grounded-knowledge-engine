#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(path.join(tmpdir(), "gke-package-install-"));
const packOutput = path.join(sandbox, "pack");
const installPrefix = path.join(sandbox, "install");
const demoParent = path.join(sandbox, "workspace");
const npmCache = path.join(sandbox, "npm-cache");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

function run(executable, args, options = {}) {
  const { env, ...rest } = options;
  return execFileSync(executable, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...rest,
    env: { ...process.env, npm_config_cache: npmCache, ...env },
  });
}

try {
  mkdirSync(packOutput, { recursive: true });
  mkdirSync(demoParent, { recursive: true });
  const tarballName = run(npmBin, ["pack", "--pack-destination", packOutput, "--json"], {
    cwd: repoRoot,
  });
  const packResult = JSON.parse(tarballName);
  assert.equal(packResult.length, 1);
  const tarball = path.join(packOutput, packResult[0].filename);
  assert.ok(existsSync(tarball), "npm pack must create the release artifact");
  const packedPaths = new Set(packResult[0].files.map((file) => file.path));
  for (const requiredPath of [
    ".github/copilot-instructions.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "skills/grounded-knowledge-workflow/SKILL.md",
    "skills/grounded-knowledge-workflow/agents/openai.yaml",
  ]) {
    assert.ok(packedPaths.has(requiredPath), `release artifact must include ${requiredPath}`);
  }

  run(npmBin, ["install", "--global", "--prefix", installPrefix, tarball]);
  const gkeBin =
    process.platform === "win32"
      ? path.join(installPrefix, "gke.cmd")
      : path.join(installPrefix, "bin", "gke");
  assert.ok(existsSync(gkeBin), "the installed package must expose the gke executable");
  assert.equal(run(gkeBin, ["--version"]).trim(), "0.2.1");

  run(gkeBin, ["demo", "golden-path"], { cwd: demoParent });
  const demoRoot = path.join(demoParent, "golden-path");
  assert.ok(existsSync(path.join(demoRoot, "kb", "projects", "router-rollout", "project.md")));

  run(gkeBin, ["setup", "--client=codex"], { cwd: demoRoot });
  const codexConfig = readFileSync(path.join(demoRoot, ".codex", "config.toml"), "utf8");
  assert.match(codexConfig, /^\[mcp_servers\.kb\]$/m);
  assert.match(codexConfig, /dist\/tools\/kb-mcp-server\/server\.js/);
  assert.doesNotMatch(codexConfig, /tsx/);
  assert.match(
    codexConfig,
    new RegExp(`KB_MCP_REPO_ROOT = ${JSON.stringify(realpathSync(demoRoot))}`),
  );

  const resume = run(gkeBin, ["project", "resume", "router-rollout", "--repo-root", demoRoot], {
    cwd: demoRoot,
  });
  assert.match(resume, /## Do next/);
  assert.match(resume, /Router Rollout/);

  console.log("Packaged CLI install, setup, smoke, demo, and resume test passed.");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
