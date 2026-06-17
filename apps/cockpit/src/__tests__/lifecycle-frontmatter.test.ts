import { describe, expect, it } from "vitest";
import { setLifecycle } from "../../scripts/lifecycle-frontmatter";

const withLifecycle = `---
title: Demo
lifecycle: next
updated: 2026-06-17
---

# Body
text`;

const withoutLifecycle = `---
title: Demo
updated: 2026-06-17
---

# Body
text`;

describe("setLifecycle", () => {
  it("replaces an existing lifecycle value, leaving the rest untouched", () => {
    const result = setLifecycle(withLifecycle, "active");
    expect(result).toContain("lifecycle: active");
    expect(result).not.toContain("lifecycle: next");
    expect(result).toContain("title: Demo");
    expect(result).toContain("updated: 2026-06-17");
    expect(result).toContain("# Body");
  });

  it("inserts lifecycle into a frontmatter block that lacks it", () => {
    const result = setLifecycle(withoutLifecycle, "blocked");
    expect(result).toMatch(/---[\s\S]*lifecycle: blocked[\s\S]*---/);
    expect(result).toContain("title: Demo");
  });

  it("removes the lifecycle line when value is empty (Auto)", () => {
    const result = setLifecycle(withLifecycle, "");
    expect(result).not.toContain("lifecycle:");
    expect(result).toContain("title: Demo");
    expect(result).toContain("# Body");
  });

  it("normalizes case and whitespace", () => {
    expect(setLifecycle(withoutLifecycle, "  COMPLETED  ")).toContain("lifecycle: completed");
  });

  it("creates a frontmatter block when none exists and a value is set", () => {
    const result = setLifecycle("# Just a body\n", "active");
    expect(result.startsWith("---\nlifecycle: active\n---")).toBe(true);
  });

  it("is a no-op when clearing a file that has no frontmatter", () => {
    const input = "# Just a body\n";
    expect(setLifecycle(input, "")).toBe(input);
  });
});
