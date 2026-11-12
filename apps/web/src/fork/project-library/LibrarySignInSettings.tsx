import { LibraryDeletedSettings, useRecentlyDeletedSupported } from "./RecentlyDeleted";
import { useAtomValue } from "@effect/atom-react";
import {
  identityRenewalLimitSeconds,
  librarySignIn,
  librarySignInText,
  LIBRARY_SIGN_IN_STATE_LABEL,
  loomIdentityAccountLabel,
  libraryProjectColor,
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
import { ChevronRightIcon, LibraryBigIcon } from "lucide-react";
import { SettingsSearchTarget, SettingsSection } from "~/components/settings/settingsLayout";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { LIBRARY_SURFACE, LibraryStateBadge } from "./LibraryControls";
import { projectColorStyle } from "./ProjectIdentity";
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
import { AccountDevices } from "../connections/AccountDevices";
import { ApproveComputer } from "../connections/ApproveComputer";
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
      <SettingsSearchTarget id={LIBRARY_SIGN_IN_TARGET} className="max-w-2xl">
        <div className="space-y-4 rounded-xl border border-border/60 p-5 sm:p-6">
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground"
          >
            <LibraryBigIcon className="size-5" />
          </span>
          {authority.authorityId !== null && authority.isReady ? (
            <p role="status" className="text-sm text-muted-foreground">
              This device is signed out of your Library. Sign in again to use it here.
            </p>
          ) : null}
          <LibrarySetup showConnectionsLink={false} />
        </div>
      </SettingsSearchTarget>
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
  const deletedSupported = useRecentlyDeletedSupported();
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
      ? {
          phase: environment.connection.phase,
          blockedReason: environment.connection.blockedReason,
          identity: account !== undefined,
        }
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
    <SettingsSearchTarget id={LIBRARY_SIGN_IN_TARGET} className="space-y-4">
      <section
        aria-label="Your Library"
        style={projectColorStyle(libraryProjectColor({ id: environment.environmentId }))}
        className={`${LIBRARY_SURFACE} space-y-5 p-5 sm:p-6`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-(--project-color)/12 text-(--project-color)"
            >
              <LibraryBigIcon className="size-6" />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="text-xs text-muted-foreground">Your Library</p>
              <h2 className="text-xl font-semibold tracking-tight wrap-anywhere">
                {environment.label}
              </h2>
              {address && address !== environment.label ? (
                <p className="text-xs text-muted-foreground wrap-anywhere">{address}</p>
              ) : null}
            </div>
          </div>
          <LibraryStateBadge
            tone={
              local || signIn.state === "current"
                ? "success"
                : signIn.state === "expired"
                  ? "danger"
                  : "neutral"
            }
          >
            {local ? "On this computer" : LIBRARY_SIGN_IN_STATE_LABEL[signIn.state]}
          </LibraryStateBadge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm text-muted-foreground wrap-anywhere">{accountLine}</p>
            {!local ? (
              <p
                role="status"
                className={`max-w-prose text-xs leading-relaxed ${signIn.state === "expired" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {librarySignInText(signIn, now)}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile !== undefined ? (
              <SavedIdentitySignIn
                entry={environment.entry}
                renewal
                actionLabel={actionLabel}
                actionVariant={actionVariant}
              />
            ) : cookieIdentity !== undefined ? (
              <LoomSignIn
                description={false}
                renewal
                actionLabel={actionLabel}
                actionVariant={actionVariant}
              />
            ) : null}
            {canSignOut && signIn.state !== "signed-out" ? (
              <Button
                shape="pill"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void signOut()}
              >
                {busy ? "Signing out..." : "Sign out"}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      <AccountDevices />
      <ApproveComputer />
      <div className="flex flex-col gap-1">
        <Collapsible>
          <CollapsibleTrigger
            render={<Button shape="pill" size="sm-multiline" variant="ghost-muted" />}
          >
            <ChevronRightIcon aria-hidden className="[[data-panel-open]_&]:rotate-90" />
            Use a different Library or account
          </CollapsibleTrigger>
          <CollapsiblePanel keepMounted>
            <div className="max-w-xl px-3 pt-4 pb-3">
              <LibrarySetup showConnectionsLink={false} />
            </div>
          </CollapsiblePanel>
        </Collapsible>
        {deletedSupported ? (
          <Collapsible>
            <CollapsibleTrigger
              render={<Button shape="pill" size="sm-multiline" variant="ghost-muted" />}
            >
              <ChevronRightIcon aria-hidden className="[[data-panel-open]_&]:rotate-90" />
              Deleted conversation history
            </CollapsibleTrigger>
            <CollapsiblePanel keepMounted>
              <div className="max-w-2xl pt-3">
                <SettingsSection title="Conversation history" hideTitle>
                  <LibraryDeletedSettings />
                </SettingsSection>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}
      </div>
    </SettingsSearchTarget>
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
