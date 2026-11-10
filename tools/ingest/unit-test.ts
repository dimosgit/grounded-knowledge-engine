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
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { detectFormat, extractText, isSupported } from "./extractors.js";
import { IngestLimitError, checkIngestSafety, readIngestLimits } from "./limits.js";
import { loadWorkspaceContext } from "../workspaces/config.js";
import { deriveTitle, scrubSecrets, chunkText, normalizeDocument } from "./normalize.js";
import { mergeSourceMetadata, runIngest, slugifySource } from "./ingest.js";
import { deriveSourceId } from "./source-record.js";
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
  assert.equal(deriveSourceId("sub dir/My Report.xlsx"), deriveSourceId("sub dir\\My Report.xlsx"));
  assert.notEqual(deriveSourceId("a/b.md"), deriveSourceId("a-b.md"));
  assert.notEqual(deriveSourceId("Report.md"), deriveSourceId("report.md"));
}

function testSourceMetadataPreservesUnknownFrontmatter(): void {
  const existing = `---\ncustom_field: keep-me\nsource_id: old-source\n---\n# Old\n`;
  const generated = `---\nmodule: general\nstatus: draft\n---\n# New\n\nNew body.\n`;
  const merged = mergeSourceMetadata(generated, existing, {
    source_id: "stable-source",
    source_uri: "folder/report.md",
    source_chunk: "1",
  });
  assert.match(merged, /custom_field: keep-me/);
  assert.match(merged, /source_id: stable-source/);
  assert.match(merged, /source_uri: folder\/report\.md/);
  assert.ok(!merged.includes("# Old"));
  assert.ok(merged.includes("# New"));
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
    // A real (tiny) ZIP container: ZIP-family files must pass the archive check.
    await fs.writeFile(
      source,
      buildZip([{ name: "ppt/presentation.xml", data: Buffer.from("placeholder") }]),
    );
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
    assert.ok(
      result.warnings.some((warning) => warning.includes("fell back to native docx extractor")),
    );
  } finally {
    if (previousConverter === undefined) delete process.env.GKE_INGEST_CONVERTER;
    else process.env.GKE_INGEST_CONVERTER = previousConverter;
    if (previousBin === undefined) delete process.env.GKE_MARKITDOWN_BIN;
    else process.env.GKE_MARKITDOWN_BIN = previousBin;
  }
}

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  /** Store deflated (method 8) instead of stored (method 0). */
  deflate?: boolean;
  /** Override the uncompressed size the central directory declares. */
  declaredSize?: number;
}

