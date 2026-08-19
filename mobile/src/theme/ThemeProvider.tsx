/**
 * Derives the active theme from the persisted preferences and hands it down by context.
 *
 * Context rather than a Redux selector in each component: the theme is derived, so a
 * selector would rebuild the object on every store change and defeat memoisation
 * everywhere. Here it is memoised once, at the root, on the two inputs that can change it.
 *
 * @author Justin Chua
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAppSelector } from "@/store/hooks";
import { buildTheme, defaultTheme, type AppTheme } from "@/styles/theme";

const ThemeContext = createContext<AppTheme>(defaultTheme);

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const highContrast = useAppSelector((state) => state.preferences.highContrast);
  const fontScale = useAppSelector((state) => state.preferences.fontScale);

  const theme = useMemo(() => buildTheme(highContrast, fontScale), [highContrast, fontScale]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * The themed tokens for the current preferences.
 *
 * Because styles depend on it, components that use this cannot hoist their `StyleSheet`
 * to module scope for anything colour- or size-dependent. That is the intended trade:
 * a static stylesheet cannot respond to a contrast toggle.
 */
export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}
