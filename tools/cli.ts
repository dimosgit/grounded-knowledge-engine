#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCaptureCli } from "./capture/cli.js";
import { runProjectCli } from "./projects/cli.js";

export async function runGkeCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "capture") return runCaptureCli(rest, cwd);
  return runProjectCli(argv, cwd);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runGkeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
