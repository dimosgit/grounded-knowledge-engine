import { buildSearchFields, matchesSearchFields, normalizeSearchText } from "../lib/search";
import {
  OPERATOR_REVIEW_ACTIONS,
  OPERATOR_VIEW_KEYS,
  type OperatorDestination,
  type OperatorReviewAction,
  type OperatorViewKey,
} from "./operator-inbox";

/**
 * Pure, browser-safe model for the Cockpit command palette.
 *
 * Everything here is metadata-only: entries are composed from the already
 * loaded catalog, project, and decision summaries. Nothing in this module
 * reads Markdown bodies, touches the network, or mutates canonical records —
 * a palette selection can only ever produce an `OperatorDestination`.
 */

export type CommandPaletteKind = "review-action" | "view" | "project" | "decision" | "document";

export interface CommandPaletteSearchFields {
  raw: string;
  normalized: string;
  compact: string;
}

interface CommandPaletteEntryBase {
  /** Stable, storable identity: `<kind-prefix>:<canonical id>`. */
  id: string;
  title: string;
  subtitle: string;
  /** Canonical identifier (path / project id / decision id / view key). */
  identifier: string;
  keywords: string[];
  search: CommandPaletteSearchFields;
  titleNormalized: string;
  identifierNormalized: string;
  destination: OperatorDestination;
}

export interface DocumentEntry extends CommandPaletteEntryBase {
  kind: "document";
  path: string;
}

export interface ProjectEntry extends CommandPaletteEntryBase {
  kind: "project";
  projectId: string;
}

export interface DecisionEntry extends CommandPaletteEntryBase {
  kind: "decision";
  decisionId: string;
}

export interface ViewEntry extends CommandPaletteEntryBase {
  kind: "view";
  view: OperatorViewKey;
  /** Canonical hash route, empty for the library view (it routes to a doc). */
  route: string;
}

export interface ReviewActionEntry extends CommandPaletteEntryBase {
  kind: "review-action";
  action: OperatorReviewAction;
}

export type CommandPaletteEntry =
  | DocumentEntry
  | ProjectEntry
  | DecisionEntry
  | ViewEntry
  | ReviewActionEntry;

export interface CommandPaletteGroup {
  key: string;
  label: string;
  entries: CommandPaletteEntry[];
}

export type CommandPaletteMode = "suggestions" | "search";

export interface CommandPaletteResult {
  mode: CommandPaletteMode;
  groups: CommandPaletteGroup[];
  /** Flattened render order; option indices are positions in this array. */
  options: CommandPaletteEntry[];
}

/**
 * The single palette contract every view receives, so all eight screens share
 * one configured palette instead of eight independently wired ones.
 */
