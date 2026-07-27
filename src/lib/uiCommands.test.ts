import { describe, expect, it, vi } from "vitest";
import {
  requestTerminalSearch,
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
});
