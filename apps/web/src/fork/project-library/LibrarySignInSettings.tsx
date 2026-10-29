import { LibraryDeletedSettings } from "./RecentlyDeleted";
import { useAtomValue } from "@effect/atom-react";
import {
  identityRenewalLimitSeconds,
  librarySignIn,
  librarySignInText,
  loomIdentityAccountLabel,
} from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { environmentCatalog } from "~/connection/catalog";
import { SavedIdentitySignIn } from "~/fork/identity/ComputerIdentityAccess";
import { identityProfile } from "~/fork/identity/identityProfile";
import { LoomSignIn } from "~/fork/identity/LoomSignIn";
import { identityRenewalAvailable } from "~/fork/identity/renewal";
import { useNowMinute } from "~/hooks/useNowMinute";
import { readLoomIdentity, signOutLoomBrowser } from "~/rpc/loomIdentity";
import { type EnvironmentPresentation, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentSessionState } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { LIBRARY_SIGN_IN_TARGET } from "./accessBlock";
import { LibrarySetup } from "./LibrarySetup";
import { useLibraryAuthority } from "./state";

const identityMetadata = Atom.family((baseUrl: string) =>
  Atom.make(Effect.promise(() => readLoomIdentity(baseUrl).catch(() => null))).pipe(
    Atom.setIdleTTL(5 * 60_000),
    Atom.withLabel(`loom-identity:metadata:${baseUrl}`),
  ),
);
const NO_METADATA = Atom.make(AsyncResult.success<LoomIdentityMetadata | null>(null));

const hostOf = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** Which Library this device signs in to, as whom, whether that is current, and the way back. */
export function LibrarySignInSettings() {
  const authority = useLibraryAuthority();
  if (authority.authorityId === null || authority.environment === null)
    return (
      <SettingsSection id={LIBRARY_SIGN_IN_TARGET} title="Library" hideTitle>
        <div className="space-y-3 px-3 py-4 sm:px-4">
          {authority.authorityId !== null && authority.isReady ? (
            <p role="status" className="text-sm text-muted-foreground">
              This device is signed out of your Library. Sign in again to use it here.
            </p>
          ) : null}
          <LibrarySetup showConnectionsLink={false} />
        </div>
      </SettingsSection>
    );
  return (
    <LibrarySignInStatus
      key={authority.environment.environmentId}
      environment={authority.environment}
    />
  );
}

function LibrarySignInStatus({ environment }: { readonly environment: EnvironmentPresentation }) {
  const session = useEnvironmentSessionState(environment.environmentId);
  const primaryId = usePrimaryEnvironmentId();
  const minute = useNowMinute();
  const [busy, setBusy] = useState(false);
  const remove = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const profile = identityProfile(environment.entry);
  const cookieIdentity =
    session.data?.sessionMethod === "browser-session-cookie" ? session.data.identity : undefined;
  const account = profile?.identity ?? cookieIdentity;
  const renewable = profile !== undefined && identityRenewalAvailable();
  const metadata = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(renewable ? identityMetadata(profile.httpBaseUrl) : NO_METADATA),
    ),
  );
  const now = Date.parse(`${minute}Z`);
  const signIn = librarySignIn({
    connection: environment.entry.enabled
      ? { phase: environment.connection.phase, identity: account !== undefined }
      : null,
    session: session.data
      ? {
          authenticated: session.data.authenticated,
          expiresAt: session.data.expiresAt ? DateTime.toEpochMillis(session.data.expiresAt) : null,
        }
      : null,
    sessionFailed: session.hasError,
    renews: renewable && metadata !== null && identityRenewalLimitSeconds(metadata) !== null,
    now,
  });
  const local = account === undefined && environment.environmentId === primaryId;
  const address = hostOf(profile?.httpBaseUrl ?? environment.displayUrl);
  const accountLine = account
    ? `Signed in as ${loomIdentityAccountLabel(account) ?? `an account on ${hostOf(account.issuer)}`}`
    : local
      ? "Your Library runs on this computer, so it needs no sign-in."
      : "Connected with a pairing link, not an account.";
  const signOut = async () => {
    const confirmed = await requestConfirmDialog(
      `Sign out of ${environment.label} on this device?\nThis ends the sign-in and removes the Library connection from this device, including its cached threads here. Sign in again to reconnect.`,
      { variant: "destructive" },
    );
    if (confirmed !== true) return;
    setBusy(true);
    if (cookieIdentity !== undefined && profile === undefined) {
      await signOutLoomBrowser().then(
        () => window.location.replace("/pair"),
        (cause: unknown) => signOutFailed(cause),
      );
      setBusy(false);
      return;
    }
    const result = await remove(environment.environmentId);
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      signOutFailed(squashAtomCommandFailure(result));
  };
  const canSignOut =
    (profile !== undefined && !environment.relayManaged) || cookieIdentity !== undefined;
  const actionLabel = signIn.state === "signed-out" ? "Sign in" : "Sign in again";
  const actionVariant = signIn.canSignIn ? "default" : "outline";
  return (
    <SettingsSection id={LIBRARY_SIGN_IN_TARGET} title="Library">
      <SettingsRow
        title={environment.label}
        description={
          <>
            {address && address !== environment.label ? (
              <span className="block">{address}</span>
            ) : null}
            <span className="block">{accountLine}</span>
          </>
        }
        status={
          local ? null : (
            <span
              role="status"
              className={signIn.state === "expired" ? "text-destructive" : undefined}
            >
              {librarySignInText(signIn, now)}
            </span>
          )
        }
        control={
          canSignOut && signIn.state !== "signed-out" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void signOut()}>
              {busy ? "Signing out..." : "Sign out"}
            </Button>
          ) : null
        }
      >
        {profile !== undefined ? (
          <div className="pb-2">
            <SavedIdentitySignIn
              entry={environment.entry}
              renewal
              actionLabel={actionLabel}
              actionVariant={actionVariant}
            />
          </div>
        ) : cookieIdentity !== undefined ? (
          <div className="pb-2">
            <LoomSignIn
              description={false}
              renewal
              actionLabel={actionLabel}
              actionVariant={actionVariant}
            />
          </div>
        ) : null}
      </SettingsRow>
      <LibraryDeletedSettings />
      <details className="px-3 py-3 text-sm sm:px-4">
        <summary className="cursor-pointer text-muted-foreground">
          Use a different Library or account
        </summary>
        <div className="mt-3">
          <LibrarySetup showConnectionsLink={false} />
        </div>
      </details>
    </SettingsSection>
  );
}

function signOutFailed(cause: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not sign out of the Library",
      description: cause instanceof Error ? cause.message : "Try again.",
    }),
  );
}
