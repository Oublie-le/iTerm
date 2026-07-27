import { describe, expect, it, vi } from "vitest";
import {
  concatenatePayloads,
  receiveZmodemFiles,
  sendZmodemFiles,
  type ZmodemSession,
} from "./zmodem";

function namedFile(name: string, bytes: Uint8Array): File {
  return new File([bytes.buffer as ArrayBuffer], name, { lastModified: 0 });
}

describe("ZModem transfer helpers", () => {
  it("sends an offered file, reports progress, and closes the session", async () => {
    const sent: number[] = [];
    const transfer = {
      get_offset: () => 0,
      send: vi.fn((bytes: Uint8Array) => sent.push(...bytes)),
      end: vi.fn(async (bytes?: Uint8Array) => {
        if (bytes) sent.push(...bytes);
      }),
    };
    const session = {
      send_offer: vi.fn(async () => transfer),
      close: vi.fn(async () => undefined),
      abort: vi.fn(),
    } as unknown as ZmodemSession;
    const progress: number[] = [];

    const count = await sendZmodemFiles(
      session,
      [namedFile("../firmware.bin", Uint8Array.of(1, 2, 3))],
      ({ transferredBytes }) => progress.push(transferredBytes),
      new AbortController().signal,
    );

    expect(count).toBe(3);
    expect(sent).toEqual([1, 2, 3]);
    expect(progress).toEqual([3]);
    expect(transfer.end).toHaveBeenCalledOnce();
    expect(session.send_offer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "firmware.bin", size: 3 }),
    );
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("receives offers, combines payloads, and renames duplicates", async () => {
    const handlers = new Map<string, (...args: never[]) => void>();
    const offers = [Uint8Array.of(1, 2), Uint8Array.of(3)].map(
      (bytes) => {
        const inputHandlers: Array<(chunk: number[]) => void> = [];
        return {
          get_details: () => ({
            name: "result.bin",
            size: bytes.length,
            files_remaining: 2,
          }),
          on: (_event: string, handler: (chunk: number[]) => void) => {
            inputHandlers.push(handler);
          },
          accept: async () => {
            for (const handler of inputHandlers) handler(Array.from(bytes));
            return [bytes];
          },
          skip: vi.fn(),
        };
      },
    );
    const session = {
      on: (event: string, handler: (...args: never[]) => void) => {
        handlers.set(event, handler);
        return session;
      },
      start: () => {
        handlers.get("offer")?.(offers[0] as never);
        handlers.get("offer")?.(offers[1] as never);
        window.setTimeout(() => handlers.get("session_end")?.(), 0);
      },
      abort: vi.fn(),
    } as unknown as ZmodemSession;

    const files = await receiveZmodemFiles(
      session,
      () => undefined,
      new AbortController().signal,
    );

    expect(files).toEqual([
      { name: "result.bin", bytes: Uint8Array.of(1, 2) },
      { name: "result (2).bin", bytes: Uint8Array.of(3) },
    ]);
  });

  it("bounds concatenated receive payloads", () => {
    expect(
      concatenatePayloads([Uint8Array.of(1, 2), [3, 4]]),
    ).toEqual(Uint8Array.of(1, 2, 3, 4));
  });
});
