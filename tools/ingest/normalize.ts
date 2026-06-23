/**
 * Normalization stage: turn raw extracted text into one or more clean,
 * captureable KB notes — deriving a title, optionally scrubbing secrets/PII,
 * chunking long documents, and attaching provenance.
 */
import path from "node:path";

export interface NormalizedNote {
  title: string;
  body: string;
  chunkIndex: number;
  chunkCount: number;
}

export interface NormalizeOptions {
  sourceFile: string; // path shown in provenance (relative is nicer)
  scrub?: boolean; // redact secrets/keys; default true
  maxChars?: number; // chunk threshold; default 12000
  ingestDate?: string; // YYYY-MM-DD; default today
}

export interface NormalizeResult {
  notes: NormalizedNote[];
  redactions: number;
}

const DEFAULT_MAX_CHARS = 12000;

/** Derive a human title from the first heading, then the first short line, else the filename. */
export function deriveTitle(filePath: string, text: string): string {
  const headingMatch = text.match(/^#{1,3}\s+(.+?)\s*$/m);
  if (headingMatch) {
    const heading = headingMatch[1].trim();
    if (heading.length >= 2) return heading.slice(0, 120);
  }
  // Extractors like mammoth's extractRawText drop heading markup, so a short
  // first line is usually the document's real title.
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine && firstLine.length >= 2 && firstLine.length <= 80) {
    return firstLine.slice(0, 120);
  }
  const base = path.basename(filePath, path.extname(filePath));
  return (
    base
      .replace(/[_\-.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "Untitled Document"
  );
}

// Reasonably specific secret patterns — specific enough to avoid shredding
// normal prose, broad enough to catch the common offenders in business docs.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*["']?[A-Za-z0-9/_+-]{12,}["']?/gi,
];

export function scrubSecrets(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      redactions += 1;
      // Preserve an assignment's left-hand side so the note still reads sensibly.
      const assign = match.match(/^([A-Za-z_-]+\s*[:=]\s*)/);
      return assign ? `${assign[1]}[REDACTED]` : "[REDACTED]";
    });
  }
  return { text: out, redactions };
}

/** Split text into chunks no larger than maxChars, preferring `##` boundaries. */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const flush = () => {
    if (current.length) {
      chunks.push(current.join("\n").trim());
      current = [];
      currentLen = 0;
    }
  };

  for (const line of lines) {
    const isHeading = /^#{1,3}\s+/.test(line);
    if (isHeading && currentLen >= maxChars) flush();
    if (line.length > maxChars) {
      // A single very long line: hard-split into windows.
      flush();
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
      continue;
    }
    current.push(line);
    currentLen += line.length + 1;
    if (currentLen >= maxChars && !isHeading) flush();
  }
  flush();
  return chunks.filter((c) => c.length > 0);
}

function buildProvenance(sourceFile: string, ingestDate: string): string {
  return `> Source: \`${sourceFile}\` — ingested ${ingestDate} via the document ingestion CLI.`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeDocument(text: string, options: NormalizeOptions): NormalizeResult {
  const scrub = options.scrub !== false;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const ingestDate = options.ingestDate ?? todayIso();

  let redactions = 0;
  let working = text;
  if (scrub) {
    const scrubbed = scrubSecrets(working);
    working = scrubbed.text;
    redactions = scrubbed.redactions;
  }

  const baseTitle = deriveTitle(options.sourceFile, working);
  const provenance = buildProvenance(options.sourceFile, ingestDate);
  const pieces = chunkText(working, maxChars);

  const notes: NormalizedNote[] = pieces.map((piece, index) => {
    const title = pieces.length > 1 ? `${baseTitle} (part ${index + 1})` : baseTitle;
    const body = `${provenance}\n\n${piece.trim()}\n`;
    return { title, body, chunkIndex: index, chunkCount: pieces.length };
  });

  return { notes, redactions };
}
