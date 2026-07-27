import { describe, expect, it } from "vitest";
import { colorizeSerialText } from "./serialColors";

describe("serial semantic colors", () => {
  it("adds distinct ANSI colors to common device log levels", () => {
    const value = colorizeSerialText(
      "INFO boot started\r\nWARN voltage low\r\nERROR sensor failed\r\n",
    );

    expect(value).toContain("\u001b[36mINFO boot started");
    expect(value).toContain("\u001b[1;33mWARN voltage low");
    expect(value).toContain("\u001b[1;31mERROR sensor failed");
  });

  it("preserves device-provided ANSI styling exactly", () => {
    const value = "\u001b[35mcustom device color\u001b[0m\r\n";
    expect(colorizeSerialText(value)).toBe(value);
  });

  it("preserves colored device lines while styling plain lines in the same chunk", () => {
    const deviceLine = "\u001b[35mcustom color\u001b[0m\r\n";
    const value = colorizeSerialText(`${deviceLine}ERROR sensor failed\r\n`);

    expect(value).toBe(
      `${deviceLine}\u001b[1;31mERROR sensor failed\r\n\u001b[0m`,
    );
  });

  it("leaves ordinary serial output untouched", () => {
    expect(colorizeSerialText("temperature=24.8 C\r\n")).toBe(
      "temperature=24.8 C\r\n",
    );
  });
});
