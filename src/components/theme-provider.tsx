"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "afg-theme";

const themeListeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    themeListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
function subscribeSystem(cb: () => void) {
  const m = media();
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: "system", resolvedTheme: "light", setTheme: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as Theme);
  const systemDark = useSyncExternalStore(subscribeSystem, () => media().matches, () => false);
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      if (t === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* stockage indisponible : le thème s'applique pour la session seulement */
    }
    themeListeners.forEach((l) => l());
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
