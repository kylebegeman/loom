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
    if (!authority.authorityId || !status.data || busy) return;
    setBusy(true);
    setError(null);
    try {
      let released = status.data.copy;
      if (released.state !== "released" && released.registered !== false) {
        if (!status.data.reviewToken) return;
        const result = await remove({
          environmentId: copy.environmentId,
          input: {
            requestId: requestIds.current.release,
            workingCopyId: copy.id,
            reviewToken: status.data.reviewToken,
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        released = result.value;
      }
      const result = await register({
        environmentId: authority.authorityId,
        input: { requestId: requestIds.current.register, copy: released },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onReleased();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove this working copy. Refresh its status and try again.",
      );
      status.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={copy.ownership === "borrowed" ? "Remove folder registration" : "Remove working copy"}
      description={
        copy.ownership === "borrowed"
          ? "Remove this folder from choices for new work. Files and existing conversations keep working on this computer. The project and saved history stay in your Library."
          : "Remove the managed files on this computer. The project, resources and saved conversations stay in your Library."
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
                ? "Remove registration"
                : "Remove working copy"}
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
              ? "Checking the folder registration..."
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
