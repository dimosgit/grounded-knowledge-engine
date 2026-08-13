import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { GraphFocusPicker } from "../components/GraphFocusPicker";

describe("Graph focus picker", () => {
  test("puts Overview first, followed by Project, Client, Track, and Module", async () => {
    const user = userEvent.setup();
    const overview = { id: "overview", label: "All major contexts", kind: "Overview" };

    render(
      <GraphFocusPicker
        options={[
          overview,
          { id: "track:sap", label: "SAP", kind: "Track" },
          { id: "module:rap", label: "RAP", kind: "Module" },
          { id: "client:acme", label: "Acme", kind: "Client" },
          { id: "project:pilot", label: "Pilot", kind: "Project" },
        ]}
        activeOption={overview}
        query=""
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole("combobox", { name: "Focus context" });
    await user.click(search);

    expect(search).toHaveAttribute("placeholder", "Search projects, clients, tracks, modules...");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "OverviewAll major contexts",
      "ProjectPilot",
      "ClientAcme",
      "TrackSAP",
      "ModuleRAP",
    ]);
  });
});
