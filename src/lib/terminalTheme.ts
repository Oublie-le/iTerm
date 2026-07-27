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
  background: "#0d0f12",
  foreground: "#f5f5f7",
  cursor: "#0a84ff",
  black: "#1c1c1e",
  red: "#ff453a",
  green: "#32d74b",
  yellow: "#ffd60a",
  blue: "#0a84ff",
  magenta: "#bf5af2",
  cyan: "#64d2ff",
  white: "#f2f2f7",
  brightBlack: "#8e8e93",
  brightRed: "#ff6961",
  brightGreen: "#4cdb68",
  brightYellow: "#ffdf3f",
  brightBlue: "#409cff",
  brightMagenta: "#da8fff",
  brightCyan: "#70d7ff",
  brightWhite: "#ffffff",
};

export const APPLE_LIGHT_TERMINAL_PALETTE: TerminalPalette = {
  background: "#fbfbfd",
  foreground: "#1d1d1f",
  cursor: "#007aff",
  black: "#1d1d1f",
  red: "#d70015",
  green: "#248a3d",
  yellow: "#a05a00",
  blue: "#0066cc",
  magenta: "#8944ab",
  cyan: "#0071a4",
  white: "#e5e5ea",
  brightBlack: "#6e6e73",
  brightRed: "#ff3b30",
  brightGreen: "#34c759",
  brightYellow: "#ff9f0a",
  brightBlue: "#007aff",
  brightMagenta: "#af52de",
  brightCyan: "#32ade6",
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
