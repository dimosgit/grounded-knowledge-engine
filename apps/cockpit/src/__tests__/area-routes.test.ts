import { afterEach, describe, expect, test } from "vitest";
import { getAppRoute, setHashAreaExplore, setHashAreas, setHashFocus } from "../lib/routes";

afterEach(() => {
  window.location.hash = "";
});

describe("area-first routes", () => {
  test("parses the chooser, focus, and scoped exploration routes", () => {
    window.location.hash = "#/areas";
    expect(getAppRoute()).toMatchObject({ mode: "areas" });

    window.location.hash = "#/focus/delivery";
    expect(getAppRoute()).toMatchObject({ mode: "focus", areaId: "delivery" });

    window.location.hash = "#/explore/product";
    expect(getAppRoute()).toMatchObject({ mode: "explore", areaId: "product" });
  });

  test("rejects malformed area ids instead of routing an arbitrary value", () => {
    window.location.hash = "#/focus/%2Foutside";
    expect(getAppRoute()).toMatchObject({ mode: null });
  });

  test("writes encoded area routes", () => {
    setHashAreas();
    expect(window.location.hash).toBe("#/areas");

    setHashFocus("delivery");
    expect(window.location.hash).toBe("#/focus/delivery");

    setHashAreaExplore("product");
    expect(window.location.hash).toBe("#/explore/product");
  });
});
