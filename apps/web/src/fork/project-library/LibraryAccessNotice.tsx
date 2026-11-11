import { KeyRoundIcon, UnplugIcon } from "lucide-react";
import {
  libraryAccessRepairNotice,
  type LibraryAccessRepairContext,
} from "@t3tools/client-runtime/fork";
import type { LibraryAccessRepair } from "@t3tools/contracts/fork";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { identityProfile } from "~/fork/identity/identityProfile";
import { useEnvironment } from "~/state/environments";
import { type EnvironmentAccessBlock, useLibraryAuthorityId } from "./state";
import { LibrarySignInLink } from "./LibrarySignInLink";

export function LibraryAccessRepairNotice({
  accessRepair,
  context,
  error,
  onLeave,
}: {
  readonly accessRepair?: LibraryAccessRepair | undefined;
  readonly context?: LibraryAccessRepairContext | undefined;
  readonly error?: string | null | undefined;
  readonly onLeave?: (() => void) | undefined;
}) {
  const libraryId = useLibraryAuthorityId();
  const environmentId = accessRepair?.environmentId ?? context?.environmentId ?? libraryId;
  const environment = useEnvironment(environmentId);
  const notice = libraryAccessRepairNotice(
    accessRepair,
    {
      authorityEnvironmentId: libraryId,
      ...context,
      environmentId,
      computerLabel:
        environment?.label ??
        (context?.environmentId === environmentId ? context.computerLabel : undefined),
      account:
        context?.account ??
        (environment ? identityProfile(environment.entry)?.identity : undefined),
    },
    error,
  );
  if (!notice) return null;
  const signIn = notice.destination.kind.endsWith("sign-in");
  return (
    <Alert variant="warning" role="status" controlAlignment="first-line">
      {signIn ? <KeyRoundIcon /> : <UnplugIcon />}
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>
        <p>{notice.description}</p>
        <p>{notice.afterReturn}</p>
        <div>
          <LibrarySignInLink
            destination={notice.destination}
            libraryEnvironmentId={libraryId}
            expectedIdentity={notice.expectedIdentity}
            label={notice.actionLabel}
            onClick={onLeave}
          />
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function LibraryAccessNotice({
  block,
  onLeave,
}: {
  readonly block: EnvironmentAccessBlock | null;
  readonly onLeave?: (() => void) | undefined;
}) {
  if (!block) return null;
  if (!block.repair)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {block.message}
      </p>
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{block.message}</p>
      <LibraryAccessRepairNotice
        accessRepair={{ kind: block.repair, environmentId: block.environmentId }}
        context={{ environmentId: block.environmentId, computerLabel: block.label }}
        onLeave={onLeave}
      />
    </div>
  );
}
