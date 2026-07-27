import { describe, expect, it, vi } from "vitest";
import {
  clearPersistentStorage,
  flushPersistentOperations,
  hydratePersistentStorage,
  setPersistentItem,
  type PersistentStorageDriver,
} from "./persistence";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function createDriver(
  databaseItems: Record<string, string>,
): PersistentStorageDriver & {
  saveItems: ReturnType<typeof vi.fn>;
} {
  return {
    loadItems: vi.fn(async () => databaseItems),
    saveItems: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    clearItems: vi.fn(async () => undefined),
  };
}

describe("persistent storage hydration", () => {
  it("restores SQLite values and migrates local-only values", async () => {
    const storage = createStorage({
      "iterm.profiles.v1": "[local]",
      "iterm.workspace.v1": "{\"sidebarOpen\":true}",
      "unrelated.key": "keep",
    });
    const driver = createDriver({
      "iterm.profiles.v1": "[sqlite]",
      "iterm.preferences.v1": "{\"theme\":\"dark\"}",
      "unknown.key": "ignored",
    });

    const result = await hydratePersistentStorage(storage, driver);

    expect(result).toEqual({
      backend: "sqlite",
      restoredItems: 2,
      migratedItems: 1,
    });
    expect(storage.getItem("iterm.profiles.v1")).toBe("[sqlite]");
    expect(storage.getItem("iterm.preferences.v1")).toContain("dark");
    expect(storage.getItem("unrelated.key")).toBe("keep");
    expect(driver.saveItems).toHaveBeenCalledWith({
      "iterm.workspace.v1": "{\"sidebarOpen\":true}",
    });
  });

  it("keeps browser storage available when SQLite loading fails", async () => {
    const storage = createStorage({ "iterm.profiles.v1": "[local]" });
    const driver = createDriver({});
    driver.loadItems = vi.fn(async () => {
      throw new Error("database unavailable");
    });

    const result = await hydratePersistentStorage(storage, driver);

    expect(result.backend).toBe("browser");
    expect(result.error).toBe("database unavailable");
    expect(storage.getItem("iterm.profiles.v1")).toBe("[local]");
  });

  it("writes local storage synchronously and serializes SQLite updates", async () => {
    const storage = createStorage();
    const calls: string[] = [];
    const driver = createDriver({});
    driver.saveItems = vi.fn(async (items: Record<string, string>) => {
      await Promise.resolve();
      calls.push(Object.values(items)[0]);
    });

    setPersistentItem(
      "iterm.preferences.v1",
      "one",
      storage,
      driver,
    );
    setPersistentItem(
      "iterm.preferences.v1",
      "two",
      storage,
      driver,
    );

    expect(storage.getItem("iterm.preferences.v1")).toBe("two");
    await flushPersistentOperations();
    expect(calls).toEqual(["one", "two"]);
  });

  it("clears every known browser and SQLite item without touching unrelated data", async () => {
    const storage = createStorage({
      "iterm.profiles.v1": "[profile]",
      "serialterm.profiles.v1": "[legacy]",
      "iterm.preferences.v1": "{\"theme\":\"dark\"}",
      "iterm.workspace.v1": "{\"sidebarOpen\":false}",
      "iterm.senders.v1": "{\"profile\":[]}",
      "unrelated.key": "keep",
    });
    const driver = createDriver({});

    await clearPersistentStorage(storage, driver);

    expect(driver.clearItems).toHaveBeenCalledOnce();
    expect(storage.getItem("iterm.profiles.v1")).toBeNull();
    expect(storage.getItem("serialterm.profiles.v1")).toBeNull();
    expect(storage.getItem("iterm.preferences.v1")).toBeNull();
    expect(storage.getItem("iterm.workspace.v1")).toBeNull();
    expect(storage.getItem("iterm.senders.v1")).toBeNull();
    expect(storage.getItem("unrelated.key")).toBe("keep");
  });

  it("keeps browser data when clearing SQLite fails", async () => {
    const storage = createStorage({ "iterm.profiles.v1": "[profile]" });
    const driver = createDriver({});
    driver.clearItems = vi.fn(async () => {
      throw new Error("database is busy");
    });

    await expect(clearPersistentStorage(storage, driver)).rejects.toThrow(
      "database is busy",
    );
    expect(storage.getItem("iterm.profiles.v1")).toBe("[profile]");
  });
});
