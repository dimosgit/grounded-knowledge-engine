import { StrictMode } from "react";
import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  describeWorkspaceDisplay,
  parseSafeWorkspace,
  type SafeWorkspaceIdentity,
  type WorkspaceDisplay,
} from "../domain/workspace-display";
import { getWorkspaceIdentity } from "../lib/workspace-context-api";
import { useWorkspaceDisplay, WorkspaceDisplayValueProvider } from "../hooks/useWorkspaceDisplay";
import { OperatorFrame } from "../components/OperatorFrame";

const GENERIC_ERROR = "Could not read the local workspace policy.";

const HOST_PATH = "/Users/secret-operator/private-kb-root";

function identity(overrides: Partial<SafeWorkspaceIdentity> = {}): SafeWorkspaceIdentity {
  return {
    id: "local-operator",
    label: "Local Operator",
    readOnly: false,
    sensitivity: "personal",
    ...overrides,
  };
}

describe("workspace display rules", () => {
  test("describes a writable personal workspace", () => {
    const display = describeWorkspaceDisplay({ status: "ready", workspace: identity() });

    expect(display.tone).toBe("writable");
    expect(display.label).toBe("Local Operator");
    expect(display.policyText).toBe("Local writes enabled");
    expect(display.sensitivityText).toBe("");
    expect(display.detailText).toBe("Local writes enabled");
    expect(display.workspaceId).toBe("local-operator");
    expect(display.accessibleLabel).toContain("Workspace ID: local-operator");
  });

  test("describes a read-only workspace", () => {
    const display = describeWorkspaceDisplay({
      status: "ready",
      workspace: identity({ readOnly: true }),
    });

    expect(display.tone).toBe("read-only");
    expect(display.policyText).toBe("Read-only");
  });

  test("surfaces sensitivity above the default and keeps the policy text", () => {
    const sensitive = describeWorkspaceDisplay({
      status: "ready",
      workspace: identity({ sensitivity: "sensitive", readOnly: true }),
    });
    expect(sensitive.tone).toBe("sensitive");
    expect(sensitive.detailText).toBe("Read-only · Sensitive");

    const restricted = describeWorkspaceDisplay({
      status: "ready",
      workspace: identity({ sensitivity: "restricted" }),
    });
    expect(restricted.tone).toBe("restricted");
    expect(restricted.detailText).toBe("Local writes enabled · Restricted");

    const internal = describeWorkspaceDisplay({
      status: "ready",
      workspace: identity({ sensitivity: "internal" }),
    });
    expect(internal.tone).toBe("writable");
    expect(internal.detailText).toBe("Local writes enabled · Internal");
  });

  test("describes loading, error, and demo states without a workspace ID", () => {
    const loading = describeWorkspaceDisplay({ status: "loading" });
    expect(loading.tone).toBe("neutral");
    expect(loading.workspaceId).toBe("");

    const failed = describeWorkspaceDisplay({ status: "error" });
    expect(failed.label).toBe("Workspace unavailable");
    expect(failed.policyText).toBe("Verify local configuration");

    const demo = describeWorkspaceDisplay({ status: "demo" });
    expect(demo.tone).toBe("demo");
    expect(demo.summary).toBe("Demo workspace · Read-only preview");
  });

  test("rejects malformed, oversized, and path-shaped payloads", () => {
    expect(parseSafeWorkspace(null)).toBeNull();
    expect(parseSafeWorkspace([identity()])).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), readOnly: "yes" })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), sensitivity: "public" })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), label: "" })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), label: "x".repeat(121) })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), label: HOST_PATH })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), id: "C:\\Users\\operator" })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), label: "~/kb" })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), label: `Client Alpha — ${HOST_PATH}` })).toBeNull();
    expect(parseSafeWorkspace({ ...identity(), label: "Customer repoRoot" })).toBeNull();
    expect(parseSafeWorkspace(identity())).toEqual(identity());
  });

  test("ignores extra payload fields instead of rendering them", () => {
    const parsed = parseSafeWorkspace({
      ...identity(),
      repoRoot: HOST_PATH,
      scanRoots: [HOST_PATH],
    });

    expect(parsed).toEqual(identity());
    const display = describeWorkspaceDisplay({ status: "ready", workspace: parsed ?? identity() });
    expect(JSON.stringify(display)).not.toContain("secret-operator");
  });
});

