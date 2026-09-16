import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { resolveTheme, THEME_STORAGE_KEY } from "../domain/theme";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { ThemeProvider, useTheme } from "../hooks/useTheme";

function ThemeProbe() {
  const { theme } = useTheme();
  return <output data-testid="theme-value">{theme}</output>;
}

function DraftProbe() {
  return <input aria-label="Draft title" defaultValue="Keep this detail" />;
}

function renderThemeControls() {
  return render(
    <ThemeProvider>
      <ThemeSwitcher />
      <ThemeProbe />
      <DraftProbe />
    </ThemeProvider>,
  );
}

describe("cockpit theme preference", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.dataset.theme = "minimal";
    document.documentElement.style.colorScheme = "dark";
  });

  test("defaults malformed stored values to Slick Minimalist", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "unrecognized-theme");
    renderThemeControls();

    expect(screen.getByTestId("theme-value")).toHaveTextContent("minimal");
    expect(document.documentElement.dataset.theme).toBe("minimal");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  test("restores a stored Warm Paper preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "warm");
    renderThemeControls();

    expect(screen.getByTestId("theme-value")).toHaveTextContent("warm");
    expect(document.documentElement.dataset.theme).toBe("warm");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  test("names the theme it will switch to, not the one already applied", async () => {
    const user = userEvent.setup();
    renderThemeControls();

    // The label is the affordance: with only two themes, showing the
    // destination is what makes a single button self-explanatory.
    const toggle = screen.getByRole("button", { name: "Switch to Warm Paper" });
    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Switch to Slick Minimalist" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("switches themes while preserving the active UI state", async () => {
    const user = userEvent.setup();
    renderThemeControls();
    const draft = screen.getByRole("textbox", { name: "Draft title" });

    await user.clear(draft);
    await user.type(draft, "A detail I am editing");
    await user.click(screen.getByRole("button", { name: "Switch to Warm Paper" }));

    expect(screen.getByTestId("theme-value")).toHaveTextContent("warm");
    expect(draft).toHaveValue("A detail I am editing");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("warm");
    expect(document.documentElement.dataset.theme).toBe("warm");
  });

  test("toggles back and keeps keyboard focus on the control", async () => {
    const user = userEvent.setup();
    renderThemeControls();

    screen.getByRole("button", { name: "Switch to Warm Paper" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("theme-value")).toHaveTextContent("warm");

    const back = screen.getByRole("button", { name: "Switch to Slick Minimalist" });
    expect(back).toHaveFocus();
    await user.keyboard(" ");

    expect(screen.getByTestId("theme-value")).toHaveTextContent("minimal");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("minimal");
  });

  test("uses only the two supported theme IDs", () => {
    expect(resolveTheme("minimal")).toBe("minimal");
    expect(resolveTheme("warm")).toBe("warm");
    expect(resolveTheme("something-else")).toBe("minimal");
    expect(resolveTheme(null)).toBe("minimal");
  });
});
