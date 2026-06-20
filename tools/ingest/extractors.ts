/**
 * Document extractors: turn a binary/text file into plain Markdown-ish text.
 *
 * Everything here is local — no network, no external API — to honor the
 * engine's grounded, local-first positioning. Each extractor returns the text
 * plus any warnings (e.g. a PDF with no text layer that needs OCR).
 */
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import ExcelJS from "exceljs";

export type SupportedFormat = "pdf" | "docx" | "xlsx" | "markdown" | "text";

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
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".text": "text",
};

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
  }
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
    lines.push(`| ${pad(header).map(() => "---").join(" | ")} |`);
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
