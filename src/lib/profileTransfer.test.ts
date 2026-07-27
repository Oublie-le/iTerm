import { describe, expect, it } from "vitest";
import { createSessionProfile } from "./types";
import {
  mergeImportedProfiles,
  parseSessionProfiles,
  serializeSessionProfiles,
} from "./profileTransfer";

describe("session profile transfer", () => {
  it("round-trips every protocol without credentials outside the profile", () => {
    const serial = createSessionProfile();
    serial.name = "开发板";
    const ssh = createSessionProfile(undefined, "ssh");
    ssh.ssh.host = "example.com";
    ssh.ssh.authMode = "password";
    const adb = createSessionProfile(undefined, "adb");
    adb.adb.deviceId = "emulator-5554";

    const parsed = parseSessionProfiles(
      serializeSessionProfiles(
        [serial, ssh, adb],
        "2026-07-27T00:00:00.000Z",
      ),
    );

    expect(parsed).toEqual([serial, ssh, adb]);
    expect(parsed[1].ssh).not.toHaveProperty("password");
  });

  it("rejects unrelated, invalid, and empty files", () => {
    expect(() => parseSessionProfiles("not json")).toThrow(
      "文件不是有效的 JSON",
    );
    expect(() =>
      parseSessionProfiles('{"schema":"another-app","profiles":[]}'),
    ).toThrow("会话配置格式无效");
    expect(() => serializeSessionProfiles([])).toThrow(
      "没有可导出的会话配置",
    );
  });

  it("preserves existing profiles and remaps conflicting identifiers", () => {
    const existing = createSessionProfile();
    const imported = {
      ...createSessionProfile(undefined, "ssh"),
      id: existing.id,
      name: "导入的 SSH",
    };
    const merged = mergeImportedProfiles(
      [existing],
      [imported],
      () => "new-profile-id",
    );

    expect(merged.importedCount).toBe(1);
    expect(merged.remappedCount).toBe(1);
    expect(merged.profiles).toHaveLength(2);
    expect(merged.profiles[0]).toBe(existing);
    expect(merged.profiles[1].id).toBe("new-profile-id");
  });
});
