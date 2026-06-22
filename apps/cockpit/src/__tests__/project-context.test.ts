import { describe, expect, it } from "vitest";
import { buildProjectLinkedDocs, buildProjectSummaries } from "../domain/projects";

function doc(path, title, frontmatter, content) {
  return {
    path,
    title,
    frontmatter,
    content,
    excerpt: "Fallback status",
    track: "demo",
    trackLabel: "Demo",
  };
}

describe("shared project context model", () => {
  it("prefers canonical projects while preserving legacy project notes", () => {
    const docs = [
      doc(
        "kb/projects/router-rollout/project.md",
        "Router Rollout",
        {
          record_type: "project",
          project_id: "router-rollout",
          status: "active",
          source_roots: "kb/sources/router-rollout",
          updated: "2026-06-22",
        },
        `# Router Rollout

## Current focus
Validate the shared project model.

## Last meaningful change
The Cockpit now consumes the shared parser.

## Active decisions
- Keep Markdown canonical.

## Blockers
- None.

## Open questions
- Which demo should lead?

## Next actions
1. Open the project.
2. Resume through MCP.
3. Compare citations.

## Key documents
- [Evidence](../../sources/router-rollout/evidence.md)
`,
      ),
      doc(
        "kb/sources/router-rollout/evidence.md",
        "Router Evidence",
        { record_type: "source", project_id: "router-rollout" },
        "# Router Evidence",
      ),
      doc(
        "kb/topics/legacy-board.md",
        "Legacy Board",
        { type: "project", module: "legacy-project", lifecycle: "next" },
        `# Legacy Board

## Current status
Legacy remains readable.

## Next 3 actions
1. Keep compatibility.
`,
      ),
    ];

    const projects = buildProjectSummaries(docs);
    const canonical = projects.find((project) => project.id === "router-rollout");
    const legacy = projects.find((project) => project.id === "legacy-project");

    expect(canonical.currentFocus).toBe("Validate the shared project model.");
    expect(canonical.recentChanges).toBe("The Cockpit now consumes the shared parser.");
    expect(canonical.nextActions).toHaveLength(3);
    expect(canonical.openQuestions).toEqual(["Which demo should lead?"]);
    expect(canonical.handoffMarkdown).toContain("Technical handoff: Router Rollout");
    expect(legacy.currentStatus).toBe("Legacy remains readable.");

    const linked = buildProjectLinkedDocs(canonical, null, docs);
    expect(linked.map((item) => item.path)).toEqual([
      "kb/projects/router-rollout/project.md",
      "kb/sources/router-rollout/evidence.md",
    ]);
  });
});
