export interface WorkspaceSnapshot {
  sidebarOpen: boolean;
  senderOpen: boolean;
  openProfileIds: string[];
  activeProfileId: string | null;
}

const WORKSPACE_STORAGE_KEY = "iterm.workspace.v1";

export const DEFAULT_WORKSPACE_SNAPSHOT: WorkspaceSnapshot = {
  sidebarOpen: true,
  senderOpen: true,
  openProfileIds: [],
  activeProfileId: null,
};

export function loadWorkspaceSnapshot(
  storage: Pick<Storage, "getItem"> = localStorage,
): WorkspaceSnapshot {
  try {
    const parsed = JSON.parse(
      storage.getItem(WORKSPACE_STORAGE_KEY) ?? "null",
    ) as Partial<WorkspaceSnapshot> | null;
    if (!parsed) return { ...DEFAULT_WORKSPACE_SNAPSHOT };
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
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_SNAPSHOT };
  }
}

export function saveWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
}
