import ZmodemPackage from "zmodem.js";
import { sanitizeYmodemFileName } from "./ymodemReceive";

export type ZmodemRole = "send" | "receive";

interface ZmodemDetection {
  confirm(): ZmodemSession;
  deny(): void;
  get_session_role(): ZmodemRole;
}

interface ZmodemTransfer {
  end(bytes?: Uint8Array): Promise<void>;
  get_offset(): number;
  send(bytes: Uint8Array): void;
}

interface ZmodemOffer {
  accept(): Promise<Array<Uint8Array | number[]>>;
  get_details(): {
    name: string;
    size?: number | null;
    files_remaining?: number | null;
    bytes_remaining?: number | null;
  };
  on(event: "input", handler: (bytes: number[]) => void): ZmodemOffer;
  skip(): void;
}

export interface ZmodemSession {
  abort(): void;
  close(): Promise<void>;
  on(
    event: "offer" | "session_end",
    handler: ((offer: ZmodemOffer) => void) | (() => void),
  ): ZmodemSession;
  send_offer(details: {
    name: string;
    size: number;
    mtime: Date;
    files_remaining: number;
    bytes_remaining: number;
  }): Promise<ZmodemTransfer | undefined>;
  start(): void;
}

interface ZmodemSentry {
  consume(bytes: number[]): void;
}

interface ZmodemApi {
  Sentry: new (options: {
    to_terminal: (bytes: number[]) => void;
    sender: (bytes: number[]) => void;
    on_detect: (detection: ZmodemDetection) => void;
    on_retract: () => void;
  }) => ZmodemSentry;
}

const Zmodem = ZmodemPackage as ZmodemApi;
const MAX_ZMODEM_FILE_SIZE = 512 * 1024 * 1024;
const MAX_ZMODEM_BATCH_SIZE = 512 * 1024 * 1024;
const DETECTION_TIMEOUT_MS = 60_000;
const READ_CHUNK_SIZE = 64 * 1024;

export interface ZmodemProgress {
  fileName: string;
  fileIndex: number;
  fileCount?: number;
  transferredBytes: number;
  fileSize: number;
}

export interface ReceivedZmodemFile {
  name: string;
  bytes: Uint8Array;
}

interface SessionWaiter {
  expectedRole: ZmodemRole;
  resolve: (session: ZmodemSession) => void;
  reject: (error: Error) => void;
  timer: number;
  abort: () => void;
}

export class ZmodemSentryBridge {
  private readonly sentry: ZmodemSentry;
  private readonly terminalBytes: number[] = [];
  private sendChain: Promise<void> = Promise.resolve();
  private sendError?: Error;
  private readonly failurePromise: Promise<never>;
  private rejectFailure!: (error: Error) => void;
  private waiter?: SessionWaiter;
  private session?: ZmodemSession;

  constructor(
    private readonly sendBytes: (bytes: Uint8Array) => Promise<number>,
  ) {
    this.failurePromise = new Promise((_, reject) => {
      this.rejectFailure = reject;
    });
    void this.failurePromise.catch(() => undefined);
    this.sentry = new Zmodem.Sentry({
      to_terminal: (bytes) => this.terminalBytes.push(...bytes),
      sender: (bytes) => this.enqueueSend(bytes),
      on_detect: (detection) => this.handleDetection(detection),
      on_retract: () => undefined,
    });
  }

  consume(bytes: number[] | Uint8Array): Uint8Array {
    this.terminalBytes.length = 0;
    try {
      this.sentry.consume(Array.from(bytes));
    } catch (error) {
      this.fail(toError(error, "ZModem 协议解析失败。"));
    }
    return Uint8Array.from(this.terminalBytes);
  }

