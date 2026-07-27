import { setPersistentItem } from "./persistence";
import type { LineEnding, SenderPreset } from "./types";

const COMMAND_HISTORY_STORAGE_KEY = "iterm.command-history.v1";
const MAX_COMMANDS_PER_PROFILE = 1_000;
const MAX_COMMAND_LENGTH = 4_096;

export interface CommandHistoryEntry {
  command: string;
  lastUsedAt: string;
  useCount: number;
}

export interface CommandSuggestion {
  id: string;
  command: string;
  label: string;
  source: "history" | "quick";
  lineEnding?: LineEnding;
  useCount: number;
}

type CommandHistoryStore = Record<string, CommandHistoryEntry[]>;
type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

function readStore(storage: ReadStorage): CommandHistoryStore {
  try {
    const value = JSON.parse(
      storage.getItem(COMMAND_HISTORY_STORAGE_KEY) ?? "{}",
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([profileId, entries]) => {
        if (!Array.isArray(entries)) return [];
        const valid = entries.flatMap((entry): CommandHistoryEntry[] => {
          if (
            !entry ||
            typeof entry !== "object" ||
            typeof entry.command !== "string" ||
            !entry.command.trim()
          ) {
            return [];
          }
          return [{
            command: entry.command.slice(0, MAX_COMMAND_LENGTH),
            lastUsedAt:
              typeof entry.lastUsedAt === "string"
                ? entry.lastUsedAt
                : new Date(0).toISOString(),
            useCount:
              typeof entry.useCount === "number" &&
              Number.isSafeInteger(entry.useCount) &&
              entry.useCount > 0
                ? entry.useCount
                : 1,
          }];
        });
        return [[profileId, valid.slice(0, MAX_COMMANDS_PER_PROFILE)]];
      }),
    );
  } catch {
    return {};
  }
}

export function loadCommandHistory(
  profileId: string,
  storage: ReadStorage = localStorage,
): CommandHistoryEntry[] {
  return readStore(storage)[profileId] ?? [];
}

export function recordCommand(
  profileId: string,
  value: string,
  storage: WriteStorage = localStorage,
  now = new Date(),
): CommandHistoryEntry[] {
  const command = value.trim().slice(0, MAX_COMMAND_LENGTH);
  if (!command) return loadCommandHistory(profileId, storage);

  const store = readStore(storage);
  const previous = store[profileId] ?? [];
  const existing = previous.find((entry) => entry.command === command);
  const next: CommandHistoryEntry[] = [
    {
      command,
      lastUsedAt: now.toISOString(),
      useCount: (existing?.useCount ?? 0) + 1,
    },
    ...previous.filter((entry) => entry.command !== command),
  ].slice(0, MAX_COMMANDS_PER_PROFILE);
  store[profileId] = next;
  setPersistentItem(
    COMMAND_HISTORY_STORAGE_KEY,
    JSON.stringify(store),
    storage,
  );
  return next;
}

export function buildCommandSuggestions(
  query: string,
  history: CommandHistoryEntry[],
  quickCommands: SenderPreset[],
  limit = 8,
): CommandSuggestion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (command: string, label = "") => {
    if (!normalizedQuery) return true;
    const normalizedCommand = command.toLocaleLowerCase();
    const normalizedLabel = label.toLocaleLowerCase();
    return (
      normalizedCommand.startsWith(normalizedQuery) ||
      normalizedCommand.includes(normalizedQuery) ||
      normalizedLabel.includes(normalizedQuery)
    );
  };
  const score = (command: string, source: "history" | "quick") => {
    if (!normalizedQuery) return source === "quick" ? 1 : 2;
    const normalizedCommand = command.toLocaleLowerCase();
    if (normalizedCommand === normalizedQuery) return 0;
    if (normalizedCommand.startsWith(normalizedQuery)) return 1;
    return 2;
  };

  const suggestions: CommandSuggestion[] = [
    ...quickCommands.flatMap((preset) => {
      if (preset.mode !== "text" || !preset.payload.trim()) return [];
      return [{
        id: `quick:${preset.id}`,
        command: preset.payload,
        label: preset.name,
        source: "quick" as const,
        lineEnding: preset.lineEnding,
        useCount: 0,
      }];
    }),
    ...history.map((entry) => ({
      id: `history:${entry.command}`,
      command: entry.command,
      label: entry.command,
      source: "history" as const,
      useCount: entry.useCount,
    })),
  ]
    .filter((suggestion) => matches(suggestion.command, suggestion.label))
    .sort((left, right) => {
      const scoreDelta =
        score(left.command, left.source) - score(right.command, right.source);
      if (scoreDelta !== 0) return scoreDelta;
      if (left.source !== right.source) return left.source === "quick" ? -1 : 1;
      return right.useCount - left.useCount;
    });

  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    if (seen.has(suggestion.command)) return false;
    seen.add(suggestion.command);
    return true;
  }).slice(0, limit);
}

export function consumeTerminalInput(
  current: string,
  input: string,
): { buffer: string; completed: string[] } {
  if (input.startsWith("\u001b")) return { buffer: current, completed: [] };
  let buffer = current;
  const completed: string[] = [];
  for (const character of input) {
    if (character === "\r" || character === "\n") {
      if (buffer.trim()) completed.push(buffer);
      buffer = "";
      continue;
    }
    if (character === "\u007f" || character === "\b") {
      buffer = buffer.slice(0, -1);
      continue;
    }
    if (character === "\u0015" || character === "\u0003") {
      buffer = "";
      continue;
    }
    if (character >= " " && character !== "\u007f") {
      buffer = `${buffer}${character}`.slice(-MAX_COMMAND_LENGTH);
    }
  }
  return { buffer, completed };
}

export function commandLineEnding(
  lineEnding: LineEnding | "terminal",
  terminalEnter: "cr" | "lf" | "crlf",
): string {
  const resolved = lineEnding === "terminal" ? terminalEnter : lineEnding;
  if (resolved === "cr") return "\r";
  if (resolved === "lf") return "\n";
  if (resolved === "crlf") return "\r\n";
  return "";
}
