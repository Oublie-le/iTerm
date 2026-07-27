import { crc16Xmodem, type ByteReceiver } from "./xmodem";

const SOH = 0x01;
const STX = 0x02;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const CRC_REQUEST = 0x43;
const MAX_RETRIES = 10;
const MAX_FILE_SIZE = 512 * 1024 * 1024;
const MAX_BATCH_SIZE = 512 * 1024 * 1024;

export interface ReceivedYmodemFile {
  name: string;
  bytes: Uint8Array;
}

export interface YmodemReceiveProgress {
  fileName: string;
  fileIndex: number;
  receivedBytes: number;
  fileSize: number;
}

interface ReceivedFrame {
  blockNumber: number;
  payload: Uint8Array;
  valid: boolean;
}

export async function receiveYmodemBatch(
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  receiver: ByteReceiver,
  onProgress: (progress: YmodemReceiveProgress) => void,
  signal: AbortSignal,
): Promise<ReceivedYmodemFile[]> {
  const files: ReceivedYmodemFile[] = [];
  const usedNames = new Set<string>();
  let declaredBatchSize = 0;
  try {
    while (true) {
      const header = await receiveHeader(sendBytes, receiver, signal);
      if (!header) return files;
      const metadata = parseYmodemMetadata(header.payload);
      if (!metadata) {
        await writeControl(sendBytes, ACK);
        return files;
      }
      declaredBatchSize += metadata.size;
      if (declaredBatchSize > MAX_BATCH_SIZE) {
        throw new Error("YModem 批次总大小超出 512 MiB 限制。");
      }
      const name = uniqueFileName(metadata.name, usedNames);
      await writeControl(sendBytes, ACK);
      await writeControl(sendBytes, CRC_REQUEST);

      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      let expectedBlock = 1;
      while (true) {
        const item = await receiveFrameOrControl(receiver, 30_000, signal);
        if (typeof item === "number") {
          if (item === CAN) throw new Error("YModem 发送端取消了传输。");
          if (item !== EOT) continue;
          await writeControl(sendBytes, NAK);
          const secondEot = await waitForControl(
            receiver,
            new Set([EOT, CAN]),
            10_000,
            signal,
          );
          if (secondEot === CAN) {
            throw new Error("YModem 发送端取消了传输。");
          }
          await writeControl(sendBytes, ACK);
          break;
        }
        if (!item.valid) {
          await writeControl(sendBytes, NAK);
          continue;
        }
        const previousBlock = (expectedBlock - 1) & 0xff;
        if (item.blockNumber === previousBlock) {
          await writeControl(sendBytes, ACK);
          continue;
        }
        if (item.blockNumber !== expectedBlock) {
          await writeControl(sendBytes, NAK);
          continue;
        }

        const remaining = metadata.size - receivedBytes;
        const accepted = item.payload.slice(0, Math.max(0, remaining));
        if (accepted.length > 0) chunks.push(accepted);
        receivedBytes += accepted.length;
        expectedBlock = (expectedBlock + 1) & 0xff;
        await writeControl(sendBytes, ACK);
        onProgress({
          fileName: name,
          fileIndex: files.length,
          receivedBytes,
          fileSize: metadata.size,
        });
      }
      if (receivedBytes !== metadata.size) {
        throw new Error(
          `YModem 文件“${name}”大小不匹配：收到 ${receivedBytes}/${metadata.size} 字节。`,
        );
      }
      const bytes = new Uint8Array(metadata.size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      files.push({ name, bytes });
    }
  } catch (error) {
    await sendBytes(Uint8Array.of(CAN, CAN)).catch(() => 0);
    throw error;
  }
}

export function parseYmodemMetadata(
  payload: Uint8Array,
): { name: string; size: number } | null {
  const nameEnd = payload.indexOf(0);
  if (nameEnd < 0) throw new Error("YModem 元数据缺少文件名结束符。");
  if (nameEnd === 0) return null;
  const rawName = new TextDecoder().decode(payload.slice(0, nameEnd));
  const remainder = payload.slice(nameEnd + 1);
  const sizeEnd = remainder.findIndex(
    (byte) => byte === 0 || byte === 0x20,
  );
  const sizeBytes =
    sizeEnd < 0 ? remainder : remainder.slice(0, sizeEnd);
  const sizeText = new TextDecoder().decode(sizeBytes).trim();
  if (!/^\d+$/.test(sizeText)) {
    throw new Error(`YModem 文件“${rawName}”缺少有效大小。`);
  }
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE) {
    throw new Error(`YModem 文件“${rawName}”大小超出 512 MiB 限制。`);
  }
  return { name: sanitizeYmodemFileName(rawName), size };
}

export function sanitizeYmodemFileName(value: string): string {
  const baseName = value.split(/[\\/]/).at(-1)?.trim() ?? "";
  const safe = baseName
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 240);
  if (!safe || safe === "." || safe === "..") {
    throw new Error("YModem 文件名无效。");
  }
  return safe;
}

async function receiveHeader(
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  receiver: ByteReceiver,
  signal: AbortSignal,
): Promise<ReceivedFrame | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await writeControl(sendBytes, CRC_REQUEST);
    const item = await receiveFrameOrControl(receiver, 10_000, signal);
    if (typeof item === "number") {
      if (item === CAN) throw new Error("YModem 发送端取消了传输。");
      continue;
    }
    if (!item.valid || item.blockNumber !== 0) {
      await writeControl(sendBytes, NAK);
      continue;
    }
    return item;
  }
  throw new Error("YModem 元数据块重试次数已用尽。");
}

async function receiveFrameOrControl(
  receiver: ByteReceiver,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ReceivedFrame | number> {
  const lead = await waitForControl(
    receiver,
    new Set([SOH, STX, EOT, CAN]),
    timeoutMs,
    signal,
  );
  if (lead === EOT || lead === CAN) return lead;
  const payloadSize = lead === SOH ? 128 : 1_024;
  const blockNumber = await receiver.readByte(timeoutMs, signal);
  const inverse = await receiver.readByte(timeoutMs, signal);
  const payload = new Uint8Array(payloadSize);
  for (let index = 0; index < payloadSize; index += 1) {
    payload[index] = await receiver.readByte(timeoutMs, signal);
  }
  const crcHigh = await receiver.readByte(timeoutMs, signal);
  const crcLow = await receiver.readByte(timeoutMs, signal);
  const expectedCrc = (crcHigh << 8) | crcLow;
  return {
    blockNumber,
    payload,
    valid:
      ((blockNumber + inverse) & 0xff) === 0xff &&
      crc16Xmodem(payload) === expectedCrc,
  };
}

async function waitForControl(
  receiver: ByteReceiver,
  accepted: Set<number>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal.aborted) throw new Error("YModem 文件接收已取消。");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("等待 YModem 发送端响应超时。");
    const byte = await receiver.readByte(remaining, signal);
    if (accepted.has(byte)) return byte;
  }
}

async function writeControl(
  sendBytes: (bytes: Uint8Array) => Promise<number>,
  control: number,
): Promise<void> {
  const written = await sendBytes(Uint8Array.of(control));
  if (written !== 1) {
    throw new Error(`YModem 控制字节仅写入 ${written}/1 字节。`);
  }
}

function uniqueFileName(name: string, used: Set<string>): string {
  let candidate = name;
  let index = 2;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  while (used.has(candidate.toLocaleLowerCase())) {
    candidate = `${stem} (${index})${extension}`;
    index += 1;
  }
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}
