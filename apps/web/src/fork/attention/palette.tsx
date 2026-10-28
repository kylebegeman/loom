import { RefreshCwIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ATTENTION_RETRY_FEATURE } from "@t3tools/contracts/fork";
import { useQuietThreadShell } from "~/state/entities";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { attention, readRetryTarget, retryThread } from "./state";

const denied = Atom.make(false);
export function useAttentionPaletteContext(ref: ScopedThreadRef | null) {
  useQuietThreadShell(ref);
  const allowed = useAtomValue(ref ? attention.retry.permissionAtom(ref.environmentId) : denied);
  return allowed && ref !== null && readRetryTarget(ref) !== null;
}
export const attentionPaletteSource: ForkCommandPaletteSource = {
  id: ATTENTION_RETRY_FEATURE,
  items: ({ activeThreadRef, loomFeatures, canRetryFailedRun }) =>
    activeThreadRef && canRetryFailedRun && loomFeatures.includes(ATTENTION_RETRY_FEATURE)
      ? [
          {
            kind: "action",
            value: "action:loom:attention-status:retry",
            title: "Retry failed run",
            searchTerms: ["retry", "failed", "provider", "outage", "continue"],
            icon: <RefreshCwIcon className="size-4" />,
            shortcutCommand: "loom.attention-status.retry",
            run: async () => retryThread(activeThreadRef),
          },
        ]
      : [],
};
