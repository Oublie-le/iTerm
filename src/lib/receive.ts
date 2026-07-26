import type { ReceiveChunk } from "./types";

export const MAX_RECEIVE_BUFFER_BYTES = 4 * 1024 * 1024;
export const MAX_HEX_DISPLAY_BYTES = 64 * 1024;

export function appendReceiveChunk(
  chunks: ReceiveChunk[],
  chunk: ReceiveChunk,
  maxBytes = MAX_RECEIVE_BUFFER_BYTES,
): ReceiveChunk[] {
  if (maxBytes <= 0 || chunk.bytes.length === 0) return chunks;

  const next = [...chunks, chunk];
  let byteCount = next.reduce((total, item) => total + item.bytes.length, 0);

  while (next.length > 1 && byteCount > maxBytes) {
    byteCount -= next.shift()?.bytes.length ?? 0;
  }

  if (byteCount > maxBytes) {
    const only = next[0];
    return [
      {
        ...only,
        bytes: only.bytes.slice(only.bytes.length - maxBytes),
      },
    ];
  }

  return next;
}

export function formatHexDump(
  chunks: ReceiveChunk[],
  totalBytes: number,
  columns = 16,
  maxDisplayBytes = MAX_HEX_DISPLAY_BYTES,
): { text: string; omittedBytes: number } {
  const safeColumns = Math.max(1, Math.min(32, Math.trunc(columns)));
  const allBytes = chunks.flatMap((chunk) => chunk.bytes);
  const visibleBytes = allBytes.slice(-maxDisplayBytes);
  const omittedBytes = Math.max(0, totalBytes - visibleBytes.length);
  const lines: string[] = [];

  for (let index = 0; index < visibleBytes.length; index += safeColumns) {
    const row = visibleBytes.slice(index, index + safeColumns);
    const address = (omittedBytes + index).toString(16).padStart(8, "0");
    const hex = row
      .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
      .join(" ")
      .padEnd(safeColumns * 3 - 1, " ");
    const ascii = row
      .map((byte) =>
        byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
      )
      .join("");
    lines.push(`${address}  ${hex}  |${ascii}|`);
  }

  return { text: lines.join("\n"), omittedBytes };
}
