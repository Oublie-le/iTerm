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
export type HexColumns = 8 | 16 | 24 | 32;
export type HexGroupSize = 1 | 2 | 4 | 8;
export type SessionProtocol = "serial" | "ssh" | "adb";
export type SshAuthMode = "agent" | "privateKey" | "password";
export type TriggerMatcher = "text" | "regex";
export type TriggerAction = "sendText" | "startLog" | "notification";
export type FileTransferProtocol = "raw" | "xmodemCrc" | "ymodem" | "zmodem";

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

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  authMode: SshAuthMode;
  privateKeyPath: string;
  strictHostKeyChecking: boolean;
  keepAliveSeconds: number;
}

export interface AdbConfig {
  deviceId: string;
  shell: string;
}

export interface AdbDeviceDescriptor {
  id: string;
  state: "device" | "offline" | "unauthorized" | "no_permissions" | "unknown";
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

export interface ExternalToolStatus {
  id: "ssh" | "adb";
  label: string;
  available: boolean;
  version?: string;
  installHint: string;
}

export interface TerminalConfig {
  encoding: string;
  termType: string;
  enterKey: "cr" | "lf" | "crlf";
  backspaceKey: "del" | "bs";
  scrollback: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  timestamp: boolean;
  hexColumns: HexColumns;
  hexGroupSize: HexGroupSize;
}

export interface LoggingConfig {
  mode: LogMode;
  append: boolean;
  autoStart: boolean;
  maxFileSizeMiB: number;
  rotateCount: number;
}

export interface TriggerRule {
  id: string;
  name: string;
  enabled: boolean;
  matcher: TriggerMatcher;
  pattern: string;
  caseSensitive: boolean;
  action: TriggerAction;
  payload: string;
  cooldownMs: number;
  maxTriggers: number;
}

export interface SessionProfile {
  id: string;
  name: string;
  group: string;
  description: string;
  color: string;
  protocol: SessionProtocol;
  serial: SerialConfig;
  ssh: SshConfig;
  adb: AdbConfig;
  terminal: TerminalConfig;
  logging: LoggingConfig;
  triggers: TriggerRule[];
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

export const DEFAULT_SSH_CONFIG: SshConfig = {
  host: "",
  port: 22,
  username: "",
  authMode: "agent",
  privateKeyPath: "",
  strictHostKeyChecking: true,
  keepAliveSeconds: 30,
};

export const DEFAULT_ADB_CONFIG: AdbConfig = {
  deviceId: "",
  shell: "",
};

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  encoding: "utf-8",
  termType: "xterm-256color",
  enterKey: "cr",
  backspaceKey: "del",
  scrollback: 999_999,
  fontFamily: '"Roboto Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.12,
  cursorStyle: "block",
  timestamp: false,
  hexColumns: 16,
  hexGroupSize: 1,
};

export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  mode: "raw",
  append: false,
  autoStart: false,
  maxFileSizeMiB: 0,
  rotateCount: 3,
};

export function createSessionProfile(
  port?: SerialPortDescriptor,
  protocol: SessionProtocol = "serial",
): SessionProfile {
  const timestamp = now();
  const defaults: Record<SessionProtocol, { name: string; group: string; color: string }> = {
    serial: {
      name: port?.displayName || port?.path || "新串口会话",
      group: "串口会话",
      color: "#17a34a",
    },
    ssh: { name: "新 SSH 会话", group: "SSH 会话", color: "#2563eb" },
    adb: { name: "新 ADB 会话", group: "ADB 会话", color: "#f59e0b" },
  };
  const selected = defaults[protocol];
  return {
    id: crypto.randomUUID(),
    name: selected.name,
    group: selected.group,
    description: "",
    color: selected.color,
    protocol,
    serial: {
      ...DEFAULT_SERIAL_CONFIG,
      portPath: port?.path ?? "",
      deviceVid: port?.vid,
      devicePid: port?.pid,
      deviceSerialNumber: port?.serialNumber,
    },
    ssh: { ...DEFAULT_SSH_CONFIG },
    adb: { ...DEFAULT_ADB_CONFIG },
    terminal: { ...DEFAULT_TERMINAL_CONFIG },
    logging: { ...DEFAULT_LOGGING_CONFIG },
    triggers: [],
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
    ssh: { ...profile.ssh },
    adb: { ...profile.adb },
    terminal: { ...profile.terminal },
    logging: { ...profile.logging },
    triggers: profile.triggers.map((trigger) => ({ ...trigger })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeSessionProfile(
  profile: SessionProfile,
): SessionProfile {
  const enterKey = profile.terminal?.enterKey;
  const backspaceKey = profile.terminal?.backspaceKey;
  return {
    ...profile,
    protocol: profile.protocol ?? "serial",
    serial: { ...DEFAULT_SERIAL_CONFIG, ...profile.serial },
    ssh: { ...DEFAULT_SSH_CONFIG, ...profile.ssh },
    adb: { ...DEFAULT_ADB_CONFIG, ...profile.adb },
    terminal: {
      ...DEFAULT_TERMINAL_CONFIG,
      ...profile.terminal,
      enterKey:
        enterKey === "cr" || enterKey === "lf" || enterKey === "crlf"
          ? enterKey
          : DEFAULT_TERMINAL_CONFIG.enterKey,
      backspaceKey:
        backspaceKey === "del" || backspaceKey === "bs"
          ? backspaceKey
          : DEFAULT_TERMINAL_CONFIG.backspaceKey,
    },
    logging: { ...DEFAULT_LOGGING_CONFIG, ...profile.logging },
    triggers: Array.isArray(profile.triggers)
      ? profile.triggers.map((trigger) => ({ ...trigger }))
      : [],
  };
}

export function sessionTargetLabel(profile: SessionProfile): string {
  switch (profile.protocol) {
    case "ssh": {
      const destination = profile.ssh.username
        ? `${profile.ssh.username}@${profile.ssh.host}`
        : profile.ssh.host;
      return destination
        ? `${destination}:${profile.ssh.port}`
        : "尚未配置 SSH 主机";
    }
    case "adb":
      return profile.adb.deviceId || "尚未选择 ADB 设备";
    case "serial":
      return profile.serial.portPath
        ? `${profile.serial.portPath} · ${profile.serial.baudRate}`
        : "尚未选择串口设备";
  }
}

export function reconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  return Math.min(30_000, 1_000 * 2 ** (safeAttempt - 1));
}

export function requiresCloseConfirmation(session: RuntimeSession): boolean {
  return (
    session.state === "opening" ||
    session.state === "connected" ||
    session.state === "closing" ||
    session.logState === "recording" ||
    session.logState === "paused" ||
    session.transferActive
  );
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
