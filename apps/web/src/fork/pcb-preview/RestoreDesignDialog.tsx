import { useEffect, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbHistoryRestorePlan,
  PcbHistoryRestoreResult,
  PcbHistoryVersion,
} from "@t3tools/contracts/fork";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { pcb } from "./state";
import { runModelCommand } from "../model-preview-3d/state";
import { errorMessage } from "./usePcbPreview";
export function RestoreDesignDialog({
  threadRef,
  designId,
  version,
  contentKey,
  threadRunning,
  onClose,
  onRestored,
  onConflict,
}: {
  threadRef: ScopedThreadRef;
  designId: string;
  version: PcbHistoryVersion;
  contentKey: string | null;
  threadRunning: boolean;
  onClose: () => void;
  onRestored: (result: PcbHistoryRestoreResult) => void;
  onConflict: () => void;
}) {
  const [plan, setPlan] = useState<PcbHistoryRestorePlan | null>(null);
  const [supporting, setSupporting] = useState(false),
    [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void runModelCommand(pcb.historyRestore, {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        designId,
        checkpointId: version.checkpointId,
        expectedContentKey: contentKey,
        includeSupporting: false,
        removeAdded: false,
        dryRun: true,
      },
    })
      .then((result) => {
        if (active) setPlan(result.plan);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [threadRef.environmentId, threadRef.threadId, designId, version.checkpointId, contentKey]);
  const restore = async () => {
    setBusy(true);
    setError(null);
    await runModelCommand(pcb.historyRestore, {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        designId,
        checkpointId: version.checkpointId,
        expectedContentKey: contentKey,
        includeSupporting: supporting,
        removeAdded: remove,
      },
    })
      .then((result) => onRestored(result))
      .catch((error: unknown) => {
        setError(errorMessage(error));
        onConflict();
      })
      .finally(() => setBusy(false));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            Restore {designId.split("/").at(-1)} from{" "}
            {version.turn ? `turn ${version.turn}` : "the start"}?
          </DialogTitle>
          <DialogDescription>
            This replaces {plan?.design.length ?? "the"} design files in the workspace. One Undo
            returns all files.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-y-auto px-4 text-sm">
          {!plan && !error && <p role="status">Preparing restore...</p>}
          {plan && (
            <>
              <ul>
                {plan.design.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
              {!!plan.supporting.length && (
                <div>
                  <label>
                    <input
                      type="checkbox"
                      checked={supporting}
                      onChange={(e) => setSupporting(e.target.checked)}
                      disabled={busy}
                    />{" "}
                    Also restore {plan.supporting.length} supporting files
                  </label>
                  <p>Other designs may use these files.</p>
                  <ul>
                    {plan.supporting.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!plan.added.length && (
                <div>
                  <label>
                    <input
                      type="checkbox"
                      checked={remove}
                      onChange={(e) => setRemove(e.target.checked)}
                      disabled={busy}
                    />{" "}
                    Also remove {plan.added.length} files added since this version
                  </label>
                  <ul>
                    {plan.added.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!plan.editorLocks.length && (
                <p>
                  KiCad has this design open. Close it first, or KiCad may save over the restored
                  files.
                </p>
              )}
            </>
          )}
          {threadRunning && (
            <p>The agent is working in this thread and may change these files again.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !plan} onClick={() => void restore()}>
            {busy ? "Restoring..." : "Restore"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
