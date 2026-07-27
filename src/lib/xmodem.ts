const SOH = 0x01;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const CRC_REQUEST = 0x43;
const SUB = 0x1a;
const BLOCK_SIZE = 128;
const MAX_RETRIES = 10;

export interface ByteReceiver {
  readByte(timeoutMs: number, signal: AbortSignal): Promise<number>;
}

interface ByteWaiter {
  resolve: (value: number) => void;
  reject: (error: Error) => void;
  timer: number;
  abort: () => void;
}

export class AsyncByteQueue implements ByteReceiver {
  private readonly bytes: number[] = [];
  private readonly waiters: ByteWaiter[] = [];
  private closedError?: Error;

  push(bytes: number[] | Uint8Array): void {
    for (const byte of bytes) {
      const waiter = this.waiters.shift();
      if (waiter) {
        window.clearTimeout(waiter.timer);
        waiter.abort();
        waiter.resolve(byte);
      } else {
        this.bytes.push(byte);
      }
    }
  }

  readByte(timeoutMs: number, signal: AbortSignal): Promise<number> {
    const byte = this.bytes.shift();
    if (byte !== undefined) return Promise.resolve(byte);
    if (this.closedError) return Promise.reject(this.closedError);
    if (signal.aborted) return Promise.reject(cancelledError());

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.removeWaiter(waiter);
        reject(cancelledError());
      };
      const waiter: ByteWaiter = {
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new Error("等待 XModem 接收端响应超时。"));
        }, timeoutMs),
        abort: () => signal.removeEventListener("abort", onAbort),
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  close(error = new Error("文件传输接收通道已关闭。")): void {
    this.closedError = error;
    for (const waiter of this.waiters.splice(0)) {
      window.clearTimeout(waiter.timer);
      waiter.abort();
      waiter.reject(error);
    }
    this.bytes.length = 0;
  }

  private removeWaiter(waiter: ByteWaiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    window.clearTimeout(waiter.timer);
    waiter.abort();
  }
}

export async function sendXmodemCrc(
  file: Blob,
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  receiver: ByteReceiver,
  onProgress: (sentBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
): Promise<number> {
  try {
    await waitForControl(receiver, new Set([CRC_REQUEST, CAN]), 60_000, signal)
      .then((response) => {
        if (response === CAN) throw new Error("XModem 接收端取消了传输。");
      });

    let offset = 0;
    let blockNumber = 1;
    while (offset < file.size) {
      throwIfCancelled(signal);
      const payload = new Uint8Array(
        await readBlobAsArrayBuffer(
          file.slice(offset, Math.min(file.size, offset + BLOCK_SIZE)),
        ),
      );
      const frame = createXmodemFrame(blockNumber, payload);
      let acknowledged = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        await writeCompleteFrame(sendBytes, frame);
        const response = await waitForControl(
          receiver,
          new Set([ACK, NAK, CAN]),
          10_000,
          signal,
        );
        if (response === ACK) {
          acknowledged = true;
          break;
        }
        if (response === CAN) throw new Error("XModem 接收端取消了传输。");
      }
      if (!acknowledged) {
        throw new Error(
          `XModem 第 ${blockNumber} 块重试 ${MAX_RETRIES} 次后仍未收到 ACK。`,
        );
      }
      offset += payload.length;
      blockNumber = (blockNumber + 1) & 0xff;
      onProgress(offset, file.size);
    }

    let completed = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      await writeCompleteFrame(sendBytes, Uint8Array.of(EOT));
      const response = await waitForControl(
        receiver,
        new Set([ACK, NAK, CAN]),
        10_000,
        signal,
      );
      if (response === ACK) {
        completed = true;
        break;
      }
      if (response === CAN) throw new Error("XModem 接收端取消了传输。");
    }
    if (!completed) throw new Error("XModem 结束握手失败。");
    return file.size;
  } catch (error) {
    await sendBytes(Uint8Array.of(CAN, CAN)).catch(() => 0);
    throw error;
  }
}

export function createXmodemFrame(
  blockNumber: number,
  payload: Uint8Array,
): Uint8Array {
  if (payload.length > BLOCK_SIZE) {
    throw new Error("XModem 数据块不能超过 128 字节。");
  }
  const frame = new Uint8Array(3 + BLOCK_SIZE + 2);
  frame[0] = SOH;
  frame[1] = blockNumber & 0xff;
  frame[2] = 0xff - frame[1];
  frame.fill(SUB, 3, 3 + BLOCK_SIZE);
  frame.set(payload, 3);
  const crc = crc16Xmodem(frame.subarray(3, 3 + BLOCK_SIZE));
  frame[frame.length - 2] = crc >> 8;
  frame[frame.length - 1] = crc & 0xff;
  return frame;
}

export function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

async function waitForControl(
  receiver: ByteReceiver,
  accepted: Set<number>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    throwIfCancelled(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("等待 XModem 接收端响应超时。");
    const byte = await receiver.readByte(remaining, signal);
    if (accepted.has(byte)) return byte;
  }
}

async function writeCompleteFrame(
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  bytes: Uint8Array,
): Promise<void> {
  const written = await sendBytes(bytes);
  if (written !== bytes.length) {
    throw new Error(`XModem 仅写入 ${written}/${bytes.length} 字节。`);
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledError();
}

function cancelledError(): Error {
  return new Error("XModem 文件发送已取消。");
}

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件。"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}
