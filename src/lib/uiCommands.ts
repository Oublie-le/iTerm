export const TERMINAL_SEARCH_EVENT = "iterm:terminal-search";

export function requestTerminalSearch(
  target: Pick<Window, "dispatchEvent"> = window,
): void {
  target.dispatchEvent(new Event(TERMINAL_SEARCH_EVENT));
}
