import { describe, expect, test } from "vitest";
import {
  MAX_COMMAND_PALETTE_RESULTS,
  RECENT_DESTINATIONS_LIMIT,
  addRecentDestinationId,
  buildCommandPaletteResult,
  composeCommandPaletteEntries,
  isCommandPaletteEntryId,
  parseRecentDestinationIds,
  rankCommandPaletteEntries,
  serializeRecentDestinationIds,
} from "../domain/command-palette";

const documents = [
  {
    path: "kb/topics/sampling.md",
    title: "MCP Source Notes: Sampling",
    searchIndex: "mcp source notes sampling",
    searchIndexNormalized: "mcp source notes sampling",
    searchIndexCompact: "mcpsourcenotessampling",
  },
  {
    path: "kb/projects/router/project.md",
    title: "Router Project Board",
    searchIndex: "router project board",
    searchIndexNormalized: "router project board",
    searchIndexCompact: "routerprojectboard",
  },
];

const projects = [
  { id: "router", title: "Router Rollout", statusBucket: "active", trackLabel: "Platform" },
];

const decisions = [
  {
    decisionId: "pilot-location",
    title: "Select the First Pilot Location",
    status: "active",
    reviewState: "overdue",
    projectId: "router",
  },
];

function composeAll() {
  return composeCommandPaletteEntries({
    documents,
    projects,
    decisions,
    includeReviewActions: true,
  });
}

