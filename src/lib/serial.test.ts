import { describe, expect, it } from "vitest";
import {
  appendLineEnding,
  areSerialPortListsEqual,
  formatByteCount,
  findMatchingSerialPort,
  parseHex,
} from "./serial";

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

describe("areSerialPortListsEqual", () => {
  const first = {
    path: "/dev/cu.usbserial-1",
    displayName: "USB Serial",
    portType: "usb" as const,
    vid: 0x10c4,
    pid: 0xea60,
    serialNumber: "ABC",
  };

  it("ignores enumeration order", () => {
    const second = {
      path: "/dev/cu.usbserial-2",
      displayName: "USB Serial 2",
      portType: "usb" as const,
    };
    expect(areSerialPortListsEqual([first, second], [second, first])).toBe(true);
  });

  it("detects hotplug and metadata changes", () => {
    expect(areSerialPortListsEqual([first], [])).toBe(false);
    expect(
      areSerialPortListsEqual(
        [first],
        [{ ...first, serialNumber: "CHANGED" }],
      ),
    ).toBe(false);
  });
});

describe("findMatchingSerialPort", () => {
  const config = {
    portPath: "/dev/cu.old",
    deviceVid: 0x10c4,
    devicePid: 0xea60,
    deviceSerialNumber: "ABC",
    baudRate: 115_200,
    dataBits: 8 as const,
    parity: "none" as const,
    stopBits: "1" as const,
    flowControl: "none" as const,
    readTimeoutMs: 20,
    dtrOnOpen: true,
    rtsOnOpen: true,
    autoReconnect: true,
  };
  const replacement = {
    path: "/dev/cu.new",
    displayName: "USB Serial",
    portType: "usb" as const,
    vid: 0x10c4,
    pid: 0xea60,
    serialNumber: "ABC",
  };

  it("follows a USB serial number when the path changes", () => {
    expect(findMatchingSerialPort(config, [replacement])?.path).toBe(
      "/dev/cu.new",
    );
  });

  it("does not guess between identical devices without a serial number", () => {
    const withoutSerial = { ...config, deviceSerialNumber: undefined };
    expect(
      findMatchingSerialPort(withoutSerial, [
        { ...replacement, serialNumber: undefined },
        {
          ...replacement,
          path: "/dev/cu.other",
          serialNumber: undefined,
        },
      ]),
    ).toBeUndefined();
  });
});
