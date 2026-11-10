/**
 * Pre-parse safety limits for ingestion.
 *
 * Every input is checked before any parser (native or MarkItDown) touches it:
 * the file size is capped, and ZIP containers (DOCX/XLSX/PPTX/EPUB/ZIP) are
 * inspected through their central directory WITHOUT decompressing, so zip
 * bombs are rejected by their declared sizes. ZIP64 archives are rejected
 * rather than parsed: office documents and ingest inputs never need them.
 *
 * Limitation: the check trusts the central directory. A crafted archive whose
 * central directory under-reports sizes still reaches the parser; the file
 * size cap and the per-entry ratio check keep that window small.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Formats that are ZIP containers; these must pass the archive check. */
const ZIP_FAMILY_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".epub", ".zip"]);

export const DEFAULT_MAX_FILE_MB = 50;
export const DEFAULT_MAX_UNZIPPED_MB = 200;
export const MAX_ZIP_ENTRIES = 10_000;
/** An entry is suspicious when it expands more than this ratio... */
export const MAX_ENTRY_COMPRESSION_RATIO = 200;
/** ...and is also larger than this many bytes once expanded. */
export const RATIO_CHECK_MIN_BYTES = 10 * 1024 * 1024;
/** Upper bound accepted for either env override (100 GB). */
const MAX_CONFIGURABLE_MB = 102_400;

const MB = 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;

export interface IngestLimits {
  maxFileBytes: number;
  maxUnzippedBytes: number;
  maxEntries: number;
}

export type IngestSafetyVerdict = { ok: true } | { ok: false; reason: string };

/** Thrown by extractors when a file fails the pre-parse safety check. */
export class IngestLimitError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "IngestLimitError";
  }
}

function parseMegabytes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0 || value > MAX_CONFIGURABLE_MB) {
    throw new Error(
      `Invalid ${name} '${raw}'. Use a positive number of megabytes up to ${MAX_CONFIGURABLE_MB}.`,
    );
  }
  return value;
}

/** Resolve limits from env (`GKE_INGEST_MAX_FILE_MB`, `GKE_INGEST_MAX_UNZIPPED_MB`). */
export function readIngestLimits(): IngestLimits {
  return {
    maxFileBytes: Math.floor(parseMegabytes("GKE_INGEST_MAX_FILE_MB", DEFAULT_MAX_FILE_MB) * MB),
    maxUnzippedBytes: Math.floor(
      parseMegabytes("GKE_INGEST_MAX_UNZIPPED_MB", DEFAULT_MAX_UNZIPPED_MB) * MB,
    ),
    maxEntries: MAX_ZIP_ENTRIES,
  };
}