describe("command palette entry composition", () => {
  test("covers all five entry kinds with stable ids and read-only destinations", () => {
    const entries = composeAll();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    expect(byId.get("document:kb/topics/sampling.md")).toMatchObject({
      kind: "document",
      title: "MCP Source Notes: Sampling",
      destination: { kind: "document", path: "kb/topics/sampling.md" },
    });
    expect(byId.get("project:router")).toMatchObject({
      kind: "project",
      destination: { kind: "project", projectId: "router" },
    });
    expect(byId.get("decision:pilot-location")).toMatchObject({
      kind: "decision",
      destination: { kind: "decision", decisionId: "pilot-location" },
    });
    expect(byId.get("view:decisions")).toMatchObject({
      kind: "view",
      destination: { kind: "view", view: "decisions" },
    });
    expect(byId.get("review:ask")).toMatchObject({
      kind: "review-action",
      destination: { kind: "review", action: "ask" },
    });

    // Every advertised destination is navigation only; none carries a payload
    // that a write endpoint could consume.
    for (const entry of entries) {
      expect(["document", "project", "decision", "view", "review"]).toContain(
        entry.destination.kind,
      );
    }
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  test("adds disambiguating context to project and decision subtitles", () => {
    const entries = composeAll();
    const project = entries.find((entry) => entry.id === "project:router");
    const decision = entries.find((entry) => entry.id === "decision:pilot-location");
    expect(project?.subtitle).toContain("router");
    expect(project?.subtitle).toContain("active");
    expect(decision?.subtitle).toContain("pilot-location");
    expect(decision?.subtitle).toContain("overdue");
  });

  test("omits review actions unless the local review surfaces exist", () => {
    const entries = composeCommandPaletteEntries({ documents, projects, decisions });
    expect(entries.some((entry) => entry.kind === "review-action")).toBe(false);
    expect(entries.some((entry) => entry.kind === "view")).toBe(true);
  });

  test("never reads a Markdown body while composing or searching", () => {
    const trap = {
      path: "kb/topics/trap.md",
      title: "Trap Note",
      searchIndex: "trap note",
      searchIndexNormalized: "trap note",
      searchIndexCompact: "trapnote",
      get content(): string {
        throw new Error("The command palette must not read Markdown bodies.");
      },
      get body(): string {
        throw new Error("The command palette must not read Markdown bodies.");
      },
    };
    const entries = composeCommandPaletteEntries({ documents: [trap] });
    expect(() => rankCommandPaletteEntries(entries, "trap")).not.toThrow();
    expect(rankCommandPaletteEntries(entries, "trap")).toHaveLength(1);
  });
});

describe("command palette ranking", () => {
  test("ranks exact matches ahead of prefix and substring matches", () => {
    const entries = composeCommandPaletteEntries({
      documents: [
        {
          path: "kb/topics/ask.md",
          title: "Ask",
          searchIndex: "ask",
          searchIndexNormalized: "ask",
          searchIndexCompact: "ask",
        },
        {
          path: "kb/topics/how-to-ask.md",
          title: "How to Ask Well",
          searchIndex: "how to ask well",
          searchIndexNormalized: "how to ask well",
          searchIndexCompact: "howtoaskwell",
        },
      ],
      includeReviewActions: true,
    });

    const ranked = rankCommandPaletteEntries(entries, "ask");
    // Both exact matches (the review action's id and the document's title) sort
    // ahead of the substring match; kind order breaks the exact-score tie.
    expect(ranked.map((entry) => entry.id)).toEqual([
      "review:ask",
      "document:kb/topics/ask.md",
      "document:kb/topics/how-to-ask.md",
    ]);
  });

  test("preserves relevance order when results are grouped for rendering", () => {
    const entries = composeCommandPaletteEntries({
      documents: [{ path: "kb/topics/router.md", title: "Router" }],
      projects: [{ id: "router-rollout", title: "Router Rollout" }],
    });

    const ranked = rankCommandPaletteEntries(entries, "router");
    const result = buildCommandPaletteResult({ entries, query: "router" });

    expect(ranked.map((entry) => entry.id)).toEqual([
      "document:kb/topics/router.md",
      "project:router-rollout",
    ]);
    expect(result.options.map((entry) => entry.id)).toEqual(ranked.map((entry) => entry.id));
    expect(result.groups.map((group) => group.label)).toEqual(["Documents", "Projects"]);
  });

  test("breaks score ties by kind and then by id, deterministically", () => {
    const shared = "Pilot Location";
    const entries = composeCommandPaletteEntries({
      documents: [
        {
          path: "kb/sources/pilot-location.md",
          title: shared,
          searchIndex: "pilot location",
          searchIndexNormalized: "pilot location",
          searchIndexCompact: "pilotlocation",
        },
      ],
      projects: [{ id: "pilot-location", title: shared }],
      decisions: [{ decisionId: "pilot-location", title: shared }],
    });

    const first = rankCommandPaletteEntries(entries, shared).map((entry) => entry.id);
    const reversed = rankCommandPaletteEntries([...entries].reverse(), shared).map(
      (entry) => entry.id,
    );

    expect(first).toEqual([
      "project:pilot-location",
      "decision:pilot-location",
      "document:kb/sources/pilot-location.md",
    ]);
    expect(reversed).toEqual(first);
  });

  test("caps results at twenty options", () => {
    const many = Array.from({ length: 40 }, (_unused, index) => {
      const label = `Sampling Note ${String(index).padStart(2, "0")}`;
      return {
        path: `kb/topics/sampling-${String(index).padStart(2, "0")}.md`,
        title: label,
        searchIndex: label.toLowerCase(),
        searchIndexNormalized: label.toLowerCase(),
        searchIndexCompact: label.toLowerCase().replace(/\s+/g, ""),
      };
    });
    const entries = composeCommandPaletteEntries({ documents: many });
    const ranked = rankCommandPaletteEntries(entries, "sampling");
    expect(ranked).toHaveLength(MAX_COMMAND_PALETTE_RESULTS);

    const result = buildCommandPaletteResult({ entries, query: "sampling" });
    expect(result.options).toHaveLength(MAX_COMMAND_PALETTE_RESULTS);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      label: "Documents",
      entries: result.options,
    });
  });

  test("returns nothing for a blank query", () => {
    expect(rankCommandPaletteEntries(composeAll(), "   ")).toEqual([]);
  });
});

