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
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage blocked — the choice still holds for this session via memoryTheme below.
    }
  },
};

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light" || value === "system";
}

// The preference is an EXTERNAL store, not React state. Reading it in an effect and calling
// setState (react-hooks/set-state-in-effect) meant every render before that effect resolved
// to "dark", so light-theme visitors got a Moon→Sun icon flip and MatrixRain — keyed on
// `light` — initialised twice.
const listeners = new Set<() => void>();
// Holds the choice when the write above was swallowed, so the toggle still works.
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
  if (memoryTheme) return memoryTheme;
  const stored = safeStorage.get(STORAGE_KEY);
  return isTheme(stored) ? stored : "system";
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
    memoryTheme = newTheme;
    safeStorage.set(STORAGE_KEY, newTheme);
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
