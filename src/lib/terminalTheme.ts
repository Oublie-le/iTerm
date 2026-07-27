import type {
  ResolvedTheme,
} from "./preferences";
import type {
  TerminalPalette,
  TerminalPaletteColor,
} from "./types";

export const TERMINAL_PALETTE_COLORS: TerminalPaletteColor[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

export const APPLE_DARK_TERMINAL_PALETTE: TerminalPalette = {
  background: "#0b1220",
  foreground: "#e5e7eb",
  cursor: "#60a5fa",
  black: "#111827",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d1d5db",
  brightBlack: "#6b7280",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

export const APPLE_LIGHT_TERMINAL_PALETTE: TerminalPalette = {
  background: "#ffffff",
  foreground: "#111827",
  cursor: "#2563eb",
  black: "#111827",
  red: "#dc2626",
  green: "#15803d",
  yellow: "#a16207",
  blue: "#1d4ed8",
  magenta: "#7e22ce",
  cyan: "#0e7490",
  white: "#e5e7eb",
  brightBlack: "#6b7280",
  brightRed: "#ef4444",
  brightGreen: "#16a34a",
  brightYellow: "#ca8a04",
  brightBlue: "#2563eb",
  brightMagenta: "#9333ea",
  brightCyan: "#0891b2",
  brightWhite: "#ffffff",
};

const HEX_COLOR = /^#[\da-f]{6}$/i;

export function normalizeTerminalPalette(
  palette: Partial<TerminalPalette> | null | undefined,
  fallback: TerminalPalette = APPLE_DARK_TERMINAL_PALETTE,
): TerminalPalette {
  const result = { ...fallback };
  for (const key of [
    "background",
    "foreground",
    "cursor",
    ...TERMINAL_PALETTE_COLORS,
  ] as const) {
    const value = palette?.[key];
    if (typeof value === "string" && HEX_COLOR.test(value)) {
      result[key] = value.toLowerCase();
    }
  }
  return result;
}

function contrastColor(background: string): string {
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  return red * 299 + green * 587 + blue * 114 > 150_000
    ? "#000000"
    : "#ffffff";
}

export function resolveTerminalTheme(
  theme: ResolvedTheme,
  paletteMode: "theme" | "custom",
  customPalette: Partial<TerminalPalette> | null | undefined,
) {
  const palette =
    paletteMode === "custom"
      ? normalizeTerminalPalette(customPalette)
      : theme === "dark"
        ? APPLE_DARK_TERMINAL_PALETTE
        : APPLE_LIGHT_TERMINAL_PALETTE;
  return {
    ...palette,
    cursorAccent: contrastColor(palette.cursor),
    selectionBackground: `${palette.cursor}66`,
  };
}
