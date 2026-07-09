import { describe, expect, it } from "vitest";
import {
  buildProjectLinkedDocs,
  buildProjectSummaries,
  compactProjectText,
} from "../domain/projects";

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
  it("derives next actions from the checklist so task status has one source of truth", () => {
    const withChecklist = doc(
      "kb/projects/checklist-ssot/project.md",
      "Checklist SSOT",
      {
        record_type: "project",
        project_id: "checklist-ssot",
        lifecycle: "active",
        updated: "2026-07-08",
      },
      `# Checklist SSOT

## Current focus
Checklist is canonical.

## Next actions
1. STALE — this section must be ignored when a checklist exists.

## Execution checklist
- [x] Shipped item [S]
- [ ] Second open item [M]
- [ ] 🟡 Item actively worked on [L]
- [ ] 🔴 Gated item — not actionable [S]
`,
    );

    const projects = buildProjectSummaries([withChecklist]);
    const project = projects.find((candidate) => candidate.id === "checklist-ssot");

    // In-progress first, then not-started in checklist order; gated and done
    // excluded; the stale ## Next actions section ignored entirely.
    expect(project.nextActions).toEqual(["Item actively worked on", "Second open item"]);
    expect(project.taskCounts).toEqual({ done: 1, inProgress: 1, gated: 1, todo: 1, total: 4 });
  });

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
    expect(canonical.blockers).toEqual([]);
    expect(canonical.openQuestions).toEqual(["Which demo should lead?"]);
    expect(canonical.handoffMarkdown).toContain("Technical handoff: Router Rollout");
    expect(legacy.currentStatus).toBe("Legacy remains readable.");

    const linked = buildProjectLinkedDocs(canonical, null, docs);
    expect(linked.map((item) => item.path)).toEqual([
      "kb/projects/router-rollout/project.md",
      "kb/sources/router-rollout/evidence.md",
    ]);
  });

  it("creates bounded glance summaries and completed semantics", () => {
    const completed = doc(
      "kb/projects/completed-demo/project.md",
      "Completed Demo",
      {
        record_type: "project",
        project_id: "completed-demo",
        status: "completed",
        lifecycle: "completed",
      },
      `# Completed Demo

## Outcome
Ship the completed demo and preserve its full handoff context.

## Current focus
Completed.

## Blockers
- None recorded.

## Next actions
- None recorded.
`,
    );

    const project = buildProjectSummaries([completed])[0];
    expect(project.statusBucket).toBe("done");
    expect(project.blockers).toEqual([]);
    expect(project.nextActions).toEqual([]);
    expect(project.glance.startHere.length).toBeLessThanOrEqual(180);

    expect(
      compactProjectText(
        "Stand up the public cockpit and attach the final production subdomain after deployment validation.",
        54,
      ),
    ).toBe("Stand up the public cockpit and attach the final…");
  });
});
