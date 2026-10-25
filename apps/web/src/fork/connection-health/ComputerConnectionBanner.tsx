import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import {
  CONNECTION_STALL_DETAIL,
  computerDirectoryHealth,
  connectionStallTitle,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { DIRECTORY_FEATURE } from "@t3tools/contracts/fork";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { KeyRoundIcon, SendIcon, WifiOffIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { ConnectionDiagnosisHeadline } from "~/components/settings/ConnectionDiagnosisDetails";
import { Button } from "~/components/ui/button";
import { directoryComputers } from "~/fork/directory-computers/state";
import { SavedIdentitySignIn } from "~/fork/identity/ComputerIdentityAccess";
import { identityProfile } from "~/fork/identity/identityProfile";
import { readLibraryAuthorityId } from "~/fork/project-library/state";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useEnvironment, type EnvironmentPresentation } from "~/state/environments";

/** Signing in again fixes this computer's connection, and this device can do it inline. */
export function needsIdentitySignIn(environment: EnvironmentPresentation): boolean {
  return (
    environment.connection.phase === "error" &&
    environment.connection.blockedReason === "authentication" &&
    identityProfile(environment.entry) !== undefined
  );
}

const nowFromMinute = (minute: string) => Date.parse(`${minute}Z`);

function StallTitle({ label, failingSince }: { label: string; failingSince: number }) {
  return <>{connectionStallTitle(label, failingSince, nowFromMinute(useNowMinute()))}</>;
}

/**
 * What the Library's directory says about a computer this device cannot reach. Reads the listing
 * live when it appears, since a kept one cannot say the computer is running now, and only while
 * the Library is connected. Nothing shows until the read answers.
 */
function DirectoryHealth({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const [libraryId] = useState(readLibraryAuthorityId);
  const library = useEnvironment(libraryId);
  const readable =
    library !== null &&
    library.environmentId !== environmentId &&
    library.connection.phase === "connected" &&
    supportsLoomFeature(library.serverConfig?.environment.capabilities, DIRECTORY_FEATURE);
  const live = useAtomValue(directoryComputers.listing(readable ? libraryId : null));
  const now = nowFromMinute(useNowMinute());
  if (!AsyncResult.isSuccess(live) || live.waiting) return null;
  const health = computerDirectoryHealth({
    listing: live.value.listing,
    environmentId,
    label,
    now,
  });
  if (health === null) return null;
  return <> {[health.text, health.attention].filter(Boolean).join(" ")}</>;
}

function StallDescription({ environment }: { environment: EnvironmentPresentation }) {
  return (
    <>
      {CONNECTION_STALL_DETAIL}
      <DirectoryHealth environmentId={environment.environmentId} label={environment.label} />{" "}
      <ConnectionDiagnosisHeadline environment={environment} />
    </>
  );
}

function reconnectingText(label: string, connection: EnvironmentConnectionPresentation) {
  return connection.phase === "offline"
    ? "This device is offline."
    : `${label} is ${connection.phase === "connecting" ? "connecting" : "reconnecting"}.`;
}

/**
 * The chat banner for a computer whose state needs more than the plain "reconnecting" notice:
 * a sign-in this device can do here, a follow-up waiting for the computer, or a reconnect that
 * has failed for over a minute. Null leaves the plain notice.
 */
export function computerConnectionBanner(input: {
  readonly environment: EnvironmentPresentation;
  readonly stalled: boolean;
  readonly held: boolean;
  readonly onRetry: () => void;
  readonly onCancelHeld: () => void;
  readonly disconnectAction: ReactNode;
}): ComposerBannerStackItem | null {
  const { environment, stalled, held } = input;
  const { connection, label } = environment;
  const id = `environment-unavailable:${environment.environmentId}`;
  const failingSince = stalled ? connection.failingSince : undefined;
  const retry = (
    <Button size="xs" variant="ghost" onClick={input.onRetry}>
      Retry now
    </Button>
  );
  if (needsIdentitySignIn(environment)) {
    return {
      id,
      variant: "warning",
      icon: <KeyRoundIcon />,
      title: `Sign in to ${label} again`,
      description: held
        ? "Your sign-in expired. Your follow-up sends once you sign in."
        : "Your sign-in expired, so Loom can't connect to it.",
      children: <SavedIdentitySignIn entry={environment.entry} />,
      actions: (
        <>
          {held ? (
            <Button size="xs" variant="ghost" onClick={input.onCancelHeld}>
              Cancel send
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" render={<Link to="/settings/connections" />}>
            Open connections
          </Button>
        </>
      ),
    };
  }
  if (held) {
    return {
      id,
      variant: "info",
      icon: <SendIcon />,
      title: `Sends when ${label} reconnects`,
      description:
        failingSince === undefined ? (
          reconnectingText(label, connection)
        ) : (
          <>
            <StallTitle label={label} failingSince={failingSince} />. <StallDescription environment={environment} />
          </>
        ),
      actions: (
        <>
          <Button size="xs" variant="ghost" onClick={input.onCancelHeld}>
            Cancel
          </Button>
          {connection.phase === "offline" ? null : retry}
        </>
      ),
    };
  }
  if (failingSince === undefined) return null;
  return {
    id,
    variant: "warning",
    icon: <WifiOffIcon />,
    title: <StallTitle label={label} failingSince={failingSince} />,
    description: <StallDescription environment={environment} />,
    actions: (
      <>
        {retry}
        {input.disconnectAction}
      </>
    ),
  };
}
