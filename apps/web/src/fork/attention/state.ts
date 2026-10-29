import {
  attentionRow,
  createAttentionRetryAtoms,
  supportsLoomFeature,
  type AttentionRetryTarget,
} from "@t3tools/client-runtime/fork";
import { ATTENTION_RETRY_FEATURE } from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadShells } from "~/state/threads";
import { environmentServerConfigsAtom } from "~/state/server";
import { toastManager } from "~/components/ui/toast";

export const attention = createAttentionRetryAtoms(connectionAtomRuntime);

export function readRetryTarget(ref: ScopedThreadRef) {
  if (
    !supportsLoomFeature(
      appAtomRegistry.get(environmentServerConfigsAtom).get(ref.environmentId)?.environment
        .capabilities,
      ATTENTION_RETRY_FEATURE,
    ) ||
    !appAtomRegistry.get(attention.retry.permissionAtom(ref.environmentId))
  )
    return null;
  const thread = appAtomRegistry
    .get(environmentThreadShells.threadShellsAtom)
    .find((thread) => thread.environmentId === ref.environmentId && thread.id === ref.threadId);
  return thread ? (attentionRow(thread)?.target ?? null) : null;
}

export async function retryAttentionTarget(target: AttentionRetryTarget) {
  const result = await attention.retry.run(appAtomRegistry, {
    environmentId: target.environmentId,
    input: { threadId: target.threadId, runId: target.runId },
  });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
}

export async function retryThread(ref: ScopedThreadRef) {
  const target = readRetryTarget(ref);
  try {
    if (!target) throw new Error("This thread can no longer be retried. Open it for details.");
    await retryAttentionTarget(target);
    toastManager.add({ type: "success", title: "Run retried" });
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Could not retry run",
      description: error instanceof Error ? error.message : "Open the thread for details.",
    });
  }
}
