import fs from "node:fs/promises";
import { normalizeScalar } from "../grounding/document-core.js";
import { resumeProject } from "../projects/index.js";

export const MCP_RESOURCES = [
  {
    uri: "gke://workspace/info",
    name: "workspace-info",
    title: "GKE Workspace Information",
    description: "Active repository root and indexed logical scan roots.",
    mimeType: "application/json",
    annotations: { audience: ["user", "assistant"], priority: 0.9 },
  },
];

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

export interface ResourceDependencies {
  repoRoot: string;
  workspaceId: string;
  profile: string;
  writesEnabled: boolean;
  scanRoots: string[];
  getDocuments: () => Promise<ResourceDocument[]>;
}

export async function readMcpResource(
  params: Record<string, unknown>,
  dependencies: ResourceDependencies,
): Promise<unknown> {
  const uri = normalizeScalar(params.uri);
  if (!uri) throw rpcError(-32602, "Missing resource URI.");

  if (uri === "gke://workspace/info") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              workspaceId: dependencies.workspaceId,
              profile: dependencies.profile,
              writesEnabled: dependencies.writesEnabled,
              scanRoots: dependencies.scanRoots,
            },
            null,
            2,
          ),
        },
      ],
    };
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