describe("workspace context client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("returns the validated identity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(identity()));

    await expect(getWorkspaceIdentity()).resolves.toEqual(identity());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/__gke/workspace/context",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  test("fails generically for invalid responses without echoing the body", async () => {
    for (const body of [
      { workspace: { id: HOST_PATH, label: HOST_PATH, readOnly: true, sensitivity: "personal" } },
      { workspace: { label: "Local Operator" } },
      { error: `Cannot read ${HOST_PATH}` },
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(null, body));
      await expect(getWorkspaceIdentity()).rejects.toThrow(GENERIC_ERROR);
      vi.restoreAllMocks();
    }
  });

  test("fails generically for error statuses and network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`{"error":"${HOST_PATH}"}`, { status: 500 }),
    );
    await expect(getWorkspaceIdentity()).rejects.toThrow(GENERIC_ERROR);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`connect ECONNREFUSED ${HOST_PATH}`));
    await expect(getWorkspaceIdentity()).rejects.toThrow(GENERIC_ERROR);
  });

  test("aborts and fails generically after the five-second timeout", async () => {
    vi.useFakeTimers();
    let abortSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          abortSignal = init?.signal ?? undefined;
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const pending = getWorkspaceIdentity();
    const assertion = expect(pending).rejects.toThrow(GENERIC_ERROR);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(abortSignal?.aborted).toBe(true);
    await assertion;
  });
});

describe("useWorkspaceDisplay", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("starts neutral and resolves to the local workspace once", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(identity({ readOnly: true, sensitivity: "restricted" })));

    const { result } = renderHook(() => useWorkspaceDisplay());
    expect(result.current.status).toBe("loading");
    expect(result.current.label).toBe("Local workspace");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.tone).toBe("restricted");
    expect(result.current.detailText).toBe("Read-only · Restricted");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("deduplicates the local request when Strict Mode replays mount effects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(identity()));

    const { result } = renderHook(() => useWorkspaceDisplay(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("degrades to the unavailable state when the endpoint fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`EACCES ${HOST_PATH}`));

    const { result } = renderHook(() => useWorkspaceDisplay());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.summary).toBe("Workspace unavailable · Verify local configuration");
    expect(JSON.stringify(result.current)).not.toContain("secret-operator");
  });
});