describe("command palette result composition", () => {
  test("offers bounded quick actions and recent destinations before typing", () => {
    const entries = composeAll();
    const result = buildCommandPaletteResult({
      entries,
      query: "",
      recentIds: [
        "document:kb/topics/sampling.md",
        "view:attention",
        "document:kb/topics/sampling.md",
        "project:router",
        "document:kb/missing.md",
      ],
    });

    expect(result.mode).toBe("suggestions");
    expect(result.groups.map((group) => group.label)).toEqual([
      "Quick actions",
      "Recent destinations",
    ]);
    expect(result.groups[0].entries.map((entry) => entry.id)).toEqual([
      "view:attention",
      "review:ask",
      "review:capture-review",
    ]);
    // Most-recent-first, deduped, quick actions excluded, unknown ids dropped.
    expect(result.groups[1].entries.map((entry) => entry.id)).toEqual([
      "document:kb/topics/sampling.md",
      "project:router",
    ]);
    expect(new Set(result.options.map((entry) => entry.id)).size).toBe(result.options.length);
  });

  test("groups typed results by kind without changing relevance order", () => {
    const result = buildCommandPaletteResult({ entries: composeAll(), query: "router" });
    expect(result.mode).toBe("search");
    expect(result.groups.map((group) => group.label)).toEqual([
      "Projects",
      "Documents",
      "Decisions",
    ]);
    expect(result.options).toEqual(result.groups.flatMap((group) => group.entries));
  });
});

describe("recent destination persistence", () => {
  test("accepts only canonical entry ids", () => {
    expect(isCommandPaletteEntryId("document:kb/topics/sampling.md")).toBe(true);
    expect(isCommandPaletteEntryId("view:hub")).toBe(true);
    expect(isCommandPaletteEntryId("document:../../etc/passwd")).toBe(false);
    expect(isCommandPaletteEntryId("document:kb//escape.md")).toBe(false);
    expect(isCommandPaletteEntryId("query:what did we decide")).toBe(false);
    expect(isCommandPaletteEntryId("/Users/someone/workspace/kb")).toBe(false);
    expect(isCommandPaletteEntryId(42)).toBe(false);
  });

  test("recovers safely from malformed, foreign, or outdated stored values", () => {
    expect(parseRecentDestinationIds(null)).toEqual([]);
    expect(parseRecentDestinationIds("")).toEqual([]);
    expect(parseRecentDestinationIds("{not json")).toEqual([]);
    expect(parseRecentDestinationIds('["view:hub"]')).toEqual([]);
    expect(parseRecentDestinationIds('{"version":0,"ids":["view:hub"]}')).toEqual([]);
    expect(parseRecentDestinationIds('{"version":1,"ids":"view:hub"}')).toEqual([]);
    expect(
      parseRecentDestinationIds('{"version":1,"ids":["view:hub","../secret","view:hub",7]}'),
    ).toEqual(["view:hub"]);
  });

  test("round-trips a bounded id list without storing anything else", () => {
    const ids = Array.from({ length: 10 }, (_unused, index) => `view:hub-${index}`);
    const serialized = serializeRecentDestinationIds([...ids, "not-an-id"]);
    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      ids: ids.slice(0, RECENT_DESTINATIONS_LIMIT),
    });
    expect(parseRecentDestinationIds(serialized)).toEqual(ids.slice(0, RECENT_DESTINATIONS_LIMIT));
  });

  test("keeps the most recent destination first, deduped and bounded", () => {
    let ids: string[] = [];
    for (const id of ["view:hub", "view:attention", "project:router", "view:hub"]) {
      ids = addRecentDestinationId(ids, id);
    }
    expect(ids).toEqual(["view:hub", "project:router", "view:attention"]);

    let capped: string[] = [];
    for (let index = 0; index < RECENT_DESTINATIONS_LIMIT + 3; index += 1) {
      capped = addRecentDestinationId(capped, `document:kb/note-${index}.md`);
    }
    expect(capped).toHaveLength(RECENT_DESTINATIONS_LIMIT);
    expect(capped[0]).toBe(`document:kb/note-${RECENT_DESTINATIONS_LIMIT + 2}.md`);

    expect(addRecentDestinationId(["view:hub"], "../secret")).toEqual(["view:hub"]);
  });
});