/** Build a minimal ZIP in memory so bombs never ship as committed binaries. */
function buildZip(entries: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = entry.deflate ? zlib.deflateRawSync(entry.data) : entry.data;
    const crc = typeof zlib.crc32 === "function" ? zlib.crc32(entry.data) : 0;
    const size = entry.declaredSize ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function testIngestLimitsRejectZipBombs(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gke-zip-limits-"));
  try {
    const limits = readIngestLimits();
    // Real deflate of 24 MB of zeros: ~24 KB on disk, ratio far above 200:1.
    const deflateBomb = path.join(dir, "deflate-bomb.docx");
    await fs.writeFile(
      deflateBomb,
      buildZip([
        { name: "word/document.xml", data: Buffer.alloc(24 * 1024 * 1024), deflate: true },
      ]),
    );
    const ratio = await checkIngestSafety(deflateBomb, limits);
    assert.equal(ratio.ok, false);
    assert.match(ratio.ok ? "" : ratio.reason, /compression ratio/);

    // Tiny archive whose central directory claims more than the unzipped cap.
    const claimed = path.join(dir, "claimed.xlsx");
    await fs.writeFile(
      claimed,
      // 25 entries x 9 MB declared: each is under the ratio floor, the sum is not.
      buildZip(
        Array.from({ length: 25 }, (_, i) => ({
          name: `part-${i}.xml`,
          data: Buffer.from("x"),
          declaredSize: 9 * 1024 * 1024,
        })),
      ),
    );
    const total = await checkIngestSafety(claimed, limits);
    assert.equal(total.ok, false);
    assert.match(total.ok ? "" : total.reason, /ZIP expands to more than/);

    // Too many entries.
    const many = path.join(dir, "many.zip");
    await fs.writeFile(
      many,
      buildZip(
        Array.from({ length: limits.maxEntries + 1 }, (_, i) => ({
          name: `e${i}`,
          data: Buffer.alloc(0),
        })),
      ),
    );
    const entries = await checkIngestSafety(many, limits);
    assert.equal(entries.ok, false);
    assert.match(entries.ok ? "" : entries.reason, /entry limit/);

    // ZIP64 markers are rejected rather than parsed.
    const zip64 = path.join(dir, "zip64.pptx");
    const zip64Buffer = buildZip([{ name: "a", data: Buffer.from("a") }]);
    zip64Buffer.writeUInt32LE(0xffffffff, zip64Buffer.length - 22 + 16);
    await fs.writeFile(zip64, zip64Buffer);
    const z64 = await checkIngestSafety(zip64, limits);
    assert.equal(z64.ok, false);
    assert.match(z64.ok ? "" : z64.reason, /ZIP64/);

    // Data placed before the archive must not skip the check: ZIP readers
    // find the archive from its end record and accept a prefix.
    const bombBuffer = await fs.readFile(deflateBomb);
    for (const name of ["prefixed-bomb.docx", "prefixed-bomb.txt", "prefixed-bomb.pdf"]) {
      const prefixed = path.join(dir, name);
      await fs.writeFile(prefixed, Buffer.concat([Buffer.from("junk-prefix\n"), bombBuffer]));
      const verdict = await checkIngestSafety(prefixed, limits);
      assert.equal(verdict.ok, false, `${name} with a prefix must be rejected`);
      assert.match(verdict.ok ? "" : verdict.reason, /data before its first entry/);
    }

    // A ZIP-family extension without an end record is rejected, not skipped.
    const noEnd = path.join(dir, "not-really.docx");
    await fs.writeFile(noEnd, Buffer.from("plain text pretending to be a document"));
    const missing = await checkIngestSafety(noEnd, limits);
    assert.equal(missing.ok, false);
    assert.match(missing.ok ? "" : missing.reason, /end-of-central-directory/);

    // Other formats whose tail merely contains the end-record bytes still pass.
    const coincidence = path.join(dir, "coincidence.txt");
    const stray = Buffer.alloc(22);
    stray.writeUInt32LE(0x06054b50, 0);
    stray.writeUInt32LE(5, 12);
    stray.writeUInt32LE(3, 16);
    await fs.writeFile(coincidence, Buffer.concat([Buffer.from("notes ".repeat(20)), stray]));
    assert.deepEqual(await checkIngestSafety(coincidence, limits), { ok: true });

    // extractText refuses the bomb before any parser runs.
    await assert.rejects(
      withEnv({ GKE_INGEST_CONVERTER: "native" }, () => extractText(deflateBomb)),
      (error: unknown) => error instanceof IngestLimitError,
    );

    // A benign archive and the committed fixtures pass.
    const benign = path.join(dir, "benign.zip");
    await fs.writeFile(
      benign,
      buildZip([{ name: "notes.txt", data: Buffer.from("hello ".repeat(100)), deflate: true }]),
    );
    assert.deepEqual(await checkIngestSafety(benign, limits), { ok: true });
    for (const fixture of ["sample.docx", "sample.xlsx", "sample.pdf", "sample.md"]) {
      assert.deepEqual(
        await checkIngestSafety(path.join(__dirname, "fixtures", fixture), limits),
        { ok: true },
        `fixture ${fixture} should pass the ingest limits`,
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testIngestLimitsEnvValidation(): Promise<void> {
  await withEnv({ GKE_INGEST_MAX_FILE_MB: "abc" }, async () => {
    assert.throws(() => readIngestLimits(), /Invalid GKE_INGEST_MAX_FILE_MB/);
  });
  await withEnv({ GKE_INGEST_MAX_UNZIPPED_MB: "-5" }, async () => {
    assert.throws(() => readIngestLimits(), /Invalid GKE_INGEST_MAX_UNZIPPED_MB/);
  });
  await withEnv({ GKE_INGEST_MAX_FILE_MB: "0" }, async () => {
    assert.throws(() => readIngestLimits(), /Invalid GKE_INGEST_MAX_FILE_MB/);
  });
  await withEnv({ GKE_INGEST_MAX_FILE_MB: "2", GKE_INGEST_MAX_UNZIPPED_MB: "" }, async () => {
    const limits = readIngestLimits();
    assert.equal(limits.maxFileBytes, 2 * 1024 * 1024);
    assert.equal(limits.maxUnzippedBytes, 200 * 1024 * 1024);
  });
}

async function testIngestRunSkipsOversizeAndBombs(): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-ingest-limits-"));
  try {
    await fs.mkdir(path.join(repoRoot, "kb", "topics"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "kb", "index.md"), "# Limits test\n", "utf8");
    const inbox = path.join(repoRoot, "inbox");
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(path.join(inbox, "small.md"), "# Small\n\nFits the limit.\n", "utf8");
    await fs.writeFile(path.join(inbox, "large.txt"), "x".repeat(64 * 1024), "utf8");
    await fs.writeFile(
      path.join(inbox, "bomb.docx"),
      buildZip([
        { name: "word/document.xml", data: Buffer.alloc(24 * 1024 * 1024), deflate: true },
      ]),
    );
    const workspace = await loadWorkspaceContext({
      repoRoot,
      scanRoots: ["kb"],
      writeRoots: ["kb", ".gke", ".cache"],
    });
    // 0.05 MB is about 51 KB: the 64 KB text file is over; the note and the ~24 KB bomb are not.
    const summary = await withEnv(
      { GKE_INGEST_MAX_FILE_MB: "0.05", GKE_INGEST_CONVERTER: "native" },
      () =>
        runIngest({
          folder: inbox,
          module: "general",
          dryRun: true,
          scrub: true,
          workspace,
          logger: () => undefined,
        }),
    );
    assert.deepEqual(summary.failures, []);
    assert.equal(summary.filesProcessed, 1, "only the small note should be processed");
    assert.ok(
      summary.skipped.some((line) => /^large\.txt \(rejected: file too large/.test(line)),
      `oversize file not reported as skipped: ${summary.skipped.join("; ")}`,
    );
    assert.ok(
      summary.skipped.some((line) => /^bomb\.docx \(rejected: .*compression ratio/.test(line)),
      `zip bomb not reported as skipped: ${summary.skipped.join("; ")}`,
    );
    assert.ok(!JSON.stringify(summary).includes(repoRoot), "summary exposed an absolute path");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

const tests = [
  testDetectFormat,
  testDeriveTitle,
  testScrubSecrets,
  testChunkText,
  testSlugify,
  testSourceMetadataPreservesUnknownFrontmatter,
  testNormalizeDocumentChunkingAndProvenance,
  testMarkItDownConverter,
  testMarkItDownAutoFallsBackToNativeExtractor,
  testIngestLimitsRejectZipBombs,
  testIngestLimitsEnvValidation,
  testIngestRunSkipsOversizeAndBombs,
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
