import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from "../domain/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "minimal",
  setTheme: () => undefined,
});

function initialTheme(): Theme {
  if (typeof document === "undefined") return "minimal";
  try {
    return resolveTheme(window.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return resolveTheme(document.documentElement.dataset.theme);
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "warm" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme selection remains useful when storage is unavailable.
    }
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => setThemeState(nextTheme), []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
