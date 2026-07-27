export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface AppPreferences {
  theme: ThemeMode;
}

const PREFERENCES_STORAGE_KEY = "iterm.preferences.v1";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "light",
};

export function loadAppPreferences(
  storage: Pick<Storage, "getItem"> = localStorage,
): AppPreferences {
  try {
    const parsed = JSON.parse(
      storage.getItem(PREFERENCES_STORAGE_KEY) ?? "null",
    ) as Partial<AppPreferences> | null;
    const theme = parsed?.theme;
    return {
      theme:
        theme === "light" || theme === "dark" || theme === "system"
          ? theme
          : DEFAULT_APP_PREFERENCES.theme,
    };
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

export function saveAppPreferences(
  preferences: AppPreferences,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function resolveTheme(
  theme: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}

export function nextThemeMode(theme: ThemeMode): ThemeMode {
  if (theme === "light") return "dark";
  if (theme === "dark") return "system";
  return "light";
}
