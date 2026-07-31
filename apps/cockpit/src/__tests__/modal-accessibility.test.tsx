import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AskDrawer } from "../components/AskDrawer";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";
import { composeCommandPaletteEntries, type CommandPaletteEntry } from "../domain/command-palette";
import { useModalSurface } from "../hooks/useModalSurface";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("shared modal accessibility", () => {
  test("focuses, traps, labels, and restores the grounded Ask drawer", async () => {
    const user = userEvent.setup();
    const { container } = render(<AskDrawer />);
    const opener = screen.getByRole("button", { name: "Ask grounded knowledge" });

    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Ask local knowledge" });
    const question = screen.getByLabelText("Question");
    const closeButton = screen.getByRole("button", { name: "Close grounded Ask" });
    expect(dialog).toHaveAccessibleDescription(/Grounded in Workspace/);
    expect(question).toHaveFocus();
    expect(container).toHaveAttribute("inert");
    expect(container).toHaveAttribute("aria-hidden", "true");
    expect(document.body.style.overflow).toBe("hidden");

    closeButton.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Demo Card owner" })).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Ask local knowledge" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("aria-hidden");
    expect(document.body.style.overflow).toBe("");

    await user.click(opener);
    const reopenedDialog = screen.getByRole("dialog", { name: "Ask local knowledge" });
    const backdrop = reopenedDialog.querySelector<HTMLButtonElement>("button[aria-hidden='true']");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(screen.queryByRole("dialog", { name: "Ask local knowledge" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  test("uses a safe combobox/listbox pattern for empty and populated command results", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CommandBarHarness onSelect={onSelect} />);
    const opener = screen.getByRole("button", { name: "Open knowledge search" });

    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const combobox = screen.getByRole("combobox");
    expect(dialog).toHaveAccessibleDescription(/arrow keys/);
    expect(combobox).toHaveFocus();
    expect(combobox).toHaveAttribute("aria-controls");
    expect(screen.getByRole("listbox", { name: "Command palette results" })).toBeInTheDocument();

    await user.type(combobox, "missing");
    expect(screen.getByRole("status")).toHaveTextContent("No results for missing.");
    expect(combobox).not.toHaveAttribute("aria-activedescendant");
    await user.keyboard("{ArrowDown}{ArrowUp}");
    expect(combobox).not.toHaveAttribute("aria-activedescendant");

    await user.clear(combobox);
    await user.type(combobox, "sampling");
    const option = screen.getByRole("option", { name: /MCP Source Notes: Sampling/i });
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(combobox).toHaveAttribute("aria-activedescendant", option.id);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("treats the mobile navigation as a labelled modal", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <OperatorFrame
        activeView="hub"
        title="Test cockpit"
        commandBar={null}
        onCommand={() => {}}
        onHub={() => {}}
        onLibrary={() => {}}
        onProjects={() => {}}
        onGraph={() => {}}
      >
        <button type="button">Page action</button>
      </OperatorFrame>,
    );
    const opener = screen.getByRole("button", { name: "Open side menu" });

    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Operator navigation" });
    expect(dialog).toHaveAccessibleDescription(/Choose an Operator Cockpit view/);
    expect(screen.getByRole("button", { name: "Close side menu" })).toHaveFocus();
    expect(container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Operator navigation" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  test("keeps one modal active and blocks replacement or Escape during a destructive action", async () => {
    const user = userEvent.setup();
    render(<ModalCoordinatorHarness />);
    const opener = screen.getByRole("button", { name: "Open first modal" });

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Start destructive action" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "First modal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open second modal" }));
    expect(screen.getByRole("dialog", { name: "First modal" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Second modal" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Finish destructive action" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Open second modal" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "First modal" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Second modal" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });
});

const commandEntries = composeCommandPaletteEntries({
  documents: [
    {
      path: "kb/topics/sampling.md",
      title: "MCP Source Notes: Sampling",
      searchIndex: "mcp source notes sampling",
      searchIndexNormalized: "mcp source notes sampling",
      searchIndexCompact: "mcpsourcenotessampling",
    },
  ],
});

function CommandBarHarness({ onSelect }: { onSelect: (entry: CommandPaletteEntry) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open knowledge search
      </button>
      <CommandBar
        entries={commandEntries}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        onSelect={onSelect}
      />
    </div>
  );
}

function ModalCoordinatorHarness() {
  const [firstOpen, setFirstOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setFirstOpen(true)}>
        Open first modal
      </button>
      <TestModal
        label="First modal"
        isOpen={firstOpen}
        closeDisabled={busy}
        onClose={() => setFirstOpen(false)}
      >
        <button type="button" onClick={() => setBusy(true)}>
          Start destructive action
        </button>
        <button type="button" onClick={() => setBusy(false)}>
          Finish destructive action
        </button>
        <button type="button" onClick={() => setSecondOpen(true)}>
          Open second modal
        </button>
      </TestModal>
      <TestModal label="Second modal" isOpen={secondOpen} onClose={() => setSecondOpen(false)} />
    </div>
  );
}

function TestModal({
  label,
  isOpen,
  onClose,
  closeDisabled = false,
  children,
}: {
  label: string;
  isOpen: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  children?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useModalSurface<HTMLDivElement>({
    isOpen,
    onClose,
    closeDisabled,
    initialFocusRef: closeRef,
  });

  if (!isOpen) return null;
  return createPortal(
    <div ref={modalRef} role="dialog" aria-label={label} tabIndex={-1}>
      <button ref={closeRef} type="button" onClick={onClose} disabled={closeDisabled}>
        Close {label}
      </button>
      {children}
    </div>,
    document.body,
  );
}
