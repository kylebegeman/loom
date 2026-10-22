import { useState } from "react";
import type { AuthSessionState } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { signOutLoomBrowser } from "~/rpc/loomIdentity";

export function CurrentIdentitySession({ session }: { readonly session: AuthSessionState | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (
    !session?.authenticated ||
    !session.identity ||
    session.sessionMethod !== "browser-session-cookie"
  )
    return null;
  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <p className="text-sm font-medium">Identity</p>
      <p className="text-xs text-muted-foreground">
        Signed in through {session.identity.issuer}. Sign out to revoke this browser's access to
        this computer.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void signOutLoomBrowser()
            .then(() => window.location.replace("/pair"))
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Could not sign out. Try again.");
              setBusy(false);
            });
        }}
      >
        {busy ? "Signing out..." : "Sign out of this computer"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
