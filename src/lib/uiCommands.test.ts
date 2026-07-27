import { describe, expect, it, vi } from "vitest";
import {
  executeTerminalCommand,
  requestTerminalCommand,
  requestTerminalSearch,
  TERMINAL_COMMAND_EVENT,
  TERMINAL_SEARCH_EVENT,
} from "./uiCommands";

describe("UI commands", () => {
  it("dispatches the terminal search request", () => {
    const dispatchEvent = vi.fn((_event: Event) => true);
    const target = { dispatchEvent };

    requestTerminalSearch(target);

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0].type).toBe(TERMINAL_SEARCH_EVENT);
  });

  it("dispatches terminal edit commands", () => {
    const dispatchEvent = vi.fn((_event: Event) => true);

    requestTerminalCommand("paste", { dispatchEvent });

    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<string>;
    expect(event.type).toBe(TERMINAL_COMMAND_EVENT);
    expect(event.detail).toBe("paste");
  });

  it("copies selections, pastes text, and selects all", async () => {
    const terminal = {
      getSelection: vi.fn(() => "selected text"),
      selectAll: vi.fn(),
    };
    const send = vi.fn();
    const clipboard = {
      readText: vi.fn(async () => "pasted text"),
      writeText: vi.fn(async () => undefined),
    };

    await expect(
      executeTerminalCommand("copy", terminal, send, clipboard),
    ).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith("selected text");

    await expect(
      executeTerminalCommand("paste", terminal, send, clipboard),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith("pasted text");

    await expect(
      executeTerminalCommand("selectAll", terminal, send, clipboard),
    ).resolves.toBe(true);
    expect(terminal.selectAll).toHaveBeenCalledOnce();
  });

  it("does not consume copy without clipboard access", async () => {
    const terminal = {
      getSelection: () => "",
      selectAll: vi.fn(),
    };

    await expect(
      executeTerminalCommand("copy", terminal, vi.fn(), undefined),
    ).resolves.toBe(false);
  });
});
