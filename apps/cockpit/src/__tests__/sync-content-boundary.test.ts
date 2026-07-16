import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPaths } from "../../scripts/sync-lib";

const originalSourceFolders = process.env.KB_PREVIEW_SOURCE_FOLDERS;
const originalRepoRoot = process.env.KB_PREVIEW_REPO_ROOT;

afterEach(() => {
  if (originalSourceFolders === undefined) {
    delete process.env.KB_PREVIEW_SOURCE_FOLDERS;
  } else {
    process.env.KB_PREVIEW_SOURCE_FOLDERS = originalSourceFolders;
  }
  if (originalRepoRoot === undefined) {
    delete process.env.KB_PREVIEW_REPO_ROOT;
  } else {
    process.env.KB_PREVIEW_REPO_ROOT = originalRepoRoot;
  }
});

describe("content sync boundary", () => {
  it("uses the public demo corpus exclusively for public builds", () => {
    process.env.KB_PREVIEW_SOURCE_FOLDERS = "kb:kb,private-notes:kb";

    expect(getPaths({ publicOnly: true }).sourceFolders).toEqual([{ from: "demo-kb", to: "kb" }]);
  });

  it("keeps the private workspace available to the local preview", () => {
    delete process.env.KB_PREVIEW_SOURCE_FOLDERS;
    // A workspace's ui.sourceFolders may override the defaults, so pin the
    // repo root to a bare fixture without a workspace configuration.
    const bareRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "gke-sync-boundary-"));
    process.env.KB_PREVIEW_REPO_ROOT = bareRoot;

    try {
      expect(getPaths().sourceFolders).toEqual([
        { from: "demo-kb", to: "kb" },
        { from: "kb", to: "kb" },
      ]);
    } finally {
      fsSync.rmSync(bareRoot, { recursive: true, force: true });
    }
  });

  it("forces the public-only mode in the production build lifecycle", async () => {
    const { appRoot } = getPaths({ publicOnly: true });
    const packageJson = JSON.parse(
      await fs.readFile(path.join(appRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.prebuild).toBe("npm run sync:content -- --public");
  });
});
