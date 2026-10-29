import {
  attentionRow,
  createAttentionRetryAtoms,
  supportsLoomFeature,
  type AttentionRetryTarget,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ATTENTION_RETRY_FEATURE } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentServerConfigsAtom } from "../../state/server";
import * as Dialog from "../../components/ui/Dialog";

export const attention = createAttentionRetryAtoms(connectionAtomRuntime);
export function canRetryThread(thread: EnvironmentThreadShell) {
  return (
    attentionRow(thread)?.target != null &&
    supportsLoomFeature(
      appAtomRegistry.get(environmentServerConfigsAtom).get(thread.environmentId)?.environment
        .capabilities,
      ATTENTION_RETRY_FEATURE,
    ) &&
    appAtomRegistry.get(attention.retry.permissionAtom(thread.environmentId))
  );
}
export async function retryAttentionTarget(target: AttentionRetryTarget) {
  const result = await attention.retry.run(appAtomRegistry, {
    environmentId: target.environmentId,
    input: { threadId: target.threadId, runId: target.runId, source: "mobile" },
  });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
}
export async function retryThread(thread: EnvironmentThreadShell) {
  try {
    const target = attentionRow(thread)?.target;
    if (!target || !canRetryThread(thread))
      throw new Error("This thread can no longer be retried. Open it for details.");
    await retryAttentionTarget(target);
  } catch (error) {
    Dialog.alert(
      "Could not retry run",
      error instanceof Error ? error.message : "Open the thread for details.",
    );
  }
}
