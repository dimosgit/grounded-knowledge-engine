import { describe, expect, test } from "vitest";
import {
  buildAreaFocus,
  hasAvailableAreaRecords,
  normalizeFocusAreas,
  scopeAreaRecords,
} from "../domain/areas";

const areas = normalizeFocusAreas([
  {
    id: "product",
    label: "Product",
    icon: "sparkles",
    projectIds: ["product-work"],
    documentPaths: ["kb/plans/product-plan.md"],
    focusRecordIds: ["document:kb/plans/product-plan.md", "project:product-work"],
  },
  {
    id: "learning",
    label: "Learning",
    icon: "graduation-cap",
    projectIds: ["learning"],
    documentPaths: ["kb/topics/learning.md"],
    focusRecordIds: ["project:learning"],
  },
]);

const records = {
  projects: [
    {
      id: "product-work",
      title: "Product Work",
      recommendedNextAction: "Ship the smallest useful slice.",
      statusBucket: "active",
    },
    { id: "learning", title: "Learning", currentFocus: "Practice the current lesson." },
  ],
  documents: [
    { path: "kb/plans/product-plan.md", title: "Product Plan", excerpt: "A scoped delivery plan." },
    { path: "kb/topics/learning.md", title: "Learning Notes", excerpt: "A study note." },
    { path: "kb/topics/unmapped.md", title: "Unmapped", excerpt: "Must never leak." },
  ],
};

describe("explicit focus areas", () => {
  test("uses neutral labels in the public fixture", () => {
    expect(areas.map((area) => area.label)).toEqual(["Product", "Learning"]);
  });

  test("keeps project and document membership isolated by exact configuration", () => {
    const scope = scopeAreaRecords(areas[0], records);

    expect(scope.records.map((record) => record.id)).toEqual([
      "project:product-work",
      "document:kb/plans/product-plan.md",
    ]);
    expect(scope.records.map((record) => record.title)).not.toContain("Learning");
    expect(scope.records.map((record) => record.title)).not.toContain("Unmapped");
  });

  test("opens a default area only when one of its configured records is available", () => {
    expect(
      hasAvailableAreaRecords(areas[0], {
        projectIds: records.projects.map((project) => project.id),
        documentPaths: records.documents.map((document) => document.path),
      }),
    ).toBe(true);
    expect(
      hasAvailableAreaRecords(areas[0], {
        projectIds: [],
        documentPaths: ["kb/topics/unmapped.md"],
      }),
    ).toBe(false);
  });

  test("uses only configured focus order and omits missing records honestly", () => {
    const focus = buildAreaFocus(areas[0], records);

    expect(focus.current?.id).toBe("document:kb/plans/product-plan.md");
    expect(focus.next.map((record) => record.id)).toEqual(["project:product-work"]);
  });

  test("does not make up a next item when membership exists without an ordered focus record", () => {
    const [unranked] = normalizeFocusAreas([
      { id: "work", label: "Work", projectIds: ["product-work"] },
    ]);

    const focus = buildAreaFocus(unranked, records);
    expect(focus.records).toHaveLength(1);
    expect(focus.current).toBeNull();
    expect(focus.next).toEqual([]);
  });

  test("drops malformed and cross-area focus configuration", () => {
    const [valid] = normalizeFocusAreas([
      {
        id: "work",
        label: "Work",
        projectIds: ["product-work", "../not-allowed"],
        documentPaths: ["kb/topics/learning.md", "../outside.md"],
        focusRecordIds: ["project:learning", "document:kb/topics/learning.md"],
      },
      { id: "work", label: "Duplicate" },
      { id: "not valid", label: "Invalid" },
    ]);

    expect(valid.projectIds).toEqual(["product-work"]);
    expect(valid.documentPaths).toEqual(["kb/topics/learning.md"]);
    expect(valid.focusRecordIds).toEqual(["document:kb/topics/learning.md"]);
  });
});
