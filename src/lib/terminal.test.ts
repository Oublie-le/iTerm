import { describe, expect, it, vi } from "vitest";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import {
  DEC_SOFT_RESET_SEQUENCE,
  installUnicode11,
  mapTerminalSpecialKey,
  resetTerminal,
} from "./terminal";

function createTerminalDouble() {
  return {
    focus: vi.fn(),
    reset: vi.fn(),
    write: vi.fn(),
  };
}

describe("terminal reset", () => {
  it("uses DECSTR for a soft reset and keeps the terminal buffer", () => {
    const terminal = createTerminalDouble();

    resetTerminal(terminal, "soft");

    expect(terminal.write).toHaveBeenCalledWith(DEC_SOFT_RESET_SEQUENCE);
    expect(terminal.reset).not.toHaveBeenCalled();
    expect(terminal.focus).toHaveBeenCalledOnce();
  });

  it("uses the xterm hard reset without injecting remote input", () => {
    const terminal = createTerminalDouble();

    resetTerminal(terminal, "hard");

    expect(terminal.reset).toHaveBeenCalledOnce();
    expect(terminal.write).not.toHaveBeenCalled();
    expect(terminal.focus).toHaveBeenCalledOnce();
  });
});

describe("terminal special key mapping", () => {
  const keyEvent = (key: string) => ({
    type: "keydown",
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
  });

  it("maps Enter to CR, LF, or CRLF", () => {
    expect(
      mapTerminalSpecialKey(keyEvent("Enter"), {
        enterKey: "cr",
        backspaceKey: "del",
      }),
    ).toBe("\r");
    expect(
      mapTerminalSpecialKey(keyEvent("Enter"), {
        enterKey: "lf",
        backspaceKey: "del",
      }),
    ).toBe("\n");
    expect(
      mapTerminalSpecialKey(keyEvent("Enter"), {
        enterKey: "crlf",
        backspaceKey: "del",
      }),
    ).toBe("\r\n");
  });

  it("maps Backspace to DEL or BS", () => {
    expect(
      mapTerminalSpecialKey(keyEvent("Backspace"), {
        enterKey: "cr",
        backspaceKey: "del",
      }),
    ).toBe("\u007f");
    expect(
      mapTerminalSpecialKey(keyEvent("Backspace"), {
        enterKey: "cr",
        backspaceKey: "bs",
      }),
    ).toBe("\b");
  });

  it("leaves modified, composing, and unrelated keys to xterm", () => {
    expect(
      mapTerminalSpecialKey(
        { ...keyEvent("Enter"), ctrlKey: true },
        { enterKey: "lf", backspaceKey: "bs" },
      ),
    ).toBeNull();
    expect(
      mapTerminalSpecialKey(
        { ...keyEvent("Backspace"), isComposing: true },
        { enterKey: "lf", backspaceKey: "bs" },
      ),
    ).toBeNull();
    expect(
      mapTerminalSpecialKey(keyEvent("F5"), {
        enterKey: "lf",
        backspaceKey: "bs",
      }),
    ).toBeNull();
  });
});

describe("terminal Unicode width", () => {
  it("activates the Unicode 11 width provider", () => {
    const terminal = {
      loadAddon: vi.fn(),
      unicode: { activeVersion: "6" },
    };
    const addon = installUnicode11(terminal);

    expect(terminal.unicode.activeVersion).toBe("11");
    expect(addon).toBeInstanceOf(Unicode11Addon);
    expect(terminal.loadAddon).toHaveBeenCalledWith(addon);
  });
});
