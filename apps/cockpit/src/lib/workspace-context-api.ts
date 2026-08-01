import { parseSafeWorkspace, type SafeWorkspaceIdentity } from "../domain/workspace-display";

const WORKSPACE_CONTEXT_PATH = "/__gke/workspace/context";
const CLIENT_TIMEOUT_MS = 5_000;

/**
 * One fixed message for every failure mode. Response bodies, URLs, and abort
 * reasons are deliberately discarded so a rejected request can never carry
 * workspace paths or local configuration into the UI, a title, or the console.
 */
const GENERIC_ERROR = "Could not read the local workspace policy.";

/**
 * Reads the active workspace identity from the local development adapter.
 * Development-only: production code must never import this module (the caller
 * gates it behind `import.meta.env.DEV` and a dynamic import).
 */
export async function getWorkspaceIdentity(): Promise<SafeWorkspaceIdentity> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch(WORKSPACE_CONTEXT_PATH, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(GENERIC_ERROR);
    const payload: unknown = await response.json().catch(() => null);
    const workspace = parseSafeWorkspace(
      (payload as { workspace?: unknown } | null)?.workspace ?? null,
    );
    if (!workspace) throw new Error(GENERIC_ERROR);
    return workspace;
  } catch {
    throw new Error(GENERIC_ERROR);
  } finally {
    window.clearTimeout(timer);
  }
}
