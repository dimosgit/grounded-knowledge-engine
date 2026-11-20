// Local-only "Open in Obsidian" link rules. The Cockpit never learns absolute
// paths: it builds `obsidian://open?vault=<name>&file=<vault-relative path>`
// from the configured vault name and the document's Cockpit path.

export interface ObsidianLinkConfig {
  vault: string;
  /** Leading part of a Cockpit path that lies outside the vault, e.g. "kb/". */
  pathPrefix: string;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export function normalizeObsidianConfig(value: unknown): ObsidianLinkConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const vault = typeof record.vault === "string" ? record.vault.trim() : "";
  if (!vault || vault.length > 120 || hasControlCharacter(vault)) return null;
  const rawPrefix = typeof record.pathPrefix === "string" ? record.pathPrefix.trim() : "";
  const prefix = rawPrefix.replace(/^\/+/, "").replace(/\/*$/, rawPrefix ? "/" : "");
  if (prefix.split("/").includes("..") || hasControlCharacter(prefix)) return null;
  return { vault, pathPrefix: prefix === "/" ? "" : prefix };
}

export function buildObsidianOpenUrl(
  config: ObsidianLinkConfig | null,
  docPath: string,
): string | null {
  if (!config || !docPath) return null;
  if (config.pathPrefix && !docPath.startsWith(config.pathPrefix)) return null;
  const file = docPath.slice(config.pathPrefix.length);
  if (!file) return null;
  return `obsidian://open?vault=${encodeURIComponent(config.vault)}&file=${encodeURIComponent(file)}`;
}
