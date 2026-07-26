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
  baudRate: number;
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
  flowControl: FlowControl;
  readTimeoutMs: number;
  dtrOnOpen: boolean;
  rtsOnOpen: boolean;
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

export interface SessionProfile {
  id: string;
  name: string;
  group: string;
  description: string;
  color: string;
  serial: SerialConfig;
  terminal: TerminalConfig;
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
  lastChunk?: {
    nonce: number;
    sequence: number;
    receivedAtMs: number;
    bytes: number[];
  };
  bytesRead: number;
  bytesWritten: number;
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
    },
    terminal: { ...DEFAULT_TERMINAL_CONFIG },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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
