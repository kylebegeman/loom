import type { LibraryRecoveryMetadata } from "@t3tools/contracts/fork";

export const MAX_LIBRARY_RECOVERY_BYTES = 4 * 1024 ** 3;
const RECOVERY_DISK_RESERVE_BYTES = 64 * 1024 ** 2;
const RECOVERY_PROGRESS_INTERVAL_BYTES = 64 * 1024 ** 2;

/** Recovery receipts and device capacity are checked before allocating a local file. */
export function assertLibraryRecoveryCapacity(
  recovery: Pick<LibraryRecoveryMetadata, "sha256" | "byteLength">,
  availableBytes: number,
) {
  if (
    !/^[a-f0-9]{64}$/.test(recovery.sha256) ||
    !Number.isSafeInteger(recovery.byteLength) ||
    recovery.byteLength <= 0 ||
    recovery.byteLength > MAX_LIBRARY_RECOVERY_BYTES
  )
    throw new Error("This recovery archive has invalid metadata or exceeds the 4 GiB limit.");
  if (
    !Number.isFinite(availableBytes) ||
    availableBytes < recovery.byteLength + RECOVERY_DISK_RESERVE_BYTES
  )
    throw new Error("Free more space on this device before downloading the recovery archive.");
}

/** Verify each streamed chunk before allowing a complete archive to be saved or shared. */
export async function streamLibraryRecovery(input: {
  readonly body: ReadableStream<Uint8Array>;
  readonly destination: WritableStream<Uint8Array>;
  readonly recovery: Pick<LibraryRecoveryMetadata, "sha256" | "byteLength">;
  readonly signal: AbortSignal;
  readonly onProgress?: (bytes: number) => void;
}) {
  const { createSha256 } = await import("@t3tools/shared/sha256");
  const hash = createSha256();
  let bytes = 0;
  let reportedBytes = 0;
  try {
    await input.body
      .pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > input.recovery.byteLength || bytes > MAX_LIBRARY_RECOVERY_BYTES)
              throw new Error("The recovery download exceeds its recorded size. Try again.");
            hash.update(chunk);
            controller.enqueue(chunk);
            if (bytes - reportedBytes >= RECOVERY_PROGRESS_INTERVAL_BYTES) {
              reportedBytes = bytes;
              input.onProgress?.(bytes);
            }
          },
          flush() {
            if (bytes !== input.recovery.byteLength)
              throw new Error("The recovery download is incomplete. Try again.");
            const digest = Array.from(hash.digest(), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
            if (digest !== input.recovery.sha256)
              throw new Error(
                "The recovery download does not match its saved checksum. Try again.",
              );
            input.onProgress?.(bytes);
          },
        }),
      )
      .pipeTo(input.destination, { signal: input.signal });
  } finally {
    hash.destroy();
  }
}
