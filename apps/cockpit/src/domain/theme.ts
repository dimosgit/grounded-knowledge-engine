export const THEME_STORAGE_KEY = "gke.cockpit.theme";

export const themes = ["minimal", "warm"] as const;

export type Theme = (typeof themes)[number];

export const themeLabels: Record<Theme, string> = {
  minimal: "Slick Minimalist",
  warm: "Warm Paper",
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}

export function resolveTheme(value: unknown): Theme {
  return isTheme(value) ? value : "minimal";
}
