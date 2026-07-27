import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_PREFERENCES,
  createSessionProfileWithPreferences,
  loadAppPreferences,
  nextThemeMode,
  resolveTheme,
  saveAppPreferences,
  type AppPreferences,
} from "./preferences";

describe("application preferences", () => {
  it("round-trips a valid theme preference", () => {
    let stored = "";
    const preferences: AppPreferences = {
      ...DEFAULT_APP_PREFERENCES,
      theme: "dark",
    };
    saveAppPreferences(preferences, {
      setItem: (_key, value) => {
        stored = value;
      },
    });

    expect(loadAppPreferences({ getItem: () => stored })).toEqual(preferences);
  });

  it("falls back safely for corrupt or unsupported values", () => {
    expect(
      loadAppPreferences({ getItem: () => '{"theme":"neon"}' }),
    ).toEqual(DEFAULT_APP_PREFERENCES);
    expect(loadAppPreferences({ getItem: () => "{broken" })).toEqual(
      DEFAULT_APP_PREFERENCES,
    );
  });

  it("resolves system theme and cycles every mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
    expect(nextThemeMode("system")).toBe("light");
  });

  it("applies application defaults only when creating a new session", () => {
    const preferences: AppPreferences = {
      ...DEFAULT_APP_PREFERENCES,
      defaultProtocol: "ssh",
      sessionDefaults: {
        terminal: {
          ...DEFAULT_APP_PREFERENCES.sessionDefaults.terminal,
          fontSize: 17,
        },
        logging: {
          ...DEFAULT_APP_PREFERENCES.sessionDefaults.logging,
          autoStart: true,
        },
      },
    };

    const profile = createSessionProfileWithPreferences(preferences);
    expect(profile.protocol).toBe("ssh");
    expect(profile.terminal.fontSize).toBe(17);
    expect(profile.logging.autoStart).toBe(true);
  });
});
