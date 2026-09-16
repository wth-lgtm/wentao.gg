"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "dark" | "light";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// WebKit throws SecurityError on ANY localStorage access under "Block all cookies" (also
// some embedded webviews). The throw used to happen inside a passive effect, which React
// treats as an uncaught render error: the root unmounted and, with no error.tsx in app/,
// the visitor got Next's "Application error" screen instead of the site.
const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  // Reports whether the value actually landed, so the caller knows if it needs the
  // in-memory fallback.
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light" || value === "system";
}

// The preference is an EXTERNAL store, not React state: reading it in an effect and calling
// setState is the react-hooks/set-state-in-effect error this file used to carry. It does NOT
// remove the dark-first first render — React must use the SERVER snapshot on the hydration
// commit, so resolvedTheme is still "dark" there and a light-system visitor still gets one
// Moon→Sun icon flip and one MatrixRain re-init. layout.tsx's anti-flash script is what
// keeps the first PAINT correct and is still required.
const listeners = new Set<() => void>();
// ONLY set when the write above was swallowed. Anything else and this would permanently
// shadow localStorage, so a `storage` event from another tab could never change the theme.
let memoryTheme: Theme | null = null;

function subscribeTheme(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  // Another tab writing the same key.
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getThemeSnapshot(): Theme {
  // Storage first: once it is readable again its value is the truth, including whatever
  // another tab just wrote.
  const stored = safeStorage.get(STORAGE_KEY);
  if (isTheme(stored)) return stored;
  return memoryTheme ?? "system";
}

function getServerThemeSnapshot(): Theme {
  return "system";
}

function subscribeSystem(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(DARK_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getSystemSnapshot(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function getServerSystemSnapshot(): boolean {
  return true;
}

function resolve(theme: Theme, systemDark: boolean): "dark" | "light" {
  if (theme !== "system") return theme;
  return systemDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const systemDark = useSyncExternalStore(subscribeSystem, getSystemSnapshot, getServerSystemSnapshot);
  const resolvedTheme = resolve(theme, systemDark);

  useEffect(() => {
    // Read the store live rather than trusting the render-time snapshot: on the hydration
    // commit useSyncExternalStore is still serving the SERVER snapshot ("system" → dark),
    // and writing that to <html> would undo layout.tsx's anti-flash class for a frame.
    const applied = resolve(getThemeSnapshot(), getSystemSnapshot());
    const root = document.documentElement;
    root.classList.toggle("dark", applied === "dark");
    root.classList.toggle("light", applied === "light");
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    // Clearing on success matters as much as setting on failure: a stale memoryTheme would
    // outrank localStorage forever after.
    memoryTheme = safeStorage.set(STORAGE_KEY, newTheme) ? null : newTheme;
    listeners.forEach((listener) => listener());
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
