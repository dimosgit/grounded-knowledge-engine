import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPaths } from "../../scripts/sync-lib";

const originalSourceFolders = process.env.KB_PREVIEW_SOURCE_FOLDERS;

afterEach(() => {
  if (originalSourceFolders === undefined) {
    delete process.env.KB_PREVIEW_SOURCE_FOLDERS;
  } else {
    process.env.KB_PREVIEW_SOURCE_FOLDERS = originalSourceFolders;
  }
});

describe("content sync boundary", () => {
  it("uses the public demo corpus exclusively for public builds", () => {
    process.env.KB_PREVIEW_SOURCE_FOLDERS = "kb:kb,private-notes:kb";

    expect(getPaths({ publicOnly: true }).sourceFolders).toEqual([{ from: "demo-kb", to: "kb" }]);
  });

  it("keeps the private workspace available to the local preview", () => {
    delete process.env.KB_PREVIEW_SOURCE_FOLDERS;

    expect(getPaths().sourceFolders).toEqual([
      { from: "demo-kb", to: "kb" },
      { from: "kb", to: "kb" },
    ]);
  });

  it("forces the public-only mode in the production build lifecycle", async () => {
    const { appRoot } = getPaths({ publicOnly: true });
    const packageJson = JSON.parse(
      await fs.readFile(path.join(appRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.prebuild).toBe("npm run sync:content -- --public");
  });
});
