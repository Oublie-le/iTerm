import { createXmodemFrame, type ByteReceiver } from "./xmodem";

const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const CRC_REQUEST = 0x43;
const MAX_RETRIES = 10;
const BLOCK_SIZE = 128;

export interface YmodemProgress {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  sentBytes: number;
  totalBytes: number;
}

export async function sendYmodemBatch(
  files: File[],
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  receiver: ByteReceiver,
  onProgress: (progress: YmodemProgress) => void,
  signal: AbortSignal,
): Promise<number> {
  if (files.length === 0) throw new Error("请选择至少一个 YModem 文件。");
  let totalSent = 0;
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  try {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      await requireControl(receiver, CRC_REQUEST, 60_000, signal);
      await sendFrameWithRetry(
        createXmodemFrame(0, createMetadataPayload(file)),
        sendBytes,
        receiver,
        signal,
      );
      await requireControl(receiver, CRC_REQUEST, 10_000, signal);

      let fileOffset = 0;
      let blockNumber = 1;
      while (fileOffset < file.size) {
        const payload = new Uint8Array(
          await readBlobAsArrayBuffer(
            file.slice(fileOffset, Math.min(file.size, fileOffset + BLOCK_SIZE)),
          ),
        );
        await sendFrameWithRetry(
          createXmodemFrame(blockNumber, payload),
          sendBytes,
          receiver,
          signal,
        );
        fileOffset += payload.length;
        totalSent += payload.length;
        blockNumber = (blockNumber + 1) & 0xff;
        onProgress({
          fileName: file.name,
          fileIndex,
          fileCount: files.length,
          sentBytes: totalSent,
          totalBytes,
        });
      }
      await finishFile(sendBytes, receiver, signal);
    }

    await requireControl(receiver, CRC_REQUEST, 10_000, signal);
    await sendFrameWithRetry(
      createXmodemFrame(0, new Uint8Array(BLOCK_SIZE)),
      sendBytes,
      receiver,
      signal,
    );
    return totalSent;
  } catch (error) {
    await sendBytes(Uint8Array.of(CAN, CAN)).catch(() => 0);
    throw error;
  }
}

export function createMetadataPayload(file: File): Uint8Array {
  const safeName = file.name.split(/[\\/]/).at(-1)?.trim() ?? "";
  if (!safeName) throw new Error("YModem 文件名不能为空。");
  const name = new TextEncoder().encode(safeName);
  const size = new TextEncoder().encode(file.size.toString());
  if (name.length + size.length + 2 > BLOCK_SIZE) {
    throw new Error(`YModem 文件名“${safeName}”过长。`);
  }
  const payload = new Uint8Array(BLOCK_SIZE);
  payload.set(name);
  payload[name.length] = 0;
  payload.set(size, name.length + 1);
  payload[name.length + 1 + size.length] = 0;
  return payload;
}

async function sendFrameWithRetry(
  frame: Uint8Array,
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  receiver: ByteReceiver,
  signal: AbortSignal,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await writeComplete(sendBytes, frame);
    const response = await waitForControl(
      receiver,
      new Set([ACK, NAK, CAN]),
      10_000,
      signal,
    );
    if (response === ACK) return;
    if (response === CAN) throw new Error("YModem 接收端取消了传输。");
  }
  throw new Error(`YModem 数据块重试 ${MAX_RETRIES} 次后仍未收到 ACK。`);
}

async function finishFile(
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  receiver: ByteReceiver,
  signal: AbortSignal,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await writeComplete(sendBytes, Uint8Array.of(EOT));
    const response = await waitForControl(
      receiver,
      new Set([ACK, NAK, CAN]),
      10_000,
      signal,
    );
    if (response === ACK) return;
    if (response === CAN) throw new Error("YModem 接收端取消了传输。");
  }
  throw new Error("YModem 文件结束握手失败。");
}

async function requireControl(
  receiver: ByteReceiver,
  expected: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  const response = await waitForControl(
    receiver,
    new Set([expected, CAN]),
    timeoutMs,
    signal,
  );
  if (response === CAN) throw new Error("YModem 接收端取消了传输。");
}

async function waitForControl(
  receiver: ByteReceiver,
  accepted: Set<number>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal.aborted) throw new Error("YModem 文件发送已取消。");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("等待 YModem 接收端响应超时。");
    const byte = await receiver.readByte(remaining, signal);
    if (accepted.has(byte)) return byte;
  }
}

async function writeComplete(
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  bytes: Uint8Array,
): Promise<void> {
  const written = await sendBytes(bytes);
  if (written !== bytes.length) {
    throw new Error(`YModem 仅写入 ${written}/${bytes.length} 字节。`);
  }
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
