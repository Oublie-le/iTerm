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
  includeTimestamps = false,
): { text: string; omittedBytes: number } {
  const safeColumns = Math.max(1, Math.min(32, Math.trunc(columns)));
  const allBytes = chunks.flatMap((chunk) =>
    chunk.bytes.map((byte) => ({
      byte,
      receivedAtMs: chunk.receivedAtMs,
    })),
  );
  const visibleBytes = allBytes.slice(-maxDisplayBytes);
  const omittedBytes = Math.max(0, totalBytes - visibleBytes.length);
  const lines: string[] = [];

  for (let index = 0; index < visibleBytes.length; index += safeColumns) {
    const row = visibleBytes.slice(index, index + safeColumns);
    const address = (omittedBytes + index).toString(16).padStart(8, "0");
    const hex = row
      .map(({ byte }) => byte.toString(16).padStart(2, "0").toUpperCase())
      .join(" ")
      .padEnd(safeColumns * 3 - 1, " ");
    const ascii = row
      .map(({ byte }) =>
        byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
      )
      .join("");
    const timestamp = includeTimestamps
      ? `${formatReceiveTimestamp(row[0].receivedAtMs)} `
      : "";
    lines.push(`${timestamp}${address}  ${hex}  |${ascii}|`);
  }

  return { text: lines.join("\n"), omittedBytes };
}

export function formatReceiveTimestamp(receivedAtMs: number): string {
  const date = new Date(receivedAtMs);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const milliseconds = date.getMilliseconds().toString().padStart(3, "0");
  return `[${hours}:${minutes}:${seconds}.${milliseconds}]`;
}

export function timestampReceivedText(
  text: string,
  receivedAtMs: number,
  startsNewLine: boolean,
): { text: string; startsNewLine: boolean } {
  if (!text) return { text, startsNewLine };

  let output = "";
  let atLineStart = startsNewLine;
  const prefix = `\u001b[38;5;244m${formatReceiveTimestamp(receivedAtMs)}\u001b[0m `;

  for (const character of text) {
    if (atLineStart) {
      output += prefix;
      atLineStart = false;
    }
    output += character;
    if (character === "\n") atLineStart = true;
  }

  return { text: output, startsNewLine: atLineStart };
}
