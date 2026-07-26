export type ConnectionState =
  | "disconnected"
  | "opening"
  | "connected"
  | "closing"
  | "deviceLost"
  | "error";

export type DataBits = 5 | 6 | 7 | 8;
export type Parity = "none" | "odd" | "even" | "mark" | "space";
export type StopBits = "1" | "1.5" | "2";
export type FlowControl = "none" | "hardware" | "software";
export type LineEnding = "none" | "lf" | "cr" | "crlf";
export type SendMode = "text" | "hex";
export type ReceiveMode = "text" | "hex";
export type SyncChannel = "off" | "A" | "B" | "C" | "D";
export type LogMode = "raw" | "text";
export type LogState = "stopped" | "recording" | "paused" | "error";

export interface SerialPortDescriptor {
  path: string;
  displayName: string;
  portType: "usb" | "pci" | "bluetooth" | "unknown";
  vid?: number;
  pid?: number;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
}

export interface SerialConfig {
  portPath: string;
  deviceVid?: number;
  devicePid?: number;
  deviceSerialNumber?: string;
  baudRate: number;
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
  flowControl: FlowControl;
  readTimeoutMs: number;
  dtrOnOpen: boolean;
  rtsOnOpen: boolean;
  autoReconnect: boolean;
}

export interface TerminalConfig {
  encoding: string;
  termType: string;
  scrollback: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  timestamp: boolean;
}

export interface LoggingConfig {
  mode: LogMode;
  append: boolean;
  autoStart: boolean;
}

export interface SessionProfile {
  id: string;
  name: string;
  group: string;
  description: string;
  color: string;
  serial: SerialConfig;
  terminal: TerminalConfig;
  logging: LoggingConfig;
  createdAt: string;
  updatedAt: string;
}

export interface SenderPreset {
  id: string;
  name: string;
  mode: SendMode;
  payload: string;
  lineEnding: LineEnding;
  repeat: boolean;
  intervalMs: number;
}

export interface RuntimeSession {
  id: string;
  profileId: string;
  title: string;
  state: ConnectionState;
  notice?: {
    tone: "info" | "warning" | "error";
    title: string;
    detail?: string;
  };
  sequence: number;
  receiveMode: ReceiveMode;
  receiveChunks: ReceiveChunk[];
  receiveBaseOffset: number;
  syncChannel: SyncChannel;
  logState: LogState;
  logPath?: string;
  reconnectAttempts: number;
  nextReconnectAt?: number;
  transferActive: boolean;
  lastChunk?: {
    nonce: number;
    sequence: number;
    receivedAtMs: number;
    bytes: number[];
  };
  bytesRead: number;
  bytesWritten: number;
  terminalCols: number;
  terminalRows: number;
  openedAt: number;
}

export interface ReceiveChunk {
  nonce: number;
  sequence: number;
  receivedAtMs: number;
  bytes: number[];
}

export type SerialEvent =
  | {
      type: "state";
      sessionId: string;
      state: ConnectionState;
      message?: string;
    }
  | {
      type: "data";
      sessionId: string;
      sequence: number;
      receivedAtMs: number;
      bytes: number[];
    }
  | {
      type: "writeComplete";
      sessionId: string;
      byteCount: number;
    }
  | {
      type: "error";
      sessionId: string;
      code: string;
      message: string;
      recoverable: boolean;
    }
  | {
      type: "log";
      sessionId: string;
      state: LogState;
      path?: string;
      message?: string;
    };

const now = () => new Date().toISOString();

export const DEFAULT_SERIAL_CONFIG: SerialConfig = {
  portPath: "",
  baudRate: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: "1",
  flowControl: "none",
  readTimeoutMs: 20,
  dtrOnOpen: true,
  rtsOnOpen: true,
  autoReconnect: false,
};

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  encoding: "utf-8",
  termType: "xterm-256color",
  scrollback: 999_999,
  fontFamily: '"Roboto Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.12,
  cursorStyle: "block",
  timestamp: false,
};

export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  mode: "raw",
  append: false,
  autoStart: false,
};

export function createSessionProfile(
  port?: SerialPortDescriptor,
): SessionProfile {
  const timestamp = now();
  const suffix = port?.displayName || port?.path || "新串口会话";
  return {
    id: crypto.randomUUID(),
    name: suffix,
    group: "串口会话",
    description: "",
    color: "#17a34a",
    serial: {
      ...DEFAULT_SERIAL_CONFIG,
      portPath: port?.path ?? "",
      deviceVid: port?.vid,
      devicePid: port?.pid,
      deviceSerialNumber: port?.serialNumber,
    },
    terminal: { ...DEFAULT_TERMINAL_CONFIG },
    logging: { ...DEFAULT_LOGGING_CONFIG },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function duplicateSessionProfile(
  profile: SessionProfile,
): SessionProfile {
  const timestamp = now();
  return {
    ...profile,
    id: crypto.randomUUID(),
    name: `${profile.name} 副本`,
    serial: { ...profile.serial },
    terminal: { ...profile.terminal },
    logging: { ...profile.logging },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeSessionProfile(
  profile: SessionProfile,
): SessionProfile {
  return {
    ...profile,
    serial: { ...DEFAULT_SERIAL_CONFIG, ...profile.serial },
    terminal: { ...DEFAULT_TERMINAL_CONFIG, ...profile.terminal },
    logging: { ...DEFAULT_LOGGING_CONFIG, ...profile.logging },
  };
}

export function reconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  return Math.min(30_000, 1_000 * 2 ** (safeAttempt - 1));
}

export function createSenderPreset(index = 1): SenderPreset {
  return {
    id: crypto.randomUUID(),
    name: `发送 ${index}`,
    mode: "text",
    payload: "",
    lineEnding: "crlf",
    repeat: false,
    intervalMs: 1000,
  };
}

export function createRuntimeSession(
  profile: SessionProfile,
  state: ConnectionState = "disconnected",
): RuntimeSession {
  return {
    id: crypto.randomUUID(),
    profileId: profile.id,
    title: profile.name,
    state,
    sequence: 0,
    receiveMode: "text",
    receiveChunks: [],
    receiveBaseOffset: 0,
    syncChannel: "off",
    logState: "stopped",
    reconnectAttempts: 0,
    transferActive: false,
    bytesRead: 0,
    bytesWritten: 0,
    terminalCols: 80,
    terminalRows: 24,
    openedAt: Date.now(),
  };
}
