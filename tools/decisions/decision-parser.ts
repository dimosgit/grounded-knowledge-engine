import { normalizeProjectId, parseProjectFrontmatter } from "../projects/project-manifest.js";
import type {
  DecisionConfidence,
  DecisionEvidence,
  DecisionRecord,
  DecisionReviewState,
  DecisionStatus,
} from "./types.js";

const VALID_STATUSES = new Set<DecisionStatus>(["proposed", "active", "superseded", "rejected"]);
const VALID_CONFIDENCE = new Set<DecisionConfidence>(["low", "medium", "high"]);
const REQUIRED_SECTIONS = [
  "decision-question",
  "recommendation",
  "alternatives-considered",
  "rationale",
  "assumptions",
  "risks-and-caveats",
  "evidence-snapshot",
  "review-history",
  "supersession",
] as const;

export function parseDecision(raw: string, relPath: string, asOf = todayIso()): DecisionRecord {
  const { frontmatter, bodyStartLine } = parseProjectFrontmatter(raw);
  if (frontmatter.schema_version !== "1") {
    throw new Error(`Decision at ${relPath} must use schema_version 1.`);
  }
  if (frontmatter.record_type !== "decision") {
    throw new Error(`Decision at ${relPath} must use record_type decision.`);
  }
  const sections = parseSections(raw, bodyStartLine);
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(section)) throw new Error(`Decision at ${relPath} is missing ${section}.`);
  }
  const decisionId = requireCanonicalSlug(frontmatter.decision_id, "decisionId");
  const pathId = relPath.match(/(?:^|\/)(?:demo-kb|kb)\/decisions\/([^/]+)\.md$/)?.[1];
  if (pathId && pathId !== decisionId) {
    throw new Error(
      `Decision ID '${decisionId}' does not match the canonical path ID '${pathId}' at ${relPath}.`,
    );
  }
  const reviewAfter = validateDate(frontmatter.review_after, "review_after");
  return {
    decisionId,
    workspaceId: requireScalar(frontmatter.workspace_id, "workspace_id"),
    projectId: cleanScalar(frontmatter.project_id)
      ? requireCanonicalSlug(frontmatter.project_id, "project_id")
      : undefined,
    title: requireScalar(frontmatter.title, "title"),
    status: requireStatus(frontmatter.status),
    owner: requireScalar(frontmatter.owner, "owner"),
    decidedAt: validateDate(frontmatter.decided_at, "decided_at"),
    evidenceCheckedAt: validateDate(frontmatter.evidence_checked_at, "evidence_checked_at"),
    reviewAfter,
    confidence: requireConfidence(frontmatter.confidence),
    updated: validateDate(frontmatter.updated, "updated"),
    tags: splitCsv(frontmatter.tags),
    question: requireText(sections.get("decision-question"), "Decision question"),
    recommendation: requireText(sections.get("recommendation"), "Recommendation"),
    alternatives: parseList(sections.get("alternatives-considered") || ""),
    rationale: requireText(sections.get("rationale"), "Rationale"),
    assumptions: parseList(sections.get("assumptions") || ""),
    risks: parseList(sections.get("risks-and-caveats") || ""),
    evidence: parseEvidence(sections.get("evidence-snapshot") || ""),
    reviewHistory: parseList(sections.get("review-history") || ""),
    supersession: parseList(sections.get("supersession") || ""),
    reviewState: calculateDecisionReviewState(reviewAfter, validateDate(asOf, "asOf")),
    path: relPath,
  };
}

export function calculateDecisionReviewState(
  reviewAfter: string,
  asOf: string,
): DecisionReviewState {
  if (reviewAfter < asOf) return "overdue";
  if (reviewAfter === asOf) return "due";
  return "current";
}

function parseSections(raw: string, bodyStartLine: number): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = raw.split(/\r?\n/).slice(bodyStartLine - 1);
  let key: string | undefined;
  let content: string[] = [];
  const save = (): void => {
    if (!key) return;
    if (sections.has(key)) throw new Error(`Decision contains duplicate '${key}' sections.`);
    sections.set(key, content.join("\n").trim());
  };
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      save();
      key = normalizeProjectId(heading[1]);
      content = [];
    } else if (key) {
      content.push(line);
    }
  }
  save();
  return sections;
}

function parseEvidence(raw: string): DecisionEvidence[] {
  const results: DecisionEvidence[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (!cleaned || /^-\s+none recorded\.?$/i.test(cleaned)) continue;
    const match = cleaned.match(/^-\s+(.+):([1-9]\d*)\s+—\s+(.+)$/);
    if (!match) throw new Error(`Invalid decision evidence citation: ${cleaned}`);
    results.push({
      path: normalizeWorkspacePath(match[1]),
      line: Number.parseInt(match[2], 10),
      section: match[3].trim(),
    });
  }
  return results;
}

function parseList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line && !/^none recorded\.?$/i.test(line));
}

function splitCsv(value: unknown): string[] {
  return [...new Set(`${value || ""}`.split(",").map(cleanScalar).filter(Boolean))];
}

function requireCanonicalSlug(value: unknown, field: string): string {
  const raw = cleanScalar(value);
  if (!raw || normalizeProjectId(raw) !== raw || raw.length > 128) {
    throw new Error(`${field} must be a canonical lowercase slug.`);
  }
  return raw;
}

function requireStatus(value: unknown): DecisionStatus {
  const status = cleanScalar(value) as DecisionStatus;
  if (!VALID_STATUSES.has(status)) {
    throw new Error("status must be proposed, active, superseded, or rejected.");
  }
  return status;
}

function requireConfidence(value: unknown): DecisionConfidence {
  const confidence = cleanScalar(value) as DecisionConfidence;
  if (!VALID_CONFIDENCE.has(confidence)) {
    throw new Error("confidence must be low, medium, or high.");
  }
  return confidence;
}

function requireScalar(value: unknown, field: string): string {
  const cleaned = cleanScalar(value);
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  return cleaned;
}

function requireText(value: unknown, field: string): string {
  const cleaned = `${value ?? ""}`.trim();
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  if (/^#{1,2}\s+/m.test(cleaned)) {
    throw new Error(`${field} cannot inject decision section headings.`);
  }
  return cleaned;
}

function cleanScalar(value: unknown): string {
  return `${value ?? ""}`.trim().replace(/[\r\n]+/g, " ");
}

function validateDate(value: unknown, field: string): string {
  const cleaned = cleanScalar(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  const parsed = new Date(`${cleaned}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== cleaned) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return cleaned;
}

function normalizeWorkspacePath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Invalid workspace-relative path: ${value}`);
  }
  return normalized;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
