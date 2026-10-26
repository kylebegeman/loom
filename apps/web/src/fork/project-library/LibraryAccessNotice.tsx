import { Link } from "@tanstack/react-router";
import { KeyRoundIcon, UnplugIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { SavedIdentitySignIn } from "~/fork/identity/ComputerIdentityAccess";
import { useEnvironment } from "~/state/environments";
import { accessRepairTarget } from "./accessBlock";
import { type EnvironmentAccessBlock, useLibraryAuthorityId } from "./state";

/**
 * Says why a Library action is unavailable for access reasons and offers the repair where the
 * action is. Signing in again refreshes the session the action's permission reads, so the action
 * comes back without a reload. Connections stays one click away for pairing, or when the saved
 * sign-in itself reports a problem.
 */
export function LibraryAccessNotice({
  block,
  onLeave,
}: {
  readonly block: EnvironmentAccessBlock | null;
  /** Runs before opening Connections, so a dialog can close first. */
  readonly onLeave?: (() => void) | undefined;
}) {
  const environment = useEnvironment(block?.environmentId ?? null);
  const libraryId = useLibraryAuthorityId();
  if (!block) return null;
  if (!block.repair)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {block.message}
      </p>
    );
  const signIn = block.repair === "sign-in" && environment ? environment.entry : null;
  const target = accessRepairTarget(block, libraryId, environment !== null);
  return (
    <Alert variant="warning" role="status" controlAlignment="first-line">
      {signIn ? <KeyRoundIcon /> : <UnplugIcon />}
      <AlertTitle>{block.message}</AlertTitle>
      <AlertDescription>
        {signIn ? <SavedIdentitySignIn entry={signIn} /> : null}
        <div>
          <Button
            size="sm"
            variant={signIn ? "ghost" : "outline"}
            render={
              <Link to="/settings/connections" {...(target === null ? {} : { hash: target })} />
            }
            onClick={onLeave}
          >
            {target === null ? "Open connections" : "Library sign-in"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
