// Browser-safe frontmatter reader and writer shared by the engine and the
// Cockpit. It understands the YAML subset that Markdown editors such as
// Obsidian write: scalars, quoted strings, inline lists, block lists, block
// scalars and CRLF files. Values are flattened to strings so existing callers
// keep their `Record<string, string>` shape; lists become "a, b".
//
// The writer replaces a key together with its continuation lines and keeps
// every other line byte-for-byte, so a write never leaves a broken YAML list.

export type Frontmatter = Record<string, string>;

export interface FrontmatterParse {
  /** True when the text opens with a closed `---` block. */
  found: boolean;
  frontmatter: Frontmatter;
  body: string;
  /** 1-based line number of the first body line. */
  bodyStartLine: number;
}

interface FrontmatterBlock {
  newline: string;
  lines: string[];
  /** Index of the closing `---` line within `lines`. */
  closeIndex: number;
  /** Character offset where the body starts. */
  bodyOffset: number;
}

interface KeySpan {
  key: string;
  start: number;
  /** Exclusive end line index. */
  end: number;
  inlineValue: string;
}

const KEY_LINE = /^([^\s#\-:][^:]*?)[ \t]*:[ \t]*(.*?)[ \t]*$/;
const LIST_ITEM = /^[ \t]*-(?:[ \t]+(.*?))?[ \t]*$/;
const BLOCK_SCALAR = /^[|>][+-]?$/;

function locateBlock(raw: string): FrontmatterBlock | null {
  const newline = raw.startsWith("---\r\n") ? "\r\n" : raw.startsWith("---\n") ? "\n" : "";
  if (!newline) return null;
  const lines = raw.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trimEnd() !== "---") continue;
    let bodyOffset = 0;
    for (let line = 0; line <= index; line += 1) {
      bodyOffset += lines[line].length;
      if (raw.startsWith("\r\n", bodyOffset)) bodyOffset += 2;
      else if (raw.startsWith("\n", bodyOffset)) bodyOffset += 1;
    }
    return { newline, lines, closeIndex: index, bodyOffset };
  }
  return null;
}

function isContinuation(line: string): boolean {
  return /^[ \t]/.test(line) || /^-(?:[ \t]|$)/.test(line);
}

function keySpans(lines: string[], closeIndex: number): KeySpan[] {
  const spans: KeySpan[] = [];
  let index = 1;
  while (index < closeIndex) {
    const match = lines[index].match(KEY_LINE);
    if (!match || isContinuation(lines[index])) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < closeIndex && (isContinuation(lines[end]) || lines[end].trim() === "")) {
      end += 1;
    }
    // Trailing blank lines belong to the gap, not to the value.
    while (end - 1 > index && lines[end - 1].trim() === "") end -= 1;
    spans.push({ key: match[1].trim(), start: index, end, inlineValue: match[2] ?? "" });
    index = end;
  }
  return spans;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function splitInlineList(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map(unquote).filter(Boolean);
}

function isInlineList(value: string): boolean {
  const trimmed = value.trim();
  // `[[Note]]` is a wiki-link written without quotes, not a nested list.
  if (/^\[\[[^\]]*\]\]$/.test(trimmed)) return false;
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function spanValue(lines: string[], span: KeySpan): string {
  const inline = span.inlineValue.trim();
  const rest = lines.slice(span.start + 1, span.end);
  if (inline && !BLOCK_SCALAR.test(inline)) {
    if (isInlineList(inline)) return splitInlineList(inline.slice(1, -1)).join(", ");
    return unquote(inline);
  }
  if (BLOCK_SCALAR.test(inline)) {
    const parts = rest.map((line) => line.trim());
    return (inline.startsWith("|") ? parts.join("\n") : parts.filter(Boolean).join(" ")).trim();
  }
  const items = rest
    .map((line) => line.match(LIST_ITEM))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => unquote(match[1] ?? ""))
    .filter(Boolean);
  // A nested mapping is not flattened; its key reads as empty.
  return items.join(", ");
}

