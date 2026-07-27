import { describe, expect, it } from "vitest";
import {
  AsyncByteQueue,
  createXmodemFrame,
  type ByteReceiver,
} from "./xmodem";
import { createMetadataPayload, sendYmodemBatch } from "./ymodem";
import {
  parseYmodemMetadata,
  receiveYmodemBatch,
  sanitizeYmodemFileName,
} from "./ymodemReceive";

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

describe("YModem batch receiver", () => {
  it("receives a CRC batch with the standard double-EOT handshake", async () => {
    const source = namedFile("firmware.bin", Uint8Array.of(1, 2, 3));
    const header = createXmodemFrame(0, createMetadataPayload(source));
    const data = createXmodemFrame(1, Uint8Array.of(1, 2, 3));
    const terminator = createXmodemFrame(0, new Uint8Array(128));
    const receiver = new ScriptedReceiver([
      ...header,
      ...data,
      0x04,
      0x04,
      ...terminator,
    ]);
    const controls: number[] = [];
    const progress: number[] = [];

    const files = await receiveYmodemBatch(
      async (bytes) => {
        controls.push(...bytes);
        return bytes.length;
      },
      receiver,
      ({ receivedBytes }) => progress.push(receivedBytes),
      new AbortController().signal,
    );

    expect(files).toEqual([
      { name: "firmware.bin", bytes: Uint8Array.of(1, 2, 3) },
    ]);
    expect(progress).toEqual([3]);
    expect(controls).toEqual([
      0x43,
      0x06,
      0x43,
      0x06,
      0x15,
      0x06,
      0x43,
      0x06,
    ]);
  });

  it("parses and sanitizes metadata paths", () => {
    const metadata = parseYmodemMetadata(
      createMetadataPayload(
        namedFile("../folder/device?.bin", Uint8Array.of(1, 2)),
      ),
    );
    expect(metadata).toEqual({ name: "device_.bin", size: 2 });
    expect(sanitizeYmodemFileName("C:\\temp\\update.bin")).toBe(
      "update.bin",
    );
  });

  it("sends cancellation when metadata exceeds the safe limit", async () => {
    const payload = new Uint8Array(128);
    payload.set(new TextEncoder().encode("huge.bin\u0000536870913\u0000"));
    const header = createXmodemFrame(0, payload);
    const controls: number[] = [];

    await expect(
      receiveYmodemBatch(
        async (bytes) => {
          controls.push(...bytes);
          return bytes.length;
        },
        new ScriptedReceiver([...header]),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("512 MiB");
    expect(controls.slice(-2)).toEqual([0x18, 0x18]);
  });

  it("interoperates with the built-in sender for a multi-file batch", async () => {
    const senderInput = new AsyncByteQueue();
    const receiverInput = new AsyncByteQueue();
    const files = [
      namedFile("result.bin", Uint8Array.of(1, 2, 3)),
      namedFile("result.bin", Uint8Array.of(4, 5)),
    ];
    const abort = new AbortController();

    const [sentBytes, received] = await Promise.all([
      sendYmodemBatch(
        files,
        async (bytes) => {
          receiverInput.push(bytes);
          return bytes.length;
        },
        senderInput,
        () => undefined,
        abort.signal,
      ),
      receiveYmodemBatch(
        async (bytes) => {
          senderInput.push(bytes);
          return bytes.length;
        },
        receiverInput,
        () => undefined,
        abort.signal,
      ),
    ]);

    expect(sentBytes).toBe(5);
    expect(received).toEqual([
      { name: "result.bin", bytes: Uint8Array.of(1, 2, 3) },
      { name: "result (2).bin", bytes: Uint8Array.of(4, 5) },
    ]);
  });
});
