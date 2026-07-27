import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./serial";

export const PERSISTENT_STORAGE_KEYS = [
  "iterm.profiles.v1",
  "serialterm.profiles.v1",
  "iterm.preferences.v1",
  "iterm.workspace.v1",
  "iterm.senders.v1",
] as const;
export const PERSISTENCE_ERROR_EVENT = "iterm:persistence-error";

type PersistentStorageKey = (typeof PERSISTENT_STORAGE_KEYS)[number];
type HydrationStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem"
>;

export interface PersistentStorageDriver {
  loadItems(): Promise<Record<string, string>>;
  saveItems(items: Record<string, string>): Promise<void>;
  removeItem(key: string): Promise<void>;
  clearItems(): Promise<void>;
}

export interface PersistenceHydrationResult {
  backend: "sqlite" | "browser";
  restoredItems: number;
  migratedItems: number;
  error?: string;
}

const STORAGE_KEY_SET = new Set<string>(PERSISTENT_STORAGE_KEYS);
let operationQueue: Promise<void> = Promise.resolve();
let latestPersistenceError = "";

const tauriDriver: PersistentStorageDriver = {
  loadItems: () => invoke("load_persistent_items"),
  saveItems: (items) => invoke("save_persistent_items", { items }),
  removeItem: (key) => invoke("remove_persistent_item", { key }),
  clearItems: () => invoke("clear_persistent_items"),
};

export async function hydratePersistentStorage(
  storage: HydrationStorage = localStorage,
  driver: PersistentStorageDriver | null = runtimeDriver(),
): Promise<PersistenceHydrationResult> {
  if (!driver) {
    return { backend: "browser", restoredItems: 0, migratedItems: 0 };
  }

  const localItems = readKnownItems(storage);
  try {
    const databaseItems = filterKnownItems(await driver.loadItems());
    const itemsToMigrate = Object.fromEntries(
      Object.entries(localItems).filter(([key]) => !(key in databaseItems)),
    );
    if (Object.keys(itemsToMigrate).length > 0) {
      await driver.saveItems(itemsToMigrate);
    }
    for (const [key, value] of Object.entries(databaseItems)) {
      storage.setItem(key, value);
    }
    return {
      backend: "sqlite",
      restoredItems: Object.keys(databaseItems).length,
      migratedItems: Object.keys(itemsToMigrate).length,
    };
  } catch (error) {
    const message = errorMessage(error, "SQLite 配置存储初始化失败。");
    reportPersistenceError(message);
    return {
      backend: "browser",
      restoredItems: 0,
      migratedItems: 0,
      error: message,
    };
  }
}

export function setPersistentItem(
  key: PersistentStorageKey,
  value: string,
  storage: Pick<Storage, "setItem"> = localStorage,
  driver: PersistentStorageDriver | null = driverForStorage(storage),
): void {
  storage.setItem(key, value);
  if (!driver) return;
  enqueueOperation(() => driver.saveItems({ [key]: value }));
}

export function removePersistentItem(
  key: PersistentStorageKey,
  storage: Pick<Storage, "removeItem"> = localStorage,
  driver: PersistentStorageDriver | null = driverForStorage(storage),
): void {
  storage.removeItem(key);
  if (!driver) return;
  enqueueOperation(() => driver.removeItem(key));
}

export async function clearPersistentStorage(
  storage: Pick<Storage, "removeItem"> = localStorage,
  driver: PersistentStorageDriver | null = driverForStorage(storage),
): Promise<void> {
  if (driver) {
    await operationQueue;
    try {
      await driver.clearItems();
    } catch (error) {
      const message = errorMessage(error, "无法清空 SQLite 配置存储。");
      reportPersistenceError(message);
      throw new Error(message);
    }
  }
  for (const key of PERSISTENT_STORAGE_KEYS) {
    storage.removeItem(key);
  }
}

export function flushPersistentOperations(): Promise<void> {
  return operationQueue;
}

export function getLatestPersistenceError(): string {
  return latestPersistenceError;
}

function enqueueOperation(operation: () => Promise<void>): void {
  operationQueue = operationQueue.then(operation).catch((error) => {
    reportPersistenceError(
      errorMessage(error, "无法将配置同步到 SQLite 数据库。"),
    );
  });
}

function runtimeDriver(): PersistentStorageDriver | null {
  return isTauriRuntime() ? tauriDriver : null;
}

function driverForStorage(
  storage: Pick<Storage, "setItem"> | Pick<Storage, "removeItem">,
): PersistentStorageDriver | null {
  return typeof localStorage !== "undefined" &&
    storage === localStorage &&
    isTauriRuntime()
    ? tauriDriver
    : null;
}

function readKnownItems(storage: HydrationStorage): Record<string, string> {
  const items: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !STORAGE_KEY_SET.has(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) items[key] = value;
  }
  return items;
}

function filterKnownItems(items: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(items).filter(
      ([key, value]) =>
        STORAGE_KEY_SET.has(key) && typeof value === "string",
    ),
  );
}

function reportPersistenceError(message: string): void {
  latestPersistenceError = message;
  console.warn(`[iTerm persistence] ${message}`);
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PERSISTENCE_ERROR_EVENT, { detail: message }),
    );
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}
