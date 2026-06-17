import { describe, expect, test } from "vitest";
import { buildSearchFields, matchesSearchFields } from "../lib/search";

describe("search helpers", () => {
  test("matches spaced compounds against compact terms", () => {
    const fields = buildSearchFields("Greenfield and brownfield rollout strategy");
    expect(matchesSearchFields(fields, "green field")).toBe(true);
    expect(matchesSearchFields(fields, "brown field")).toBe(true);
  });

  test("matches hyphen/underscore variants", () => {
    const fields = buildSearchFields("clean-core and side_by_side extensibility");
    expect(matchesSearchFields(fields, "clean core")).toBe(true);
    expect(matchesSearchFields(fields, "side by side")).toBe(true);
  });
});
