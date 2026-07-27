import { describe, expect, it } from "vitest";
import {
  clearDiagnosticEvents,
  loadDiagnosticEvents,
  recordDiagnostic,
  serializeDiagnosticEvents,
} from "./diagnostics";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("local diagnostics", () => {
  it("persists structured events and clears them", () => {
    const storage = memoryStorage();
    recordDiagnostic(
      "session",
      "open_failed",
      {
        level: "error",
        message: "permission denied",
        context: { protocol: "serial", recoverable: true },
      },
      storage,
      "2026-07-27T00:00:00.000Z",
    );

    expect(loadDiagnosticEvents(storage)).toMatchObject([
      {
        timestamp: "2026-07-27T00:00:00.000Z",
        level: "error",
        area: "session",
        event: "open_failed",
        message: "permission denied",
        context: { protocol: "serial", recoverable: true },
      },
    ]);
    clearDiagnosticEvents(storage);
    expect(loadDiagnosticEvents(storage)).toEqual([]);
  });

  it("redacts sensitive context and omits complex values", () => {
    const storage = memoryStorage();
    recordDiagnostic(
      "transfer",
      "failed",
      {
        context: {
          password: "do-not-store",
          privateKeyPath: "/secret/key",
          payload: "AA55",
          byteCount: 42,
          nested: { unsafe: true },
        },
      },
      storage,
    );

    expect(loadDiagnosticEvents(storage)[0].context).toEqual({
      password: "[已省略]",
      privateKeyPath: "[已省略]",
      payload: "[已省略]",
      byteCount: 42,
      nested: "[复杂值已省略]",
    });
  });

  it("keeps a bounded ring and exports a versioned privacy statement", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 510; index += 1) {
      recordDiagnostic("test", `event-${index}`, {}, storage);
    }
    const events = loadDiagnosticEvents(storage);
    expect(events).toHaveLength(500);
    expect(events[0].event).toBe("event-10");
    expect(serializeDiagnosticEvents(events)).toContain(
      '"schema": "iterm.diagnostics"',
    );
    expect(serializeDiagnosticEvents(events)).toContain(
      "不包含终端收发内容",
    );
  });

  it("exports privacy and redaction markers in English", () => {
    const events = [
      {
        id: "event-1",
        timestamp: "2026-07-27T00:00:00.000Z",
        level: "info" as const,
        area: "test",
        event: "redacted",
        context: {
          secret: "[已省略]",
          nested: "[复杂值已省略]",
        },
      },
    ];
    const output = serializeDiagnosticEvents(
      events,
      "2026-07-27T00:00:00.000Z",
      "en-US",
    );

    expect(output).toContain("Diagnostics exclude terminal input/output");
    expect(output).toContain("[redacted]");
    expect(output).toContain("[complex value omitted]");
    expect(output).not.toContain("[已省略]");
  });
});