describe("operator shell workspace status", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  test("renders the label, policy, and workspace ID for a writable workspace", () => {
    renderFrame(describeWorkspaceDisplay({ status: "ready", workspace: identity() }));

    const status = desktopStatus();
    expect(within(status).getByText("Local Operator")).toBeInTheDocument();
    expect(within(status).getByText("Local writes enabled")).toBeInTheDocument();
    expect(within(status).getByText("local-operator")).toBeInTheDocument();
    expect(status).toHaveAttribute("title", "Local Operator · Local writes enabled");
  });

  test("states the read-only policy in text, not only in color", () => {
    renderFrame(
      describeWorkspaceDisplay({ status: "ready", workspace: identity({ readOnly: true }) }),
    );

    const status = desktopStatus();
    expect(within(status).getByText("Read-only")).toBeInTheDocument();
    expect(status).toHaveAttribute(
      "aria-label",
      "Workspace: Local Operator. Read-only. Workspace ID: local-operator.",
    );
  });

  test("names a sensitive workspace in the detail line", () => {
    renderFrame(
      describeWorkspaceDisplay({
        status: "ready",
        workspace: identity({ sensitivity: "sensitive", readOnly: true }),
      }),
    );

    expect(within(desktopStatus()).getByText("Read-only · Sensitive")).toBeInTheDocument();
  });

  test("shows neutral status while loading and the fixed copy on failure", () => {
    renderFrame(describeWorkspaceDisplay({ status: "loading" }));
    expect(within(desktopStatus()).getByText("Local workspace")).toBeInTheDocument();
    expect(within(desktopStatus()).getByText("Checking workspace policy")).toBeInTheDocument();
    cleanup();

    renderFrame(describeWorkspaceDisplay({ status: "error" }));
    expect(within(desktopStatus()).getByText("Workspace unavailable")).toBeInTheDocument();
    expect(within(desktopStatus()).getByText("Verify local configuration")).toBeInTheDocument();
    // Navigation stays usable when the workspace cannot be read.
    expect(
      screen.getByRole("button", { name: "Command palette (Command or Control K)" }),
    ).toBeEnabled();
  });

  test("renders the compile-time demo state", () => {
    renderFrame(describeWorkspaceDisplay({ status: "demo" }));

    const status = desktopStatus();
    expect(within(status).getByText("Demo workspace")).toBeInTheDocument();
    expect(within(status).getByText("Read-only preview")).toBeInTheDocument();
    expect(within(status).queryByText("local-operator")).not.toBeInTheDocument();
  });

  test("keeps the full description available in collapsed navigation", () => {
    window.localStorage.setItem("operator-nav-collapsed", "true");
    renderFrame(
      describeWorkspaceDisplay({
        status: "ready",
        workspace: identity({ readOnly: true, sensitivity: "restricted" }),
      }),
    );

    const status = desktopStatus();
    expect(status).toHaveAttribute(
      "title",
      "Workspace: Local Operator. Read-only. Sensitivity: Restricted. Workspace ID: local-operator.",
    );
    expect(
      within(status).getByText(
        "Workspace: Local Operator. Read-only. Sensitivity: Restricted. Workspace ID: local-operator.",
      ),
    ).toBeInTheDocument();
    // The rail shows the icon plus the screen-reader label, not the metadata.
    expect(within(status).queryByText("Local Operator")).not.toBeInTheDocument();
  });

  test("shows the same workspace status inside mobile navigation", async () => {
    const user = userEvent.setup();
    renderFrame(describeWorkspaceDisplay({ status: "ready", workspace: identity() }));

    expect(within(desktopStatus()).getByText("Local writes enabled")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open side menu" }));

    // The drawer is modal, so the desktop copy leaves the accessibility tree and
    // the drawer must carry the same label and policy on its own.
    const drawer = screen.getByRole("dialog", { name: "Operator navigation" });
    const status = screen.getByRole("status");
    expect(drawer).toContainElement(status);
    expect(within(status).getByText("Local Operator")).toBeInTheDocument();
    expect(within(status).getByText("Local writes enabled")).toBeInTheDocument();
    expect(within(status).getByText("local-operator")).toBeInTheDocument();
  });

  test("never renders a host path or root field name", () => {
    renderFrame(describeWorkspaceDisplay({ status: "ready", workspace: identity() }));

    const markup = document.body.innerHTML;
    for (const marker of ["repoRoot", "scanRoots", "writeRoots", "secret-operator", HOST_PATH]) {
      expect(markup).not.toContain(marker);
    }
  });
});

function renderFrame(workspace: WorkspaceDisplay) {
  return render(
    <WorkspaceDisplayValueProvider value={workspace}>
      <OperatorFrame
        activeView="hub"
        title="Mission Control"
        commandBar={null}
        onCommand={() => {}}
        onHub={() => {}}
        onLibrary={() => {}}
        onProjects={() => {}}
        onGraph={() => {}}
      >
        <div>Shell body</div>
      </OperatorFrame>
    </WorkspaceDisplayValueProvider>,
  );
}

/** The desktop aside renders first; the mobile drawer is portalled on demand. */
function desktopStatus(): HTMLElement {
  return screen.getAllByRole("status")[0];
}

function jsonResponse(workspace: SafeWorkspaceIdentity | null, body?: unknown): Response {
  return new Response(JSON.stringify(body ?? { workspace }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