export interface CommandPaletteBinding {
  entries: CommandPaletteEntry[];
  recentIds: string[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (entry: CommandPaletteEntry) => void;
}

export const MAX_COMMAND_PALETTE_RESULTS = 20;
export const RECENT_DESTINATIONS_LIMIT = 6;
export const RECENT_DESTINATIONS_STORAGE_KEY = "gke.cockpit.recent-destinations";
export const RECENT_DESTINATIONS_VERSION = 1;

const KIND_ORDER: Record<CommandPaletteKind, number> = {
  "review-action": 0,
  view: 1,
  project: 2,
  decision: 3,
  document: 4,
};

const KIND_GROUP_LABELS: Record<CommandPaletteKind, string> = {
  "review-action": "Review actions",
  view: "Views",
  project: "Projects",
  decision: "Decisions",
  document: "Documents",
};

const SCORE_EXACT = 0;
const SCORE_TITLE_PREFIX = 1;
const SCORE_IDENTIFIER_PREFIX = 2;
const SCORE_TITLE_CONTAINS = 3;
const SCORE_OTHER = 4;

const VIEW_DEFINITIONS: Array<{
  view: OperatorViewKey;
  title: string;
  summary: string;
  route: string;
  keywords: string[];
}> = [
  {
    view: "hub",
    title: "Mission Control",
    summary: "Operator hub",
    route: "#/hub",
    keywords: ["hub", "home", "dashboard", "overview"],
  },
  {
    view: "attention",
    title: "Attention Inbox",
    summary: "One prioritized review queue",
    route: "#/attention",
    keywords: ["inbox", "queue", "signals", "review"],
  },
  {
    view: "library",
    title: "Knowledge Base",
    summary: "Browse indexed Markdown",
    route: "",
    keywords: ["library", "docs", "notes", "knowledge"],
  },
  {
    view: "projects",
    title: "Project Board",
    summary: "Project lanes and attention filters",
    route: "#/projects",
    keywords: ["board", "lanes", "kanban", "projects"],
  },
  {
    view: "decisions",
    title: "Decision Replay",
    summary: "Decision ledger and evidence review",
    route: "#/decisions",
    keywords: ["ledger", "replay", "decisions"],
  },
  {
    view: "graph",
    title: "Context Graph",
    summary: "Visual project, work, decision, history, and evidence relationships",
    route: "#/graph",
    keywords: ["portfolio", "projects", "graph", "links", "map", "context", "evidence"],
  },
];

const REVIEW_ACTION_DEFINITIONS: Array<{
  action: OperatorReviewAction;
  title: string;
  summary: string;
  keywords: string[];
}> = [
  {
    action: "ask",
    title: "Ask grounded knowledge",
    summary: "Open the grounded Ask drawer",
    keywords: ["ask", "question", "answer", "grounded"],
  },
  {
    action: "capture-review",
    title: "Capture Review",
    summary: "Open the capture review queue",
    keywords: ["capture", "proposal", "review", "queue"],
  },
];

/** Quick actions offered before the operator types. All are read-only. */
const QUICK_ACTION_IDS = ["view:attention", "review:ask", "review:capture-review"];

const ENTRY_ID_PATTERN =
  /^(?:document|project|decision|view|review):[A-Za-z0-9][A-Za-z0-9._\-/]{0,199}$/;

export interface CommandPaletteDocumentInput {
  path: string;
  title: string;
  searchIndex?: string;
  searchIndexNormalized?: string;
  searchIndexCompact?: string;
}

export interface CommandPaletteProjectInput {
  id: string;
  title: string;
  statusBucket?: string;
  status?: string;
  trackLabel?: string;
}

export interface CommandPaletteDecisionInput {
  decisionId: string;
  title: string;
  status?: string;
  reviewState?: string;
  projectId?: string;
}

export interface ComposeCommandPaletteInput {
  documents?: CommandPaletteDocumentInput[];
  projects?: CommandPaletteProjectInput[];
  decisions?: CommandPaletteDecisionInput[];
  /**
   * Ask and Capture Review are local-only review surfaces. The static public
   * build does not render them, so their entries must not be offered there.
   */
  includeReviewActions?: boolean;
}

export function buildViewEntries(): ViewEntry[] {
  return VIEW_DEFINITIONS.map((definition) => {
    const identifier = definition.view;
    return finalize<ViewEntry>({
      kind: "view",
      id: `view:${identifier}`,
      view: definition.view,
      route: definition.route,
      title: definition.title,
      subtitle: definition.route
        ? `${definition.summary} · ${definition.route}`
        : definition.summary,
      identifier,
      keywords: ["view", "go to", ...definition.keywords],
      destination: { kind: "view", view: definition.view },
    });
  });
}

export function buildReviewActionEntries(): ReviewActionEntry[] {
  return REVIEW_ACTION_DEFINITIONS.map((definition) =>
    finalize<ReviewActionEntry>({
      kind: "review-action",
      id: `review:${definition.action}`,
      action: definition.action,
      title: definition.title,
      subtitle: definition.summary,
      identifier: definition.action,
      keywords: ["action", "open", ...definition.keywords],
      destination: { kind: "review", action: definition.action },
    }),
  );
}

export function buildProjectEntries(projects: CommandPaletteProjectInput[]): ProjectEntry[] {
  return projects
    .filter((project) => project.id && project.title)
    .map((project) =>
      finalize<ProjectEntry>({
        kind: "project",
        id: `project:${project.id}`,
        projectId: project.id,
        title: project.title,
        subtitle: joinContext([
          "Project",
          project.statusBucket || project.status,
          project.trackLabel,
          project.id,
        ]),
        identifier: project.id,
        keywords: ["project", project.id],
        destination: { kind: "project", projectId: project.id },
      }),
    );
}

export function buildDecisionEntries(decisions: CommandPaletteDecisionInput[]): DecisionEntry[] {
  return decisions
    .filter((decision) => decision.decisionId && decision.title)
    .map((decision) =>
      finalize<DecisionEntry>({
        kind: "decision",
        id: `decision:${decision.decisionId}`,
        decisionId: decision.decisionId,
        title: decision.title,
        subtitle: joinContext([
          "Decision",
          decision.status,
          decision.reviewState,
          decision.projectId,
          decision.decisionId,
        ]),
        identifier: decision.decisionId,
        keywords: ["decision", decision.decisionId, decision.projectId || ""],
        destination: { kind: "decision", decisionId: decision.decisionId },
      }),
    );
}

export function buildDocumentEntries(documents: CommandPaletteDocumentInput[]): DocumentEntry[] {
  return documents
    .filter((doc) => doc.path && doc.title)
    .map((doc) => {
      // The catalog already carries normalized search fields; reuse them rather
      // than re-normalizing (potentially large) structural text on every build.
      const catalogFields: CommandPaletteSearchFields = {
        raw: doc.searchIndex || "",
        normalized: doc.searchIndexNormalized || "",
        compact: doc.searchIndexCompact || "",
      };
      return finalize<DocumentEntry>(
        {
          kind: "document",
          id: `document:${doc.path}`,
          path: doc.path,
          title: doc.title,
          subtitle: doc.path,
          identifier: doc.path,
          keywords: ["document", "note"],
          destination: { kind: "document", path: doc.path },
        },
        catalogFields,
      );
    });
}

export function composeCommandPaletteEntries({
  documents = [],
  projects = [],
  decisions = [],
  includeReviewActions = false,
}: ComposeCommandPaletteInput): CommandPaletteEntry[] {
  return [
    ...(includeReviewActions ? buildReviewActionEntries() : []),
    ...buildViewEntries(),
    ...buildProjectEntries(projects),
    ...buildDecisionEntries(decisions),
    ...buildDocumentEntries(documents),
  ];
}

/**
 * Deterministic ranking: exact title/identifier matches first, then title
 * prefix, identifier prefix, title substring, and finally any other metadata
 * match. Equal scores are broken by kind and then by the entry id, so the same
 * query always produces the same order.
 */
export function rankCommandPaletteEntries(
  entries: CommandPaletteEntry[],
  query: string,
  limit = MAX_COMMAND_PALETTE_RESULTS,
): CommandPaletteEntry[] {
  const needle = buildNeedle(query);
  if (!needle) return [];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, needle) }))
    .filter((scored): scored is { entry: CommandPaletteEntry; score: number } => scored.score >= 0)
    .sort(
      (a, b) =>
        a.score - b.score ||
        KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, Math.max(0, limit))
    .map((scored) => scored.entry);
}

