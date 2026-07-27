import { z } from "zod";
import type { SessionProfile } from "./types";

export const SESSION_PROFILE_EXPORT_SCHEMA = "iterm.session-profiles";

const serialSchema = z.object({
  portPath: z.string(),
  deviceVid: z.number().int().min(0).max(0xffff).optional(),
  devicePid: z.number().int().min(0).max(0xffff).optional(),
  deviceSerialNumber: z.string().optional(),
  baudRate: z.number().int().positive(),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  parity: z.enum(["none", "odd", "even", "mark", "space"]),
  stopBits: z.enum(["1", "1.5", "2"]),
  flowControl: z.enum(["none", "hardware", "software"]),
  readTimeoutMs: z.number().int().min(1).max(60_000),
  dtrOnOpen: z.boolean(),
  rtsOnOpen: z.boolean(),
  autoReconnect: z.boolean(),
});

const sshSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65_535),
  username: z.string(),
  authMode: z.enum(["agent", "privateKey", "password"]),
  privateKeyPath: z.string(),
  strictHostKeyChecking: z.boolean(),
  keepAliveSeconds: z.number().int().min(0).max(86_400),
});

const adbSchema = z.object({
  deviceId: z.string(),
  shell: z.string(),
});

const terminalSchema = z.object({
  encoding: z.string().min(1),
  termType: z.string().min(1),
  enterKey: z.enum(["cr", "lf", "crlf"]).default("cr"),
  backspaceKey: z.enum(["del", "bs"]).default("del"),
  scrollback: z.number().int().min(0).max(2_000_000),
  fontFamily: z.string().min(1),
  fontSize: z.number().int().min(8).max(40),
  lineHeight: z.number().min(0.5).max(4),
  cursorStyle: z.enum(["block", "bar", "underline"]),
  timestamp: z.boolean(),
  semanticColors: z.boolean().default(true),
  hexColumns: z.union([
    z.literal(8),
    z.literal(16),
    z.literal(24),
    z.literal(32),
  ]),
  hexGroupSize: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(4),
    z.literal(8),
  ]),
});

const loggingSchema = z.object({
  mode: z.enum(["raw", "text"]),
  append: z.boolean(),
  autoStart: z.boolean(),
  maxFileSizeMiB: z.number().min(0).max(1_048_576),
  rotateCount: z.number().int().min(0).max(1_000),
});

const triggerSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  enabled: z.boolean(),
  matcher: z.enum(["text", "regex"]),
  pattern: z.string().max(100_000),
  caseSensitive: z.boolean(),
  action: z.enum(["sendText", "startLog", "notification"]),
  payload: z.string().max(1_000_000),
  cooldownMs: z.number().int().min(0).max(86_400_000),
  maxTriggers: z.number().int().min(0).max(1_000_000),
});

const sessionProfileSchema: z.ZodType<SessionProfile> = z.object({
  id: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  group: z.string().max(500),
  description: z.string().max(10_000),
  color: z.string().max(100),
  protocol: z.enum(["serial", "ssh", "adb"]),
  serial: serialSchema,
  ssh: sshSchema,
  adb: adbSchema,
  terminal: terminalSchema,
  logging: loggingSchema,
  triggers: z.array(triggerSchema).max(1_000),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const sessionProfileExportSchema = z.object({
  schema: z.literal(SESSION_PROFILE_EXPORT_SCHEMA),
  version: z.literal(1),
  exportedAt: z.string(),
  profiles: z.array(sessionProfileSchema).min(1).max(1_000),
});

export interface ImportedProfileMerge {
  profiles: SessionProfile[];
  importedCount: number;
  remappedCount: number;
}

export function serializeSessionProfiles(
  profiles: SessionProfile[],
  exportedAt = new Date().toISOString(),
): string {
  if (profiles.length === 0) {
    throw new Error("没有可导出的会话配置。");
  }
  return `${JSON.stringify(
    {
      schema: SESSION_PROFILE_EXPORT_SCHEMA,
      version: 1,
      exportedAt,
      profiles,
    },
    null,
    2,
  )}\n`;
}

export function parseSessionProfiles(contents: string): SessionProfile[] {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
  const result = sessionProfileExportSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue.path.length > 0 ? issue.path.join(".") : "根对象";
    throw new Error(`会话配置格式无效：${location} ${issue.message}`);
  }
  return result.data.profiles;
}

export function mergeImportedProfiles(
  existing: SessionProfile[],
  imported: SessionProfile[],
  createId: () => string = () => crypto.randomUUID(),
): ImportedProfileMerge {
  const ids = new Set(existing.map((profile) => profile.id));
  let remappedCount = 0;
  const appended = imported.map((profile) => {
    let id = profile.id;
    while (ids.has(id)) {
      id = createId();
      remappedCount += 1;
    }
    ids.add(id);
    return {
      ...profile,
      id,
      serial: { ...profile.serial },
      ssh: { ...profile.ssh },
      adb: { ...profile.adb },
      terminal: { ...profile.terminal },
      logging: { ...profile.logging },
      triggers: profile.triggers.map((trigger) => ({ ...trigger })),
    };
  });
  return {
    profiles: [...existing, ...appended],
    importedCount: appended.length,
    remappedCount,
  };
}
