import { describe, expect, it } from "vitest";
import {
  AsyncByteQueue,
  crc16Xmodem,
  createXmodemFrame,
  receiveXmodemCrc,
  sendXmodemCrc,
  trimXmodemPadding,
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

describe("XModem-CRC receiver", () => {
  it("receives a CRC frame, trims SUB padding, and acknowledges EOT", async () => {
    const frame = createXmodemFrame(1, Uint8Array.of(1, 2, 3));
    const controls: number[] = [];
    const progress: number[] = [];

    const bytes = await receiveXmodemCrc(
      async (value) => {
        controls.push(...value);
        return value.length;
      },
      new ScriptedReceiver([...frame, 0x04]),
      (received) => progress.push(received),
      new AbortController().signal,
    );

    expect(bytes).toEqual(Uint8Array.of(1, 2, 3));
    expect(controls).toEqual([0x43, 0x06, 0x06]);
    expect(progress).toEqual([128, 3]);
  });

  it("requests a retry for a corrupted frame without duplicating data", async () => {
    const frame = createXmodemFrame(1, Uint8Array.of(7, 8));
    const corrupted = frame.slice();
    corrupted[corrupted.length - 1] ^= 0xff;
    const controls: number[] = [];

    const bytes = await receiveXmodemCrc(
      async (value) => {
        controls.push(...value);
        return value.length;
      },
      new ScriptedReceiver([
        ...corrupted,
        ...frame,
        ...frame,
        0x04,
      ]),
      () => undefined,
      new AbortController().signal,
    );

    expect(bytes).toEqual(Uint8Array.of(7, 8));
    expect(controls).toEqual([0x43, 0x15, 0x06, 0x06, 0x06]);
  });

  it("interoperates with the built-in sender", async () => {
    const senderInput = new AsyncByteQueue();
    const receiverInput = new AsyncByteQueue();
    const abort = new AbortController();

    const [sent, received] = await Promise.all([
      sendXmodemCrc(
        new Blob([Uint8Array.of(0x10, 0x20, 0x30)]),
        async (bytes) => {
          receiverInput.push(bytes);
          return bytes.length;
        },
        senderInput,
        () => undefined,
        abort.signal,
      ),
      receiveXmodemCrc(
        async (bytes) => {
          senderInput.push(bytes);
          return bytes.length;
        },
        receiverInput,
        () => undefined,
        abort.signal,
      ),
    ]);

    expect(sent).toBe(3);
    expect(received).toEqual(Uint8Array.of(0x10, 0x20, 0x30));
  });

  it("only trims conventional trailing padding", () => {
    expect(trimXmodemPadding(Uint8Array.of(1, 0x1a, 0x1a))).toEqual(
      Uint8Array.of(1),
    );
    expect(trimXmodemPadding(Uint8Array.of(0x1a, 2))).toEqual(
      Uint8Array.of(0x1a, 2),
    );
  });
});
