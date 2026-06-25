export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2024-11-05"] as const;
export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export function negotiateProtocolVersion(requested: unknown): string {
  const candidate = typeof requested === "string" ? requested.trim() : "";
  return candidate && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(candidate)
    ? candidate
    : DEFAULT_PROTOCOL_VERSION;
}
