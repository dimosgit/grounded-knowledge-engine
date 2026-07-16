import fs from "node:fs/promises";
import { normalizeScalar } from "../grounding/document-core.js";
import { resumeProject, reviewWorkspace } from "../projects/index.js";
import { authorizeWorkspaceRead } from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";

export const MCP_RESOURCE_TEMPLATES = [
  {
    uriTemplate: "gke://record/{path}",
    name: "knowledge-record",
    title: "GKE Knowledge Record",
    description: "Read an indexed Markdown record by URL-encoded workspace-relative path.",
    mimeType: "text/markdown",
    annotations: { audience: ["user", "assistant"], priority: 0.7 },
  },
  {
    uriTemplate: "gke://project/{projectId}/context",
    name: "project-context",
    title: "GKE Project Context",
    description: "Read the same compact cited project capsule returned by kb.resume_project.",
    mimeType: "text/markdown",
    annotations: { audience: ["user", "assistant"], priority: 0.9 },
  },
];

export interface ResourceDocument {
  absPath: string;
  relPath: string;
}

export interface ProjectResourceSummary {
  projectId: string;
  title: string;
}

export interface ResourceDependencies {
  repoRoot: string;
  workspace: WorkspaceContext;
  profile: string;
  writesEnabled: boolean;
  scanRoots: string[];
  getDocuments: () => Promise<ResourceDocument[]>;
  getProjects: () => Promise<ProjectResourceSummary[]>;
}

/**
 * Build the dynamic resource list: the workspace-info record plus one cited
 * project-context resource per discovered project. Keeping projects in
 * `resources/list` is what makes the private workspace's projects discoverable
 * without the caller knowing their ids in advance.
 */
export async function listMcpResources(dependencies: ResourceDependencies): Promise<unknown[]> {
  const projectResources = (await dependencies.getProjects()).map((project) => ({
    uri: `gke://project/${encodeURIComponent(project.projectId)}/context`,
    name: `project-${project.projectId}`,
    title: project.title,
    description: `Cited project capsule for ${project.title}.`,
    mimeType: "text/markdown",
    annotations: { audience: ["user", "assistant"], priority: 0.8 },
  }));
  return [
    {
      uri: "gke://workspace/info",
      name: "workspace-info",
      title: "GKE Workspace Information",
      description: "Active repository root, indexed scan roots, and the project inventory.",
      mimeType: "application/json",
      annotations: { audience: ["user", "assistant"], priority: 0.9 },
    },
    {
      uri: "gke://workspace/review",
      name: "workspace-review",
      title: "GKE Workspace Review",
      description: "Due project reviews, attention reasons, and changed project documents.",
      mimeType: "text/markdown",
      annotations: { audience: ["user", "assistant"], priority: 0.95 },
    },
    ...projectResources,
  ];
}

export async function readMcpResource(
  params: Record<string, unknown>,
  dependencies: ResourceDependencies,
): Promise<unknown> {
  const uri = normalizeScalar(params.uri);
  if (!uri) throw rpcError(-32602, "Missing resource URI.");

  if (uri === "gke://workspace/info") {
    const value = {
      workspaceId: dependencies.workspace.id,
      label: dependencies.workspace.label,
      sensitivity: dependencies.workspace.sensitivity,
      readOnly: dependencies.workspace.readOnly,
      profile: dependencies.profile,
      writesEnabled: dependencies.writesEnabled,
      scanRoots: dependencies.workspace.scanRoots,
      writeRoots: dependencies.workspace.writeRoots,
      projects: (await dependencies.getProjects()).map((project) => ({
        projectId: project.projectId,
        title: project.title,
        contextUri: `gke://project/${encodeURIComponent(project.projectId)}/context`,
      })),
    };
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }],
    };
  }

  if (uri === "gke://workspace/review") {
    try {
      const result = await reviewWorkspace(
        {},
        dependencies.repoRoot,
        dependencies.scanRoots,
        dependencies.workspace,
      );
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: result.contentText,
            annotations: { audience: ["user", "assistant"], priority: 0.95 },
          },
        ],
      };
    } catch (error) {
      throw rpcError(-32602, errorMessage(error));
    }
  }

  const projectMatch = uri.match(/^gke:\/\/project\/([^/]+)\/context$/);
  if (projectMatch) {
    let projectId: string;
    try {
      projectId = decodeURIComponent(projectMatch[1]);
    } catch (error) {
      throw rpcError(-32602, `Invalid project resource URI: ${errorMessage(error)}`);
    }
    try {
      const result = await resumeProject(
        { projectId },
        dependencies.repoRoot,
        dependencies.scanRoots,
        dependencies.workspace,
      );
      return {
        contents: [
          {
            uri: `gke://project/${encodeURIComponent(result.structured.projectId)}/context`,
            mimeType: "text/markdown",
            text: result.contentText,
            annotations: { audience: ["user", "assistant"], priority: 0.9 },
          },
        ],
      };
    } catch (error) {
      throw rpcError(-32602, errorMessage(error));
    }
  }

  const prefix = "gke://record/";
  if (!uri.startsWith(prefix)) {
    throw rpcError(-32602, `Unsupported resource URI: ${uri}`);
  }

  let relPath: string;
  try {
    relPath = sanitizeResourcePath(decodeURIComponent(uri.slice(prefix.length)));
  } catch (error) {
    throw rpcError(-32602, `Invalid record URI: ${errorMessage(error)}`);
  }
  const documents = await dependencies.getDocuments();
  const document = documents.find((item) => item.relPath === relPath);
  if (!document) throw rpcError(-32602, `Indexed record not found: ${relPath}`);
  await authorizeWorkspaceRead(dependencies.workspace, document.absPath);
  const raw = await fs.readFile(document.absPath, "utf8");
  return {
    contents: [
      {
        uri: `gke://record/${encodeURIComponent(document.relPath)}`,
        mimeType: document.relPath.endsWith(".md") ? "text/markdown" : "text/plain",
        text: raw,
        annotations: { audience: ["user", "assistant"], priority: 0.7 },
      },
    ],
  };
}

function sanitizeResourcePath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized) throw new Error("Resource path is required.");
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Path traversal is not allowed.");
  }
  if (normalized.split("/").some((part) => part.toLowerCase() === ".gke")) {
    throw new Error("Operational state is not exposed as a knowledge resource.");
  }
  return normalized;
}

function rpcError(code: number, message: string): Error {
  const error = new Error(message);
  (error as Error & { code?: number }).code = code;
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
