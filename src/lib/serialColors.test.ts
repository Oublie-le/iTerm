import { describe, expect, it } from "vitest";
import { colorizeSerialText } from "./serialColors";

describe("serial semantic colors", () => {
  it("adds distinct ANSI colors to common device log levels", () => {
    const value = colorizeSerialText(
      "INFO boot started\r\nWARN voltage low\r\nERROR sensor failed\r\n",
    );

    expect(value).toContain("\u001b[36mINFO\u001b[0m");
    expect(value).toContain("\u001b[1;33mWARN\u001b[0m voltage low");
    expect(value).toContain("\u001b[1;31mERROR\u001b[0m sensor");
    expect(value).toContain("\u001b[1;31mfailed\u001b[0m");
    expect(value).not.toContain("\u001b[1;31mERROR sensor failed");
  });

  it("preserves device-provided ANSI styling exactly", () => {
    const value = "\u001b[35mcustom device color\u001b[0m\r\n";
    expect(colorizeSerialText(value)).toBe(value);
  });

  it("preserves colored device lines while styling plain lines in the same chunk", () => {
    const deviceLine = "\u001b[35mcustom color\u001b[0m\r\n";
    const value = colorizeSerialText(`${deviceLine}ERROR sensor failed\r\n`);

    expect(value).toBe(
      `${deviceLine}\u001b[1;31mERROR\u001b[0m sensor \u001b[1;31mfailed\u001b[0m\r\n`,
    );
  });

  it("styles serial shell prompts and entered commands separately", () => {
    expect(colorizeSerialText("console:/ # ls\r\n")).toBe(
      "\u001b[1;32mconsole:/ #\u001b[0m \u001b[1;36mls\u001b[0m\r\n",
    );
    expect(colorizeSerialText("console:/ # ")).toBe(
      "\u001b[1;32mconsole:/ #\u001b[0m ",
    );
  });

  it("styles tabular shell listings so serial output is visibly colored", () => {
    expect(colorizeSerialText("apex      data      system\r\n")).toBe(
      "\u001b[1;34mapex\u001b[0m      \u001b[1;34mdata\u001b[0m      \u001b[1;34msystem\u001b[0m\r\n",
    );
  });

  it("highlights paths in otherwise plain device output", () => {
    expect(colorizeSerialText("mount=/data/local/tmp rw\r\n")).toContain(
      "mount=\u001b[36m/data/local/tmp\u001b[0m rw",
    );
  });

  it("leaves ordinary serial output untouched", () => {
    expect(colorizeSerialText("temperature=24.8 C\r\n")).toBe(
      "temperature=24.8 C\r\n",
    );
  });
});
