export type TerminalResetMode = "soft" | "hard";

export const DEC_SOFT_RESET_SEQUENCE = "\u001b[!p";

export interface TerminalKeyMapping {
  enterKey: "cr" | "lf" | "crlf";
  backspaceKey: "del" | "bs";
}

interface TerminalKeyEvent {
  type: string;
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

interface ResettableTerminal {
  focus(): void;
  reset(): void;
  write(data: string): void;
}

export function mapTerminalSpecialKey(
  event: TerminalKeyEvent,
  mapping: TerminalKeyMapping,
): string | null {
  if (
    event.type !== "keydown" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing
  ) {
    return null;
  }
  if (event.key === "Backspace") {
    return mapping.backspaceKey === "bs" ? "\b" : "\u007f";
  }
  if (event.key === "Enter") {
    if (mapping.enterKey === "lf") return "\n";
    if (mapping.enterKey === "crlf") return "\r\n";
    return "\r";
  }
  return null;
}

export function resetTerminal(
  terminal: ResettableTerminal,
  mode: TerminalResetMode,
): void {
  if (mode === "soft") {
    terminal.write(DEC_SOFT_RESET_SEQUENCE);
  } else {
    terminal.reset();
  }
  terminal.focus();
}
