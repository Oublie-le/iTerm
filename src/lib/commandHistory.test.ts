import { describe, expect, it } from "vitest";
import { createSenderPreset } from "./types";
import {
  buildCommandSuggestions,
  commandLineEnding,
  consumeTerminalInput,
  loadCommandHistory,
  recordCommand,
} from "./commandHistory";

function createStorage(initial = "{}") {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("command history", () => {
  it("persists, deduplicates, and ranks recent commands per profile", () => {
    const storage = createStorage();
    recordCommand("profile-a", "git status", storage, new Date("2026-01-01"));
    recordCommand("profile-a", "ls -la", storage, new Date("2026-01-02"));
    recordCommand("profile-a", "git status", storage, new Date("2026-01-03"));

    expect(loadCommandHistory("profile-a", storage)).toMatchObject([
      { command: "git status", useCount: 2 },
      { command: "ls -la", useCount: 1 },
    ]);
    expect(loadCommandHistory("profile-b", storage)).toEqual([]);
  });

  it("combines quick commands and history without duplicate payloads", () => {
    const quick = {
      ...createSenderPreset(),
      id: "status",
      name: "查看状态",
      payload: "git status",
      lineEnding: "cr" as const,
    };
    const suggestions = buildCommandSuggestions(
      "status",
      [
        {
          command: "git status",
          lastUsedAt: "2026-01-01T00:00:00.000Z",
          useCount: 4,
        },
      ],
      [quick],
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      source: "quick",
      command: "git status",
      lineEnding: "cr",
    });
  });

  it("captures basic terminal editing and complete commands", () => {
    expect(consumeTerminalInput("git statu", "s\u007f")).toEqual({
      buffer: "git statu",
      completed: [],
    });
    expect(consumeTerminalInput("git status", "\r")).toEqual({
      buffer: "",
      completed: ["git status"],
    });
    expect(consumeTerminalInput("unchanged", "\u001b[A")).toEqual({
      buffer: "unchanged",
      completed: [],
    });
  });

  it("maps quick-command and terminal line endings", () => {
    expect(commandLineEnding("terminal", "crlf")).toBe("\r\n");
    expect(commandLineEnding("none", "cr")).toBe("");
    expect(commandLineEnding("lf", "cr")).toBe("\n");
  });
});
