import { Moon, Sun } from "lucide-react";
import { themeLabels, type Theme } from "../domain/theme";
import { useTheme } from "../hooks/useTheme";

const nextThemeFor: Record<Theme, Theme> = {
  minimal: "warm",
  warm: "minimal",
};

/**
 * A two-state preference does not need a menu. The button shows where it will
 * take you rather than where you already are, so one press is the whole
 * interaction and there is nothing to open, dismiss, or arrow through.
 */
export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const nextTheme = nextThemeFor[theme];
  const Icon = nextTheme === "minimal" ? Moon : Sun;
  const label = `Switch to ${themeLabels[nextTheme]}`;

  return (
    <button
      type="button"
      className={`theme-switcher__toggle ${compact ? "theme-switcher__toggle--compact" : ""}`}
      aria-label={label}
      title={label}
      onClick={() => setTheme(nextTheme)}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="theme-switcher__toggle-label">{themeLabels[nextTheme]}</span>
    </button>
  );
}
