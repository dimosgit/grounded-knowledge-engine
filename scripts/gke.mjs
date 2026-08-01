#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const [command, ...rest] = process.argv.slice(2);

function printHelp() {
  console.log(`Grounded Knowledge Engine ${packageJson.version}

Usage:
  gke setup [options]             Configure GKE for Codex, Claude, Gemini, and Copilot
  gke demo [directory]            Create a writable demo workspace (default: gke-demo)
  gke project <command>           Create, inspect, validate, or resume a project
  gke capture <command>           Review pending capture proposals
  gke decisions <command>         Manage durable decision records
  gke review [project-id]         Show project attention and recent changes
  gke --version                   Print the installed version

Start here:
  gke demo
  cd gke-demo
  gke setup

Then restart Codex or Claude from that directory.`);
}

function runSetup(args) {
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot, "scripts", "configure-mcp.mjs"), ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, GKE_MCP_CONFIG_ROOT: process.cwd() },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function createDemo(args) {
  if (args.some((arg) => arg.startsWith("-")) || args.length > 1) {
    throw new Error("Usage: gke demo [directory]");
  }
  const requestedTarget = args[0] || "gke-demo";
  const target = path.resolve(process.cwd(), requestedTarget);
  if (existsSync(target)) {
    throw new Error(`Demo target already exists: ${target}`);
  }

  const source = path.join(packageRoot, "examples", "demo-project-workspace");
  if (!existsSync(source)) {
    throw new Error("The packaged demo workspace is missing. Reinstall GKE and try again.");
  }

  cpSync(source, target, { recursive: true, errorOnExist: true });
  mkdirSync(path.join(target, ".gke"), { recursive: true });
  writeFileSync(
    path.join(target, ".gke", "workspace.json"),
    `${JSON.stringify(
      {
        id: "gke-demo",
        label: "GKE Demo",
        scanRoots: ["kb"],
        writeRoots: ["kb", ".gke", ".cache"],
        readOnly: false,
        sensitivity: "personal",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  console.log(`Created the GKE demo workspace at ${target}

Next:
  cd ${requestedTarget}
  gke setup

Then restart Codex or Claude from that directory and ask:
  Use GKE to resume the router-rollout project.`);
  return 0;
}

async function run() {
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageJson.version);
    return 0;
  }
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "setup") return runSetup(rest);
  if (command === "demo") return createDemo(rest);

  const cliEntry = path.join(packageRoot, "dist", "tools", "cli.js");
  if (!existsSync(cliEntry)) {
    throw new Error("The compiled GKE CLI is missing. Reinstall GKE and try again.");
  }
  const { runGkeCli } = await import(pathToFileURL(cliEntry).href);
  return runGkeCli([command, ...rest], process.cwd());
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
