import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readProductionSources, validateImportBoundaries } from "./import-boundaries.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
for (const source of [
  'import { parseDecision } from "../../../../tools/decisions/decision-parser";',
  'export type { DecisionRecord } from "../../../../tools/decisions/types";',
  'const api = import("../../../../tools/projects/index");',
  'import fs from "node:fs";',
  'import fs = require("node:fs");',
]) {
  assert.throws(
    () => validateImportBoundaries(new Map([["apps/cockpit/src/domain/new-file.ts", source]])),
    /forbidden/,
  );
}
assert.throws(
  () =>
    validateImportBoundaries(
      new Map([["packages/contracts/src/new.ts", 'import fs from "node:fs";']]),
    ),
  /forbidden/,
);
assert.throws(
  () =>
    validateImportBoundaries(
      new Map([
        ["tools/a.ts", 'import "./b.js";'],
        ["tools/b.ts", 'import "./a.js";'],
      ]),
    ),
  /Runtime import cycle/,
);
validateImportBoundaries(
  new Map([
    ["tools/a.ts", 'import type { B } from "./b.js";'],
    ["tools/b.ts", 'import type { A } from "./a.js";'],
  ]),
);
const result = validateImportBoundaries(readProductionSources(repoRoot));
console.log(`Import boundaries passed: ${result.files} production files; no runtime cycles.`);
