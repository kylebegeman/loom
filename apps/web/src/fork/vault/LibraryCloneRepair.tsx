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
      <Button variant="outline" onClick={() => setOpen(true)}>
        Set up GitHub on {repair.label}
      </Button>
      {open ? (
        <LibraryDialog
          open
          onOpenChange={setOpen}
          title={`Set up GitHub on ${repair.label}`}
          description="Cloning needs GitHub access on that computer. Set it up here, then try again."
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
