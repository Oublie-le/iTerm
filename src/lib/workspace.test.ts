import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_SNAPSHOT,
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./workspace";

describe("workspace persistence", () => {
  it("round-trips a valid snapshot", () => {
    let stored = "";
    const snapshot: WorkspaceSnapshot = {
      sidebarOpen: false,
      senderOpen: true,
      openProfileIds: ["one", "two"],
      activeProfileId: "two",
    };
    saveWorkspaceSnapshot(snapshot, {
      setItem: (_key, value) => {
        stored = value;
      },
    });

    expect(
      loadWorkspaceSnapshot({
        getItem: () => stored,
      }),
    ).toEqual(snapshot);
  });

  it("falls back safely for corrupt data", () => {
    expect(
      loadWorkspaceSnapshot({
        getItem: () => "{broken",
      }),
    ).toEqual(DEFAULT_WORKSPACE_SNAPSHOT);
  });
});
