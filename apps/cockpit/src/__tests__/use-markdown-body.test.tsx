import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useMarkdownBody } from "../hooks/useMarkdownBody";
import type { MarkdownContentLoader } from "../lib/content-loader";

function loaderFrom(load: MarkdownContentLoader["load"]): MarkdownContentLoader {
  return {
    has: () => true,
    load,
    clear: () => {},
  };
}

describe("useMarkdownBody", () => {
  test("exposes a stable loading state before the requested body is ready", async () => {
    let resolveBody: (body: string) => void = () => {};
    const pendingBody = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });
    const loader = loaderFrom(() => pendingBody);

    const { result } = renderHook(() => useMarkdownBody(loader, "kb/topics/example.md"));

    await waitFor(() => expect(result.current.status).toBe("loading"));
    act(() => resolveBody("# Loaded body"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.body).toBe("# Loaded body");
  });

  test("surfaces a safe error and retries the same document", async () => {
    const load = vi
      .fn<MarkdownContentLoader["load"]>()
      .mockRejectedValueOnce(new Error("Temporary read failure"))
      .mockResolvedValueOnce("# Recovered body");
    const loader = loaderFrom(load);

    const { result } = renderHook(() => useMarkdownBody(loader, "kb/topics/example.md"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Temporary read failure");

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.body).toBe("# Recovered body");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