  waitForSession(
    expectedRole: ZmodemRole,
    signal: AbortSignal,
    timeoutMs = DETECTION_TIMEOUT_MS,
  ): Promise<ZmodemSession> {
    if (this.waiter || this.session) {
      return Promise.reject(new Error("ZModem 会话已经在等待或运行。"));
    }
    if (signal.aborted) return Promise.reject(cancelledError());
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.session?.abort();
        this.clearWaiter();
        reject(cancelledError());
      };
      this.waiter = {
        expectedRole,
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.clearWaiter();
          reject(
            new Error(
              expectedRole === "send"
                ? "等待远端 rz 启动 ZModem 接收超时。"
                : "等待远端 sz 启动 ZModem 发送超时。",
            ),
          );
        }, timeoutMs),
        abort: () => signal.removeEventListener("abort", onAbort),
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async flush(): Promise<void> {
    await this.sendChain;
    if (this.sendError) throw this.sendError;
  }

  guard<T>(operation: Promise<T>): Promise<T> {
    return Promise.race([operation, this.failurePromise]);
  }

  abort(): void {
    try {
      this.session?.abort();
    } catch {
      // A completed or already-aborted session needs no further action.
    }
    this.fail(cancelledError());
  }

  private enqueueSend(bytes: number[]): void {
    const payload = Uint8Array.from(bytes);
    this.sendChain = this.sendChain
      .then(async () => {
        const written = await this.sendBytes(payload);
        if (written !== payload.length) {
          throw new Error(
            `ZModem 仅写入 ${written}/${payload.length} 字节。`,
          );
        }
      })
      .catch((error) => {
        this.sendError = toError(error, "ZModem 写入失败。");
        this.fail(this.sendError);
      });
  }

  private handleDetection(detection: ZmodemDetection): void {
    const waiter = this.waiter;
    if (!waiter) {
      detection.deny();
      return;
    }
    const role = detection.get_session_role();
    if (role !== waiter.expectedRole) {
      detection.deny();
      this.fail(
        new Error(
          waiter.expectedRole === "send"
            ? "检测到远端正在发送文件；当前操作需要远端运行 rz。"
            : "检测到远端正在接收文件；当前操作需要远端运行 sz。",
        ),
      );
      return;
    }
    try {
      this.session = detection.confirm();
      this.clearWaiter();
      waiter.resolve(this.session);
    } catch (error) {
      this.fail(toError(error, "无法确认 ZModem 会话。"));
    }
  }

  private fail(error: Error): void {
    const waiter = this.waiter;
    this.clearWaiter();
    waiter?.reject(error);
    this.rejectFailure(error);
  }

  private clearWaiter(): void {
    if (!this.waiter) return;
    window.clearTimeout(this.waiter.timer);
    this.waiter.abort();
    this.waiter = undefined;
  }
}

export async function sendZmodemFiles(
  session: ZmodemSession,
  files: File[],
  onProgress: (progress: ZmodemProgress) => void,
  signal: AbortSignal,
): Promise<number> {
  if (files.length === 0) throw new Error("请选择至少一个 ZModem 文件。");
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_ZMODEM_BATCH_SIZE) {
    throw new Error("ZModem 批次总大小超出 512 MiB 限制。");
  }
  let transferredTotal = 0;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    throwIfCancelled(signal, session);
    const file = files[fileIndex];
    if (file.size > MAX_ZMODEM_FILE_SIZE) {
      throw new Error(`ZModem 文件“${file.name}”超过 512 MiB。`);
    }
    const bytesRemaining = files
      .slice(fileIndex)
      .reduce((sum, item) => sum + item.size, 0);
    const transfer = await session.send_offer({
      name: sanitizeYmodemFileName(file.name),
      size: file.size,
      mtime: new Date(file.lastModified),
      files_remaining: files.length - fileIndex,
      bytes_remaining: bytesRemaining,
    });
    if (!transfer) continue;

    let offset = Math.min(transfer.get_offset(), file.size);
    let ended = false;
    while (offset < file.size) {
      throwIfCancelled(signal, session);
      const end = Math.min(file.size, offset + READ_CHUNK_SIZE);
      const chunk = new Uint8Array(
        await readBlobAsArrayBuffer(file.slice(offset, end)),
      );
      if (end === file.size) {
        await transfer.end(chunk);
        ended = true;
      } else {
        transfer.send(chunk);
      }
      transferredTotal += chunk.length;
      offset = end;
      onProgress({
        fileName: file.name,
        fileIndex,
        fileCount: files.length,
        transferredBytes: offset,
        fileSize: file.size,
      });
    }
    if (!ended) await transfer.end();
  }
  await session.close();
  return transferredTotal;
}

