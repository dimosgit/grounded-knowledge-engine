import { buildObsidianOpenUrl, normalizeObsidianConfig } from "../domain/obsidian";

declare const __KB_OBSIDIAN__: unknown;

const WORKSPACE_OBSIDIAN_CONFIG = import.meta.env.DEV
  ? normalizeObsidianConfig(typeof __KB_OBSIDIAN__ === "undefined" ? null : __KB_OBSIDIAN__)
  : null;

/**
 * Local-only hand-off to the Obsidian editor. Renders nothing in production
 * builds, without a configured vault, or for documents outside the vault.
 */
export function OpenInObsidianLink({
  docPath,
  config = WORKSPACE_OBSIDIAN_CONFIG,
}: {
  docPath: string;
  config?: ReturnType<typeof normalizeObsidianConfig>;
}) {
  if (!import.meta.env.DEV) return null;
  const href = buildObsidianOpenUrl(config, docPath);
  if (!href) return null;
  return (
    <a className="action-btn" href={href} title={`Open ${docPath} in Obsidian`}>
      Open in Obsidian
    </a>
  );
}
