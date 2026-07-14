import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertProductionBoundary,
  forbiddenLocalEndpointMarkers,
} from "../../scripts/production-boundary";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gke-production-boundary-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("production bundle boundary", () => {
  it("fails when the production build directory is missing", async () => {
    const directory = await temporaryDirectory();

    await expect(assertProductionBoundary(path.join(directory, "dist"))).rejects.toThrow(
      "Production build directory is missing.",
    );
  });

  it("accepts a production bundle without local-only endpoint markers", async () => {
    const directory = await temporaryDirectory();
    await fs.mkdir(path.join(directory, "assets"), { recursive: true });
    await fs.writeFile(path.join(directory, "assets", "app.js"), "console.log('public preview');");

    await expect(assertProductionBoundary(directory)).resolves.toBeUndefined();
  });

  it("reports every forbidden marker and relative artifact path without artifact contents", async () => {
    const directory = await temporaryDirectory();
    await fs.mkdir(path.join(directory, "assets"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "assets", "app.js"),
      `${forbiddenLocalEndpointMarkers.join("\n")}\nprivate artifact body`,
    );

    await expect(assertProductionBoundary(directory)).rejects.toThrow(
      `${forbiddenLocalEndpointMarkers.join(" assets/app.js\n")} assets/app.js`,
    );
    await expect(assertProductionBoundary(directory)).rejects.not.toThrow("private artifact body");
  });
});