export function receiveZmodemFiles(
  session: ZmodemSession,
  onProgress: (progress: ZmodemProgress) => void,
  signal: AbortSignal,
): Promise<ReceivedZmodemFile[]> {
  return new Promise((resolve, reject) => {
    const files: ReceivedZmodemFile[] = [];
    const usedNames = new Set<string>();
    const pending = new Set<Promise<void>>();
    let declaredBatchSize = 0;
    let receivedBatchSize = 0;
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try {
        session.abort();
      } catch {
        // The session may already have ended.
      }
      reject(toError(error, "ZModem 文件接收失败。"));
    };
    const onAbort = () => fail(cancelledError());
    signal.addEventListener("abort", onAbort, { once: true });

    session.on("offer", (offer: ZmodemOffer) => {
      const task = (async () => {
        const details = offer.get_details();
        const size =
          typeof details.size === "number" && Number.isSafeInteger(details.size)
            ? details.size
            : null;
        if (size !== null && (size < 0 || size > MAX_ZMODEM_FILE_SIZE)) {
          offer.skip();
          throw new Error("ZModem 文件大小超出 512 MiB 限制。");
        }
        if (size !== null) {
          declaredBatchSize += size;
          if (declaredBatchSize > MAX_ZMODEM_BATCH_SIZE) {
            offer.skip();
            throw new Error("ZModem 批次总大小超出 512 MiB 限制。");
          }
        }
        const name = uniqueFileName(
          sanitizeYmodemFileName(details.name),
          usedNames,
        );
        let receivedBytes = 0;
        offer.on("input", (bytes) => {
          receivedBytes += bytes.length;
          if (receivedBytes > MAX_ZMODEM_FILE_SIZE) {
            fail(new Error("ZModem 文件数据超出 512 MiB 限制。"));
            return;
          }
          onProgress({
            fileName: name,
            fileIndex: files.length,
            fileCount: details.files_remaining ?? undefined,
            transferredBytes: receivedBytes,
            fileSize: size ?? Math.max(1, receivedBytes),
          });
        });
        const payloads = await offer.accept();
        const bytes = concatenatePayloads(payloads);
        receivedBatchSize += bytes.length;
        if (receivedBatchSize > MAX_ZMODEM_BATCH_SIZE) {
          throw new Error("ZModem 批次总数据超出 512 MiB 限制。");
        }
        if (size !== null && bytes.length !== size) {
          throw new Error(
            `ZModem 文件“${name}”大小不匹配：收到 ${bytes.length}/${size} 字节。`,
          );
        }
        files.push({ name, bytes });
      })();
      pending.add(task);
      void task
        .catch(fail)
        .finally(() => pending.delete(task));
    });
    session.on("session_end", () => {
      void Promise.all([...pending])
        .then(() => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(files);
        })
        .catch(fail);
    });

    try {
      session.start();
    } catch (error) {
      fail(error);
    }
  });
}

export function concatenatePayloads(
  payloads: Array<Uint8Array | number[]>,
): Uint8Array {
  const length = payloads.reduce((sum, payload) => sum + payload.length, 0);
  if (length > MAX_ZMODEM_FILE_SIZE) {
    throw new Error("ZModem 文件数据超出 512 MiB 限制。");
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const payload of payloads) {
    result.set(payload, offset);
    offset += payload.length;
  }
  return result;
}

function throwIfCancelled(
  signal: AbortSignal,
  session: ZmodemSession,
): void {
  if (!signal.aborted) return;
  session.abort();
  throw cancelledError();
}

function cancelledError(): Error {
  return new Error("ZModem 文件传输已取消。");
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error(fallback);
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

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件。"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}
