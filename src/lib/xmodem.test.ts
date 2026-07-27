import { describe, expect, it } from "vitest";
import {
  crc16Xmodem,
  createXmodemFrame,
  sendXmodemCrc,
  type ByteReceiver,
} from "./xmodem";

class ScriptedReceiver implements ByteReceiver {
  constructor(private readonly responses: number[]) {}

  async readByte(): Promise<number> {
    const response = this.responses.shift();
    if (response === undefined) throw new Error("测试响应已用尽。");
    return response;
  }
}

describe("XModem-CRC sender", () => {
  it("builds a padded 128-byte frame with CRC16", () => {
    const frame = createXmodemFrame(1, Uint8Array.of(0x41, 0x42, 0x43));

    expect(frame).toHaveLength(133);
    expect(Array.from(frame.slice(0, 6))).toEqual([
      0x01,
      0x01,
      0xfe,
      0x41,
      0x42,
      0x43,
    ]);
    expect(frame[130]).toBe(0x1a);
    expect(crc16Xmodem(new TextEncoder().encode("123456789"))).toBe(0x31c3);
  });

  it("sends a file after C handshake and completes with EOT", async () => {
    const writes: Uint8Array[] = [];
    const progress: number[] = [];
    const count = await sendXmodemCrc(
      new Blob([Uint8Array.of(1, 2, 3)]),
      async (bytes) => {
        writes.push(bytes);
        return bytes.length;
      },
      new ScriptedReceiver([0x43, 0x06, 0x06]),
      (sent) => progress.push(sent),
      new AbortController().signal,
    );

    expect(count).toBe(3);
    expect(writes.map((bytes) => bytes[0])).toEqual([0x01, 0x04]);
    expect(progress).toEqual([3]);
  });

  it("retries a block after NAK", async () => {
    const writes: Uint8Array[] = [];
    await sendXmodemCrc(
      new Blob([Uint8Array.of(7)]),
      async (bytes) => {
        writes.push(bytes);
        return bytes.length;
      },
      new ScriptedReceiver([0x43, 0x15, 0x06, 0x06]),
      () => undefined,
      new AbortController().signal,
    );

    expect(writes.map((bytes) => bytes[0])).toEqual([0x01, 0x01, 0x04]);
  });

  it("sends cancellation when the receiver cancels", async () => {
    const writes: Uint8Array[] = [];
    await expect(
      sendXmodemCrc(
        new Blob([Uint8Array.of(1)]),
        async (bytes) => {
          writes.push(bytes);
          return bytes.length;
        },
        new ScriptedReceiver([0x18]),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("接收端取消");

    expect(Array.from(writes.at(-1) ?? [])).toEqual([0x18, 0x18]);
  });
});
