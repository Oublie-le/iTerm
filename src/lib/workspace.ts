import type { SplitMode } from "./layout";
import { setPersistentItem } from "./persistence";

export interface WorkspaceSnapshot {
  sidebarOpen: boolean;
  senderOpen: boolean;
  openProfileIds: string[];
  activeProfileId: string | null;
  splitMode: SplitMode;
  splitProfileIds: [string, string] | null;
}

const WORKSPACE_STORAGE_KEY = "iterm.workspace.v1";

export const DEFAULT_WORKSPACE_SNAPSHOT: WorkspaceSnapshot = {
  sidebarOpen: true,
  senderOpen: true,
  openProfileIds: [],
  activeProfileId: null,
  splitMode: "single",
  splitProfileIds: null,
};

export function loadWorkspaceSnapshot(
  storage: Pick<Storage, "getItem"> = localStorage,
): WorkspaceSnapshot {
  try {
    const parsed = JSON.parse(
      storage.getItem(WORKSPACE_STORAGE_KEY) ?? "null",
    ) as Partial<WorkspaceSnapshot> | null;
    if (!parsed) return { ...DEFAULT_WORKSPACE_SNAPSHOT };
    const splitProfileIds =
      Array.isArray(parsed.splitProfileIds) &&
      parsed.splitProfileIds.length === 2 &&
      parsed.splitProfileIds.every((profileId) => typeof profileId === "string") &&
      parsed.splitProfileIds[0] !== parsed.splitProfileIds[1]
        ? ([parsed.splitProfileIds[0], parsed.splitProfileIds[1]] as [
            string,
            string,
          ])
        : null;
    const requestedSplitMode = parsed.splitMode;
    return {
      sidebarOpen:
        typeof parsed.sidebarOpen === "boolean"
          ? parsed.sidebarOpen
          : DEFAULT_WORKSPACE_SNAPSHOT.sidebarOpen,
      senderOpen:
        typeof parsed.senderOpen === "boolean"
          ? parsed.senderOpen
          : DEFAULT_WORKSPACE_SNAPSHOT.senderOpen,
      openProfileIds: Array.isArray(parsed.openProfileIds)
        ? parsed.openProfileIds.filter(
            (profileId): profileId is string => typeof profileId === "string",
          )
        : [],
      activeProfileId:
        typeof parsed.activeProfileId === "string"
          ? parsed.activeProfileId
          : null,
      splitMode:
        splitProfileIds &&
        (requestedSplitMode === "horizontal" ||
          requestedSplitMode === "vertical")
          ? requestedSplitMode
          : "single",
      splitProfileIds,
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_SNAPSHOT };
  }
}

export function saveWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  setPersistentItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot), storage);
}
