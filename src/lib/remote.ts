import { Channel, invoke } from "@tauri-apps/api/core";
import { appendLineEnding, isTauriRuntime } from "./serial";
import type {
  AdbDeviceDescriptor,
  LineEnding,
  LogMode,
  SerialEvent,
  SessionProfile,
} from "./types";

const mockTimers = new Map<string, number[]>();

export async function listAdbDevices(): Promise<AdbDeviceDescriptor[]> {
  if (isTauriRuntime()) {
    return invoke<AdbDeviceDescriptor[]>("list_adb_devices");
  }
  return [
    {
      id: "emulator-5554",
      state: "device",
      product: "sdk_gphone64_arm64",
      model: "Pixel 8 API 35",
      device: "emu64a",
      transportId: "1",
    },
    {
      id: "R58M1234ABC",
      state: "unauthorized",
      model: "Android Device",
      transportId: "2",
    },
  ];
}

export async function openSshSession(
  sessionId: string,
  profile: SessionProfile,
  onEvent: (event: SerialEvent) => void,
): Promise<void> {
  if (isTauriRuntime()) {
    const channel = new Channel<SerialEvent>();
    channel.onmessage = onEvent;
    await invoke("open_ssh_session", {
      request: {
        sessionId,
        host: profile.ssh.host,
        port: profile.ssh.port,
        username: profile.ssh.username,
        authMode: profile.ssh.authMode,
        privateKeyPath: profile.ssh.privateKeyPath,
        strictHostKeyChecking: profile.ssh.strictHostKeyChecking,
        keepAliveSeconds: profile.ssh.keepAliveSeconds,
        termType: profile.terminal.termType,
      },
      onEvent: channel,
    });
    return;
  }

  const timers = [
    window.setTimeout(
      () =>
        onEvent({
          type: "state",
          sessionId,
          state: "connected",
          message: "Mock SSH connected",
        }),
      150,
    ),
    window.setTimeout(
      () =>
        onEvent({
          type: "data",
          sessionId,
          sequence: 1,
          receivedAtMs: Date.now(),
          bytes: Array.from(
            new TextEncoder().encode(
              `\u001b[32mSSH connected\u001b[0m ${profile.ssh.username ? `${profile.ssh.username}@` : ""}${profile.ssh.host}\r\n$ `,
            ),
          ),
        }),
      300,
    ),
  ];
  mockTimers.set(sessionId, timers);
}

export async function openAdbSession(
  sessionId: string,
  profile: SessionProfile,
  onEvent: (event: SerialEvent) => void,
): Promise<void> {
  if (isTauriRuntime()) {
    const channel = new Channel<SerialEvent>();
    channel.onmessage = onEvent;
    await invoke("open_adb_session", {
      request: {
        sessionId,
        deviceId: profile.adb.deviceId,
        shell: profile.adb.shell,
      },
      onEvent: channel,
    });
    return;
  }

  const timers = [
    window.setTimeout(
      () =>
        onEvent({
          type: "state",
          sessionId,
          state: "connected",
          message: "Mock ADB Shell connected",
        }),
      120,
    ),
    window.setTimeout(
      () =>
        onEvent({
          type: "data",
          sessionId,
          sequence: 1,
          receivedAtMs: Date.now(),
          bytes: Array.from(
            new TextEncoder().encode(
              `Android Debug Bridge shell\r\n${profile.adb.deviceId}:/ $ `,
            ),
          ),
        }),
      260,
    ),
  ];
  mockTimers.set(sessionId, timers);
}

export async function closeProcessSession(sessionId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("close_process_session", { sessionId });
    return;
  }
  for (const timer of mockTimers.get(sessionId) ?? []) {
    window.clearTimeout(timer);
  }
  mockTimers.delete(sessionId);
}

export async function writeProcessBytes(
  sessionId: string,
  bytes: Uint8Array,
): Promise<number> {
  if (isTauriRuntime()) {
    return invoke<number>("write_process_bytes", {
      request: { sessionId, bytes: Array.from(bytes) },
    });
  }
  return bytes.length;
}

export async function writeProcessText(
  sessionId: string,
  text: string,
  lineEnding: LineEnding = "none",
): Promise<number> {
  return writeProcessBytes(
    sessionId,
    new TextEncoder().encode(appendLineEnding(text, lineEnding)),
  );
}

export async function startProcessLog(
  sessionId: string,
  sessionName: string,
  mode: LogMode,
  encoding: string,
  append: boolean,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("start_process_log", {
      request: { sessionId, sessionName, mode, encoding, append },
    });
  }
  return `/mock/logs/${sessionName.replaceAll("/", "_")}.log`;
}

export async function setProcessLogPaused(
  sessionId: string,
  paused: boolean,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("set_process_log_paused", { sessionId, paused });
  }
}

export async function stopProcessLog(sessionId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("stop_process_log", { sessionId });
  }
}
