export type WorkspaceSensitivity = "personal" | "internal" | "sensitive" | "restricted";

/** Internal retrieval modes. Domain configs may alias external names onto these. */
export type InternalSearchMode = "domain" | "project";

/**
 * One additive scoring adjustment applied during rerank. Every gate that is
 * present must match for the boost to apply; omitted gates always match.
 */
export interface DomainScoringRule {
  /** Stable identifier surfaced as the debug adjustment reason. */
  id: string;
  /** Restrict to one retrieval backend; omit to apply on both. */
  backend?: "bm25" | "sqlite";
  /** Internal mode gate ("domain" | "project" | "generic"). */
  mode?: string;
  sourceKind?: string;
  module?: string;
  track?: string;
  /** Applies only when the query matches this pattern (case-insensitive). */
  queryRegex?: string;
  /** Applies only when the query does NOT match this pattern (case-insensitive). */
  queryNotRegex?: string;
  boost: number;
}

export interface WorkspaceDomainConfig {
  /** Human label used in answer-service hint text, e.g. "SAP". */
  label?: string;
  /**
   * Regex-source alternatives for the domain name as it appears inside
   * glossary-style questions ("what is X in <token>?"), e.g. ["sap"].
   * Defaults to the lowercased label.
   */
  labelTokens?: string[];
  /** External mode name -> internal mode, e.g. { sap: "domain", acme: "project" }. */
  modeAliases?: Record<string, InternalSearchMode>;
  queryExpansions?: {
    /** "extend" merges over the built-in dictionary; "replace" discards it. */
    merge?: "extend" | "replace";
    entries: Record<string, string[]>;
  };
  /** Extra query/text normalizations applied before tokenization. */
  textNormalizations?: Array<{ pattern: string; flags?: string; replacement: string }>;
  /** Workspace-relative path prefix -> document classification. */
  pathMappings?: Array<{ prefix: string; sourceKind?: string; track?: string }>;
  /** Track name treated as the domain track for scoring, e.g. "sap". */
  defaultTrack?: string;
  /** Regex sources for mode inference; project patterns are checked first. */
  inferMode?: { project?: string[]; domain?: string[] };
  /**
   * How queries mention the project workstream by name (regex source).
   * Domain-mode search penalizes project documents unless the query matches.
   * Defaults to "\\bproject\\b".
   */
  projectQueryPattern?: string;
  scoringRules?: DomainScoringRule[];
  /** Defaults stamped onto captured/ingested topics. */
  captureDefaults?: {
    track?: string;
    module?: string;
    tags?: string[];
    /** Extra tags applied when the routed module matches a pattern. */
    moduleTagRules?: Array<{ tag: string; moduleRegex: string }>;
  };
  /** Ordered query-pattern -> module routing; first match wins. */
  primaryModuleRules?: Array<{ module: string; queryRegex: string }>;
  /** Module used when a capture happens in project mode. */
  projectModeModule?: string;
  defaultModule?: string;
}

export interface WorkspaceUiConfig {
  readonly sourceFolders?: ReadonlyArray<{ readonly from: string; readonly to?: string }>;
  readonly rootFiles?: readonly string[];
  readonly defaultActiveTrack?: string;
}

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
  /** Compiled domain vocabulary; DEFAULT_DOMAIN_PROFILE when unconfigured. */
  readonly domain: DomainProfile;
  readonly ui: WorkspaceUiConfig;
}

export interface WorkspaceConfigFile {
  id?: string;
  label?: string;
  scanRoots?: string[];
  writeRoots?: string[];
  readOnly?: boolean;
  sensitivity?: WorkspaceSensitivity;
  domain?: WorkspaceDomainConfig;
  ui?: WorkspaceUiConfig;
}

/**
 * Runtime form of WorkspaceDomainConfig: regexes compiled once, defaults
 * applied, frozen. Produced by resolveDomainProfile() in domain-profile.ts.
 */
export interface DomainProfile {
  readonly label: string;
  readonly labelTokens: readonly string[];
  /** Compiled glossary-question patterns ("what is X in <domain>?" etc.). */
  readonly termQuestionPatterns: readonly RegExp[];
  readonly modeAliases: Readonly<Record<string, InternalSearchMode>>;
  readonly queryExpansions: Readonly<Record<string, readonly string[]>>;
  readonly textNormalizations: ReadonlyArray<{ pattern: RegExp; replacement: string }>;
  readonly pathMappings: ReadonlyArray<{ prefix: string; sourceKind?: string; track?: string }>;
  readonly defaultTrack: string;
  readonly inferModeProject: readonly RegExp[];
  readonly inferModeDomain: readonly RegExp[];
  readonly projectQueryPattern: RegExp;
  readonly scoringRules: ReadonlyArray<CompiledDomainScoringRule>;
  readonly captureDefaults: Readonly<{
    track: string;
    module: string;
    tags: readonly string[];
    moduleTagRules: ReadonlyArray<{ tag: string; moduleRegex: RegExp }>;
  }>;
  readonly primaryModuleRules: ReadonlyArray<{ module: string; queryRegex: RegExp }>;
  readonly projectModeModule: string;
  readonly defaultModule: string;
}

export interface CompiledDomainScoringRule {
  readonly id: string;
  readonly backend?: "bm25" | "sqlite";
  readonly mode?: string;
  readonly sourceKind?: string;
  readonly module?: string;
  readonly track?: string;
  readonly queryRegex?: RegExp;
  readonly queryNotRegex?: RegExp;
  readonly boost: number;
}

export interface LoadWorkspaceContextOptions {
  repoRoot?: string;
  scanRoots?: string[] | string;
  writeRoots?: string[] | string;
  environment?: NodeJS.ProcessEnv;
}
