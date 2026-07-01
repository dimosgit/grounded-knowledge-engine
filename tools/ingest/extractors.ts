/**
 * Document extractors: turn a binary/text file into plain Markdown-ish text.
 *
 * Everything here is local — no external API — to honor the engine's grounded,
 * local-first positioning. Rich documents prefer the optional MarkItDown CLI
 * when available, with native Node fallbacks for PDF/DOCX/XLSX. Each extractor
 * returns the text plus any warnings (e.g. a PDF with no text layer that needs OCR).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import mammoth from "mammoth";
import ExcelJS from "exceljs";

export type SupportedFormat =
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "html"
  | "csv"
  | "json"
  | "xml"
  | "zip"
  | "epub"
  | "markdown"
  | "text";

export type IngestConverter = "auto" | "native" | "markitdown";

export interface ExtractResult {
  format: SupportedFormat;
  text: string;
  warnings: string[];
}

const EXTENSION_MAP: Record<string, SupportedFormat> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".pptx": "pptx",
  ".html": "html",
  ".htm": "html",
  ".csv": "csv",
  ".json": "json",
  ".xml": "xml",
  ".zip": "zip",
  ".epub": "epub",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".text": "text",
};

const NATIVE_FORMATS = new Set<SupportedFormat>(["pdf", "docx", "xlsx", "markdown", "text"]);
const PLAIN_FORMATS = new Set<SupportedFormat>(["markdown", "text"]);
const MARKITDOWN_TIMEOUT_MS = 60_000;
const MARKITDOWN_MAX_BUFFER = 50 * 1024 * 1024;

// Caps so a giant workbook does not explode into retrieval noise.
const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 500;

/** Map a file path to a supported format, or null if unsupported. */
export function detectFormat(filePath: string): SupportedFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

export function isSupported(filePath: string): boolean {
  return detectFormat(filePath) !== null;
}

export async function extractText(filePath: string): Promise<ExtractResult> {
  const format = detectFormat(filePath);
  if (!format) throw new Error(`Unsupported file type: ${filePath}`);
  const converter = getIngestConverter();
  if (!PLAIN_FORMATS.has(format) && converter !== "native") {
    try {
      return await extractWithMarkItDown(filePath, format);
    } catch (error) {
      if (converter === "markitdown" || !NATIVE_FORMATS.has(format)) {
        throw new Error(markItDownErrorMessage(filePath, error));
      }
      const native = await extractNative(filePath, format);
      native.warnings.unshift(
        `MarkItDown conversion failed; fell back to native ${format} extractor.`,
      );
      native.warnings.unshift(markItDownErrorMessage(filePath, error));
      return native;
    }
  }
  return extractNative(filePath, format);
}

function getIngestConverter(): IngestConverter {
  const raw = (process.env.GKE_INGEST_CONVERTER || "auto").toLowerCase();
  if (raw === "auto" || raw === "native" || raw === "markitdown") return raw;
  throw new Error(`Invalid GKE_INGEST_CONVERTER '${raw}'. Use auto, native, or markitdown.`);
}

async function extractNative(filePath: string, format: SupportedFormat): Promise<ExtractResult> {
  switch (format) {
    case "pdf":
      return extractPdf(filePath);
    case "docx":
      return extractDocx(filePath);
    case "xlsx":
      return extractXlsx(filePath);
    case "markdown":
    case "text":
      return extractPlainText(filePath, format);
    default:
      throw new Error(
        `${format} requires MarkItDown. Install the Python CLI and use GKE_INGEST_CONVERTER=auto or markitdown.`,
      );
  }
}

