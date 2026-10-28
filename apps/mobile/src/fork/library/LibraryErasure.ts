import { useAtomValue } from "@effect/atom-react";
import { LIBRARY_DELETED_FEATURE } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { library, useLibraryAuthority, useLoomFeature } from "./libraryState";

export function useLibraryErasure(archiveId: string, onErased: () => void, onRefresh: () => void) {
  const authority = useLibraryAuthority();
  const supported = useLoomFeature(authority.environmentId, LIBRARY_DELETED_FEATURE);
  const allowed = useAtomValue(library.eraseConversation.permissionAtom(authority.environmentId));
  const erase = useAtomCommand(library.eraseConversation, { reportFailure: false });
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const available = supported && allowed && authority.ready;
  const run = async () => {
    if (!available || !authority.environmentId || inFlight.current) return;
    // The Library saves the receipt before file cleanup, so retries reuse it.
    requestId.current ??= uuidv4();
    inFlight.current = true;
    setAttempted(true);
    setBusy(true);
    setError(null);
    await erase({
      environmentId: authority.environmentId,
      input: { id: archiveId, requestId: requestId.current },
    })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        onErased();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Erasure did not finish. Retry to finish removing the saved files.",
        );
        onRefresh();
      })
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  return {
    supported,
    available,
    attempted,
    busy,
    error,
    retry: () => void run(),
    confirm: (title: string) =>
      Dialog.confirm({
        title: "Erase saved conversation?",
        message: `Erase “${title}” from your Library, including its history and attachments? This cannot be undone.`,
        confirmText: "Erase now",
        destructive: true,
        onConfirm: () => void run(),
      }),
  };
}
