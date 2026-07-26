import { describe, expect, it } from "vitest";
import {
  createSessionProfile,
  createRuntimeSession,
  duplicateSessionProfile,
  normalizeSessionProfile,
  reconnectDelayMs,
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
    expect(duplicate.terminal).not.toBe(source.terminal);
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
    });
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
