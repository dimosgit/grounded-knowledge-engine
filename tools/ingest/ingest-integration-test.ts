#!/usr/bin/env node
/**
 * Ingestion end-to-end test: feed real PDF / DOCX / XLSX fixtures through the
 * ingest CLI into a throwaway sandbox KB, then prove that content which exists
 * ONLY inside each binary file is retrievable and cited by the grounding engine.
 *
 * Also checks the secret-scrub stage. Run with: `npm run test:ingest`.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnKbServer } from "../kb-mcp-server/mcp-client.js";
import { normalizeDocument } from "./normalize.js";
import { FIXTURE_TOKENS } from "./fixtures/tokens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const ingestEntry = path.join(__dirname, "ingest.ts");

async function seedSandboxKb(repoRoot: string): Promise<void> {
  const kb = path.join(repoRoot, "kb");
  await fs.mkdir(path.join(kb, "topics"), { recursive: true });
  await fs.mkdir(path.join(kb, "terms"), { recursive: true });
  await fs.writeFile(path.join(kb, "index.md"), "# Sandbox KB\n\nThrowaway KB for the ingestion test.\n", "utf8");
  await fs.writeFile(path.join(kb, "terms", "RAP.md"), "# RAP\n\nSeed evidence so the index is non-empty.\n", "utf8");
}

function runIngestCli(repoRoot: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", ingestEntry, fixturesDir, "--module", "general"],
      {
        env: { ...process.env, KB_MCP_REPO_ROOT: repoRoot, KB_MCP_SCAN_ROOTS: "kb", KB_MCP_LOG_LEVEL: "error" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (c) => process.stdout.write(c));
    child.stderr.on("data", (c) => process.stderr.write(c));
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function scrubCheck(): void {
  // Synthetic, non-real secrets assembled at runtime so the literals never land
  // in source — the scrubber sees the full strings, but the repo (and the
  // gitleaks scrub gate) never does.
  const fakeAwsKey = "AKIA" + "1234567890ABCDEF";
  const fakePassword = "hunter2" + "supersecretvalue";
  const sample = `Deploy notes.\napi_key = ${fakeAwsKey}\npassword: ${fakePassword}\nNormal prose continues.`;
  const result = normalizeDocument(sample, { sourceFile: "notes.txt", scrub: true });
  const body = result.notes[0].body;
  assert.ok(result.redactions >= 2, `Expected secrets to be redacted, got ${result.redactions}.`);
  assert.ok(body.includes("[REDACTED]"), "Scrubbed body should contain a [REDACTED] marker.");
  assert.ok(!body.includes(fakeAwsKey), "AWS key must not survive scrubbing.");
  assert.ok(!body.includes(fakePassword), "Password value must not survive scrubbing.");
  assert.ok(body.includes("Normal prose continues."), "Scrubbing must not destroy normal prose.");
}

async function main(): Promise<void> {
  scrubCheck();

  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-ingest-"));
  let serverChild: ChildProcessWithoutNullStreams | null = null;
  try {
    await seedSandboxKb(repoRoot);

    const code = await runIngestCli(repoRoot);
    assert.equal(code, 0, "Ingest CLI exited non-zero.");

    // The three documents became distinct, non-colliding notes on disk.
    for (const slug of ["sample-pdf", "sample-docx", "sample-xlsx", "sample-md"]) {
      const p = path.join(repoRoot, "kb", "topics", `${slug}.md`);
      await fs.access(p).catch(() => {
        throw new Error(`Expected ingested note not found: kb/topics/${slug}.md`);
      });
    }

    const { child, client } = spawnKbServer({
      KB_MCP_REPO_ROOT: repoRoot,
      KB_MCP_SCAN_ROOTS: "kb",
      KB_MCP_PROFILE: "full",
      KB_MCP_LOG_LEVEL: "error",
    });
    serverChild = child;
    await client.initialize("gke-ingest-verify");

    for (const [format, token] of Object.entries(FIXTURE_TOKENS)) {
      // Retrieval: the token (which lived only inside the binary) is searchable.
      const search = await client.callTool("kb.search", { query: token, limit: 5 });
      const hits = (search.structuredContent?.hits || []) as any[];
      assert.ok(hits.length > 0, `[${format}] token ${token} not retrievable after ingestion.`);

      // Grounding: a question keyed on the token cites a note whose on-disk
      // content actually contains it.
      const grounded = await client.callTool("kb.answer_grounded", {
        question: `What is tracked under ${token}?`,
        limit: 4,
        mode: "generic",
        allowDirect: true,
      });
      const citations = (grounded.structuredContent?.citations || []) as any[];
      assert.ok(citations.length > 0, `[${format}] grounded answer produced no citations for ${token}.`);

      let citedWithToken = false;
      for (const citation of citations) {
        const cited = await fs.readFile(path.join(repoRoot, citation.path), "utf8").catch(() => "");
        if (cited.includes(token)) { citedWithToken = true; break; }
      }
      assert.ok(citedWithToken, `[${format}] no cited note actually contains ${token}.`);
    }

    console.log("Ingestion integration test passed (PDF/DOCX/XLSX -> grounded & cited; secrets scrubbed).");
  } finally {
    if (serverChild) serverChild.kill("SIGTERM");
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
