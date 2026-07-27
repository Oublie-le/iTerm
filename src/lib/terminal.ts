export type TerminalResetMode = "soft" | "hard";

export const DEC_SOFT_RESET_SEQUENCE = "\u001b[!p";
export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 40;

export function clampTerminalFontSize(fontSize: number): number {
  return Math.min(
    MAX_TERMINAL_FONT_SIZE,
    Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(fontSize)),
  );
}

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

interface UnicodeTerminal {
  loadAddon(addon: ITerminalAddon): void;
  unicode: {
    activeVersion: string;
  };
}

export function installUnicode11(terminal: UnicodeTerminal): Unicode11Addon {
  const addon = new Unicode11Addon();
  terminal.loadAddon(addon);
  terminal.unicode.activeVersion = "11";
  return addon;
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
import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { ITerminalAddon } from "@xterm/xterm";
