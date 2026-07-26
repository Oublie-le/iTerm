import { describe, expect, it } from "vitest";
import {
  appendReceiveChunk,
  formatHexDump,
  formatReceiveTimestamp,
  timestampReceivedText,
} from "./receive";
import type { ReceiveChunk } from "./types";

const chunk = (sequence: number, bytes: number[]): ReceiveChunk => ({
  nonce: sequence,
  sequence,
  receivedAtMs: 1_700_000_000_000 + sequence,
  bytes,
});

describe("appendReceiveChunk", () => {
  it("keeps the newest complete chunks within the byte limit", () => {
    const result = appendReceiveChunk(
      [chunk(1, [1, 2]), chunk(2, [3, 4])],
      chunk(3, [5, 6]),
      4,
    );

    expect(result.map((item) => item.sequence)).toEqual([2, 3]);
  });

  it("keeps the tail of a single oversized chunk", () => {
    const result = appendReceiveChunk([], chunk(1, [1, 2, 3, 4]), 2);
    expect(result[0].bytes).toEqual([3, 4]);
  });
});

describe("formatHexDump", () => {
  it("formats offsets, hexadecimal bytes, and printable ASCII", () => {
    const result = formatHexDump(
      [chunk(1, [0x41, 0x00, 0x7e, 0xff])],
      4,
      4,
    );

    expect(result.text).toBe("00000000  41 00 7E FF  |A.~.|");
    expect(result.omittedBytes).toBe(0);
  });

  it("uses the absolute receive offset when old bytes are omitted", () => {
    const result = formatHexDump(
      [chunk(1, [0x41, 0x42, 0x43, 0x44])],
      10,
      2,
      2,
    );

    expect(result.text).toContain("00000008  43 44  |CD|");
    expect(result.omittedBytes).toBe(8);
  });

  it("optionally prefixes rows with their receive time", () => {
    const receivedAtMs = new Date(2026, 6, 26, 9, 8, 7, 6).getTime();
    const result = formatHexDump(
      [{ ...chunk(1, [0x41]), receivedAtMs }],
      1,
      16,
      64,
      true,
    );

    expect(result.text.startsWith("[09:08:07.006] 00000000")).toBe(true);
  });
});

describe("timestampReceivedText", () => {
  it("timestamps each new line while preserving chunk continuations", () => {
    const receivedAtMs = new Date(2026, 6, 26, 9, 8, 7, 6).getTime();
    const first = timestampReceivedText("hello", receivedAtMs, true);
    const second = timestampReceivedText(" world\nnext", receivedAtMs, first.startsNewLine);

    expect(first.text).toContain(`${formatReceiveTimestamp(receivedAtMs)}\u001b[0m hello`);
    expect(second.text).toBe(
      ` world\n\u001b[38;5;244m${formatReceiveTimestamp(receivedAtMs)}\u001b[0m next`,
    );
  });
});
