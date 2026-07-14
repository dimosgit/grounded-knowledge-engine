export interface ProjectCitation {
  path: string;
  line: number;
  section: string;
}

export interface ProjectManifest {
  projectId: string;
  title: string;
  workspaceId: string;
  status: string;
  owner: string;
  track: string;
  startedAt: string;
  updated: string;
  reviewAfter: string;
  sourceRoots: string[];
  tags: string[];
  path: string;
  legacy: boolean;
}

export interface ProjectSection {
  key: string;
  heading: string;
  content: string;
  line: number;
}

export interface ParsedProjectDocument {
  manifest: ProjectManifest;
  sections: Map<string, ProjectSection>;
  explicitPaths: string[];
}

export type ProjectValidationSeverity = "error" | "warning";

export interface ProjectValidationIssue {
  severity: ProjectValidationSeverity;
  code: string;
  message: string;
  path: string;
  field?: string;
}

export interface ProjectValidationResult {
  valid: boolean;
  projectId: string;
  path: string;
  issues: ProjectValidationIssue[];
}

export interface ProjectSummary {
  projectId: string;
  title: string;
  status: string;
  owner: string;
  track: string;
  updated: string;
  path: string;
  workspaceId: string;
}

export type ProjectReviewState = "due" | "overdue" | "scheduled" | "unscheduled" | "not-applicable";

export type ProjectChangeSource = "git" | "frontmatter" | "mtime";

export interface ProjectChangedDocument {
  path: string;
  title: string;
  changedAt: string;
  source: ProjectChangeSource;
  citation: ProjectCitation;
}

export interface ProjectReviewEntry {
  projectId: string;
  title: string;
  status: string;
  path: string;
  reviewAfter: string;
  reviewState: ProjectReviewState;
  daysUntilReview: number | null;
  needsAttention: boolean;
  attentionReasons: string[];
  blockers: string[];
  openQuestions: string[];
  changedDocuments: ProjectChangedDocument[];
  citations: ProjectCitation[];
}

export interface WorkspaceReviewReport {
  asOf: string;
  since: string | null;
  projectCount: number;
  attentionCount: number;
  projects: ProjectReviewEntry[];
}

export interface ProjectCapsule {
  projectId: string;
  title: string;
  startHereBrief: string;
  currentFocus: string;
  recentChanges: string;
  activeDecisions: string[];
  blockersAndQuestions: string[];
  nextThreeActions: string[];
  keyDocuments: string[];
  citations: ProjectCitation[];
}
