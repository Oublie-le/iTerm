import { describe, expect, it } from "vitest";
import { createSenderPreset } from "./types";
import {
  mergeImportedSenderPresets,
  parseSenderPresets,
  serializeSenderPresets,
} from "./senderTransfer";

describe("sender preset transfer", () => {
  it("round-trips text and Hex command templates", () => {
    const text = {
      ...createSenderPreset(1),
      name: "查询状态",
      payload: "status",
      lineEnding: "crlf" as const,
    };
    const hex = {
      ...createSenderPreset(2),
      name: "握手帧",
      mode: "hex" as const,
      payload: "AA 55 01",
    };

    expect(
      parseSenderPresets(
        serializeSenderPresets([text, hex], "2026-07-27T00:00:00.000Z"),
      ),
    ).toEqual([text, hex]);
  });

  it("rejects unrelated, invalid, and empty command files", () => {
    expect(() => parseSenderPresets("broken")).toThrow(
      "文件不是有效的 JSON",
    );
    expect(() =>
      parseSenderPresets('{"schema":"another-app","presets":[]}'),
    ).toThrow("命令模板格式无效");
    expect(() => serializeSenderPresets([])).toThrow(
      "没有可导出的命令模板",
    );
  });

  it("appends imported commands and remaps conflicting identifiers", () => {
    const existing = createSenderPreset(1);
    const imported = {
      ...createSenderPreset(2),
      id: existing.id,
      name: "导入模板",
    };
    const merged = mergeImportedSenderPresets(
      [existing],
      [imported],
      () => "new-preset-id",
    );

    expect(merged.importedCount).toBe(1);
    expect(merged.remappedCount).toBe(1);
    expect(merged.firstImportedId).toBe("new-preset-id");
    expect(merged.presets.map((preset) => preset.id)).toEqual([
      existing.id,
      "new-preset-id",
    ]);
  });
});
