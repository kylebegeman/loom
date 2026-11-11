import { LIBRARY_ACCESS_REPAIR_RETURN_TEXT } from "@t3tools/client-runtime/fork";
import { useState } from "react";
import type { LibraryError } from "@t3tools/contracts/fork";
import { GitHubHostSetupSettings } from "~/components/settings/GitHubHostSetupSettings";
import { Button } from "~/components/ui/button";
import { LibraryDialog } from "../project-library/LibraryControls";

/** Setup opens in its own dialog: the palettes that show this clip anything taller than a row. */
export function LibraryCloneRepair({ repair }: { repair: NonNullable<LibraryError["repair"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        Host GitHub login is required on {repair.label}
        {repair.repository ? ` for ${repair.repository}` : ""}. {LIBRARY_ACCESS_REPAIR_RETURN_TEXT}
      </p>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Set up GitHub on {repair.label}
      </Button>
      {open ? (
        <LibraryDialog
          open
          onOpenChange={setOpen}
          title={`Set up GitHub on ${repair.label}`}
          description={`Set up host GitHub login on ${repair.label}. ${LIBRARY_ACCESS_REPAIR_RETURN_TEXT}`}
          actions={
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Done
            </Button>
          }
        >
          <GitHubHostSetupSettings
            environmentId={repair.environmentId}
            label={repair.label}
            onReady={() => undefined}
          />
        </LibraryDialog>
      ) : null}
    </div>
  );
}
