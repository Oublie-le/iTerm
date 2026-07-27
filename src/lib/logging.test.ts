import { describe, expect, it } from "vitest";
import { openLogDirectory, openLogFile } from "./logging";

describe("logging browser mocks", () => {
  it("opens the application log directory without native APIs", async () => {
    await expect(openLogDirectory()).resolves.toBeUndefined();
  });

  it("opens a log file without native APIs", async () => {
    await expect(openLogFile("/mock/logs/session.log")).resolves.toBeUndefined();
  });
});
