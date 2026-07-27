import { describe, expect, it } from "vitest";
import {
  APPLE_DARK_TERMINAL_PALETTE,
  APPLE_LIGHT_TERMINAL_PALETTE,
  normalizeTerminalPalette,
  resolveTerminalTheme,
} from "./terminalTheme";

describe("terminal themes", () => {
  it("follows the resolved application appearance by default", () => {
    expect(resolveTerminalTheme("light", "theme", undefined)).toMatchObject({
      background: APPLE_LIGHT_TERMINAL_PALETTE.background,
      blue: APPLE_LIGHT_TERMINAL_PALETTE.blue,
    });
    expect(resolveTerminalTheme("dark", "theme", undefined)).toMatchObject({
      background: APPLE_DARK_TERMINAL_PALETTE.background,
      blue: APPLE_DARK_TERMINAL_PALETTE.blue,
    });
  });

  it("uses a complete custom ANSI palette and derives selection colors", () => {
    const palette = {
      ...APPLE_DARK_TERMINAL_PALETTE,
      background: "#123456",
      cursor: "#fedcba",
      brightGreen: "#abcdef",
    };

    expect(resolveTerminalTheme("light", "custom", palette)).toMatchObject({
      background: "#123456",
      cursor: "#fedcba",
      brightGreen: "#abcdef",
      selectionBackground: "#fedcba66",
      cursorAccent: "#000000",
    });
  });

  it("normalizes valid colors and replaces malformed imported values", () => {
    expect(
      normalizeTerminalPalette({
        ...APPLE_DARK_TERMINAL_PALETTE,
        red: "#ABCDEF",
        green: "not-a-color",
      }),
    ).toMatchObject({
      red: "#abcdef",
      green: APPLE_DARK_TERMINAL_PALETTE.green,
    });
  });
});