/** Parses an opening frontmatter block. Text without one returns `found: false`. */
export function parseFrontmatter(raw: string): FrontmatterParse {
  const block = locateBlock(raw);
  if (!block) return { found: false, frontmatter: {}, body: raw, bodyStartLine: 1 };
  const frontmatter: Frontmatter = {};
  for (const span of keySpans(block.lines, block.closeIndex)) {
    frontmatter[span.key] = spanValue(block.lines, span);
  }
  return {
    found: true,
    frontmatter,
    body: raw.slice(block.bodyOffset),
    bodyStartLine: block.closeIndex + 2,
  };
}

/** Splits a flattened list value ("a, b") into items. */
export function frontmatterList(value: unknown): string[] {
  const text = `${value ?? ""}`.trim();
  const source = isInlineList(text) ? text.slice(1, -1) : text;
  return source
    .split(",")
    .map((item) => unquote(item))
    .filter(Boolean);
}

function renderSpan(span: KeySpan | undefined, lines: string[], key: string, value: string) {
  const wasBlockList =
    span &&
    !span.inlineValue.trim() &&
    lines.slice(span.start + 1, span.end).some((line) => LIST_ITEM.test(line));
  const wasInlineList = span && isInlineList(span.inlineValue);
  if (wasBlockList) {
    const sample = lines.slice(span.start + 1, span.end).find((line) => LIST_ITEM.test(line))!;
    const indent = sample.match(/^[ \t]*/)![0];
    const items = frontmatterList(value);
    return items.length ? [`${key}:`, ...items.map((item) => `${indent}- ${item}`)] : [`${key}:`];
  }
  if (wasInlineList) return [`${key}: [${frontmatterList(value).join(", ")}]`];
  return [`${key}: ${value}`];
}

/**
 * Sets frontmatter keys. A string replaces the key (keeping a list key a list
 * in the same style), `null` removes it, and missing keys are appended before
 * the closing line. Untouched lines are preserved byte-for-byte. Text without
 * frontmatter gets a new block.
 */
export function setFrontmatterValues(raw: string, updates: Record<string, string | null>): string {
  const block = locateBlock(raw);
  const entries = Object.entries(updates);
  if (!block) {
    const additions = entries.filter(([, value]) => value !== null);
    if (!additions.length) return raw;
    const newline = raw.includes("\r\n") ? "\r\n" : "\n";
    const header = additions.map(([key, value]) => `${key}: ${value}`).join(newline);
    return `---${newline}${header}${newline}---${newline}${newline}${raw}`;
  }
  const { lines, closeIndex, newline } = block;
  const spans = keySpans(lines, closeIndex);
  const header = lines.slice(1, closeIndex);
  const replacements = new Map<number, { end: number; lines: string[] }>();
  const appended: string[] = [];
  for (const [key, value] of entries) {
    const span = spans.find((candidate) => candidate.key === key);
    if (!span) {
      if (value !== null) appended.push(...renderSpan(undefined, lines, key, value));
      continue;
    }
    replacements.set(span.start, {
      end: span.end,
      lines: value === null ? [] : renderSpan(span, lines, key, value),
    });
  }
  const next: string[] = [];
  for (let index = 1; index < closeIndex;) {
    const replacement = replacements.get(index);
    if (replacement) {
      next.push(...replacement.lines);
      index = replacement.end;
    } else {
      next.push(header[index - 1]);
      index += 1;
    }
  }
  next.push(...appended);
  const opening = `---${newline}`;
  const headerText = next.length ? `${next.join(newline)}${newline}` : "";
  const closingAndBody = raw.slice(lineOffset(raw, closeIndex));
  return `${opening}${headerText}${closingAndBody}`;
}

function lineOffset(raw: string, lineIndex: number): number {
  let offset = 0;
  for (let line = 0; line < lineIndex; line += 1) {
    const next = raw.indexOf("\n", offset);
    if (next < 0) return raw.length;
    offset = next + 1;
  }
  return offset;
}