function formatMb(bytes: number): string {
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  const mb = bytes / MB;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(2)} MB`;
}

/**
 * Check one input before parsing. Never throws for hostile content; returns a
 * verdict with a human-readable reason instead. I/O errors (missing file)
 * propagate so the caller reports them as failures.
 */
export async function checkIngestSafety(
  filePath: string,
  limits: IngestLimits = readIngestLimits(),
): Promise<IngestSafetyVerdict> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return { ok: false, reason: "not a regular file" };
  if (stat.size > limits.maxFileBytes) {
    return {
      ok: false,
      reason: `file too large: ${formatMb(stat.size)} exceeds the ${formatMb(limits.maxFileBytes)} limit (GKE_INGEST_MAX_FILE_MB)`,
    };
  }
  const handle = await fs.open(filePath, "r");
  try {
    return await inspectZipCentralDirectory(
      handle,
      stat.size,
      limits,
      ZIP_FAMILY_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    );
  } finally {
    await handle.close();
  }
}

async function readAt(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** Local file header (PK\3\4) or an empty archive (PK\5\6) at offset 0. */
function startsLikeZip(head: Buffer): boolean {
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) return false;
  return (head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06);
}

/**
 * ZIP readers (JSZip behind mammoth/exceljs, Python's zipfile behind
 * MarkItDown) locate an archive from its end record and accept data placed in
 * front of it. So the decision to inspect cannot rest on the first bytes: the
 * end record is searched in every file, and any archive found must start at
 * offset 0 with its central directory directly before the end record.
 */
async function inspectZipCentralDirectory(
  handle: fs.FileHandle,
  size: number,
  limits: IngestLimits,
  zipByExtension: boolean,
): Promise<IngestSafetyVerdict> {
  const reject = (reason: string): IngestSafetyVerdict => ({ ok: false, reason });
  const startsAsZip = startsLikeZip(await readAt(handle, 0, Math.min(size, 4)));
  const mustBeZip = zipByExtension || startsAsZip;

  const tailLength = Math.min(size, EOCD_MIN_SIZE + EOCD_MAX_COMMENT);
  const tailStart = size - tailLength;
  const tail =
    tailLength >= EOCD_MIN_SIZE ? await readAt(handle, tailStart, tailLength) : Buffer.alloc(0);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return mustBeZip
      ? reject("malformed ZIP: end-of-central-directory record not found")
      : { ok: true };
  }

  const eocdAbsolute = tailStart + eocd;
  if (!mustBeZip) {
    // Another format whose tail happens to hold the end-record bytes. Treat it
    // as an archive only when a central directory sits where a reader would
    // look for one: at the declared offset or directly before the end record.
    const declaredSize = tail.readUInt32LE(eocd + 12);
    const declaredOffset = tail.readUInt32LE(eocd + 16);
    let hasDirectory = declaredSize === 0;
    for (const candidate of [declaredOffset, eocdAbsolute - declaredSize]) {
      if (candidate < 0 || candidate + 4 > eocdAbsolute) continue;
      if ((await readAt(handle, candidate, 4)).readUInt32LE(0) === CENTRAL_HEADER_SIGNATURE) {
        hasDirectory = true;
      }
    }
    if (!hasDirectory) return { ok: true };
  }
  if (!startsAsZip) {
    return reject("ZIP archive with data before its first entry is not supported for ingestion");
  }

  const diskNumber = tail.readUInt16LE(eocd + 4);
  const cdDisk = tail.readUInt16LE(eocd + 6);
  const entriesOnDisk = tail.readUInt16LE(eocd + 8);
  const totalEntries = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);

  const zip64Locator = eocd >= 20 && tail.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE;
  if (
    zip64Locator ||
    totalEntries === 0xffff ||
    entriesOnDisk === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    return reject("ZIP64 archives are not supported for ingestion");
  }
  if (diskNumber !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) {
    return reject("multi-disk ZIP archives are not supported for ingestion");
  }
  if (totalEntries > limits.maxEntries) {
    return reject(`ZIP has ${totalEntries} entries, above the ${limits.maxEntries} entry limit`);
  }
  if (cdOffset + cdSize !== eocdAbsolute) {
    return reject("malformed ZIP: central directory does not end at its end record");
  }

  const cd = await readAt(handle, cdOffset, cdSize);
  if (cd.length !== cdSize) return reject("malformed ZIP: truncated central directory");

  let offset = 0;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (
      offset + CENTRAL_HEADER_SIZE > cd.length ||
      cd.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE
    ) {
      return reject("malformed ZIP: central directory entry is invalid");
    }
    const compressed = cd.readUInt32LE(offset + 20);
    const uncompressed = cd.readUInt32LE(offset + 24);
    const nameLength = cd.readUInt16LE(offset + 28);
    const extraLength = cd.readUInt16LE(offset + 30);
    const commentLength = cd.readUInt16LE(offset + 32);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      return reject("ZIP64 archives are not supported for ingestion");
    }
    totalUncompressed += uncompressed;
    if (totalUncompressed > limits.maxUnzippedBytes) {
      return reject(
        `ZIP expands to more than ${formatMb(limits.maxUnzippedBytes)} (GKE_INGEST_MAX_UNZIPPED_MB)`,
      );
    }
    if (
      uncompressed > RATIO_CHECK_MIN_BYTES &&
      uncompressed / Math.max(compressed, 1) > MAX_ENTRY_COMPRESSION_RATIO
    ) {
      return reject(
        `ZIP entry compression ratio above ${MAX_ENTRY_COMPRESSION_RATIO}:1 (${formatMb(uncompressed)} from ${compressed} bytes); possible zip bomb`,
      );
    }
    offset += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
  if (offset > cd.length) return reject("malformed ZIP: central directory entry is invalid");
  return { ok: true };
}
