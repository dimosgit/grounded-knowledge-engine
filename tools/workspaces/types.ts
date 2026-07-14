export type WorkspaceSensitivity = "personal" | "internal" | "sensitive" | "restricted";

export interface WorkspaceContext {
  readonly id: string;
  readonly label: string;
  /** Configured workspace root. This value is never returned through MCP. */
  readonly repoRoot: string;
  /** Canonical filesystem root resolved once at process startup. */
  readonly realRepoRoot: string;
  /** Workspace-relative configured roots, suitable for safe user-facing metadata. */
  readonly scanRoots: readonly string[];
  readonly realScanRoots: readonly string[];
  readonly writeRoots: readonly string[];
  readonly realWriteRoots: readonly string[];
  readonly readOnly: boolean;
  readonly sensitivity: WorkspaceSensitivity;
}

export interface WorkspaceConfigFile {
  id?: string;
  label?: string;
  scanRoots?: string[];
  writeRoots?: string[];
  readOnly?: boolean;
  sensitivity?: WorkspaceSensitivity;
}

export interface LoadWorkspaceContextOptions {
  repoRoot?: string;
  scanRoots?: string[] | string;
  writeRoots?: string[] | string;
  environment?: NodeJS.ProcessEnv;
}
