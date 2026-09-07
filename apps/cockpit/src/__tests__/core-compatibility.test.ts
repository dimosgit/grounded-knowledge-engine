import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { assertCoreCompatibility } from "../../scripts/core-compatibility";

test("UI-only updates accept compatible cores and reject legacy or breaking cores during verification", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-core-compatibility-"));
  try {
    await expect(assertCoreCompatibility(root)).rejects.toThrow("Update the core scope");
    await fs.mkdir(path.join(root, "tools"));
    await fs.writeFile(
      path.join(root, "tools/core-api.json"),
      JSON.stringify({ cockpitApiVersion: 1 }),
    );
    await expect(assertCoreCompatibility(root)).resolves.toBeUndefined();
    await fs.writeFile(
      path.join(root, "tools/core-api.json"),
      JSON.stringify({ cockpitApiVersion: 2 }),
    );
    await expect(assertCoreCompatibility(root)).rejects.toThrow("requires core API 1");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
