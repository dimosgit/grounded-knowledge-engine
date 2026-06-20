#!/usr/bin/env node
/**
 * Generates the binary sample documents used by the ingestion integration test:
 * sample.pdf, sample.docx, sample.xlsx — each carrying a unique token from
 * tokens.ts. Run once and commit the outputs: `npm run ingest:fixtures`.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import ExcelJS from "exceljs";
import { FIXTURE_TOKENS } from "./tokens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function makePdf(outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    doc.fontSize(18).text("Sandbox Cutover Blocker Report");
    doc.moveDown();
    doc
      .fontSize(12)
      .text(
        `The sandbox integration is currently blocked. The root cause is tracked under ${FIXTURE_TOKENS.pdf}: a missing API key for the sandbox tenant must be provisioned before cutover can proceed.`,
      );
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

async function makeDocx(outPath: string): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Integration Decision Record")] }),
          new Paragraph(
            `Decision ${FIXTURE_TOKENS.docx}: the team agreed to route order replication through the middleware queue rather than a direct point-to-point call, to preserve clean-core boundaries.`,
          ),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  await fsp.writeFile(outPath, buffer);
}

async function makeXlsx(outPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cutover Tasks");
  sheet.addRow(["Task", "Owner", "Status", "Note"]);
  sheet.addRow(["Provision sandbox key", "Platform", "Blocked", `Tracked as ${FIXTURE_TOKENS.xlsx}`]);
  sheet.addRow(["Smoke test replication", "Integration", "Pending", "Depends on the key above"]);
  await workbook.xlsx.writeFile(outPath);
}

async function makeMarkdown(outPath: string): Promise<void> {
  const md = `# Runbook Notes\n\nThe replication retry policy is documented under ${FIXTURE_TOKENS.markdown}: retry three times with exponential backoff before routing to the dead-letter queue.\n`;
  await fsp.writeFile(outPath, md, "utf8");
}

async function main(): Promise<void> {
  await makePdf(path.join(__dirname, "sample.pdf"));
  await makeDocx(path.join(__dirname, "sample.docx"));
  await makeXlsx(path.join(__dirname, "sample.xlsx"));
  await makeMarkdown(path.join(__dirname, "sample.md"));
  console.log("Wrote sample.pdf, sample.docx, sample.xlsx, sample.md to tools/ingest/fixtures/.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
