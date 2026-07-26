import { Channel, invoke } from "@tauri-apps/api/core";
import { appendLineEnding, isTauriRuntime } from "./serial";
import type {
  LineEnding,
  SerialEvent,
  SessionProfile,
} from "./types";

const mockTimers = new Map<string, number[]>();

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
