import { describe, expect, it } from "vitest";
import { loadSenderPresets, saveSenderPresets } from "./senders";
import { createSenderPreset } from "./types";

describe("sender preset persistence", () => {
  it("keeps presets isolated by session profile", () => {
    let stored = "{}";
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };
    const preset = {
      ...createSenderPreset(),
      name: "查询版本",
      payload: "version",
      lineEnding: "cr" as const,
    };

    saveSenderPresets("profile-a", [preset], storage);

    expect(loadSenderPresets("profile-a", storage)[0]).toMatchObject(preset);
    expect(loadSenderPresets("profile-b", storage)[0].payload).toBe("");
  });

  it("recovers from invalid storage", () => {
    const presets = loadSenderPresets("profile-a", {
      getItem: () => "{broken",
    });
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe("发送 1");
  });
});
