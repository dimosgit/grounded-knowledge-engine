// Surgical upsert of the `lifecycle:` frontmatter field used by the Project
// Board. Kept as a pure, dependency-free function so it is unit-testable and so
// the Vite dev-server write-back endpoint can reuse it. Only the lifecycle line
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

  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    // No frontmatter: nothing to clear; create a block when setting a value.
    if (!normalized) return text;
    return `---\n${lifecycleLine}\n---\n\n${text}`;
  }

  const lines = fmMatch[1].split(/\r?\n/);
  const idx = lines.findIndex((line) => /^lifecycle\s*:/.test(line));

  if (idx >= 0) {
    if (normalized) lines[idx] = lifecycleLine;
    else lines.splice(idx, 1);
  } else if (normalized) {
    lines.push(lifecycleLine);
  }

  return text.replace(fmMatch[0], `---\n${lines.join("\n")}\n---`);
}
