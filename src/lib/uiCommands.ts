export const TERMINAL_SEARCH_EVENT = "iterm:terminal-search";
export const TERMINAL_COMMAND_EVENT = "iterm:terminal-command";

export type TerminalUiCommand = "copy" | "paste" | "selectAll";

export interface TerminalCommandTarget {
  getSelection(): string;
  selectAll(): void;
}

export interface ClipboardAccess {
  readText(): Promise<string>;
  writeText(value: string): Promise<void>;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export function clampContextMenuPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  menuWidth = 190,
  menuHeight = 224,
): ContextMenuPosition {
  const inset = 8;
  return {
    x: Math.max(inset, Math.min(x, viewportWidth - menuWidth - inset)),
    y: Math.max(inset, Math.min(y, viewportHeight - menuHeight - inset)),
  };
}

export function requestTerminalSearch(
  target: Pick<Window, "dispatchEvent"> = window,
): void {
  target.dispatchEvent(new Event(TERMINAL_SEARCH_EVENT));
}

export function requestTerminalCommand(
  command: TerminalUiCommand,
  target: Pick<Window, "dispatchEvent"> = window,
): void {
  target.dispatchEvent(
    new CustomEvent<TerminalUiCommand>(TERMINAL_COMMAND_EVENT, {
      detail: command,
    }),
  );
}

export async function executeTerminalCommand(
  command: TerminalUiCommand,
  terminal: TerminalCommandTarget,
  send: (value: string) => void,
  clipboard: ClipboardAccess | undefined = navigator.clipboard,
): Promise<boolean> {
  if (command === "selectAll") {
    terminal.selectAll();
    return true;
  }
  if (!clipboard) return false;
  if (command === "copy") {
    const selection = terminal.getSelection();
    if (!selection) return false;
    await clipboard.writeText(selection);
    return true;
  }
  const value = await clipboard.readText();
  if (!value) return false;
  send(value);
  return true;
}
