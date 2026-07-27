import { describe, expect, it } from "vitest";
import {
  createMetadataPayload,
  sendYmodemBatch,
} from "./ymodem";
import type { ByteReceiver } from "./xmodem";

class ScriptedReceiver implements ByteReceiver {
  constructor(private readonly responses: number[]) {}

  async readByte(): Promise<number> {
    const response = this.responses.shift();
    if (response === undefined) throw new Error("测试响应已用尽。");
    return response;
  }
}

function namedFile(name: string, bytes: Uint8Array): File {
  return new File([bytes.buffer as ArrayBuffer], name);
}

describe("YModem batch sender", () => {
  it("encodes filename and size in block zero metadata", () => {
    const payload = createMetadataPayload(
      namedFile("firmware.bin", Uint8Array.of(1, 2, 3)),
    );
    const text = new TextDecoder().decode(payload);

    expect(text.startsWith("firmware.bin\u00003\u0000")).toBe(true);
    expect(payload).toHaveLength(128);
  });

  it("sends multiple files and an empty batch terminator", async () => {
    const files = [
      namedFile("one.bin", Uint8Array.of(1, 2)),
      namedFile("two.bin", Uint8Array.of(3)),
    ];
    const writes: Uint8Array[] = [];
    const progress: number[] = [];
    const receiver = new ScriptedReceiver([
      0x43,
      0x06,
      0x43,
      0x06,
      0x15,
      0x06,
      0x43,
      0x06,
      0x43,
      0x06,
      0x06,
      0x43,
      0x06,
    ]);

    const count = await sendYmodemBatch(
      files,
      async (bytes) => {
        writes.push(bytes);
        return bytes.length;
      },
      receiver,
      ({ sentBytes }) => progress.push(sentBytes),
      new AbortController().signal,
    );

    expect(count).toBe(3);
    expect(progress).toEqual([2, 3]);
    expect(writes.map((bytes) => bytes[0])).toEqual([
      0x01,
      0x01,
      0x04,
      0x04,
      0x01,
      0x01,
      0x04,
      0x01,
    ]);
    expect(writes.at(-1)?.every((byte, index) => index < 3 || byte === 0)).toBe(
      true,
    );
  });
});
