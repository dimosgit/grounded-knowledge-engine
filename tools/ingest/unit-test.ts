#!/usr/bin/env node
/**
 * Fast, deterministic unit tests for the ingestion pure functions — the logic
 * branches the end-to-end test (test:ingest) does not exercise: format
 * detection, title derivation, chunking, secret scrubbing, and path slugging.
 *
 * Uses only temp-file I/O for the MarkItDown shim; no server.
 * Run with: `npm run test:ingest:unit`.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectFormat, extractText, isSupported } from "./extractors.js";
import { deriveTitle, scrubSecrets, chunkText, normalizeDocument } from "./normalize.js";
import { slugifySource } from "./ingest.js";
import { FIXTURE_TOKENS } from "./fixtures/tokens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function testDetectFormat(): void {
  assert.equal(detectFormat("/a/b/report.pdf"), "pdf");
  assert.equal(detectFormat("notes.DOCX"), "docx"); // case-insensitive
  assert.equal(detectFormat("data.xlsx"), "xlsx");
  assert.equal(detectFormat("legacy.xls"), "xlsx");
  assert.equal(detectFormat("deck.pptx"), "pptx");
  assert.equal(detectFormat("page.html"), "html");
  assert.equal(detectFormat("data.csv"), "csv");
  assert.equal(detectFormat("payload.json"), "json");
  assert.equal(detectFormat("feed.xml"), "xml");
  assert.equal(detectFormat("archive.zip"), "zip");
  assert.equal(detectFormat("book.epub"), "epub");
  assert.equal(detectFormat("readme.md"), "markdown");
  assert.equal(detectFormat("log.txt"), "text");
  assert.equal(detectFormat("image.png"), null);
  assert.equal(detectFormat("Makefile"), null);
  assert.equal(isSupported("a.pdf"), true);
  assert.equal(isSupported("a.png"), false);
}

function testDeriveTitle(): void {
  // Markdown heading wins.
  assert.equal(deriveTitle("x.md", "# Real Title\n\nbody"), "Real Title");
  assert.equal(deriveTitle("x.md", "## Sub Title\n\nbody"), "Sub Title");
  // No markup -> short first line (mammoth extractRawText case).
  assert.equal(
    deriveTitle("x.docx", "Integration Decision Record\nmore text"),
    "Integration Decision Record",
  );
  // First line too long -> filename fallback, title-cased.
  const longFirst = "x".repeat(200) + "\nbody";
  assert.equal(deriveTitle("my_source-file.pdf", longFirst), "My Source File");
  // Empty text -> filename fallback.
  assert.equal(deriveTitle("quarterly report.xlsx", ""), "Quarterly Report");
}

function testScrubSecrets(): void {
  // Synthetic secrets assembled from fragments so no scannable literal lands in source.
  const fakeAwsKey = "AKIA" + "1234567890ABCDEF";
  const aws = scrubSecrets(`key ${fakeAwsKey} here`);
  assert.equal(aws.redactions, 1);
  assert.ok(!aws.text.includes(fakeAwsKey));

  const fakePassword = "hunter2" + "supersecretvalue";
  const assign = scrubSecrets(`password: "${fakePassword}"`);
  assert.equal(assign.redactions, 1);
  assert.ok(assign.text.includes("[REDACTED]"));
  assert.ok(assign.text.startsWith("password"), "assignment LHS should be preserved");

  const fakeJwt = "eyJabcdefgh" + "." + "eyJijklmnop" + "." + "signature123";
  const jwt = scrubSecrets(`token ${fakeJwt} done`);
  assert.equal(jwt.redactions, 1);

  const clean = scrubSecrets("Just normal prose with no secrets at all.");
  assert.equal(clean.redactions, 0);
  assert.equal(clean.text, "Just normal prose with no secrets at all.");
}

function testChunkText(): void {
  // Below threshold -> single chunk.
  assert.deepEqual(chunkText("short text", 1000), ["short text"]);

  // Above threshold, split on heading boundaries.
  const big = `## A\n${"a".repeat(60)}\n## B\n${"b".repeat(60)}\n## C\n${"c".repeat(60)}`;
  const chunks = chunkText(big, 80);
  assert.ok(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
  // No content is lost.
  const rejoined = chunks.join("\n");
  assert.ok(rejoined.includes("## A") && rejoined.includes("## B") && rejoined.includes("## C"));

  // A single over-long line is hard-split into windows.
  const longLine = "z".repeat(250);
  const windows = chunkText(longLine, 100);
  assert.ok(windows.length >= 3, `expected hard-split windows, got ${windows.length}`);
  assert.equal(windows.join(""), longLine);
}

function testSlugify(): void {
  assert.equal(slugifySource("sample.pdf"), "sample-pdf");
  assert.equal(slugifySource("sample.docx"), "sample-docx");
  assert.equal(slugifySource("sub dir/My Report.xlsx"), "sub-dir-my-report-xlsx");
  assert.equal(slugifySource("...weird___name.txt"), "weird-name-txt");
}

function testNormalizeDocumentChunkingAndProvenance(): void {
  const big = `## A\n${"a".repeat(60)}\n## B\n${"b".repeat(60)}\n## C\n${"c".repeat(60)}`;
  const result = normalizeDocument(big, {
    sourceFile: "big.md",
    maxChars: 80,
    ingestDate: "2026-06-20",
  });
  assert.ok(result.notes.length > 1, "long doc should produce multiple notes");
  // Multi-part titles and provenance present on every chunk.
  assert.ok(result.notes[0].title.endsWith("(part 1)"));
  for (const note of result.notes) {
    assert.ok(note.body.includes("> Source: `big.md` — ingested 2026-06-20"));
  }
  // Single short doc -> one note, no "(part N)" suffix.
  const single = normalizeDocument("# Title\n\nbody", {
    sourceFile: "s.md",
    ingestDate: "2026-06-20",
  });
  assert.equal(single.notes.length, 1);
  assert.equal(single.notes[0].title, "Title");
}

async function testMarkItDownConverter(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gke-markitdown-"));
  const previousConverter = process.env.GKE_INGEST_CONVERTER;
  const previousBin = process.env.GKE_MARKITDOWN_BIN;
  try {
    const bin = path.join(dir, "markitdown");
    const source = path.join(dir, "slides.pptx");
    await fs.writeFile(
      bin,
      "#!/usr/bin/env node\nconsole.log('# Converted Deck\\n\\n- MARKITDOWNTOKEN9005')\n",
      { mode: 0o755 },
    );
    await fs.writeFile(source, "placeholder", "utf8");
    process.env.GKE_INGEST_CONVERTER = "markitdown";
    process.env.GKE_MARKITDOWN_BIN = bin;

    const result = await extractText(source);
    assert.equal(result.format, "pptx");
    assert.ok(result.text.includes("MARKITDOWNTOKEN9005"));
  } finally {
    if (previousConverter === undefined) delete process.env.GKE_INGEST_CONVERTER;
    else process.env.GKE_INGEST_CONVERTER = previousConverter;
    if (previousBin === undefined) delete process.env.GKE_MARKITDOWN_BIN;
    else process.env.GKE_MARKITDOWN_BIN = previousBin;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testMarkItDownAutoFallsBackToNativeExtractor(): Promise<void> {
  const previousConverter = process.env.GKE_INGEST_CONVERTER;
  const previousBin = process.env.GKE_MARKITDOWN_BIN;
  try {
    process.env.GKE_INGEST_CONVERTER = "auto";
    process.env.GKE_MARKITDOWN_BIN = path.join(os.tmpdir(), "missing-markitdown-bin");

    const result = await extractText(path.join(__dirname, "fixtures", "sample.docx"));
    assert.equal(result.format, "docx");
    assert.ok(result.text.includes(FIXTURE_TOKENS.docx));
    assert.ok(result.warnings.some((warning) => warning.includes("MarkItDown CLI not found")));
    assert.ok(result.warnings.some((warning) => warning.includes("fell back to native docx extractor")));
  } finally {
    if (previousConverter === undefined) delete process.env.GKE_INGEST_CONVERTER;
    else process.env.GKE_INGEST_CONVERTER = previousConverter;
    if (previousBin === undefined) delete process.env.GKE_MARKITDOWN_BIN;
    else process.env.GKE_MARKITDOWN_BIN = previousBin;
  }
}

const tests = [
  testDetectFormat,
  testDeriveTitle,
  testScrubSecrets,
  testChunkText,
  testSlugify,
  testNormalizeDocumentChunkingAndProvenance,
  testMarkItDownConverter,
  testMarkItDownAutoFallsBackToNativeExtractor,
];

let failed = 0;
for (const test of tests) {
  try {
    await test();
    console.log(`  ✓ ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${test.name}: ${(error as Error).message}`);
  }
}

if (failed > 0) {
  console.error(`Ingestion unit tests failed: ${failed}/${tests.length}.`);
  process.exit(1);
}
console.log("Ingestion unit tests passed.");
