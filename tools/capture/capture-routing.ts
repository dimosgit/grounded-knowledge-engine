import path from "node:path";
import { parseProjectFrontmatter } from "../projects/project-manifest.js";
import { getProject } from "../projects/project-service.js";

export type CaptureRouteFieldName = "path" | "track" | "module" | "projectId";

export type CaptureRouteSource =
  | "explicit"
  | "identified-project"
  | "evidence-consensus"
  | "workspace-default";

export type CaptureRouteAmbiguityReason =
  | "invalid-explicit-project"
  | "invalid-routed-project"
  | "evidence-disagreement"
  | "insufficient-evidence"
  | "evidence-project-conflict"
  | "unresolved-route";

export interface CaptureEvidenceRoute {
  path: string;
  track?: string | null;
  module?: string | null;
  projectId?: string | null;
  score?: number;
}

export interface CaptureRoutingDefaults {
  path?: string;
  track?: string;
  module?: string;
  projectId?: string;
}

export interface CaptureEvidenceConsensusPolicy {
  minimumDistinctPaths?: number;
  minimumShare?: number;
}

export interface ResolveCaptureRouteInput {
  repoRoot: string;
  kind?: "topic" | "term";
  requestedPath?: string;
  track?: string;
  module?: string;
  projectId?: string;
  evidence?: CaptureEvidenceRoute[];
  defaults?: CaptureRoutingDefaults;
  evidenceConsensus?: CaptureEvidenceConsensusPolicy;
  projectScanRoots?: string[];
}

export interface CaptureRouteCandidate {
  value: string;
  source: CaptureRouteSource;
  paths: string[];
  count: number;
  share: number;
}

export interface CaptureRouteField {
  value: string | null;
  source: CaptureRouteSource | null;
  candidates: CaptureRouteCandidate[];
}

export interface CaptureRouteAmbiguity {
  field: CaptureRouteFieldName;
  reason: CaptureRouteAmbiguityReason;
  candidates: CaptureRouteCandidate[];
  detail: string;
}

export interface CaptureRouteDecision {
  status: "resolved" | "review_required";
  fields: Record<CaptureRouteFieldName, CaptureRouteField>;
  ambiguities: CaptureRouteAmbiguity[];
  reviewReasons: string[];
  evidencePaths: string[];
}

interface EvidenceConsensus {
  candidate: CaptureRouteCandidate | null;
  candidates: CaptureRouteCandidate[];
  ambiguity: CaptureRouteAmbiguity | null;
}

interface ProjectRouteDefaults {
  track: string;
  module: string;
  path: string;
}

const DEFAULT_MINIMUM_DISTINCT_PATHS = 2;
const DEFAULT_MINIMUM_SHARE = 1;

