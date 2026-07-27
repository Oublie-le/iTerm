import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listAdbDevices,
  openAdbSession,
  openSshSession,
  setProcessLogPaused,
  startProcessLog,
  stopProcessLog,
  writeProcessText,
} from "./remote";
import { createSessionProfile, type SerialEvent } from "./types";

afterEach(() => {
  vi.useRealTimers();
});

describe("remote session browser mocks", () => {
  it("exposes authorized and unauthorized ADB devices", async () => {
    const devices = await listAdbDevices();

    expect(devices.map((device) => device.state)).toEqual([
      "device",
      "unauthorized",
    ]);
    expect(devices[0].id).toBe("emulator-5554");
  });

  it("reports SSH connection and terminal output", async () => {
    vi.useFakeTimers();
    const profile = createSessionProfile(undefined, "ssh");
    profile.ssh.host = "example.com";
    profile.ssh.username = "root";
    const events: SerialEvent[] = [];

    await openSshSession("ssh-1", profile, (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(500);

    expect(events[0]).toMatchObject({
      type: "state",
      state: "connected",
    });
    expect(events[1]).toMatchObject({ type: "data", sessionId: "ssh-1" });
  });

  it("reports ADB Shell connection and terminal output", async () => {
    vi.useFakeTimers();
    const profile = createSessionProfile(undefined, "adb");
    profile.adb.deviceId = "emulator-5554";
    const events: SerialEvent[] = [];

    await openAdbSession("adb-1", profile, (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(500);

    expect(events[0]).toMatchObject({
      type: "state",
      state: "connected",
    });
    expect(events[1]).toMatchObject({ type: "data", sessionId: "adb-1" });
  });

  it("encodes remote text as UTF-8 with the selected line ending", async () => {
    await expect(writeProcessText("session", "你好", "crlf")).resolves.toBe(
      new TextEncoder().encode("你好\r\n").length,
    );
  });

  it("supports the remote logging lifecycle", async () => {
    await expect(
      startProcessLog(
        "ssh-1",
        "SSH/生产机",
        "text",
        "utf-8",
        false,
        10,
        3,
      ),
    ).resolves.toBe("/mock/logs/SSH_生产机.log");
    await expect(setProcessLogPaused("ssh-1", true)).resolves.toBeUndefined();
    await expect(stopProcessLog("ssh-1")).resolves.toBeUndefined();
  });
});
