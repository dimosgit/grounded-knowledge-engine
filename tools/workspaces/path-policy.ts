import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceContext } from "./types.js";

/** Authorize a pre-existing document before it is indexed or read. */
export async function authorizeWorkspaceRead(
  workspace: WorkspaceContext,
  targetPath: string,
): Promise<string> {
  const realTarget = await fs.realpath(targetPath);
  if (!workspace.realScanRoots.some((root) => isContained(root, realTarget))) {
    throw new Error("Workspace read target is outside an allowed scan root.");
  }
  return realTarget;
}

/**
 * Authorize a write without following a symlink outside the configured write
 * roots. The returned path remains the requested logical destination so the
 * caller can preserve its existing atomic-write behavior.
 */
export async function authorizeWorkspaceWrite(
  workspace: WorkspaceContext,
  targetPath: string,
): Promise<string> {
  if (workspace.readOnly) throw new Error("Workspace is read-only.");
  return authorizeWorkspaceRuntimePath(workspace, targetPath);
}

/**
 * Confine derived runtime state to a configured write root without granting a
 * canonical mutation. Read-only processes use this to validate cache paths
 * before reading an existing cache or choosing an in-memory replacement.
 */
export async function authorizeWorkspaceRuntimePath(
  workspace: WorkspaceContext,
  targetPath: string,
): Promise<string> {
  const target = resolveWorkspaceTarget(workspace, targetPath);
  if (!target) {
    throw new Error("Workspace write target is outside an allowed write root.");
  }
  const allowedRoot = workspace.realWriteRoots.find((root) => isContained(root, target));
  if (!allowedRoot) throw new Error("Workspace write target is outside an allowed write root.");

  if (await exists(target)) {
    const realTarget = await fs.realpath(target);
    if (!isContained(allowedRoot, realTarget)) {
      throw new Error("Workspace write target is outside an allowed write root.");
    }
    return target;
  }

  const existingParent = await nearestExistingParent(target);
  const realParent = await fs.realpath(existingParent);
  if (!isContained(workspace.realRepoRoot, realParent)) {
    throw new Error("Workspace write target is outside an allowed write root.");
  }
  if ((await exists(allowedRoot)) && !isContained(allowedRoot, realParent)) {
    throw new Error("Workspace write target is outside an allowed write root.");
  }
  return target;
}

/** Internal operational state may be read from configured write roots. */
export async function authorizeWorkspaceOperationalRead(
  workspace: WorkspaceContext,
  targetPath: string,
): Promise<string> {
  const realTarget = await fs.realpath(targetPath);
  if (
    !workspace.realScanRoots.some((root) => isContained(root, realTarget)) &&
    !workspace.realWriteRoots.some((root) => isContained(root, realTarget))
  ) {
    throw new Error("Workspace read target is outside an allowed root.");
  }
  return realTarget;
}

export function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspaceTarget(workspace: WorkspaceContext, targetPath: string): string | null {
  const requested = path.resolve(targetPath);
  if (isContained(workspace.realRepoRoot, requested)) return requested;
  if (!isContained(workspace.repoRoot, requested)) return null;
  return path.resolve(workspace.realRepoRoot, path.relative(workspace.repoRoot, requested));
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function nearestExistingParent(target: string): Promise<string> {
  let current = path.dirname(target);
  while (!(await exists(current))) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}
