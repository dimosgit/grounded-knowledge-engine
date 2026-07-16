import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..", "..");
const tsxCli = path.join(appRoot, "node_modules", "tsx", "dist", "cli.mjs");

function runChecker(script: string, args: string[] = [], env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [tsxCli, path.join(appRoot, "scripts", script), ...args],
      { cwd: appRoot, encoding: "utf8", env: { ...process.env, ...env } },
    );
    return { code: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/**
 * Build a minimal governed workspace fixture: one module owning one healthy
 * topic plus one topic with governance smells (bad naming prefix, no index
 * link would be a failure — so it is linked; the smells are warnings only).
 */
function createGovernedFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gke-governance-"));
  const write = (rel: string, content: string) => {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  };

  write(
    "kb/modules/topic-ownership.json",
    JSON.stringify({
      tracks: { domain: {} },
      moduleTracks: { "agent-runtime": "domain" },
      governance: {
        namingPrefixes: ["kb-"],
        namingLegacyAllowlist: [],
      },
      owners: {
        "kb-transport-basics.md": "agent-runtime",
        "oddly-named-topic.md": "agent-runtime",
      },
    }),
  );
  write(
    "kb/modules/agent-runtime.md",
    [
      "# Agent Runtime Module",
      "## Scope",
      "- Runtime behavior.",
      "## Topic Links",
      "- [KB Transport Basics](../topics/kb-transport-basics.md)",
      "- [Oddly Named Topic](../topics/oddly-named-topic.md)",
    ].join("\n"),
  );
  const frontmatter = [
    "---",
    "module: agent-runtime",
    "track: domain",
    "status: canonical",
    "type: concept",
    "owner: kb-curator",
    "updated: 2026-07-01",
    "tags: domain, runtime",
    "---",
  ].join("\n");
  write("kb/topics/kb-transport-basics.md", `${frontmatter}\n# KB Transport Basics\n\nBody.\n`);
  write("kb/topics/oddly-named-topic.md", `${frontmatter}\n# Oddly Named Topic\n\nBody.\n`);
  write(
    "kb/index.md",
    [
      "# Index",
      "- [KB Transport Basics](./topics/kb-transport-basics.md)",
      "- [Oddly Named Topic](./topics/oddly-named-topic.md)",
    ].join("\n"),
  );
  return root;
}

describe("governance scripts", () => {
  test("ownership checker passes a governed fixture and reports naming warnings", () => {
    const fixture = createGovernedFixture();
    try {
      const result = runChecker("check-topic-module-ownership.ts", [], {
        KB_PREVIEW_REPO_ROOT: fixture,
      });
      expect(result.code).toBe(0);
      expect(result.output).toMatch(/Ownership check passed for 2 topics/);
      expect(result.output).toMatch(/does not follow preferred naming prefixes/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("ownership checker fails the governed fixture when a topic loses its owner", () => {
    const fixture = createGovernedFixture();
    try {
      const ownershipPath = path.join(fixture, "kb", "modules", "topic-ownership.json");
      const ownership = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
      delete ownership.owners["oddly-named-topic.md"];
      fs.writeFileSync(ownershipPath, JSON.stringify(ownership));

      const result = runChecker("check-topic-module-ownership.ts", [], {
        KB_PREVIEW_REPO_ROOT: fixture,
      });
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/No owner module assigned for topic: oddly-named-topic\.md/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("ownership checker skips with a notice when the workspace is ungoverned", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "gke-ungoverned-"));
    try {
      const result = runChecker("check-topic-module-ownership.ts", [], {
        KB_PREVIEW_REPO_ROOT: fixture,
      });
      expect(result.code).toBe(0);
      expect(result.output).toMatch(/ownership checks skipped/i);

      const strict = runChecker("check-topic-module-ownership.ts", ["--require-ownership"], {
        KB_PREVIEW_REPO_ROOT: fixture,
      });
      expect(strict.code).toBe(1);
      expect(strict.output).toMatch(/required governance inputs are missing/i);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("digest and cadence checkers skip with a notice when inputs are absent", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "gke-ungoverned-"));
    try {
      const digests = runChecker("check-kb-digests.ts", [], { KB_PREVIEW_REPO_ROOT: fixture });
      expect(digests.code).toBe(0);
      expect(digests.output).toMatch(/digest checks skipped/i);

      const cadence = runChecker("check-kb-maintenance-cadence.ts", [], {
        KB_PREVIEW_REPO_ROOT: fixture,
      });
      expect(cadence.code).toBe(0);
      expect(cadence.output).toMatch(/cadence checks skipped/i);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