/**
 * Groups adjacent entries by kind without changing their ranked order.
 *
 * A kind can appear in more than one group when stronger matches from other
 * kinds fall between its entries. That repetition is intentional: relevance
 * remains the source of truth for keyboard order and the group labels still
 * give assistive technology the type context for every option.
 */
export function groupCommandPaletteEntries(entries: CommandPaletteEntry[]): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  for (const entry of entries) {
    const current = groups.at(-1);
    if (current?.entries[0]?.kind === entry.kind) {
      current.entries.push(entry);
      continue;
    }
    groups.push({
      key: `${entry.kind}-${groups.length}`,
      label: KIND_GROUP_LABELS[entry.kind],
      entries: [entry],
    });
  }
  return groups;
}

export function buildQuickActionEntries(entries: CommandPaletteEntry[]): CommandPaletteEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return QUICK_ACTION_IDS.map((id) => byId.get(id)).filter((entry): entry is CommandPaletteEntry =>
    Boolean(entry),
  );
}

export function buildRecentEntries(
  entries: CommandPaletteEntry[],
  recentIds: string[],
  excludeIds: string[] = [],
  limit = RECENT_DESTINATIONS_LIMIT,
): CommandPaletteEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const excluded = new Set(excludeIds);
  const seen = new Set<string>();
  const recent: CommandPaletteEntry[] = [];
  for (const id of recentIds) {
    if (seen.has(id) || excluded.has(id)) continue;
    const entry = byId.get(id);
    if (!entry) continue;
    seen.add(id);
    recent.push(entry);
    if (recent.length >= limit) break;
  }
  return recent;
}

export interface BuildCommandPaletteResultInput {
  entries: CommandPaletteEntry[];
  query: string;
  recentIds?: string[];
  limit?: number;
}

/**
 * Single composition entry point for the presentation layer: an empty query
 * yields the bounded quick-action and recent-destination groups, a typed query
 * yields ranked, grouped, capped results.
 */
export function buildCommandPaletteResult({
  entries,
  query,
  recentIds = [],
  limit = MAX_COMMAND_PALETTE_RESULTS,
}: BuildCommandPaletteResultInput): CommandPaletteResult {
  if (!query.trim()) {
    const quickActions = buildQuickActionEntries(entries);
    const recent = buildRecentEntries(
      entries,
      recentIds,
      quickActions.map((entry) => entry.id),
    );
    const groups: CommandPaletteGroup[] = [];
    if (quickActions.length) {
      groups.push({ key: "quick-actions", label: "Quick actions", entries: quickActions });
    }
    if (recent.length) {
      groups.push({ key: "recent", label: "Recent destinations", entries: recent });
    }
    return { mode: "suggestions", groups, options: flattenGroups(groups) };
  }

  const ranked = rankCommandPaletteEntries(entries, query, limit);
  const groups = groupCommandPaletteEntries(ranked);
  return { mode: "search", groups, options: flattenGroups(groups) };
}

