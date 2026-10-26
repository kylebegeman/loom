import type { ScopedThreadRef } from "@t3tools/contracts";
import { libraryThreadSaveState } from "@t3tools/client-runtime/fork";
import { LibraryError } from "@t3tools/contracts/fork";
import { CloudOffIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary } from "./state";

/** Shown only for a conversation the Library saves whose work has not reached it. */
export function LibrarySaveIndicator({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const query = useEnvironmentQuery(
    projectLibrary.threadSaveStatus({
      environmentId: threadRef.environmentId,
      input: { threadIds: [threadRef.threadId] },
    }),
  );
  const state = libraryThreadSaveState(query.data, threadRef.threadId);
  if (state === null) return null;
  const label = state.kind === "unsaved" ? "Not saved to Library yet" : "Library copy is behind";
  const detail =
    state.kind === "unsaved"
      ? "This computer uploads this conversation to its Library project automatically. Older conversations upload one at a time."
      : `Uploads to the Library are failing. ${new LibraryError({ reason: state.reason }).message} This computer keeps retrying.`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="status" />}
        className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs"
      >
        <CloudOffIcon aria-hidden className="size-3.5" />
        <span>{label}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-72">
        {detail}
      </TooltipPopup>
    </Tooltip>
  );
}
