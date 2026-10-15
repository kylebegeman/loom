import * as NodeCrypto from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  assertLibraryRecoveryCapacity,
  MAX_LIBRARY_RECOVERY_BYTES,
  streamLibraryRecovery,
} from "./libraryRecovery";

const bytes = new TextEncoder().encode("captured Git recovery refs and working files");
const recovery = {
  sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
  byteLength: bytes.byteLength,
};

function source(chunks: readonly Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function destination() {
  const chunks: Uint8Array[] = [];
  const close = vi.fn();
  const abort = vi.fn();
  return {
    chunks,
    close,
    abort,
    stream: new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(chunk);
      },
      close,
      abort,
    }),
  };
}

describe("native recovery archive downloads", () => {
  it("rejects oversized receipts and insufficient device space before a download starts", () => {
    expect(() =>
      assertLibraryRecoveryCapacity(recovery, 64 * 1024 ** 2 + bytes.byteLength),
    ).not.toThrow();
    expect(() => assertLibraryRecoveryCapacity(recovery, bytes.byteLength)).toThrow(
      "Free more space",
    );
    expect(() =>
      assertLibraryRecoveryCapacity(
        { ...recovery, byteLength: MAX_LIBRARY_RECOVERY_BYTES + 1 },
        10 * MAX_LIBRARY_RECOVERY_BYTES,
      ),
    ).toThrow("4 GiB");
    expect(() =>
      assertLibraryRecoveryCapacity(
        { ...recovery, sha256: "bad" },
        10 * MAX_LIBRARY_RECOVERY_BYTES,
      ),
    ).toThrow("invalid metadata");
    expect(() =>
      assertLibraryRecoveryCapacity(
        { ...recovery, byteLength: 0 },
        10 * MAX_LIBRARY_RECOVERY_BYTES,
      ),
    ).toThrow("invalid metadata");
    expect(() => assertLibraryRecoveryCapacity(recovery, Number.NaN)).toThrow("Free more space");
  });
  it("writes bounded chunks and closes the destination only after checking the complete size and SHA-256", async () => {
    const sink = destination();
    const onProgress = vi.fn();
    await streamLibraryRecovery({
      body: source([bytes.subarray(0, 7), bytes.subarray(7)]),
      destination: sink.stream,
      recovery,
      signal: new AbortController().signal,
      onProgress,
    });
    expect(sink.chunks.map((chunk) => Array.from(chunk))).toEqual([
      Array.from(bytes.subarray(0, 7)),
      Array.from(bytes.subarray(7)),
    ]);
    expect(sink.close).toHaveBeenCalledOnce();
    expect(sink.abort).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(bytes.byteLength);
  });
  it.each([
    {
      downloaded: bytes.subarray(0, bytes.byteLength - 1),
      metadata: recovery,
      message: "incomplete",
    },
    {
      downloaded: bytes,
      metadata: { ...recovery, byteLength: bytes.byteLength - 1 },
      message: "exceeds its recorded size",
    },
    {
      downloaded: bytes,
      metadata: { ...recovery, sha256: "0".repeat(64) },
      message: "saved checksum",
    },
  ])("aborts the cached file on $message", async ({ downloaded, metadata, message }) => {
    const sink = destination();
    await expect(
      streamLibraryRecovery({
        body: source([downloaded]),
        destination: sink.stream,
        recovery: metadata,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(message);
    expect(sink.close).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
  });
  it("cancels the response stream and partial destination when the user stops a download", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const sink = destination();
    const controller = new AbortController();
    const task = streamLibraryRecovery({
      body,
      destination: sink.stream,
      recovery,
      signal: controller.signal,
    });
    controller.abort();
    await expect(task).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(sink.abort).toHaveBeenCalledOnce();
    expect(sink.close).not.toHaveBeenCalled();
  });
});
