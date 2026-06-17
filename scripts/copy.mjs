#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"]);
const sourceRoot = path.resolve(String(args.source ?? "../learning-sap-tutor"));
const destRoot = path.resolve(String(args.dest ?? "."));
const manifestPath = path.join(destRoot, "copy-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const forbidden = manifest.forbidAlways ?? [];
const planned = [];

for (const entry of manifest.copy ?? []) {
  const sourcePath = path.join(sourceRoot, entry.src);
  const destPath = path.join(destRoot, entry.dest);
  const exists = await pathExists(sourcePath);

  if (!exists) {
    planned.push({ action: "missing", src: entry.src, dest: entry.dest });
    continue;
  }

  const files = await listFiles(sourcePath);
  for (const file of files) {
    const rel = toPosix(path.relative(sourcePath, file));
    const srcRel = toPosix(path.join(entry.src, rel));
    const destRel = toPosix(path.join(entry.dest, rel));

    if (entry.include && !matchesAny(rel, entry.include)) continue;
    if (entry.exclude && matchesAny(rel, entry.exclude)) continue;

    if (matchesAny(srcRel, forbidden) || matchesAny(destRel, forbidden)) {
      planned.push({ action: "blocked", src: srcRel, dest: destRel });
      continue;
    }

    planned.push({ action: "copy", src: srcRel, dest: destRel });

    if (!dryRun) {
      const finalDest = path.join(destRoot, destRel);
      await mkdir(path.dirname(finalDest), { recursive: true });
      await cp(file, finalDest, { force: true });
    }
  }
}

for (const item of planned) {
  console.log(`${item.action.padEnd(7)} ${item.src} -> ${item.dest}`);
}

const blocked = planned.filter((item) => item.action === "blocked");
if (blocked.length > 0) {
  console.error(`\nRefusing to continue: ${blocked.length} forbidden path(s) matched.`);
  process.exitCode = 1;
}

if (dryRun) {
  const copyCount = planned.filter((item) => item.action === "copy").length;
  const missingCount = planned.filter((item) => item.action === "missing").length;
  console.log(`\nDry run complete: ${copyCount} file(s) would copy, ${missingCount} source path(s) missing.`);
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const out = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(glob) {
  const normalized = toPosix(glob);
  let source = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`(^|/)${source}($|/)`);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
