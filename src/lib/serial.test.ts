import { describe, expect, it } from "vitest";
import { appendLineEnding, formatByteCount, parseHex } from "./serial";

describe("parseHex", () => {
  it("parses separators and 0x prefixes", () => {
    expect(Array.from(parseHex("0xAA 55,01-0d 0A"))).toEqual([
      0xaa, 0x55, 0x01, 0x0d, 0x0a,
    ]);
  });

  it("rejects half bytes", () => {
    expect(() => parseHex("AA 5")).toThrow(/半个字节/);
  });

  it("rejects invalid characters with a position", () => {
    expect(() => parseHex("AA GG")).toThrow(/第 3 个字符/);
  });
});

describe("appendLineEnding", () => {
  it("appends CRLF", () => {
    expect(appendLineEnding("help", "crlf")).toBe("help\r\n");
  });

  it("supports no line ending", () => {
    expect(appendLineEnding("help", "none")).toBe("help");
  });
});

describe("formatByteCount", () => {
  it("formats byte units", () => {
    expect(formatByteCount(42)).toBe("42 B");
    expect(formatByteCount(2048)).toBe("2.0 KiB");
  });
});
