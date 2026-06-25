import { describe, expect, test } from "vitest";
import { buildContextGraph } from "../domain/graph";

/**
 * Visualization pillar of the GKE loop: when a new note is captured into the KB,
 * the cockpit's Context Graph must surface it as a node connected to related
 * knowledge — the "a new node appears and an edge is drawn" moment from the demo.
 *
 * buildContextGraph is a pure function over docs, so we can assert that exact
 * behaviour deterministically without rendering React.
 */

function makeDoc(overrides: Record<string, any>) {
  return {
    path: "kb/topics/placeholder.md",
    title: "Placeholder",
    content: "# Placeholder\n\nBody.",
    docType: "topic",
    frontmatter: {},
    track: "sap",
    trackLabel: "SAP",
    ...overrides,
  };
}

describe("Context Graph reflects newly captured knowledge", () => {
  const focusDoc = makeDoc({
    path: "kb/topics/project-board.md",
    title: "Project Board",
    content: "# Project Board\n\nProject status and blockers.",
    frontmatter: { module: "rap-core", tags: ["cutover"] },
  });

  const capturedNote = makeDoc({
    path: "kb/topics/sandbox-blocker.md",
    title: "Sandbox Integration Blocker",
    content: "# Sandbox Integration Blocker\n\nBlocked by a missing API key.",
    frontmatter: { module: "rap-core", tags: ["cutover"] },
  });

  test("before capture, the new note is not in the graph", () => {
    const graph = buildContextGraph(focusDoc, [focusDoc]);
    expect(graph.nodes.map((node) => node.path)).toEqual(["kb/topics/project-board.md"]);
    expect(graph.edges).toHaveLength(0);
  });

  test("after capture, the new note appears as a node connected to the focus", () => {
    const graph = buildContextGraph(focusDoc, [focusDoc, capturedNote]);

    const capturedNode = graph.nodes.find((node) => node.path === capturedNote.path);
    expect(capturedNode, "captured note should be a graph node").toBeDefined();
    expect(capturedNode?.label).toBe("Sandbox Integration Blocker");

    const edge = graph.edges.find((e) => e.from === focusDoc.path && e.to === capturedNote.path);
    expect(edge, "an edge should connect the focus to the captured note").toBeDefined();
    expect(edge?.score).toBeGreaterThan(0);
  });
});
