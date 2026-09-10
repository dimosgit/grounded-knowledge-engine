import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { OperatorFrame } from "../components/OperatorFrame";
import type { FocusAreaDefinition } from "../domain/areas";
import { FocusNavigationProvider } from "../hooks/useFocusNavigation";
import { AttentionHarness } from "./support/attention-harness";

const AREA: FocusAreaDefinition = {
  id: "product",
  label: "Product",
  description: "Product initiatives and research.",
  icon: "sparkles",
  projectIds: [],
  documentPaths: [],
  focusTasks: [],
  focusRecordIds: [],
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("full workspace focus navigation", () => {
  test("carries focus as one ordinary destination named for the current area", async () => {
    const user = userEvent.setup();
    const onOpenCurrent = vi.fn();
    const onChooseArea = vi.fn();

    renderFrame({ onOpenCurrent, onChooseArea });

    // Focus is a sibling of the other destinations, not a section above them,
    // so it appears exactly once in the one navigation list.
    const views = screen.getByRole("navigation", { name: "Operator views" });
    expect(within(views).getAllByRole("button", { name: "Product" })).toHaveLength(1);

    await user.click(within(views).getByRole("button", { name: "Product" }));
    expect(onOpenCurrent).toHaveBeenCalledOnce();
    expect(onChooseArea).not.toHaveBeenCalled();
  });

  test("offers area selection only when no area is current", async () => {
    const user = userEvent.setup();
    const onOpenCurrent = vi.fn();
    const onChooseArea = vi.fn();

    renderFrame({ onOpenCurrent, onChooseArea, currentArea: null });

    await user.click(screen.getByRole("button", { name: "Focus area" }));
    expect(onChooseArea).toHaveBeenCalledOnce();
    expect(onOpenCurrent).not.toHaveBeenCalled();
  });

  test("keeps the destination reachable in collapsed and mobile navigation", async () => {
    const user = userEvent.setup();
    const onOpenCurrent = vi.fn();
    const onChooseArea = vi.fn();

    renderFrame({ onOpenCurrent, onChooseArea });

    await user.click(screen.getByRole("button", { name: "Collapse side menu" }));
    await user.click(screen.getByRole("button", { name: "Product" }));
    expect(onOpenCurrent).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Open side menu" }));
    const drawer = await screen.findByRole("dialog", { name: "Operator navigation" });
    await user.click(within(drawer).getByRole("button", { name: "Product" }));
    expect(onOpenCurrent).toHaveBeenCalledTimes(2);
  });
});

function renderFrame({
  onOpenCurrent,
  onChooseArea,
  currentArea = AREA,
}: {
  onOpenCurrent: () => void;
  onChooseArea: () => void;
  currentArea?: FocusAreaDefinition | null;
}) {
  return render(
    <AttentionHarness>
      <FocusNavigationProvider value={{ currentArea, onOpenCurrent, onChooseArea }}>
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
      </FocusNavigationProvider>
    </AttentionHarness>,
  );
}
