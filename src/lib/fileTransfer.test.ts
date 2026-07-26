import { describe, expect, it } from "vitest";
import { sendFileInChunks } from "./fileTransfer";

describe("sendFileInChunks", () => {
  it("waits for each complete chunk and reports progress", async () => {
    const chunks: number[][] = [];
    const progress: number[] = [];
    const controller = new AbortController();
    const file = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);

    const sent = await sendFileInChunks(
      file,
      async (bytes) => {
        chunks.push(Array.from(bytes));
        return bytes.length;
      },
      (value) => progress.push(value),
      controller.signal,
      2,
    );

    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    expect(progress).toEqual([2, 4, 5]);
    expect(sent).toBe(5);
  });

  it("stops before the next chunk when cancelled", async () => {
    const controller = new AbortController();
    let writes = 0;
    await expect(
      sendFileInChunks(
        new Blob([new Uint8Array([1, 2, 3, 4])]),
        async (bytes) => {
          writes += 1;
          controller.abort();
          return bytes.length;
        },
        () => undefined,
        controller.signal,
        2,
      ),
    ).rejects.toThrow(/已取消/);
    expect(writes).toBe(1);
  });
});
