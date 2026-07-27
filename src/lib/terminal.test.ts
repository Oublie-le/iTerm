import { describe, expect, it, vi } from "vitest";
import {
  DEC_SOFT_RESET_SEQUENCE,
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
