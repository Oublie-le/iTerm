import { describe, expect, it } from "vitest";
import {
  createSessionProfile,
  createRuntimeSession,
  duplicateSessionProfile,
  normalizeSessionProfile,
  reconnectDelayMs,
  requiresCloseConfirmation,
  sessionTargetLabel,
} from "./types";

describe("duplicateSessionProfile", () => {
  it("creates an independent profile with a new identity", () => {
    const source = createSessionProfile();
    source.name = "开发板";
    source.serial.baudRate = 115_200;

    const duplicate = duplicateSessionProfile(source);

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.name).toBe("开发板 副本");
    expect(duplicate.serial).not.toBe(source.serial);
    expect(duplicate.ssh).not.toBe(source.ssh);
    expect(duplicate.adb).not.toBe(source.adb);
    expect(duplicate.terminal).not.toBe(source.terminal);
    expect(duplicate.terminal.customPalette).not.toBe(
      source.terminal.customPalette,
    );
    expect(duplicate.serial.baudRate).toBe(115_200);
  });
});

describe("normalizeSessionProfile", () => {
  it("migrates profiles created before logging settings existed", () => {
    const source = createSessionProfile();
    const legacy = { ...source, logging: undefined } as unknown as typeof source;

    expect(normalizeSessionProfile(legacy).logging).toEqual({
      mode: "raw",
      append: false,
      autoStart: false,
      maxFileSizeMiB: 0,
      rotateCount: 3,
    });
  });

  it("migrates serial-only profiles to the multi-protocol schema", () => {
    const source = createSessionProfile();
    const legacy = {
      ...source,
      protocol: undefined,
      ssh: undefined,
      adb: undefined,
    } as unknown as typeof source;

    const migrated = normalizeSessionProfile(legacy);
    expect(migrated.protocol).toBe("serial");
    expect(migrated.ssh.port).toBe(22);
    expect(migrated.adb.deviceId).toBe("");
  });

  it("migrates profiles created before triggers existed", () => {
    const source = createSessionProfile();
    const legacy = { ...source, triggers: undefined } as unknown as typeof source;

    expect(normalizeSessionProfile(legacy).triggers).toEqual([]);
  });

  it("adds default Enter and Backspace mappings to legacy profiles", () => {
    const source = createSessionProfile();
    const legacy = {
      ...source,
      terminal: {
        ...source.terminal,
        enterKey: undefined,
        backspaceKey: undefined,
        paletteMode: undefined,
        customPalette: undefined,
        semanticColors: undefined,
      },
    } as unknown as typeof source;

    expect(normalizeSessionProfile(legacy).terminal).toMatchObject({
      enterKey: "cr",
      backspaceKey: "del",
      paletteMode: "theme",
      customPalette: expect.objectContaining({
        background: "#0d0f12",
        brightBlue: "#409cff",
      }),
      semanticColors: true,
    });
  });
});

describe("multi-protocol profiles", () => {
  it("creates SSH and ADB defaults", () => {
    const ssh = createSessionProfile(undefined, "ssh");
    const adb = createSessionProfile(undefined, "adb");

    expect(ssh.name).toBe("新 SSH 会话");
    expect(ssh.ssh.authMode).toBe("agent");
    expect(adb.name).toBe("新 ADB 会话");
    expect(adb.adb.shell).toBe("");
  });

  it("supports localized default names and target placeholders", () => {
    const ssh = createSessionProfile(undefined, "ssh", {
      serialName: "New Serial Session",
      serialGroup: "Serial Sessions",
      sshName: "New SSH Session",
      sshGroup: "SSH Sessions",
      adbName: "New ADB Session",
      adbGroup: "ADB Sessions",
    });

    expect(ssh.name).toBe("New SSH Session");
    expect(ssh.group).toBe("SSH Sessions");
    expect(
      sessionTargetLabel(ssh, {
        sshUnset: "SSH host not configured",
        adbUnset: "No ADB device selected",
        serialUnset: "No serial device selected",
      }),
    ).toBe("SSH host not configured");
    expect(duplicateSessionProfile(ssh, "Copy").name).toBe(
      "New SSH Session Copy",
    );
  });

  it("preserves password authentication without adding a credential field", () => {
    const ssh = createSessionProfile(undefined, "ssh");
    ssh.ssh.authMode = "password";

    const normalized = normalizeSessionProfile(ssh);
    expect(normalized.ssh.authMode).toBe("password");
    expect(normalized.ssh).not.toHaveProperty("password");
  });

  it("formats targets for every protocol", () => {
    const ssh = createSessionProfile(undefined, "ssh");
    ssh.ssh = { ...ssh.ssh, host: "example.com", username: "root" };
    const adb = createSessionProfile(undefined, "adb");
    adb.adb.deviceId = "emulator-5554";

    expect(sessionTargetLabel(ssh)).toBe("root@example.com:22");
    expect(sessionTargetLabel(adb)).toBe("emulator-5554");
  });
});

describe("reconnectDelayMs", () => {
  it("uses bounded exponential backoff", () => {
    expect(reconnectDelayMs(1)).toBe(1_000);
    expect(reconnectDelayMs(4)).toBe(8_000);
    expect(reconnectDelayMs(8)).toBe(30_000);
    expect(reconnectDelayMs(100)).toBe(30_000);
  });
});

describe("createRuntimeSession", () => {
  it("restores a profile without opening its serial device", () => {
    const profile = createSessionProfile();
    const runtime = createRuntimeSession(profile);

    expect(runtime.profileId).toBe(profile.id);
    expect(runtime.state).toBe("disconnected");
    expect(runtime.bytesRead).toBe(0);
    expect(runtime.logState).toBe("stopped");
  });
});

describe("requiresCloseConfirmation", () => {
  it("protects active connections and transfers", () => {
    const runtime = createRuntimeSession(createSessionProfile());
    expect(requiresCloseConfirmation(runtime)).toBe(false);
    expect(
      requiresCloseConfirmation({ ...runtime, state: "connected" }),
    ).toBe(true);
    expect(
      requiresCloseConfirmation({ ...runtime, transferActive: true }),
    ).toBe(true);
    expect(
      requiresCloseConfirmation({ ...runtime, logState: "recording" }),
    ).toBe(true);
  });
});
