import { describe, expect, it } from "vitest";
import {
  defaultLogFileName,
  openLogDirectory,
  openLogFile,
  selectLogOutputFile,
} from "./logging";

describe("logging browser mocks", () => {
  it("builds a safe timestamped default file name", () => {
    const name = defaultLogFileName(
      "Board/COM:4?",
      new Date(2026, 6, 27, 9, 8, 7),
    );
    expect(name).toBe("Board_COM_4__2026-07-27_09-08-07.log");
  });

  it("opens the application log directory without native APIs", async () => {
    await expect(openLogDirectory()).resolves.toBeUndefined();
  });

  it("opens a log file without native APIs", async () => {
    await expect(openLogFile("/mock/logs/session.log")).resolves.toBeUndefined();
  });

  it("uses the timestamped name when selecting a browser mock path", async () => {
    await expect(
      selectLogOutputFile("console", "text", "Save log"),
    ).resolves.toMatch(/^console_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/);
  });
});
