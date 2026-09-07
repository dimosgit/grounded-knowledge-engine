// Surgical upsert of the `lifecycle:` frontmatter field used by the Project
// Board. Kept as a pure, dependency-free function so it is unit-testable and so
// every project writer can reuse it. Only the lifecycle line
// is touched; everything else in the file is preserved byte-for-byte.

export const VALID_LIFECYCLES = ["active", "next", "blocked", "completed"] as const;

export type Lifecycle = (typeof VALID_LIFECYCLES)[number];

/**
 * Returns `text` with its `lifecycle:` frontmatter set to `value`.
 * - present  → value replaced
 * - missing  → value inserted into the existing frontmatter block
 * - value="" → the lifecycle line is removed (card falls back to "Auto")
 * - no frontmatter block → one is created (only when setting a value)
 */
export function setLifecycle(text: string, value: string): string {
  const normalized = (value || "").trim().toLowerCase();
  const lifecycleLine = normalized ? `lifecycle: ${normalized}` : "";

  const fmMatch = text.match(/^---(\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m);
  if (!fmMatch || fmMatch.index !== 0) {
    if (!normalized) return text;
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    return `---${newline}${lifecycleLine}${newline}---${newline}${newline}${text}`;
  }

  const newline = fmMatch[1];
  const header = fmMatch[2];
  const lifecycle = /^lifecycle[ \t]*:[^\r\n]*(?:\r?\n|$)/m;
  const existing = header.match(lifecycle);
  let updated = header;
  if (existing) {
    const ending = existing[0].match(/\r?\n$/)?.[0] ?? "";
    updated = header.replace(lifecycle, normalized ? `${lifecycleLine}${ending}` : "");
  } else if (normalized) {
    updated = `${header}${lifecycleLine}${newline}`;
  }
  return `---${newline}${updated}${fmMatch[3]}${text.slice(fmMatch[0].length)}`;
}
