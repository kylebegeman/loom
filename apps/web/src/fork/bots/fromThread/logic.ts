import type { ExecutionEnvironmentCapabilities, ScopedThreadRef } from "@t3tools/contracts";
import {
  supportsLoomFeature,
  saveInputFromDraft,
  type BotDraft,
} from "@t3tools/client-runtime/fork";
import {
  BOTS_FROM_THREAD_FEATURE,
  isBotRunThreadId,
  type BotDefinitionInput,
} from "@t3tools/contracts/fork";

/**
 * Whether a thread can become a bot: its server drafts bots, it is not itself a bot run, and it
 * lives on the bots host, which is the only server that can read it.
 */
export const canSaveAsBot = (
  thread: ScopedThreadRef,
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
  botsEnvironmentId: string | null,
) =>
  thread.environmentId === botsEnvironmentId &&
  supportsLoomFeature(capabilities, BOTS_FROM_THREAD_FEATURE) &&
  !isBotRunThreadId(thread.threadId);

/** What refining sends: the editor's current draft, or the first problem to fix before refining. */
export const refineInputFromDraft = (
  draft: BotDraft,
):
  | { readonly ok: true; readonly draft: BotDefinitionInput }
  | { readonly ok: false; readonly message: string } => {
  const checked = saveInputFromDraft(draft, undefined);
  return checked.ok ? { ok: true, draft: checked.input } : checked;
};
