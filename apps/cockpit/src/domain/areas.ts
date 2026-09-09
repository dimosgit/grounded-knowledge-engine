export const FOCUS_AREA_ICONS = ["briefcase", "sparkles", "graduation-cap"] as const;

export type FocusAreaIcon = (typeof FOCUS_AREA_ICONS)[number];

export interface FocusAreaDefinition {
  id: string;
  label: string;
  description: string;
  icon: FocusAreaIcon;
  projectIds: string[];
  documentPaths: string[];
  focusRecordIds: string[];
}

export interface AreaProjectRecord {
  id: string;
  title: string;
  recommendedNextAction?: string;
  currentFocus?: string;
  statusBucket?: string;
  updated?: string;
}

export interface AreaDocumentRecord {
  path: string;
  title: string;
  excerpt?: string;
  trackLabel?: string;
  updated?: string;
}

export interface AreaRecord {
  id: string;
  kind: "project" | "document";
  title: string;
  summary: string;
  metadata: string;
  projectId?: string;
  path?: string;
}

export interface AreaScope {
  records: AreaRecord[];
  projects: AreaRecord[];
  documents: AreaRecord[];
}

export interface AreaFocus extends AreaScope {
  current: AreaRecord | null;
  next: AreaRecord[];
}

const AREA_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const FOCUS_ICONS = new Set<FocusAreaIcon>(FOCUS_AREA_ICONS);

/**
 * The browser receives a build-time copy of the ignored workspace UI config.
 * Validate it again at the UI boundary so malformed local configuration cannot
 * produce a cross-area record leak or prevent the Cockpit from booting.
 */
export function normalizeFocusAreas(value: unknown): FocusAreaDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const areas: FocusAreaDefinition[] = [];
  for (const candidate of value.slice(0, 12)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
    const label = typeof raw.label === "string" ? raw.label.trim().replace(/\s+/g, " ") : "";
    if (!AREA_ID.test(id) || !label || label.length > 80 || seen.has(id)) continue;
    seen.add(id);
    const projectIds = uniqueStrings(raw.projectIds, (item) => PROJECT_ID.test(item), 160);
    const documentPaths = uniqueStrings(raw.documentPaths, isDocumentPath, 320);
    const validFocusIds = new Set([
      ...projectIds.map((projectId) => `project:${projectId}`),
      ...documentPaths.map((path) => `document:${path}`),
    ]);
    areas.push({
      id,
      label,
      description:
        typeof raw.description === "string"
          ? raw.description.trim().replace(/\s+/g, " ").slice(0, 240)
          : "",
      icon: FOCUS_ICONS.has(raw.icon as FocusAreaIcon) ? (raw.icon as FocusAreaIcon) : "briefcase",
      projectIds,
      documentPaths,
      focusRecordIds: uniqueStrings(raw.focusRecordIds, (item) => validFocusIds.has(item), 24),
    });
  }
  return areas;
}

export function getFocusArea(
  areas: FocusAreaDefinition[],
  areaId: string,
): FocusAreaDefinition | null {
  return areas.find((area) => area.id === areaId) || null;
}

export function scopeAreaRecords(
  area: FocusAreaDefinition | null,
  input: { projects: AreaProjectRecord[]; documents: AreaDocumentRecord[] },
): AreaScope {
  if (!area) return { records: [], projects: [], documents: [] };
  const allowedProjectIds = new Set(area.projectIds);
  const allowedDocumentPaths = new Set(area.documentPaths);
  const projects = input.projects
    .filter((project) => allowedProjectIds.has(project.id))
    .map((project) => ({
      id: `project:${project.id}`,
      kind: "project" as const,
      title: project.title,
      summary: project.recommendedNextAction || project.currentFocus || "No next action recorded.",
      metadata: project.statusBucket || "Project",
      projectId: project.id,
    }));
  const documents = input.documents
    .filter((document) => allowedDocumentPaths.has(document.path))
    .map((document) => ({
      id: `document:${document.path}`,
      kind: "document" as const,
      title: document.title,
      summary: document.excerpt || "No summary recorded.",
      metadata: document.trackLabel || "Note",
      path: document.path,
    }));
  return { records: [...projects, ...documents], projects, documents };
}

export function buildAreaFocus(
  area: FocusAreaDefinition | null,
  input: { projects: AreaProjectRecord[]; documents: AreaDocumentRecord[] },
): AreaFocus {
  const scope = scopeAreaRecords(area, input);
  if (!area?.focusRecordIds.length) return { ...scope, current: null, next: [] };
  const byId = new Map(scope.records.map((record) => [record.id, record]));
  const ordered = area.focusRecordIds
    .map((recordId) => byId.get(recordId) || null)
    .filter((record): record is AreaRecord => Boolean(record));
  return {
    ...scope,
    current: ordered[0] || null,
    next: ordered.slice(1, 3),
  };
}

function uniqueStrings(
  value: unknown,
  predicate: (value: string) => boolean,
  limit: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const values = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item && predicate(item));
  return [...new Set(values)].slice(0, limit);
}

function isDocumentPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized === value &&
    value.startsWith("kb/") &&
    value.endsWith(".md") &&
    !value.includes("..") &&
    value.length <= 240
  );
}
