/**
 * Unique tokens embedded in each binary fixture. The ingestion integration test
 * asserts that content which exists ONLY inside a PDF/DOCX/XLSX becomes grounded
 * and cited — these tokens are how it proves that, end to end.
 */
export const FIXTURE_TOKENS = {
  pdf: "PDFINGESTTOKEN9001",
  docx: "DOCXINGESTTOKEN9002",
  xlsx: "XLSXINGESTTOKEN9003",
  markdown: "MDINGESTTOKEN9004",
} as const;
