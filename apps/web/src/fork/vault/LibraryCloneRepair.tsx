import { useState } from "react";
import type { LibraryError } from "@t3tools/contracts/fork";
import { GitHubHostSetupSettings } from "~/components/settings/GitHubHostSetupSettings";
import { Button } from "~/components/ui/button";
export function LibraryCloneRepair({ repair }: { repair: NonNullable<LibraryError["repair"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="outline" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide GitHub setup" : `Set up GitHub on ${repair.label}`}
      </Button>
      {open ? (
        <GitHubHostSetupSettings
          environmentId={repair.environmentId}
          label={repair.label}
          onReady={() => undefined}
        />
      ) : null}
    </div>
  );
}