export async function resolveCaptureRoute(
  input: ResolveCaptureRouteInput,
): Promise<CaptureRouteDecision> {
  const evidence = dedupeEvidenceByPath(input.evidence || []);
  const evidencePaths = evidence.map((item) => item.path);
  const ambiguities: CaptureRouteAmbiguity[] = [];
  const reviewReasons: string[] = [];
  const explicitProjectId = clean(input.projectId);
  let projectDefaults: ProjectRouteDefaults | null = null;
  let verifiedProjectId = "";

  if (explicitProjectId) {
    try {
      const project = await getProject(explicitProjectId, {
        repoRoot: input.repoRoot,
        scanRoots: input.projectScanRoots,
      });
      const { frontmatter } = parseProjectFrontmatter(project.raw);
      verifiedProjectId = project.parsed.manifest.projectId;
      projectDefaults = {
        track: clean(project.parsed.manifest.track),
        module: clean(frontmatter.capture_module),
        path: clean(frontmatter.capture_path),
      };
    } catch (error) {
      const candidate = scalarCandidate(explicitProjectId, "explicit");
      ambiguities.push({
        field: "projectId",
        reason: "invalid-explicit-project",
        candidates: [candidate],
        detail: error instanceof Error ? error.message : String(error),
      });
      reviewReasons.push("invalid-explicit-project");
    }
  }

  const policy = normalizeConsensusPolicy(input.evidenceConsensus);
  const evidenceConsensus = {
    track: consensusForField(evidence, "track", policy),
    module: consensusForField(evidence, "module", policy),
    projectId: consensusForField(evidence, "projectId", policy),
  };

  const fields: Record<CaptureRouteFieldName, CaptureRouteField> = {
    path: chooseField([
      explicitChoice(input.requestedPath),
      projectChoice(projectDefaults?.path),
      defaultChoice(input.defaults?.path),
    ]),
    track: chooseField([
      explicitChoice(input.track),
      projectChoice(projectDefaults?.track),
      consensusChoice(evidenceConsensus.track),
      defaultChoice(input.defaults?.track),
    ]),
    module: chooseField([
      explicitChoice(input.module),
      projectChoice(projectDefaults?.module),
      consensusChoice(evidenceConsensus.module),
      defaultChoice(input.defaults?.module),
    ]),
    projectId: chooseField([
      explicitChoice(verifiedProjectId),
      consensusChoice(evidenceConsensus.projectId),
      defaultChoice(input.defaults?.projectId),
    ]),
  };

  if (fields.projectId.value && fields.projectId.source !== "explicit") {
    try {
      const project = await getProject(fields.projectId.value, {
        repoRoot: input.repoRoot,
        scanRoots: input.projectScanRoots,
      });
      fields.projectId.value = project.parsed.manifest.projectId;
    } catch (error) {
      ambiguities.push({
        field: "projectId",
        reason: "invalid-routed-project",
        candidates: fields.projectId.candidates,
        detail: error instanceof Error ? error.message : String(error),
      });
      reviewReasons.push("invalid-routed-project");
      fields.projectId.value = null;
    }
  }

  for (const field of ["track", "module"] as const) {
    const consensus = evidenceConsensus[field];
    if (!fields[field].value && consensus.ambiguity) {
      ambiguities.push(consensus.ambiguity);
      reviewReasons.push(`ambiguous-evidence-${field}`);
    } else if (
      fields[field].source === "workspace-default" &&
      consensus.ambiguity?.reason === "evidence-disagreement"
    ) {
      ambiguities.push(consensus.ambiguity);
      reviewReasons.push(`ambiguous-evidence-${field}`);
    }
  }

  const evidenceProject = evidenceConsensus.projectId;
  if (fields.projectId.source === "evidence-consensus") {
    reviewReasons.push("evidence-project-membership-requires-review");
  } else if (fields.projectId.source === "workspace-default") {
    reviewReasons.push("default-project-membership-requires-review");
  }
  if (evidenceProject.ambiguity) {
    ambiguities.push(evidenceProject.ambiguity);
    reviewReasons.push("ambiguous-evidence-project");
  }
  if (
    verifiedProjectId &&
    evidenceProject.candidate &&
    evidenceProject.candidate.value !== verifiedProjectId
  ) {
    const candidates = [scalarCandidate(verifiedProjectId, "explicit"), evidenceProject.candidate];
    ambiguities.push({
      field: "projectId",
      reason: "evidence-project-conflict",
      candidates,
      detail: "Evidence points to a different project than the caller-identified project.",
    });
    reviewReasons.push("evidence-project-conflict");
  }

  if ((input.kind || "topic") === "topic") {
    for (const field of ["track", "module"] as const) {
      if (fields[field].value) continue;
      ambiguities.push({
        field,
        reason: "unresolved-route",
        candidates: evidenceConsensus[field].candidates,
        detail: `No ${field} was resolved from explicit context, the identified project, evidence, or workspace defaults.`,
      });
      reviewReasons.push(`unresolved-${field}`);
    }
  }

  const normalizedReasons = [...new Set(reviewReasons)];
  return {
    status: normalizedReasons.length ? "review_required" : "resolved",
    fields,
    ambiguities,
    reviewReasons: normalizedReasons,
    evidencePaths,
  };
}

