import { describe, expect, it } from "vitest";
import {
  buildProjectAttentionCounts,
  buildProjectColumns,
  buildProjectLinkedDocs,
  buildProjectSummaries,
  compactProjectText,
  filterProjectSummaries,
} from "../domain/projects";
import { buildProjectContextMap } from "../domain/project-context-map";

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

  it("builds a portable project context map from explicit existing KB relationships", () => {
    const docs = [
      doc(
        "kb/projects/context-demo/project.md",
        "Context Demo",
        {
          record_type: "project",
          project_id: "context-demo",
          lifecycle: "active",
          source_roots: "kb/sources/context-demo",
          updated: "2026-08-03",
        },
        `# Context Demo

## Outcome
Make project relationships operational.

## Current focus
Connect the existing records.

## Last meaningful change
The context adapter became portable.

## Delivery checklist
- [ ] 🟡 Build the context map [M]
- [ ] 🔴 Confirm the rollout owner [S]

## Active decisions
- Preserve Markdown compatibility.

## Blockers
- Local validation is pending.

## Open questions
- Which KB should be migrated first?

## Key documents
- [Evidence](../../sources/context-demo/evidence.md)
`,
      ),
      doc(
        "kb/sources/context-demo/evidence.md",
        "Context Evidence",
        { record_type: "source", project_id: "context-demo" },
        "# Context Evidence",
      ),
      doc(
        "kb/decisions/context-layout.md",
        "Use a Structured Context Map",
        {
          record_type: "decision",
          decision_id: "context-layout",
          project_id: "context-demo",
          status: "active",
          review_after: "2026-09-01",
        },
        "# Use a Structured Context Map",
      ),
      doc(
        "kb/projects/context-demo/checkpoints/2026-08-03-cp-map.md",
        "Context Map Started",
        {
          record_type: "checkpoint",
          checkpoint_id: "cp-map",
          project_id: "context-demo",
          created_at: "2026-08-03",
        },
        "# Context Map Started\n\n## What changed\n\nAdded the portable adapter.\n",
      ),
    ];

    const project = buildProjectSummaries(docs)[0];
    const contextMap = buildProjectContextMap(project, docs);
    const groups = new Map(contextMap.groups.map((group) => [group.key, group.items]));

    expect(groups.get("work")?.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "Current focus",
        "Build the context map",
        "Confirm the rollout owner",
      ]),
    );
    expect(groups.get("work")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Build the context map",
          destination: "delivery-checklist",
        }),
      ]),
    );
    expect(groups.get("attention")?.map((item) => item.meta)).toEqual(
      expect.arrayContaining(["Blocker", "Open question", "Gated task · S"]),
    );
    expect(groups.get("attention")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Confirm the rollout owner",
          destination: "delivery-checklist",
        }),
      ]),
    );
    expect(groups.get("decisions")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Use a Structured Context Map",
          decisionId: "context-layout",
        }),
        expect.objectContaining({ label: "Preserve Markdown compatibility." }),
      ]),
    );
    expect(groups.get("history")?.[0]).toEqual(
      expect.objectContaining({
        label: "Context Map Started",
        detail: "Added the portable adapter.",
      }),
    );
    expect(groups.get("evidence")?.map((item) => item.label)).toEqual([
      "Context Demo",
      "Context Evidence",
    ]);
  });

  it("adapts legacy project notes without requiring a schema migration", () => {
    const legacyDoc = doc(
      "kb/topics/legacy-context.md",
      "Legacy Context",
      { type: "project", module: "legacy-context", lifecycle: "next" },
      `# Legacy Context

## Current focus
Keep the old note usable.

## Next actions
1. Open the legacy project.
`,
    );

    const project = buildProjectSummaries([legacyDoc])[0];
    const contextMap = buildProjectContextMap(project, [legacyDoc]);

    expect(project.legacy).toBe(true);
    expect(contextMap.projectId).toBe("legacy-context");
    expect(contextMap.groups.find((group) => group.key === "work")?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Open the legacy project." })]),
    );
    expect(contextMap.groups.find((group) => group.key === "evidence")?.items[0]).toEqual(
      expect.objectContaining({ meta: "Legacy project record" }),
    );
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

  it("shares deterministic review semantics and composes attention filters with lanes", () => {
    const projects = buildProjectSummaries(
      [
        doc(
          "kb/projects/overdue/project.md",
          "Overdue Project",
          {
            record_type: "project",
            project_id: "overdue",
            status: "active",
            review_after: "2026-07-10",
          },
          "# Overdue\n\n## Blockers\n- Approval pending.\n",
        ),
        doc(
          "kb/projects/questions/project.md",
          "Questions Project",
          {
            record_type: "project",
            project_id: "questions",
            status: "planned",
            review_after: "2026-07-14",
          },
          "# Questions\n\n## Open questions\n- Who owns rollout?\n",
        ),
        doc(
          "kb/projects/done/project.md",
          "Done Project",
          {
            record_type: "project",
            project_id: "done",
            status: "completed",
            review_after: "2026-07-01",
          },
          "# Done\n\n## Blockers\n- Historical blocker.\n",
        ),
      ],
      {},
      { asOf: "2026-07-14T17:00:00.000Z" },
    );

    const overdue = projects.find((project) => project.id === "overdue");
    const due = projects.find((project) => project.id === "questions");
    const done = projects.find((project) => project.id === "done");
    expect(overdue).toEqual(
      expect.objectContaining({
        reviewState: "overdue",
        daysUntilReview: -4,
        needsAttention: true,
      }),
    );
    expect(due).toEqual(
      expect.objectContaining({ reviewState: "due", daysUntilReview: 0, needsAttention: true }),
    );
    expect(done).toEqual(
      expect.objectContaining({ reviewState: "not-applicable", needsAttention: false }),
    );

    expect(buildProjectAttentionCounts(projects)).toEqual({
      due: 1,
      overdue: 1,
      dueOrOverdue: 2,
      blocked: 1,
      openQuestions: 1,
      needsAttention: 2,
    });
    expect(filterProjectSummaries(projects, "overdue").map((project) => project.id)).toEqual([
      "overdue",
    ]);
    expect(filterProjectSummaries(projects, "open-questions").map((project) => project.id)).toEqual(
      ["questions"],
    );
    const filteredColumns = buildProjectColumns(filterProjectSummaries(projects, "blocked"));
    expect(filteredColumns.active.map((project) => project.id)).toEqual(["overdue"]);
    expect(Object.values(filteredColumns).flat()).toHaveLength(1);
  });
});
