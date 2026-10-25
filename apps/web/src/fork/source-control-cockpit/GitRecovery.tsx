import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  ScopedThreadRef,
  VcsStatusResult,
  GitResolveOperationInput,
} from "@t3tools/contracts";
import { gitOperationLabel, landedBranch } from "@t3tools/client-runtime/state/vcs";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { toastManager } from "~/components/ui/toast";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { useThreadActions } from "~/hooks/useThreadActions";

export function GitRecovery({
  status,
  threadRef,
  cwd,
  worktree,
  busy,
  canWrite,
  canSettle,
  onAsk,
}: {
  status: VcsStatusResult | null;
  threadRef: ScopedThreadRef | null;
  cwd: string;
  worktree: boolean;
  busy: boolean;
  canWrite: boolean;
  canSettle: boolean;
  onAsk: () => void;
}) {
  const resolve = useAtomCommand(vcsEnvironment.resolveOperation, { reportFailure: false });
  const { settleThread } = useThreadActions();
  const permitted = useAtomValue(
    vcsEnvironment.resolveOperation.permissionAtom(threadRef?.environmentId ?? null),
  );
  const [pending, setPending] = useState<GitResolveOperationInput | null>(null);
  const [running, setRunning] = useState(false);
  const label = gitOperationLabel(status);
  const landed = landedBranch(status, worktree);
  const confirm = async () => {
    if (!pending || !threadRef || running || busy || !canWrite || !permitted) return;
    setRunning(true);
    const result = await resolve({ environmentId: threadRef.environmentId, input: pending });
    setRunning(false);
    setPending(null);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Git operation stopped",
        description: error instanceof Error ? error.message : "Refresh status and try again.",
      });
    }
  };
  if (!label && !landed) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs"
      role="status"
    >
      <span>{label ?? `Landed on ${landed}`}</span>
      {label ? (
        <>
          <Button size="xs" variant="outline" disabled={!threadRef} onClick={onAsk}>
            Ask the agent to resolve
          </Button>
          {status?.operation &&
            status.headSha &&
            (["continue", "abort"] as const).map((resolution) => (
              <Button
                key={resolution}
                size="xs"
                variant="outline"
                disabled={
                  !canWrite ||
                  !permitted ||
                  busy ||
                  running ||
                  (resolution === "continue" && (status.unmergedCount ?? 0) > 0)
                }
                onClick={() =>
                  setPending({
                    cwd,
                    expectedHead: status.headSha!,
                    operation: status.operation!,
                    resolution,
                  })
                }
              >
                {resolution === "continue" ? "Continue" : "Abort"}
              </Button>
            ))}
          {(status?.unmergedPaths?.length ?? 0) > 0 && (
            <ul className="w-full break-all">
              {status?.unmergedPaths?.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <Button
          size="xs"
          variant="outline"
          disabled={!threadRef || !canSettle || busy}
          onClick={() => {
            if (threadRef) void settleThread(threadRef);
          }}
        >
          Settle
        </Button>
      )}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !running) setPending(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {pending?.resolution === "abort" ? "Abort" : "Continue"} {pending?.operation}?
            </DialogTitle>
            <DialogDescription>
              {pending?.resolution === "abort"
                ? "Git will restore the checkout to before this operation. Conflict resolution edits may be discarded."
                : "Git will continue using the files you have already staged. This may run repository hooks or rebase steps."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={running} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={pending?.resolution === "abort" ? "destructive" : "default"}
              disabled={running || busy || !canWrite || !permitted}
              onClick={() => void confirm()}
            >
              {pending?.resolution === "abort" ? "Abort" : "Continue"} {pending?.operation}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
