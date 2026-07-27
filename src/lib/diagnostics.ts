export type DiagnosticLevel = "info" | "warning" | "error";

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  level: DiagnosticLevel;
  area: string;
  event: string;
  message?: string;
  context: Record<string, string | number | boolean | null>;
}

type DiagnosticStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DIAGNOSTIC_STORAGE_KEY = "iterm.diagnostics.v1";
const MAX_DIAGNOSTIC_EVENTS = 500;
const SENSITIVE_CONTEXT_KEY =
  /password|secret|token|private.*key|payload|contents|bytes|data/i;

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}…`;
}

function sanitizeContext(
  context: Record<string, unknown>,
): DiagnosticEvent["context"] {
  return Object.fromEntries(
    Object.entries(context)
      .slice(0, 30)
      .map(([key, value]) => {
        if (SENSITIVE_CONTEXT_KEY.test(key)) return [key, "[已省略]"];
        if (typeof value === "string") return [key, truncate(value, 500)];
        if (
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
        ) {
          return [key, value];
        }
        return [key, "[复杂值已省略]"];
      }),
  );
}

export function loadDiagnosticEvents(
  storage: Pick<Storage, "getItem"> = localStorage,
): DiagnosticEvent[] {
  try {
    const parsed = JSON.parse(
      storage.getItem(DIAGNOSTIC_STORAGE_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is DiagnosticEvent =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as DiagnosticEvent).id === "string" &&
          typeof (entry as DiagnosticEvent).timestamp === "string" &&
          ["info", "warning", "error"].includes(
            (entry as DiagnosticEvent).level,
          ) &&
          typeof (entry as DiagnosticEvent).area === "string" &&
          typeof (entry as DiagnosticEvent).event === "string",
      )
      .slice(-MAX_DIAGNOSTIC_EVENTS);
  } catch {
    return [];
  }
}

export function recordDiagnostic(
  area: string,
  event: string,
  options: {
    level?: DiagnosticLevel;
    message?: string;
    context?: Record<string, unknown>;
  } = {},
  storage: DiagnosticStorage = localStorage,
  timestamp = new Date().toISOString(),
): DiagnosticEvent {
  const entry: DiagnosticEvent = {
    id: crypto.randomUUID(),
    timestamp,
    level: options.level ?? "info",
    area: truncate(area, 100),
    event: truncate(event, 100),
    message: options.message ? truncate(options.message, 1_000) : undefined,
    context: sanitizeContext(options.context ?? {}),
  };
  try {
    const events = [...loadDiagnosticEvents(storage), entry].slice(
      -MAX_DIAGNOSTIC_EVENTS,
    );
    storage.setItem(DIAGNOSTIC_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics must never interrupt a terminal session.
  }
  return entry;
}

export function clearDiagnosticEvents(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(DIAGNOSTIC_STORAGE_KEY);
}

export function serializeDiagnosticEvents(
  events: DiagnosticEvent[],
  exportedAt = new Date().toISOString(),
  locale: AppLocale = "zh-CN",
): string {
  const redacted = locale === "en-US" ? "[redacted]" : "[已省略]";
  const complexValue =
    locale === "en-US" ? "[complex value omitted]" : "[复杂值已省略]";
  const localizedEvents = events.map((event) => ({
    ...event,
    context: Object.fromEntries(
      Object.entries(event.context).map(([key, value]) => [
        key,
        value === "[已省略]" || value === "[redacted]"
          ? redacted
          : value === "[复杂值已省略]" ||
              value === "[complex value omitted]"
            ? complexValue
            : value,
      ]),
    ),
  }));
  return `${JSON.stringify(
    {
      schema: "iterm.diagnostics",
      version: 1,
      exportedAt,
      privacy:
        locale === "en-US"
          ? "Diagnostics exclude terminal input/output, passwords, tokens, private-key paths, and file contents."
          : "诊断记录不包含终端收发内容、密码、令牌、私钥路径或文件内容。",
      events: localizedEvents,
    },
    null,
    2,
  )}\n`;
}
import type { AppLocale } from "./i18n";
