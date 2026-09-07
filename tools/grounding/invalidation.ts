import path from "node:path";
import { realpathSync } from "node:fs";

// All in-process consumers of a workspace observe successful application mutations.
const generations = new Map<string, number>();

export function invalidateWorkspaceRetrieval(repoRoot: string): void {
  const key = workspaceKey(repoRoot);
  generations.set(key, workspaceRetrievalGeneration(key) + 1);
}

export function workspaceRetrievalGeneration(repoRoot: string): number {
  return generations.get(workspaceKey(repoRoot)) || 0;
}

function workspaceKey(repoRoot: string): string {
  try {
    return realpathSync(repoRoot);
  } catch {
    return path.resolve(repoRoot);
  }
}
