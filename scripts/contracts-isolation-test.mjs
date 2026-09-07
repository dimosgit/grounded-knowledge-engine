import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "gke-contracts-isolated-"));
try {
  fs.cpSync(path.join(root, "packages/contracts"), path.join(isolated, "contracts"), {
    recursive: true,
  });
  for (const test of ["project-contract-test.ts", "decision-contract-test.ts"]) {
    execFileSync(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), path.join(isolated, "contracts", test)],
      { cwd: isolated, stdio: "pipe" },
    );
  }
  console.log("Contracts pass without engine or Cockpit source present.");
} finally {
  fs.rmSync(isolated, { recursive: true, force: true });
}