function dedupeEvidenceByPath(evidence: CaptureEvidenceRoute[]): CaptureEvidenceRoute[] {
  const byPath = new Map<string, CaptureEvidenceRoute>();
  for (const item of evidence) {
    const normalizedPath = normalizeEvidencePath(item.path);
    if (!normalizedPath) continue;
    const normalized: CaptureEvidenceRoute = {
      path: normalizedPath,
      track: clean(item.track),
      module: clean(item.module),
      projectId: clean(item.projectId),
      ...(Number.isFinite(item.score) ? { score: item.score } : {}),
    };
    const existing = byPath.get(normalizedPath);
    if (!existing || (normalized.score || 0) > (existing.score || 0)) {
      byPath.set(normalizedPath, normalized);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function consensusForField(
  evidence: CaptureEvidenceRoute[],
  field: "track" | "module" | "projectId",
  policy: Required<CaptureEvidenceConsensusPolicy>,
): EvidenceConsensus {
  const values = new Map<string, string[]>();
  for (const item of evidence) {
    const value = clean(item[field]);
    if (!value) continue;
    const paths = values.get(value) || [];
    paths.push(item.path);
    values.set(value, paths);
  }
  const total = [...values.values()].reduce((sum, paths) => sum + paths.length, 0);
  const candidates = [...values.entries()]
    .map(([value, paths]) => ({
      value,
      source: "evidence-consensus" as const,
      paths,
      count: paths.length,
      share: total ? Number((paths.length / total).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  if (!candidates.length) return { candidate: null, candidates, ambiguity: null };
  const top = candidates[0];
  if (top.count >= policy.minimumDistinctPaths && top.share >= policy.minimumShare) {
    return { candidate: top, candidates, ambiguity: null };
  }
  const reason: CaptureRouteAmbiguityReason =
    candidates.length > 1 ? "evidence-disagreement" : "insufficient-evidence";
  return {
    candidate: null,
    candidates,
    ambiguity: {
      field,
      reason,
      candidates,
      detail:
        reason === "evidence-disagreement"
          ? `Evidence does not meet the ${policy.minimumShare} consensus share for ${field}.`
          : `Evidence needs at least ${policy.minimumDistinctPaths} distinct path(s) for ${field}.`,
    },
  };
}

function normalizeConsensusPolicy(
  policy: CaptureEvidenceConsensusPolicy | undefined,
): Required<CaptureEvidenceConsensusPolicy> {
  const minimumDistinctPaths = Number.isInteger(policy?.minimumDistinctPaths)
    ? Math.max(1, policy?.minimumDistinctPaths || 1)
    : DEFAULT_MINIMUM_DISTINCT_PATHS;
  const requestedShare = Number(policy?.minimumShare);
  const minimumShare = Number.isFinite(requestedShare)
    ? Math.min(1, Math.max(0.5, requestedShare))
    : DEFAULT_MINIMUM_SHARE;
  return { minimumDistinctPaths, minimumShare };
}

function explicitChoice(value: unknown): CaptureRouteField | null {
  return choice(value, "explicit");
}

function projectChoice(value: unknown): CaptureRouteField | null {
  return choice(value, "identified-project");
}

function consensusChoice(consensus: EvidenceConsensus): CaptureRouteField | null {
  if (!consensus.candidate) return null;
  return {
    value: consensus.candidate.value,
    source: "evidence-consensus",
    candidates: consensus.candidates,
  };
}

function defaultChoice(value: unknown): CaptureRouteField | null {
  return choice(value, "workspace-default");
}

function choice(value: unknown, source: CaptureRouteSource): CaptureRouteField | null {
  const normalized = clean(value);
  if (!normalized) return null;
  return { value: normalized, source, candidates: [scalarCandidate(normalized, source)] };
}

function chooseField(choices: Array<CaptureRouteField | null>): CaptureRouteField {
  return choices.find((item): item is CaptureRouteField => Boolean(item)) || emptyField();
}

function emptyField(): CaptureRouteField {
  return { value: null, source: null, candidates: [] };
}

function scalarCandidate(value: string, source: CaptureRouteSource): CaptureRouteCandidate {
  return { value, source, paths: [], count: 1, share: 1 };
}

function normalizeEvidencePath(value: unknown): string {
  const raw = clean(value).replaceAll("\\", "/");
  if (!raw || path.posix.isAbsolute(raw)) return "";
  const normalized = path.posix.normalize(raw.replace(/^\.\//, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return "";
  }
  return normalized;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
