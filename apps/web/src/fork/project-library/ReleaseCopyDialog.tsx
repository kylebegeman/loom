import { randomUUID } from "~/lib/utils";
import { useRef, useState } from "react";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";
import { LibraryDialog, LibraryErrorNotice } from "./LibraryControls";

export function ReleaseCopyDialog({
  copy,
  onReleased,
  onClose,
}: {
  readonly copy: LibraryWorkingCopy;
  readonly onReleased: () => void;
  readonly onClose: () => void;
}) {
  const authority = useLibraryAuthority();
  const host = authority.environments.find((entry) => entry.environmentId === copy.environmentId);
  const status = useEnvironmentQuery(
    projectLibrary.copyStatus({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id },
    }),
  );
  const borrowed = copy.ownership === "borrowed";
  const removeCommand = borrowed ? projectLibrary.unregisterCopy : projectLibrary.releaseCopy;
  const remove = useAtomCommand(removeCommand, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const allowed = useLibraryPermission(removeCommand, copy.environmentId);
  const canRegister = useLibraryPermission(projectLibrary.registerCopy, authority.authorityId);
  const requestIds = useRef({ release: randomUUID(), register: randomUUID() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const authorityId = authority.authorityId;
    const data = status.data;
    if (!authorityId || !data || busy) return;
    setBusy(true);
    setError(null);
    const releaseCopy = async () => {
      let released = data.copy;
      if (released.state !== "released" && released.registered !== false) {
        if (!data.reviewToken) return;
        const result = await remove({
          environmentId: copy.environmentId,
          input: {
            requestId: requestIds.current.release,
            workingCopyId: copy.id,
            reviewToken: data.reviewToken,
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        released = result.value;
      }
      const result = await register({
        environmentId: authorityId,
        input: { requestId: requestIds.current.register, copy: released },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onReleased();
    };
    try {
      await releaseCopy();
    } catch (cause) {
      const handleFailure = async () => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not remove these files. Refresh their status and try again.",
        );
        status.refresh();
      };
      await handleFailure().finally(() => setBusy(false));
      return;
    }
    setBusy(false);
  };
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={copy.ownership === "borrowed" ? "Stop using this folder?" : "Remove files"}
      description={
        copy.ownership === "borrowed"
          ? "This existing folder stays on disk. It will no longer be offered for new work in this project. Your project and conversations stay available."
          : "Save a recovery archive, then remove these files from this computer. Your project and conversations stay available. Starting work again restores its files."
      }
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={
              busy ||
              !allowed ||
              !canRegister ||
              !authority.connected ||
              host?.connection.phase !== "connected" ||
              status.isPending ||
              (!status.data?.reviewToken &&
                status.data?.copy.state !== "released" &&
                status.data?.copy.registered !== false)
            }
            onClick={() => void submit()}
          >
            {busy
              ? "Removing..."
              : copy.ownership === "borrowed"
                ? "Stop using folder"
                : "Remove files"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="break-words text-sm">
          {host?.label ?? "Computer unavailable"}: {copy.rootPath}
        </p>
        {status.isPending ? (
          <p className="text-sm text-muted-foreground">
            {borrowed
              ? "Checking this folder..."
              : "Checking for active conversations and local changes..."}
          </p>
        ) : null}
        {!borrowed && status.data?.blockers.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {status.data.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
        <LibraryErrorNotice error={status.error} onRetry={status.refresh} />
        <LibraryErrorNotice error={error} />
      </div>
    </LibraryDialog>
  );
}
