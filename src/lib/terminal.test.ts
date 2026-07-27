import { describe, expect, it, vi } from "vitest";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import {
  DEC_SOFT_RESET_SEQUENCE,
  clampTerminalFontSize,
  classifyTerminalCompletionResponse,
  installUnicode11,
  isTerminalCompletionTab,
  mapTerminalSpecialKey,
  resetTerminal,
  TERMINAL_CONVERT_EOL,
} from "./terminal";

describe("terminal font size", () => {
  it("rounds and clamps interactive zoom values", () => {
    expect(clampTerminalFontSize(7)).toBe(8);
    expect(clampTerminalFontSize(14.4)).toBe(14);
    expect(clampTerminalFontSize(99)).toBe(40);
  });
});

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

  it("recognizes only an unmodified Tab keydown as shell completion", () => {
    expect(isTerminalCompletionTab(keyEvent("Tab"))).toBe(true);
    expect(
      isTerminalCompletionTab({ ...keyEvent("Tab"), type: "keyup" }),
    ).toBe(false);
    expect(
      isTerminalCompletionTab({ ...keyEvent("Tab"), ctrlKey: true }),
    ).toBe(false);
    expect(
      isTerminalCompletionTab({ ...keyEvent("Tab"), isComposing: true }),
    ).toBe(false);
    expect(isTerminalCompletionTab(keyEvent("Enter"))).toBe(false);
  });

  it("moves valid completion text to a new line", () => {
    expect(classifyTerminalCompletionResponse("onsole")).toBe("newline");
    expect(
      classifyTerminalCompletionResponse("\u001b[36monsole\u001b[0m"),
    ).toBe("newline");
  });

  it("does not move rejected or already multiline completions", () => {
    expect(classifyTerminalCompletionResponse("\u0007")).toBe("none");
    expect(classifyTerminalCompletionResponse("\r\ncommand")).toBe("none");
    expect(classifyTerminalCompletionResponse("\u001b[31m")).toBe("wait");
    expect(classifyTerminalCompletionResponse("")).toBe("wait");
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

describe("terminal line endings", () => {
  it("starts bare-LF output at column one", async () => {
    const terminal = new Terminal({
      cols: 40,
      rows: 10,
      convertEol: TERMINAL_CONVERT_EOL,
    });

    await new Promise<void>((resolve) => {
      terminal.write("first\nsecond\nthird", resolve);
    });

    expect(
      [0, 1, 2].map((row) =>
        terminal.buffer.active.getLine(row)?.translateToString(true),
      ),
    ).toEqual(["first", "second", "third"]);
    expect(terminal.buffer.active.cursorX).toBe(5);
    terminal.dispose();
  });
});
