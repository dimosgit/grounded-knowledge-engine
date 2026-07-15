import type {
  CompiledDomainScoringRule,
  DomainProfile,
  DomainScoringRule,
  InternalSearchMode,
  WorkspaceDomainConfig,
} from "./types.js";

/**
 * Compiles the optional `domain` block of `.gke/workspace.json` into the
 * runtime vocabulary the retrieval/capture stack consumes. Every default below
 * reproduces the engine's historical hardcoded behavior exactly, so a
 * workspace without a `domain` block behaves byte-for-byte like before this
 * module existed.
 */

// Historical hardcoded values (see retriever.ts / document-core.ts / server.ts
// prior to the domain-profile refactor).
const DEFAULT_LABEL = "Domain";
const DEFAULT_QUERY_EXPANSIONS: Record<string, string[]> = {
  mcp: ["model", "context", "protocol"],
  kb: ["knowledge", "base"],
};
const DEFAULT_PATH_MAPPINGS = [
  { prefix: "source-docs/", sourceKind: "reference-source", track: "domain" },
  { prefix: "project/", sourceKind: "project", track: "domain" },
  { prefix: "kb/", track: "domain" },
];
const DEFAULT_INFER_MODE_PROJECT = ["\\bproject\\b|\\btask\\s*\\d+\\b"];
const DEFAULT_PRIMARY_MODULE_RULES = [
  { module: "project-tracking", queryRegex: "\\bproject\\b|\\btask\\s*\\d+\\b" },
];
const DEFAULT_CAPTURE_DEFAULTS = {
  track: "domain",
  module: "general",
  tags: ["domain", "kb-captured"],
};

function compileRegex(source: string, flags = "i"): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new Error(
      `Workspace domain configuration contains an invalid pattern: ${source} (${(error as Error).message})`,
    );
  }
}

function compileTermQuestionPatterns(labelTokens: readonly string[]): RegExp[] {
  const token = labelTokens.map((item) => `(?:${item})`).join("|");
  return [
    compileRegex(
      `^\\s*what(?:'s|\\s+is)\\s+([A-Za-z0-9/_-]{2,24})\\s+in\\s+(?:${token})\\s*\\??\\s*$`,
    ),
    compileRegex(`^\\s*define\\s+([A-Za-z0-9/_-]{2,24})\\s+(?:in\\s+(?:${token}))?\\s*\\??\\s*$`),
    compileRegex(`^\\s*meaning\\s+of\\s+([A-Za-z0-9/_-]{2,24})\\s+in\\s+(?:${token})\\s*\\??\\s*$`),
  ];
}

function compileScoringRules(rules: DomainScoringRule[] = []): CompiledDomainScoringRule[] {
  return rules.map((rule) => {
    if (!rule.id || typeof rule.id !== "string") {
      throw new Error("Every domain scoring rule needs a string id.");
    }
    if (typeof rule.boost !== "number" || !Number.isFinite(rule.boost)) {
      throw new Error(`Domain scoring rule ${rule.id} needs a finite numeric boost.`);
    }
    return Object.freeze({
      id: rule.id,
      backend: rule.backend,
      mode: rule.mode,
      sourceKind: rule.sourceKind,
      module: rule.module,
      track: rule.track,
      queryRegex: rule.queryRegex ? compileRegex(rule.queryRegex) : undefined,
      queryNotRegex: rule.queryNotRegex ? compileRegex(rule.queryNotRegex) : undefined,
      boost: rule.boost,
    });
  });
}

