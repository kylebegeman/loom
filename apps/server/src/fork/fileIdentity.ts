import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

/**
 * Converts a stat `dev` or `ino` to the number ownership receipts store. Effect reports exact
 * bigints while older receipts hold JSON numbers; a value past the safe integer range returns null,
 * so ownership checks treat it as unproven instead of matching a rounded number.
 */
export const exactFileId = (value: bigint): number | null =>
  value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;

/** The device and inode of a stat result in receipt form; either may be null when unproven. */
export const fileIdentity = (info: FileSystem.File.Info) => ({
  device: exactFileId(info.dev),
  inode: Option.match(info.ino, { onNone: () => null, onSome: exactFileId }),
});