export function isCommandPaletteEntryId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!ENTRY_ID_PATTERN.test(value)) return false;
  // Reject traversal-ish shapes so nothing outside a canonical id can persist.
  return !value.includes("..") && !value.includes("//");
}

/**
 * Recent destinations persist as `{ version, ids }` and nothing else: canonical
 * entry ids only, never queries, bodies, or machine paths. Anything malformed,
 * versioned differently, or otherwise unrecognized degrades to "no recents".
 */
export function parseRecentDestinationIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const record = parsed as { version?: unknown; ids?: unknown };
  if (record.version !== RECENT_DESTINATIONS_VERSION) return [];
  if (!Array.isArray(record.ids)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of record.ids) {
    if (!isCommandPaletteEntryId(value) || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
    if (ids.length >= RECENT_DESTINATIONS_LIMIT) break;
  }
  return ids;
}

export function serializeRecentDestinationIds(ids: string[]): string {
  return JSON.stringify({
    version: RECENT_DESTINATIONS_VERSION,
    ids: ids.filter(isCommandPaletteEntryId).slice(0, RECENT_DESTINATIONS_LIMIT),
  });
}

export function addRecentDestinationId(ids: string[], id: string): string[] {
  if (!isCommandPaletteEntryId(id)) return ids;
  if (ids[0] === id) return ids;
  return [id, ...ids.filter((value) => value !== id)].slice(0, RECENT_DESTINATIONS_LIMIT);
}

export function isOperatorViewKey(value: string): value is OperatorViewKey {
  return (OPERATOR_VIEW_KEYS as readonly string[]).includes(value);
}

export function isOperatorReviewAction(value: string): value is OperatorReviewAction {
  return (OPERATOR_REVIEW_ACTIONS as readonly string[]).includes(value);
}

interface SearchNeedle {
  raw: string;
  normalized: string;
}

function buildNeedle(query: string): SearchNeedle | null {
  const raw = String(query || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  return { raw, normalized: normalizeSearchText(raw) };
}

function scoreEntry(entry: CommandPaletteEntry, needle: SearchNeedle): number {
  if (!matchesSearchFields(entry.search, needle.raw)) return -1;
  const { normalized } = needle;
  if (!normalized) return SCORE_OTHER;
  if (entry.titleNormalized === normalized || entry.identifierNormalized === normalized) {
    return SCORE_EXACT;
  }
  if (entry.titleNormalized.startsWith(normalized)) return SCORE_TITLE_PREFIX;
  if (entry.identifierNormalized.startsWith(normalized)) return SCORE_IDENTIFIER_PREFIX;
  if (entry.titleNormalized.includes(normalized)) return SCORE_TITLE_CONTAINS;
  return SCORE_OTHER;
}

function flattenGroups(groups: CommandPaletteGroup[]): CommandPaletteEntry[] {
  return groups.flatMap((group) => group.entries);
}

type DraftEntry<TEntry extends CommandPaletteEntry> = Omit<
  TEntry,
  "search" | "titleNormalized" | "identifierNormalized"
>;

function finalize<TEntry extends CommandPaletteEntry>(
  draft: DraftEntry<TEntry>,
  extraSearch?: CommandPaletteSearchFields,
): TEntry {
  const own = buildSearchFields(
    [draft.title, draft.identifier, draft.subtitle, ...draft.keywords].filter(Boolean).join(" "),
  );
  return {
    ...draft,
    search: extraSearch ? mergeSearchFields(extraSearch, own) : own,
    titleNormalized: normalizeSearchText(draft.title),
    identifierNormalized: normalizeSearchText(draft.identifier),
  } as TEntry;
}

function mergeSearchFields(
  base: CommandPaletteSearchFields,
  extra: CommandPaletteSearchFields,
): CommandPaletteSearchFields {
  return {
    raw: `${base.raw} ${extra.raw}`.trim(),
    normalized: `${base.normalized} ${extra.normalized}`.trim(),
    compact: `${base.compact} ${extra.compact}`.trim(),
  };
}

function joinContext(parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  return parts
    .map((part) => (part || "").trim())
    .filter((part) => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join(" · ");
}
