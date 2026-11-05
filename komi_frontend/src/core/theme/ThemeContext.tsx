import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ThemeId } from "./colorTokens";
import { resolveTheme } from "./resolveTheme";
import { THEME_ATTRIBUTE } from "./themeCss";
import { syncThemeColor } from "./themeColor";

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  /** Eleccion manual guardada (se conecta a Dexie en el bloque 7). */
  storedMode?: ThemeId | null;
  preconfigureTsukimi?: boolean | null;
  /** Se llama cuando el lector cambia el tema, para persistirlo. */
  onModeChange?: (mode: ThemeId) => void;
  children: ReactNode;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export function ThemeProvider({
  storedMode = null,
  preconfigureTsukimi = null,
  onModeChange,
  children,
}: ThemeProviderProps) {
  const [chosen, setChosen] = useState<ThemeId | null>(storedMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useLayoutEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const theme = resolveTheme({
    storedMode: chosen,
    preconfigureTsukimi,
    systemPrefersDark: systemDark,
  });

  // Las variables CSS ya vienen en la hoja inyectada (themeCss.ts); aqui solo se fija el atributo.
  useLayoutEffect(() => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
    syncThemeColor(theme);
  }, [theme]);

  const setTheme = useCallback(
    (next: ThemeId) => {
      setChosen(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme debe usarse dentro de ThemeProvider");
  return context;
}
