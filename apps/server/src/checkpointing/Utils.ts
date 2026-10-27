import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result"; // fork: library-projects
import { CheckpointRef, ThreadId } from "@t3tools/contracts"; // fork: library-projects

const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Base64Url.encode(threadId)}/turn/${turnCount}`,
  );
}

// fork: library-projects
export function threadIdFromCheckpointRef(checkpointRef: CheckpointRef): ThreadId | undefined {
  const encoded = /^refs\/t3\/checkpoints\/([^/]+)\/turn\/\d+$/.exec(checkpointRef)?.[1];
  if (encoded === undefined) return undefined;
  const decoded = Base64Url.decodeString(encoded);
  return Result.isSuccess(decoded) && decoded.success !== ""
    ? ThreadId.make(decoded.success)
    : undefined;
}
