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
  updated: string;
  path: string;
  workspaceId: string;
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