async function extractWithMarkItDown(
  filePath: string,
  format: SupportedFormat,
): Promise<ExtractResult> {
  const command = process.env.GKE_MARKITDOWN_BIN || "markitdown";
  const timeout = Number.parseInt(
    process.env.GKE_MARKITDOWN_TIMEOUT_MS || `${MARKITDOWN_TIMEOUT_MS}`,
    10,
  );

  return new Promise((resolve, reject) => {
    execFile(
      command,
      [filePath],
      {
        timeout: Number.isFinite(timeout) ? timeout : MARKITDOWN_TIMEOUT_MS,
        maxBuffer: MARKITDOWN_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        const text = stdout.trim();
        const warnings = stderr.trim() ? [`MarkItDown: ${stderr.trim()}`] : [];
        if (!text) {
          reject(new Error("MarkItDown returned no extractable Markdown."));
          return;
        }
        resolve({ format, text, warnings });
      },
    );
  });
}

function markItDownErrorMessage(filePath: string, error: unknown): string {
  const err = error as NodeJS.ErrnoException & { signal?: string };
  if (err.code === "ENOENT") {
    return `MarkItDown CLI not found while converting ${filePath}. Install it with: python -m pip install 'markitdown[all]'`;
  }
  if (err.signal === "SIGTERM") {
    return `MarkItDown conversion timed out for ${filePath}.`;
  }
  return `MarkItDown conversion failed for ${filePath}: ${err.message || String(error)}`;
}

async function extractPdf(filePath: string): Promise<ExtractResult> {
  const warnings: string[] = [];
  // unpdf is ESM-only; import dynamically so this module stays loadable from CJS callers.
  const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
  const buffer = await fs.readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await pdfExtract(pdf, { mergePages: true });
  const cleaned = (typeof text === "string" ? text : (text as string[]).join("\n")).trim();
  if (!cleaned) {
    warnings.push(
      "No extractable text found — this PDF is likely scanned/image-only and needs OCR (not supported in v1.1).",
    );
  }
  return { format: "pdf", text: cleaned, warnings };
}

async function extractDocx(filePath: string): Promise<ExtractResult> {
  const warnings: string[] = [];
  const { value, messages } = await mammoth.extractRawText({ path: filePath });
  for (const message of messages) {
    if (message.type === "warning" || message.type === "error") warnings.push(message.message);
  }
  return { format: "docx", text: value.trim(), warnings };
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    if (typeof obj.text === "string") return obj.text;
    if (obj.result !== undefined) return String(obj.result);
    if (Array.isArray(obj.richText)) return obj.richText.map((part: any) => part.text).join("");
    if (obj.hyperlink) return String(obj.text ?? obj.hyperlink);
    return "";
  }
  return String(value);
}

async function extractXlsx(filePath: string): Promise<ExtractResult> {
  const warnings: string[] = [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sections: string[] = [];
  let sheetCount = 0;
  workbook.eachSheet((worksheet) => {
    if (sheetCount >= MAX_SHEETS) {
      return;
    }
    sheetCount += 1;

    const rows: string[][] = [];
    let truncated = false;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > MAX_ROWS_PER_SHEET) {
        truncated = true;
        return;
      }
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((v) => cellToString(v).replace(/\|/g, "\\|")));
    });

    if (rows.length === 0) return;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");

    const lines: string[] = [`## ${worksheet.name}`, ""];
    const [header, ...body] = rows;
    lines.push(`| ${pad(header).join(" | ")} |`);
    lines.push(
      `| ${pad(header)
        .map(() => "---")
        .join(" | ")} |`,
    );
    for (const r of body) lines.push(`| ${pad(r).join(" | ")} |`);
    if (truncated) {
      lines.push("");
      lines.push(`_(truncated at ${MAX_ROWS_PER_SHEET} rows)_`);
      warnings.push(`Sheet "${worksheet.name}" truncated at ${MAX_ROWS_PER_SHEET} rows.`);
    }
    sections.push(lines.join("\n"));
  });

  if (sheetCount >= MAX_SHEETS) {
    warnings.push(`Workbook truncated at ${MAX_SHEETS} sheets.`);
  }
  return { format: "xlsx", text: sections.join("\n\n").trim(), warnings };
}

async function extractPlainText(filePath: string, format: SupportedFormat): Promise<ExtractResult> {
  const text = await fs.readFile(filePath, "utf8");
  return { format, text: text.trim(), warnings: [] };
}
