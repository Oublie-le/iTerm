import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  LineEnding,
  LogMode,
  SerialEvent,
  SerialPortDescriptor,
  SerialConfig,
  SessionProfile,
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const mockTimers = new Map<string, number[]>();

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function appendLineEnding(
  text: string,
  lineEnding: LineEnding,
): string {
  const endings: Record<LineEnding, string> = {
    none: "",
    lf: "\n",
    cr: "\r",
    crlf: "\r\n",
  };
  return text + endings[lineEnding];
}

export function parseHex(value: string): Uint8Array {
  const compact = value.replace(/(?:0x)|[\s,;:_-]/gi, "");
  if (compact.length === 0) return new Uint8Array();
  if (compact.length % 2 !== 0) {
    throw new Error(`Hex 数据缺少半个字节（共 ${compact.length} 个字符）`);
  }
  const invalid = compact.search(/[^0-9a-f]/i);
  if (invalid !== -1) {
    throw new Error(`Hex 数据第 ${invalid + 1} 个字符无效`);
  }

  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function formatByteCount(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function areSerialPortListsEqual(
  current: SerialPortDescriptor[],
  next: SerialPortDescriptor[],
): boolean {
  if (current.length !== next.length) return false;
  const byPath = (ports: SerialPortDescriptor[]) =>
    [...ports].sort((left, right) => left.path.localeCompare(right.path));
  const left = byPath(current);
  const right = byPath(next);
  return left.every(
    (port, index) =>
      port.path === right[index].path &&
      port.displayName === right[index].displayName &&
      port.vid === right[index].vid &&
      port.pid === right[index].pid &&
      port.serialNumber === right[index].serialNumber,
  );
}

export function findMatchingSerialPort(
  config: SerialConfig,
  ports: SerialPortDescriptor[],
): SerialPortDescriptor | undefined {
  const exact = ports.find((port) => port.path === config.portPath);
  if (exact) return exact;

  if (
    config.deviceVid === undefined ||
    config.devicePid === undefined
  ) {
    return undefined;
  }

  const sameProduct = ports.filter(
    (port) =>
      port.vid === config.deviceVid &&
      port.pid === config.devicePid,
  );
  if (config.deviceSerialNumber) {
    return sameProduct.find(
      (port) => port.serialNumber === config.deviceSerialNumber,
    );
  }
  return sameProduct.length === 1 ? sameProduct[0] : undefined;
}

export async function listSerialPorts(): Promise<SerialPortDescriptor[]> {
  if (isTauriRuntime()) {
    return invoke<SerialPortDescriptor[]>("list_serial_ports");
  }

  return [
    {
      path: "/dev/cu.usbserial-0001",
      displayName: "CP2102 USB to UART",
      portType: "usb",
      vid: 0x10c4,
      pid: 0xea60,
      serialNumber: "DEMO-0001",
      manufacturer: "Silicon Labs",
      product: "CP2102 USB to UART Bridge",
    },
    {
      path: "/dev/cu.debug-console",
      displayName: "Debug Console",
      portType: "unknown",
    },
  ];
}

export async function openSerialSession(
  sessionId: string,
  profile: SessionProfile,
  onEvent: (event: SerialEvent) => void,
): Promise<void> {
  if (isTauriRuntime()) {
    const channel = new Channel<SerialEvent>();
    channel.onmessage = onEvent;
    await invoke("open_serial_session", {
      request: {
        sessionId,
        profileId: profile.id,
        portPath: profile.serial.portPath,
        baudRate: profile.serial.baudRate,
        dataBits: profile.serial.dataBits,
        parity: profile.serial.parity,
        stopBits: profile.serial.stopBits,
        flowControl: profile.serial.flowControl,
        readTimeoutMs: profile.serial.readTimeoutMs,
        dtrOnOpen: profile.serial.dtrOnOpen,
        rtsOnOpen: profile.serial.rtsOnOpen,
      },
      onEvent: channel,
    });
    return;
  }

  const timers: number[] = [];
  mockTimers.set(sessionId, timers);
  timers.push(
    window.setTimeout(
      () =>
        onEvent({
          type: "state",
          sessionId,
          state: "connected",
          message: "Mock serial device connected",
        }),
      250,
    ),
  );

  const demoOutput = [
    "\u001b[38;5;81miTerm device monitor\u001b[0m\r\n",
    `Port: ${profile.serial.portPath}  ${profile.serial.baudRate}/${profile.serial.dataBits}/${profile.serial.parity.toUpperCase()}/${profile.serial.stopBits}\r\n`,
    "\u001b[32m✓ Device ready\u001b[0m\r\n\r\n",
    "Press Enter or use the sender pane to transmit data.\r\n",
  ];

  demoOutput.forEach((line, index) => {
    timers.push(
      window.setTimeout(
        () =>
          onEvent({
            type: "data",
            sessionId,
            sequence: index + 1,
            receivedAtMs: Date.now(),
            bytes: Array.from(new TextEncoder().encode(line)),
          }),
        500 + index * 180,
      ),
    );
  });
}

export async function closeSerialSession(sessionId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("close_serial_session", { sessionId });
    return;
  }

  for (const timer of mockTimers.get(sessionId) ?? []) {
    window.clearTimeout(timer);
  }
  mockTimers.delete(sessionId);
}

export async function writeSerialText(
  sessionId: string,
  text: string,
  encoding: string,
  lineEnding: LineEnding = "none",
): Promise<number> {
  const payload = appendLineEnding(text, lineEnding);
  if (isTauriRuntime()) {
    return invoke<number>("write_serial_text", {
      request: { sessionId, text: payload, encoding },
    });
  }
  return new TextEncoder().encode(payload).length;
}

export async function writeSerialTextMany(
  sessionIds: string[],
  text: string,
  encoding: string,
): Promise<Array<{ sessionId: string; byteCount: number }>> {
  if (isTauriRuntime()) {
    return invoke<Array<{ sessionId: string; byteCount: number }>>(
      "write_serial_text_many",
      {
        request: { sessionIds, text, encoding },
      },
    );
  }
  const byteCount = new TextEncoder().encode(text).length;
  return sessionIds.map((sessionId) => ({ sessionId, byteCount }));
}

export async function writeSerialBytes(
  sessionId: string,
  bytes: Uint8Array,
): Promise<number> {
  if (isTauriRuntime()) {
    return invoke<number>("write_serial_bytes", {
      request: { sessionId, bytes: Array.from(bytes) },
    });
  }
  return bytes.length;
}

export async function setSerialSignal(
  sessionId: string,
  signal: "dtr" | "rts",
  enabled: boolean,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("set_serial_signal", { sessionId, signal, enabled });
  }
}

export async function sendSerialBreak(
  sessionId: string,
  durationMs = 250,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("send_serial_break", { sessionId, durationMs });
  }
}

export async function clearSerialBuffers(
  sessionId: string,
  target: "input" | "output" | "all" = "all",
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("clear_serial_buffers", { sessionId, target });
  }
}

export async function startSerialLog(
  sessionId: string,
  sessionName: string,
  mode: LogMode,
  encoding: string,
  append: boolean,
  maxFileSizeMiB: number,
  rotateCount: number,
  path?: string,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("start_serial_log", {
      request: {
        sessionId,
        sessionName,
        mode,
        encoding,
        append,
        maxFileSizeMiB,
        rotateCount,
        path,
      },
    });
  }
  return `/mock/logs/${sessionName.replaceAll("/", "_")}.log`;
}

export async function setSerialLogPaused(
  sessionId: string,
  paused: boolean,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("set_serial_log_paused", { sessionId, paused });
  }
}

export async function stopSerialLog(sessionId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("stop_serial_log", { sessionId });
  }
}
