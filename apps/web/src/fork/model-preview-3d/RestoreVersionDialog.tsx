import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
export function RestoreVersionDialog({
  open,
  label,
  differingIncludes,
  threadRunning,
  onClose,
  onRestore,
}: {
  open: boolean;
  label: string;
  differingIncludes: ReadonlyArray<string>;
  threadRunning: boolean;
  onClose: () => void;
  onRestore: (includeDependencies: boolean) => Promise<void>;
}) {
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = async () => {
    setBusy(true);
    setError(null);
    // The async wrapper routes a synchronous throw from onRestore or onClose into the catch.
    await (async () => {
      await onRestore(includeDependencies);
      onClose();
    })()
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not restore this version.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Restore {label}</DialogTitle>
          <DialogDescription>
            The workspace file will become this version. You can undo the restore until the file
            changes again.
          </DialogDescription>
        </DialogHeader>
        {threadRunning && (
          <p className="text-sm">
            An agent is working in this thread and may change the file again.
          </p>
        )}
        {differingIncludes.length > 0 && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeDependencies}
                onCheckedChange={setIncludeDependencies}
                disabled={busy}
              />
              Also restore included files
            </label>
            <ul className="max-h-40 overflow-y-auto text-xs">
              {differingIncludes.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void restore()}>
            {busy ? "Restoring…" : "Restore"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