export function resolveDomainProfile(config: WorkspaceDomainConfig = {}): DomainProfile {
  const label = `${config.label ?? DEFAULT_LABEL}`.trim() || DEFAULT_LABEL;
  const labelTokens =
    config.labelTokens && config.labelTokens.length
      ? config.labelTokens.map((token) => `${token}`.trim()).filter(Boolean)
      : [label.toLowerCase()];

  const merge = config.queryExpansions?.merge ?? "extend";
  const configuredExpansions = config.queryExpansions?.entries ?? {};
  const queryExpansions: Record<string, readonly string[]> =
    merge === "replace"
      ? { ...configuredExpansions }
      : { ...DEFAULT_QUERY_EXPANSIONS, ...configuredExpansions };

  const modeAliases: Record<string, InternalSearchMode> = { ...(config.modeAliases ?? {}) };

  return Object.freeze({
    label,
    labelTokens: Object.freeze(labelTokens),
    termQuestionPatterns: Object.freeze(compileTermQuestionPatterns(labelTokens)),
    modeAliases: Object.freeze(modeAliases),
    queryExpansions: Object.freeze(queryExpansions),
    textNormalizations: Object.freeze(
      (config.textNormalizations ?? []).map((item) => ({
        pattern: compileRegex(item.pattern, item.flags ?? "g"),
        replacement: item.replacement,
      })),
    ),
    pathMappings: Object.freeze(
      config.pathMappings && config.pathMappings.length
        ? config.pathMappings.map((item) => ({ ...item }))
        : DEFAULT_PATH_MAPPINGS.map((item) => ({ ...item })),
    ),
    defaultTrack: `${config.defaultTrack ?? "domain"}`,
    inferModeProject: Object.freeze(
      (config.inferMode?.project ?? DEFAULT_INFER_MODE_PROJECT).map((source) =>
        compileRegex(source),
      ),
    ),
    inferModeDomain: Object.freeze(
      (config.inferMode?.domain ?? []).map((source) => compileRegex(source)),
    ),
    projectQueryPattern: compileRegex(config.projectQueryPattern ?? "\\bproject\\b"),
    scoringRules: Object.freeze(compileScoringRules(config.scoringRules)),
    captureDefaults: Object.freeze({
      track: config.captureDefaults?.track ?? DEFAULT_CAPTURE_DEFAULTS.track,
      module: config.captureDefaults?.module ?? DEFAULT_CAPTURE_DEFAULTS.module,
      tags: Object.freeze([...(config.captureDefaults?.tags ?? DEFAULT_CAPTURE_DEFAULTS.tags)]),
      moduleTagRules: Object.freeze(
        (config.captureDefaults?.moduleTagRules ?? []).map((rule) => ({
          tag: rule.tag,
          moduleRegex: compileRegex(rule.moduleRegex),
        })),
      ),
    }),
    primaryModuleRules: Object.freeze(
      (config.primaryModuleRules ?? DEFAULT_PRIMARY_MODULE_RULES).map((rule) => ({
        module: rule.module,
        queryRegex: compileRegex(rule.queryRegex),
      })),
    ),
    projectModeModule: `${config.projectModeModule ?? "project-tracking"}`,
    defaultModule: `${config.defaultModule ?? DEFAULT_CAPTURE_DEFAULTS.module}`,
  });
}

/** Profile used whenever a workspace has no `domain` configuration. */
export const DEFAULT_DOMAIN_PROFILE: DomainProfile = resolveDomainProfile();

/**
 * Maps an externally supplied mode name (tool argument, CLI flag) onto the
 * internal vocabulary. Unknown names pass through unchanged so downstream
 * normalization keeps rejecting them the way it always has.
 */
export function resolveModeAlias(profile: DomainProfile, mode: string): string {
  const normalized = `${mode ?? ""}`.trim().toLowerCase();
  return profile.modeAliases[normalized] ?? normalized;
}

/**
 * External names for the internal modes, for tool schemas and CLI help: each
 * internal mode is advertised under its alias when one exists.
 */
export function advertisedModeNames(profile: DomainProfile): string[] {
  const aliasByInternal = new Map<string, string>();
  for (const [alias, internal] of Object.entries(profile.modeAliases)) {
    if (!aliasByInternal.has(internal)) aliasByInternal.set(internal, alias);
  }
  return [
    "auto",
    aliasByInternal.get("domain") ?? "domain",
    aliasByInternal.get("project") ?? "project",
    "generic",
  ];
}

export interface DomainScoringContext {
  backend: "bm25" | "sqlite";
  mode: string;
  query: string;
  sourceKind?: string;
  module?: string;
  track?: string;
}

/**
 * Evaluates the profile's scoring rules against one candidate. Returns the
 * applicable adjustments; the caller adds the boosts and records the ids as
 * debug reasons.
 */
export function applyDomainScoringRules(
  profile: DomainProfile,
  context: DomainScoringContext,
): Array<{ id: string; boost: number }> {
  const out: Array<{ id: string; boost: number }> = [];
  for (const rule of profile.scoringRules) {
    if (rule.backend && rule.backend !== context.backend) continue;
    if (rule.mode && rule.mode !== context.mode) continue;
    if (rule.sourceKind && rule.sourceKind !== (context.sourceKind ?? "")) continue;
    if (rule.module && rule.module !== (context.module ?? "")) continue;
    if (rule.track && rule.track !== (context.track ?? "")) continue;
    if (rule.queryRegex && !rule.queryRegex.test(context.query)) continue;
    if (rule.queryNotRegex && rule.queryNotRegex.test(context.query)) continue;
    out.push({ id: rule.id, boost: rule.boost });
  }
  return out;
}

/**
 * Stable fingerprint of everything that affects indexing or scoring. Folded
 * into retriever cache keys so a vocabulary change rebuilds stale indexes.
 */
export function domainFingerprint(profile: DomainProfile): string {
  return JSON.stringify({
    tokens: profile.labelTokens,
    expansions: profile.queryExpansions,
    normalizations: profile.textNormalizations.map((item) => [
      String(item.pattern),
      item.replacement,
    ]),
    pathMappings: profile.pathMappings,
    defaultTrack: profile.defaultTrack,
    inferProject: profile.inferModeProject.map(String),
    inferDomain: profile.inferModeDomain.map(String),
    projectQuery: String(profile.projectQueryPattern),
    rules: profile.scoringRules.map((rule) => [
      rule.id,
      rule.backend ?? "",
      rule.mode ?? "",
      rule.sourceKind ?? "",
      rule.module ?? "",
      rule.track ?? "",
      String(rule.queryRegex ?? ""),
      String(rule.queryNotRegex ?? ""),
      rule.boost,
    ]),
    aliases: profile.modeAliases,
  });
}
