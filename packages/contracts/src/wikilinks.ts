// Browser-safe wiki-link, embed and inline-tag rules shared by the engine and
// the Cockpit. The syntax follows the Obsidian conventions:
//   [[Note]]  [[folder/Note]]  [[Note|label]]  [[Note#Heading]]  ![[image.png]]
// Resolution: exact vault-relative path, then a unique file name, then the
// candidate in the linking note's folder, then the shortest path. Matching
// ignores case and the `.md` extension. Code spans and fenced code are skipped.

export interface WikiLink {
  /** Link target without heading or label, e.g. `folder/Note`. */
  target: string;
  /** Heading or `^block` reference after `#`, without the `#`. */
  fragment: string;
  /** Display label after `|`, or the target when none is given. */
  label: string;
  embed: boolean;
  /** Full matched text, e.g. `![[image.png|300]]`. */
  raw: string;
  /** Offset of `raw` in the scanned text. */
  index: number;
}

const WIKI_LINK = /(!?)\[\[([^[\]\n|#]*)(?:#([^[\]\n|]*))?(?:\|([^[\]\n]*))?\]\]/g;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const INLINE_TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/** Calls `visit` for each run of text that is not code. */
function forEachProseSegment(markdown: string, visit: (text: string, offset: number) => void) {
  const lines = markdown.split("\n");
  let offset = 0;
  let fence = "";
  for (const line of lines) {
    const fenceMatch = line.match(FENCE);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = "";
      }
    } else if (fenceMatch) {
      fence = fenceMatch[1];
    } else {
      let cursor = 0;
      for (const span of line.matchAll(/(`+)[^`]*?\1/g)) {
        visit(line.slice(cursor, span.index), offset + cursor);
        cursor = span.index! + span[0].length;
      }
      visit(line.slice(cursor), offset + cursor);
    }
    offset += line.length + 1;
  }
}

/** Extracts wiki-links and embeds from Markdown prose. */
export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  forEachProseSegment(markdown, (text, offset) => {
    for (const match of text.matchAll(WIKI_LINK)) {
      const target = match[2].trim();
      const fragment = (match[3] ?? "").trim();
      if (!target && !fragment) continue;
      links.push({
        target,
        fragment,
        label: (match[4] ?? "").trim() || target || fragment,
        embed: match[1] === "!",
        raw: match[0],
        index: offset + match.index!,
      });
    }
  });
  return links;
}

/** Extracts inline `#tags` (not in code, headings or URLs), lower-cased and unique. */
export function extractInlineTags(markdown: string): string[] {
  const tags = new Set<string>();
  forEachProseSegment(markdown, (text) => {
    for (const match of text.matchAll(INLINE_TAG)) {
      const tag = match[2].replace(/\/+$/, "").toLowerCase();
      if (tag) tags.add(tag);
    }
  });
  return [...tags];
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, "");
}

function directoryOf(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index < 0 ? "" : relPath.slice(0, index);
}

export interface WikiLinkIndex {
  resolve(target: string, sourcePath?: string): string | null;
}

/**
 * Indexes workspace-relative paths for wiki-link resolution. Markdown targets
 * match without their extension; other files (images, PDFs) need it.
 */
export function createWikiLinkIndex(paths: Iterable<string>): WikiLinkIndex {
  const byKey = new Map<string, string[]>();
  const all: string[] = [];
  const add = (key: string, relPath: string) => {
    const list = byKey.get(key) ?? [];
    if (!list.includes(relPath)) list.push(relPath);
    byKey.set(key, list);
  };
  for (const relPath of paths) {
    all.push(relPath);
    const lower = relPath.toLowerCase();
    const name = lower.split("/").pop() || lower;
    add(name, relPath);
    if (lower.endsWith(".md")) add(stripMarkdownExtension(name), relPath);
  }

  return {
    resolve(rawTarget, sourcePath = "") {
      const target = rawTarget
        .trim()
        .replace(/^\.?\//, "")
        .toLowerCase();
      if (!target) return sourcePath || null;
      const withMd = target.endsWith(".md") ? target : `${target}.md`;
      if (target.includes("/")) {
        const suffixMatches = all.filter((candidate) => {
          const lower = candidate.toLowerCase();
          return [target, withMd].some((form) => lower === form || lower.endsWith(`/${form}`));
        });
        return pick(suffixMatches, sourcePath);
      }
      return pick(byKey.get(target) ?? byKey.get(withMd) ?? [], sourcePath);
    },
  };
}

function pick(candidates: string[], sourcePath: string): string | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const sourceDir = directoryOf(sourcePath);
  const sameFolder = candidates.filter((candidate) => directoryOf(candidate) === sourceDir);
  if (sameFolder.length === 1) return sameFolder[0];
  return [...candidates].sort(
    (left, right) =>
      left.split("/").length - right.split("/").length ||
      left.length - right.length ||
      left.localeCompare(right),
  )[0];
}

/** Returns `target` relative to the folder of `fromPath` (both workspace-relative). */
export function relativeWorkspacePath(fromPath: string, target: string): string {
  const from = directoryOf(fromPath).split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

export function isImagePath(relPath: string): boolean {
  return IMAGE_EXTENSION.test(relPath);
}

/**
 * Rewrites wiki-links and embeds into standard Markdown so ordinary renderers
 * can display them. `href` turns a resolved workspace path into a link target.
 * Image embeds become images, note embeds become links, unresolved image
 * embeds stay note-relative images, and other unresolved links become their
 * plain label.
 */
export function wikiLinksToMarkdown(
  markdown: string,
  index: WikiLinkIndex,
  sourcePath: string,
  href: (resolvedPath: string, fragment: string) => string,
): string {
  const links = extractWikiLinks(markdown);
  if (!links.length) return markdown;
  let output = "";
  let cursor = 0;
  for (const link of links) {
    output += markdown.slice(cursor, link.index);
    cursor = link.index + link.raw.length;
    const resolved = index.resolve(link.target, sourcePath);
    const label = link.label.replace(/[[\]]/g, "");
    if (!resolved) {
      // An unknown image embed stays an image relative to the note, so the
      // renderer can show its missing-asset fallback.
      output += link.embed && isImagePath(link.target) ? `![](<${link.target}>)` : label;
    } else if (link.embed && isImagePath(resolved)) {
      const alt = /^\d+(x\d+)?$/.test(label) || label === link.target ? "" : label;
      output += `![${alt}](<${href(resolved, "")}>)`;
    } else {
      output += `[${label}](<${href(resolved, link.fragment)}>)`;
    }
  }
  return output + markdown.slice(cursor);
}
