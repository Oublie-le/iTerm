export async function sendFileInChunks(
  file: Blob,
  sendChunk: (bytes: Uint8Array) => Promise<number>,
  onProgress: (sentBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
  chunkSize = 16 * 1024,
): Promise<number> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("文件分块大小必须是正整数。");
  }

  let sentBytes = 0;
  while (sentBytes < file.size) {
    if (signal.aborted) throw new Error("文件发送已取消。");
    const bytes = new Uint8Array(
      await readBlobAsArrayBuffer(
        file.slice(sentBytes, sentBytes + chunkSize),
      ),
    );
    if (signal.aborted) throw new Error("文件发送已取消。");
    const written = await sendChunk(bytes);
    if (written !== bytes.length) {
      throw new Error(
        `串口仅写入 ${written}/${bytes.length} 字节，文件发送已停止。`,
      );
    }
    sentBytes += written;
    onProgress(sentBytes, file.size);
  }
  return sentBytes;
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
