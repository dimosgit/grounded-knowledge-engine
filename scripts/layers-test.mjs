#!/usr/bin/env node
import assert from "node:assert/strict";
import { loadLayerManifest, resolveLayerScope, validateLayerManifest } from "./layers.mjs";

const manifest = loadLayerManifest();
const summary = validateLayerManifest(manifest);
assert.equal(summary.schemaVersion, 1);
assert.equal(summary.layerCount, 4);

const ui = resolveLayerScope(manifest, "ui");
assert.deepEqual(ui.layers, ["contracts", "ui"]);
assert.deepEqual(ui.roots, ["packages/contracts", "apps/cockpit"]);
assert.deepEqual(ui.excludes, [
  "apps/cockpit/content",
  "apps/cockpit/dist",
  "apps/cockpit/node_modules",
]);
assert.deepEqual(ui.reconcile, ["package.json", "tsconfig.json"]);
assert.ok(ui.verify.includes("npm run test:contracts"));
assert.ok(ui.verify.includes("npm --prefix apps/cockpit run build"));

const all = resolveLayerScope(manifest, "all");
assert.deepEqual(all.layers, ["contracts", "core", "ui", "demo"]);
assert.ok(!all.roots.includes("kb"));

assert.throws(
  () => validateFixture({ roots: ["."], protectedRoots: ["kb"] }),
  /unsafe or non-canonical path/,
);
assert.throws(
  () => validateLayerManifest({ ...manifest, schemaVersion: 2 }, { checkExists: false }),
  /unsupported schemaVersion/,
);
assert.throws(
  () => validateLayerManifest({ ...manifest, unexpected: true }, { checkExists: false }),
  /unknown keys/,
);
assert.throws(
  () => validateFixture({ roots: ["kb/topics"], protectedRoots: ["kb"] }),
  /overlaps protected root/,
);
assert.throws(
  () =>
    validateFixture({
      roots: ["apps/cockpit"],
      excludes: ["kb"],
      protectedRoots: ["kb"],
    }),
  /outside its owned roots/,
);
assert.throws(
  () => validateFixture({ roots: ["tools"], reconcile: ["kb"], protectedRoots: ["kb"] }),
  /reconcile path.*overlaps protected root/,
);
assert.throws(
  () =>
    validateLayerManifest(
      {
        schemaVersion: 1,
        protectedRoots: ["kb"],
        layers: {
          first: layer(["tools"], ["second"]),
          second: layer(["packages/contracts"], ["first"]),
        },
      },
      { checkExists: false },
    ),
  /dependency cycle/,
);
assert.throws(() => resolveLayerScope(manifest, "missing"), /unknown layer/);

console.log(
  `GKE layer manifest v${summary.schemaVersion} passed: ${summary.layerCount} layers, ${summary.ownedRootCount} owned roots.`,
);

function validateFixture({ roots, excludes = [], reconcile = [], protectedRoots }) {
  return validateLayerManifest(
    {
      schemaVersion: 1,
      protectedRoots,
      layers: { fixture: layer(roots, [], excludes, reconcile) },
    },
    { checkExists: false },
  );
}

function layer(roots, dependsOn = [], excludes = [], reconcile = []) {
  return {
    description: "Test layer",
    roots,
    excludes,
    reconcile,
    dependsOn,
    verify: ["test command"],
  };
}
