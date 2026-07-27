import {
  createSessionProfile,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_TERMINAL_CONFIG,
  type LoggingConfig,
  type SerialPortDescriptor,
  type SessionProfile,
  type SessionProtocol,
  type TerminalConfig,
} from "./types";
import { setPersistentItem } from "./persistence";
import { createTranslator, type AppLocale } from "./i18n";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface AppPreferences {
  locale: AppLocale;
  theme: ThemeMode;
  confirmActiveSessionClose: boolean;
  defaultProtocol: SessionProtocol;
  sessionDefaults: {
    terminal: TerminalConfig;
    logging: LoggingConfig;
  };
}

const PREFERENCES_STORAGE_KEY = "iterm.preferences.v1";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  locale: "zh-CN",
  theme: "light",
  confirmActiveSessionClose: true,
  defaultProtocol: "serial",
  sessionDefaults: {
    terminal: {
      ...DEFAULT_TERMINAL_CONFIG,
      customPalette: { ...DEFAULT_TERMINAL_CONFIG.customPalette },
    },
    logging: { ...DEFAULT_LOGGING_CONFIG },
  },
};

export function loadAppPreferences(
  storage: Pick<Storage, "getItem"> = localStorage,
): AppPreferences {
  try {
    const parsed = JSON.parse(
      storage.getItem(PREFERENCES_STORAGE_KEY) ?? "null",
    ) as Partial<AppPreferences> | null;
    const theme = parsed?.theme;
    const locale = parsed?.locale;
    const defaultProtocol = parsed?.defaultProtocol;
    const enterKey = parsed?.sessionDefaults?.terminal?.enterKey;
    const backspaceKey = parsed?.sessionDefaults?.terminal?.backspaceKey;
    return {
      locale:
        locale === "zh-CN" || locale === "en-US"
          ? locale
          : DEFAULT_APP_PREFERENCES.locale,
      theme:
        theme === "light" || theme === "dark" || theme === "system"
          ? theme
          : DEFAULT_APP_PREFERENCES.theme,
      confirmActiveSessionClose:
        typeof parsed?.confirmActiveSessionClose === "boolean"
          ? parsed.confirmActiveSessionClose
          : DEFAULT_APP_PREFERENCES.confirmActiveSessionClose,
      defaultProtocol:
        defaultProtocol === "serial" ||
        defaultProtocol === "ssh" ||
        defaultProtocol === "adb"
          ? defaultProtocol
          : DEFAULT_APP_PREFERENCES.defaultProtocol,
      sessionDefaults: {
        terminal: {
          ...DEFAULT_TERMINAL_CONFIG,
          ...parsed?.sessionDefaults?.terminal,
          paletteMode:
            parsed?.sessionDefaults?.terminal?.paletteMode === "custom"
              ? "custom"
              : "theme",
          customPalette: {
            ...DEFAULT_TERMINAL_CONFIG.customPalette,
            ...parsed?.sessionDefaults?.terminal?.customPalette,
          },
          enterKey:
            enterKey === "cr" || enterKey === "lf" || enterKey === "crlf"
              ? enterKey
              : DEFAULT_TERMINAL_CONFIG.enterKey,
          backspaceKey:
            backspaceKey === "del" || backspaceKey === "bs"
              ? backspaceKey
              : DEFAULT_TERMINAL_CONFIG.backspaceKey,
        },
        logging: {
          ...DEFAULT_LOGGING_CONFIG,
          ...parsed?.sessionDefaults?.logging,
        },
      },
    };
  } catch {
    return {
      ...DEFAULT_APP_PREFERENCES,
      sessionDefaults: {
        terminal: {
          ...DEFAULT_TERMINAL_CONFIG,
          customPalette: { ...DEFAULT_TERMINAL_CONFIG.customPalette },
        },
        logging: { ...DEFAULT_LOGGING_CONFIG },
      },
    };
  }
}

export function saveAppPreferences(
  preferences: AppPreferences,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  setPersistentItem(
    PREFERENCES_STORAGE_KEY,
    JSON.stringify(preferences),
    storage,
  );
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

export function createSessionProfileWithPreferences(
  preferences: AppPreferences,
  port?: SerialPortDescriptor,
): SessionProfile {
  const t = createTranslator(preferences.locale);
  const profile = createSessionProfile(port, preferences.defaultProtocol, {
    serialName: t("dialog.defaultName.serial"),
    serialGroup: t("dialog.defaultGroup.serial"),
    sshName: t("dialog.defaultName.ssh"),
    sshGroup: t("dialog.defaultGroup.ssh"),
    adbName: t("dialog.defaultName.adb"),
    adbGroup: t("dialog.defaultGroup.adb"),
  });
  return {
    ...profile,
    terminal: {
      ...preferences.sessionDefaults.terminal,
      customPalette: {
        ...preferences.sessionDefaults.terminal.customPalette,
      },
    },
    logging: { ...preferences.sessionDefaults.logging },
  };
}
