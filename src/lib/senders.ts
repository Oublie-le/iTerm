import { createSenderPreset, type SenderPreset } from "./types";
import { setPersistentItem } from "./persistence";

const SENDERS_STORAGE_KEY = "iterm.senders.v1";

type SenderStore = Record<string, SenderPreset[]>;

function readStore(storage: Pick<Storage, "getItem">): SenderStore {
  try {
    const parsed = JSON.parse(
      storage.getItem(SENDERS_STORAGE_KEY) ?? "{}",
    ) as SenderStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadSenderPresets(
  profileId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
  defaultLabel = "发送",
): SenderPreset[] {
  const stored = readStore(storage)[profileId];
  if (!Array.isArray(stored) || stored.length === 0) {
    return [createSenderPreset(1, defaultLabel)];
  }
  return stored.map((preset, index) => ({
    ...createSenderPreset(index + 1, defaultLabel),
    ...preset,
    id: typeof preset.id === "string" ? preset.id : crypto.randomUUID(),
  }));
}

export function saveSenderPresets(
  profileId: string,
  presets: SenderPreset[],
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const store = readStore(storage);
  store[profileId] = presets;
  setPersistentItem(SENDERS_STORAGE_KEY, JSON.stringify(store), storage);
}
