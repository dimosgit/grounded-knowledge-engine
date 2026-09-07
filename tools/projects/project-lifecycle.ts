import fs from "node:fs/promises";
import path from "node:path";
import { authorizeWorkspaceWrite } from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";
import { parseProjectDocument } from "./project-manifest.js";
import {
  withProjectMutation,
  writeProjectFile,
  type ProjectServiceOptions,
} from "./project-service.js";
import { setLifecycle, VALID_LIFECYCLES } from "../../packages/contracts/src/lifecycle.js";

const ALLOWED_ROOTS = ["demo-kb", "kb"] as const;

export class ProjectLifecycleError extends Error {
  constructor(
    readonly code: "invalid_path" | "invalid_lifecycle" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

export interface ProjectLifecycleOptions extends ProjectServiceOptions {
  workspace: WorkspaceContext;
  path: unknown;
  lifecycle: unknown;
  dryRun?: boolean;
}

export async function updateProjectLifecycle(options: ProjectLifecycleOptions) {
  const repoRoot = options.workspace.realRepoRoot;
  const normalizedPath = normalizeLifecyclePath(options.path);
  const lifecycle = normalizeLifecycle(options.lifecycle);
  const targetPath = await resolveLifecycleTarget(repoRoot, normalizedPath, options.workspace);
  // Legacy board records may identify their project through frontmatter or title.
  // Resolve identity first, then re-read under the same lock as task/update/link.
  const identity = parseProjectDocument(await fs.readFile(targetPath, "utf8"), normalizedPath, "")
    .manifest.projectId;
  return withProjectMutation({ ...options, repoRoot, projectId: identity }, async () => {
    const original = await fs.readFile(targetPath, "utf8");
    if (parseProjectDocument(original, normalizedPath, "").manifest.projectId !== identity) {
      throw new Error("Project identity changed while acquiring its mutation lock.");
    }
    const content = setLifecycle(original, lifecycle);
    const changed = content !== original;
    if (changed && !options.dryRun) await writeProjectFile(targetPath, content, options.workspace);
    return { path: normalizedPath, lifecycle, content, changed, dryRun: Boolean(options.dryRun) };
  });
}

function normalizeLifecyclePath(value: unknown): string {
  const normalized = typeof value === "string" ? value.replace(/\\/g, "/") : "";
  const segments = normalized.split("/");
  const root = segments[0];
  const valid =
    normalized.endsWith(".md") &&
    !path.posix.isAbsolute(normalized) &&
    segments.length > 1 &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    ALLOWED_ROOTS.includes(root as (typeof ALLOWED_ROOTS)[number]);
  if (!valid) {
    throw new ProjectLifecycleError("invalid_path", "Lifecycle path is invalid.");
  }
  return normalized;
}

function normalizeLifecycle(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProjectLifecycleError("invalid_lifecycle", "Lifecycle value is invalid.");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized !== "" && !(VALID_LIFECYCLES as readonly string[]).includes(normalized)) {
    throw new ProjectLifecycleError("invalid_lifecycle", "Lifecycle value is invalid.");
  }
  return normalized;
}

async function resolveLifecycleTarget(
  repoRootInput: string,
  normalizedPath: string,
  workspace: WorkspaceContext,
): Promise<string> {
  const repoRoot = path.resolve(repoRootInput);
  const candidates = normalizedPath.startsWith("kb/")
    ? [normalizedPath, `demo-kb/${normalizedPath.slice("kb/".length)}`]
    : [normalizedPath];

  for (const candidate of candidates) {
    const candidatePath = path.resolve(repoRoot, candidate);
    let realTarget: string;
    try {
      realTarget = await fs.realpath(candidatePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      throw error;
    }

    const rootName = candidate.split("/", 1)[0];
    const realRoot = await fs.realpath(path.join(repoRoot, rootName));
    if (!isWithin(realRoot, realTarget)) {
      throw new ProjectLifecycleError("invalid_path", "Lifecycle path is invalid.");
    }
    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) {
      throw new ProjectLifecycleError("invalid_path", "Lifecycle path is invalid.");
    }
    await authorizeWorkspaceWrite(workspace, realTarget);
    return realTarget;
  }

  throw new ProjectLifecycleError("not_found", "Lifecycle source was not found.");
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
